/// Embedded local HTTP + WebSocket API server.
///
/// Endpoints:
///   GET  /api/screen-time/today          → Vec<AppUsageSummary>
///   GET  /api/screen-time/range?start=&end= → Vec<AppUsageSummary>
///   GET  /api/categories                 → Vec<AppCategoryRule>
///   GET  /api/status                     → { version, focus_active }
///   WS   /ws/active-window               → streams ActiveWindowInfo JSON

use std::sync::{Arc, Mutex};

use axum::{
    extract::{Query, State, WebSocketUpgrade},
    extract::ws::{Message, WebSocket},
    http::Method,
    response::{IntoResponse, Json},
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use tower_http::cors::{Any, CorsLayer};

use crate::db;
use crate::monitor::SharedMonitorStatus;
use crate::models::BrowserSession;

/// Shared state threaded through axum handlers.
#[derive(Clone)]
pub struct ApiState {
    pub db: Arc<Mutex<rusqlite::Connection>>,
    pub monitor_status: SharedMonitorStatus,
    pub api_token: String,
}

#[derive(Deserialize)]
struct RangeParams {
    start: Option<String>,
    end:   Option<String>,
}

#[derive(Serialize)]
struct StatusResponse {
    version: &'static str,
    focus_active: bool,
    browser_extension_enabled: bool,
}

#[derive(Serialize)]
struct BrowserLinkResponse {
    enabled: bool,
    app_name: &'static str,
    version: &'static str,
    api_base_url: &'static str,
}

#[derive(Deserialize)]
struct BrowserSessionInput {
    browser_name: String,
    tab_url: String,
    host: String,
    title: String,
    started_at: String,
    ended_at: String,
    duration_seconds: i64,
    locale: String,
}

async fn get_today(State(s): State<ApiState>) -> impl IntoResponse {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    match s.db.lock() {
        Ok(conn) => {
            let rows = db::get_app_totals_in_range(&conn, &today, &today)
                .unwrap_or_default();
            Json(rows).into_response()
        }
        Err(_) => axum::http::StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

async fn get_range(
    State(s): State<ApiState>,
    Query(p): Query<RangeParams>,
) -> impl IntoResponse {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let start = p.start.as_deref().unwrap_or(&today).to_string();
    let end   = p.end.as_deref().unwrap_or(&today).to_string();
    match s.db.lock() {
        Ok(conn) => {
            let rows = db::get_app_totals_in_range(&conn, &start, &end)
                .unwrap_or_default();
            Json(rows).into_response()
        }
        Err(_) => axum::http::StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

async fn get_categories(State(s): State<ApiState>) -> impl IntoResponse {
    match s.db.lock() {
        Ok(conn) => {
            let rows = db::get_all_app_categories(&conn).unwrap_or_default();
            Json(rows).into_response()
        }
        Err(_) => axum::http::StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

async fn get_status(State(s): State<ApiState>) -> impl IntoResponse {
    let (focus_active, browser_extension_enabled) = s
        .db
        .lock()
        .ok()
        .map(|conn| {
            (
                db::get_bool_setting(&conn, "focus_mode_active", false).unwrap_or(false),
                db::get_bool_setting(&conn, "browser_extension_enabled", true).unwrap_or(true),
            )
        })
        .unwrap_or((false, true));
    Json(StatusResponse {
        version: env!("CARGO_PKG_VERSION"),
        focus_active,
        browser_extension_enabled,
    })
}

async fn get_browser_link(State(s): State<ApiState>) -> impl IntoResponse {
    let enabled = s
        .db
        .lock()
        .ok()
        .and_then(|conn| db::get_bool_setting(&conn, "browser_extension_enabled", true).ok())
        .unwrap_or(true);
    Json(BrowserLinkResponse {
        enabled,
        app_name: "TimeLens",
        version: env!("CARGO_PKG_VERSION"),
        api_base_url: "http://127.0.0.1:49152",
    })
}

async fn post_browser_session(
    State(s): State<ApiState>,
    Json(payload): Json<BrowserSessionInput>,
) -> impl IntoResponse {
    let Ok(conn) = s.db.lock() else {
        return axum::http::StatusCode::INTERNAL_SERVER_ERROR;
    };

    let enabled = db::get_bool_setting(&conn, "browser_extension_enabled", true).unwrap_or(true);
    if !enabled {
        return axum::http::StatusCode::FORBIDDEN;
    }

    let synced_at = chrono::Local::now().to_rfc3339();
    let session = BrowserSession {
        id: None,
        browser_name: payload.browser_name.clone(),
        tab_url: payload.tab_url,
        host: payload.host,
        title: payload.title,
        started_at: payload.started_at,
        ended_at: payload.ended_at,
        duration_seconds: payload.duration_seconds,
        locale: payload.locale.clone(),
        synced_at: synced_at.clone(),
    };

    if db::insert_browser_session(&conn, &session).is_err() {
        return axum::http::StatusCode::INTERNAL_SERVER_ERROR;
    }
    let _ = db::set_setting(&conn, "browser_extension_last_sync_at", &synced_at);
    let _ = db::set_setting(&conn, "browser_extension_last_browser_name", &payload.browser_name);
    let _ = db::set_setting(&conn, "browser_extension_last_locale", &payload.locale);
    axum::http::StatusCode::NO_CONTENT
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(s): State<ApiState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws(socket, s))
}

async fn handle_ws(mut socket: WebSocket, state: ApiState) {
    // Push current active window every second
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        let info = {
            let st = state.monitor_status.lock().unwrap();
            serde_json::json!({
                "app_name": st.current_app,
                "exe_path": st.current_exe_path,
                "window_title": st.current_title,
                "active": st.active,
            })
        };
        let text = info.to_string();
        if socket.send(Message::Text(text.into())).await.is_err() {
            break;
        }
    }
}

/// Build and spawn the axum HTTP server.
/// Binds to 127.0.0.1:`port` (default 49152).
pub fn start_api_server(
    db: Arc<Mutex<rusqlite::Connection>>,
    monitor_status: SharedMonitorStatus,
    port: u16,
    api_token: String,
) {
    let state = ApiState { db, monitor_status, api_token };

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST])
        .allow_headers(Any);

    let app = Router::new()
        .route("/api/screen-time/today", get(get_today))
        .route("/api/screen-time/range", get(get_range))
        .route("/api/categories", get(get_categories))
        .route("/api/status", get(get_status))
        .route("/api/browser/link", get(get_browser_link))
        .route("/api/browser/session", post(post_browser_session))
        .route("/ws/active-window", get(ws_handler))
        .layer(cors)
        .with_state(state);

    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    tauri::async_runtime::spawn(async move {
        let listener = match tokio::net::TcpListener::bind(addr).await {
            Ok(l) => l,
            Err(e) => {
                log::error!("Local API server failed to bind {addr}: {e}");
                return;
            }
        };
        log::info!("TimeLens local API listening on http://{addr}");
        if let Err(e) = axum::serve(listener, app).await {
            log::error!("Local API server error: {e}");
        }
    });
}
