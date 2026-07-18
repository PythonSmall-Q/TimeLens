/// Embedded local HTTP + WebSocket API server.
///
/// Endpoints:
///   GET  /api/screen-time/today          → Vec<AppUsageSummary>
///   GET  /api/screen-time/range?start=&end= → Vec<AppUsageSummary>
///   GET  /api/categories                 → Vec<AppCategoryRule>
///   GET  /api/status                     → { version, focus_active }
///   WS   /ws/active-window               → streams ActiveWindowInfo JSON
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::{Arc, Mutex};

use axum::{
    extract::ws::{Message, WebSocket},
    extract::{Query, State, WebSocketUpgrade},
    http::{HeaderMap, Method},
    response::{IntoResponse, Json},
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use tower_http::cors::{Any, CorsLayer};

use crate::commands::extension_bridge_cmd;
use crate::db;
use crate::models::{AppUsageSummary, BrowserSession, VsCodeLanguageDuration, VsCodeSession};
use crate::monitor::SharedMonitorStatus;

/// Default local API port. Extensions and widgets hardcode this as the primary
/// port; the backend falls back to a range if it is unavailable.
const DEFAULT_LOCAL_API_PORT: u16 = 49152;

/// Number of fallback ports to try if the default port cannot be bound.
const LOCAL_API_PORT_FALLBACK_COUNT: u16 = 1000;

static LOCAL_API_PORT: AtomicU16 = AtomicU16::new(DEFAULT_LOCAL_API_PORT);

/// Return the currently bound local API port. Before the server starts this is
/// the default port; afterwards it reflects the actual port the server is
/// listening on.
pub fn local_api_port() -> u16 {
    LOCAL_API_PORT.load(Ordering::SeqCst)
}

/// Return the base URL for the local API, e.g. `http://127.0.0.1:49152`.
pub fn local_api_base_url() -> String {
    format!("http://127.0.0.1:{}", local_api_port())
}

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
    end: Option<String>,
}

#[derive(Serialize)]
struct StatusResponse {
    version: &'static str,
    focus_active: bool,
    browser_extension_enabled: bool,
    extension_bridge_auth_required: bool,
}

#[derive(Serialize)]
struct BrowserLinkResponse {
    enabled: bool,
    app_name: &'static str,
    version: &'static str,
    api_base_url: String,
}

#[derive(Deserialize, Serialize)]
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

#[derive(Deserialize, Serialize)]
struct VsCodeLanguageDurationInput {
    language: String,
    seconds: i64,
}

#[derive(Deserialize, Serialize)]
struct VsCodeSessionInput {
    session_id: String,
    started_at: String,
    ended_at: String,
    duration_seconds: i64,
    project_name: Option<String>,
    project_path: Option<String>,
    language_durations: Option<Vec<VsCodeLanguageDurationInput>>,
}

#[derive(Deserialize)]
struct TrackingEnabledInput {
    enabled: bool,
    tracking_level: Option<String>,
}

#[derive(Serialize)]
struct TrackingEnabledResponse {
    enabled: bool,
    tracking_level: String,
}

fn write_api_audit_log(
    conn: &rusqlite::Connection,
    client_id: &str,
    endpoint: &str,
    method: &str,
    status_code: i64,
    detail: &str,
) {
    let now = chrono::Local::now().to_rfc3339();
    let _ = db::insert_api_audit_log(conn, &now, client_id, endpoint, method, status_code, detail);
}

/// Central API governance: allowlist, rate-limit, token validity, and scope checks.
/// Returns the resolved `X-Client-Id` on success.
///
/// `bridge_authenticated` is set to `true` when the caller has already proven
/// possession of the extension bridge key via a valid `X-Extension-Signature`.
/// In that case the allowlist and token-required checks are bypassed, and
/// scope enforcement is skipped unless a valid token is also provided.
fn enforce_api_governance_internal(
    conn: &rusqlite::Connection,
    headers: &HeaderMap,
    required_scope: Option<&str>,
    bridge_authenticated: bool,
) -> Result<String, axum::http::StatusCode> {
    let client_id = headers
        .get("X-Client-Id")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("")
        .trim()
        .to_string();

    let allowlist_enforced =
        db::get_bool_setting(conn, "local_api_allowlist_enforced", false).unwrap_or(false);
    if allowlist_enforced && !bridge_authenticated {
        if client_id.is_empty() {
            return Err(axum::http::StatusCode::FORBIDDEN);
        }
        // Widgets identify with client IDs starting with "widget-"; they are
        // allowed through the allowlist but still subject to token checks.
        let is_widget = client_id.starts_with("widget-");
        if !is_widget {
            let allowed = db::is_api_client_allowed(conn, &client_id).unwrap_or(false);
            if !allowed {
                return Err(axum::http::StatusCode::FORBIDDEN);
            }
        }
    }

    let rate_limit_per_min = db::get_setting(conn, "local_api_rate_limit_per_min")
        .ok()
        .flatten()
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(240);
    if rate_limit_per_min > 0 && !client_id.is_empty() {
        let since = (chrono::Local::now() - chrono::Duration::minutes(1)).to_rfc3339();
        let used = db::count_api_audit_log_since(conn, &client_id, &since).unwrap_or(0);
        if used >= rate_limit_per_min {
            return Err(axum::http::StatusCode::TOO_MANY_REQUESTS);
        }
    }

    let token_required =
        db::get_bool_setting(conn, "local_api_token_required", false).unwrap_or(false);
    let token = headers
        .get("X-Api-Token")
        .and_then(|h| h.to_str().ok())
        .map(|v| v.trim())
        .unwrap_or("")
        .to_string();

    if token_required && token.is_empty() && !bridge_authenticated {
        return Err(axum::http::StatusCode::FORBIDDEN);
    }

    // If a token is provided (or required), verify it and enforce scopes.
    if !token.is_empty() {
        let scopes = extension_bridge_cmd::verify_api_token(conn, &token, &client_id)
            .map_err(|_| axum::http::StatusCode::INTERNAL_SERVER_ERROR)?;
        match scopes {
            Some(scopes) => {
                if let Some(scope) = required_scope {
                    if !scopes.iter().any(|s| s == scope) {
                        return Err(axum::http::StatusCode::FORBIDDEN);
                    }
                }
            }
            None => {
                // Invalid token. A valid bridge signature still grants access,
                // but an invalid token on its own is not enough.
                if !bridge_authenticated {
                    return Err(axum::http::StatusCode::FORBIDDEN);
                }
            }
        }
    }

    Ok(client_id)
}

fn enforce_api_governance(
    conn: &rusqlite::Connection,
    headers: &HeaderMap,
    required_scope: Option<&str>,
) -> Result<String, axum::http::StatusCode> {
    enforce_api_governance_internal(conn, headers, required_scope, false)
}

/// Verify an extension bridge signature for POST request bodies.
/// Returns `true` when the signature is valid, `false` when no bridge key is
/// configured, or an error when a key is configured but the signature is
/// missing or invalid.
fn verify_extension_bridge_signature(
    conn: &rusqlite::Connection,
    headers: &HeaderMap,
    body_json: &str,
    client_id: &str,
    endpoint: &str,
    method: &str,
) -> Result<bool, axum::http::StatusCode> {
    let Ok(Some(key)) = db::get_setting(conn, "extension_bridge_key") else {
        return Ok(false);
    };

    let provided_signature = headers
        .get("X-Extension-Signature")
        .and_then(|h| h.to_str().ok());

    if let Some(sig) = provided_signature {
        if extension_bridge_cmd::verify_request_signature(body_json.as_bytes(), sig, &key) {
            return Ok(true);
        }
        write_api_audit_log(
            conn,
            client_id,
            endpoint,
            method,
            403,
            "invalid_extension_signature",
        );
        return Err(axum::http::StatusCode::FORBIDDEN);
    }

    write_api_audit_log(
        conn,
        client_id,
        endpoint,
        method,
        403,
        "missing_extension_signature",
    );
    Err(axum::http::StatusCode::FORBIDDEN)
}

async fn get_today(State(s): State<ApiState>, headers: HeaderMap) -> impl IntoResponse {
    let endpoint = "/api/screen-time/today";
    let method = "GET";
    let Ok(conn) = s.db.lock() else {
        return axum::http::StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };

    let client_id = match enforce_api_governance(&conn, &headers, Some("screen-time:read")) {
        Ok(client_id) => client_id,
        Err(code) => {
            write_api_audit_log(
                &conn,
                "",
                endpoint,
                method,
                code.as_u16() as i64,
                "governance_check_failed",
            );
            return code.into_response();
        }
    };

    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let rows: Vec<AppUsageSummary> = db::get_app_totals_in_range(&conn, &today, &today)
        .unwrap_or_default()
        .into_iter()
        .map(|(app_name, exe_path, total_seconds)| AppUsageSummary {
            app_name,
            exe_path,
            total_seconds,
        })
        .collect();
    write_api_audit_log(&conn, &client_id, endpoint, method, 200, "ok");
    Json(rows).into_response()
}

async fn get_range(State(s): State<ApiState>, headers: HeaderMap, Query(p): Query<RangeParams>) -> impl IntoResponse {
    let endpoint = "/api/screen-time/range";
    let method = "GET";
    let Ok(conn) = s.db.lock() else {
        return axum::http::StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };

    let client_id = match enforce_api_governance(&conn, &headers, Some("screen-time:read")) {
        Ok(client_id) => client_id,
        Err(code) => {
            write_api_audit_log(
                &conn,
                "",
                endpoint,
                method,
                code.as_u16() as i64,
                "governance_check_failed",
            );
            return code.into_response();
        }
    };

    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let start = p.start.as_deref().unwrap_or(&today).to_string();
    let end = p.end.as_deref().unwrap_or(&today).to_string();
    let rows: Vec<AppUsageSummary> = db::get_app_totals_in_range(&conn, &start, &end)
        .unwrap_or_default()
        .into_iter()
        .map(|(app_name, exe_path, total_seconds)| AppUsageSummary {
            app_name,
            exe_path,
            total_seconds,
        })
        .collect();
    write_api_audit_log(&conn, &client_id, endpoint, method, 200, "ok");
    Json(rows).into_response()
}

async fn get_categories(State(s): State<ApiState>, headers: HeaderMap) -> impl IntoResponse {
    let endpoint = "/api/categories";
    let method = "GET";
    let Ok(conn) = s.db.lock() else {
        return axum::http::StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };

    let client_id = match enforce_api_governance(&conn, &headers, Some("screen-time:read")) {
        Ok(client_id) => client_id,
        Err(code) => {
            write_api_audit_log(
                &conn,
                "",
                endpoint,
                method,
                code.as_u16() as i64,
                "governance_check_failed",
            );
            return code.into_response();
        }
    };

    let rows = db::get_all_app_categories(&conn).unwrap_or_default();
    write_api_audit_log(&conn, &client_id, endpoint, method, 200, "ok");
    Json(rows).into_response()
}

async fn get_status(State(s): State<ApiState>, headers: HeaderMap) -> impl IntoResponse {
    let endpoint = "/api/status";
    let method = "GET";
    let Ok(conn) = s.db.lock() else {
        return axum::http::StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };

    let client_id = match enforce_api_governance(&conn, &headers, None) {
        Ok(client_id) => client_id,
        Err(code) => {
            write_api_audit_log(
                &conn,
                "",
                endpoint,
                method,
                code.as_u16() as i64,
                "governance_check_failed",
            );
            return code.into_response();
        }
    };

    let (focus_active, browser_extension_enabled, extension_bridge_auth_required) = {
        (
            db::get_bool_setting(&conn, "focus_mode_active", false).unwrap_or(false),
            db::get_bool_setting(&conn, "browser_extension_enabled", true).unwrap_or(true),
            db::get_setting(&conn, "extension_bridge_key")
                .ok()
                .flatten()
                .map(|k| !k.trim().is_empty())
                .unwrap_or(false),
        )
    };
    write_api_audit_log(&conn, &client_id, endpoint, method, 200, "ok");
    Json(StatusResponse {
        version: env!("CARGO_PKG_VERSION"),
        focus_active,
        browser_extension_enabled,
        extension_bridge_auth_required,
    })
    .into_response()
}

async fn get_browser_link(State(s): State<ApiState>, headers: HeaderMap) -> impl IntoResponse {
    let endpoint = "/api/browser/link";
    let method = "GET";
    let Ok(conn) = s.db.lock() else {
        return axum::http::StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };

    let client_id = match enforce_api_governance(&conn, &headers, Some("browser:read")) {
        Ok(client_id) => client_id,
        Err(code) => {
            write_api_audit_log(
                &conn,
                "",
                endpoint,
                method,
                code.as_u16() as i64,
                "governance_check_failed",
            );
            return code.into_response();
        }
    };

    let enabled =
        db::get_bool_setting(&conn, "browser_extension_enabled", true).unwrap_or(true);
    write_api_audit_log(&conn, &client_id, endpoint, method, 200, "ok");
    Json(BrowserLinkResponse {
        enabled,
        app_name: "TimeLens",
        version: env!("CARGO_PKG_VERSION"),
        api_base_url: local_api_base_url(),
    })
    .into_response()
}

async fn post_browser_session(
    State(s): State<ApiState>,
    headers: HeaderMap,
    Json(payload): Json<BrowserSessionInput>,
) -> impl IntoResponse {
    let endpoint = "/api/browser/session";
    let method = "POST";
    let Ok(conn) = s.db.lock() else {
        return axum::http::StatusCode::INTERNAL_SERVER_ERROR;
    };

    let body_json = match serde_json::to_string(&payload) {
        Ok(j) => j,
        Err(_) => {
            write_api_audit_log(
                &conn,
                "",
                endpoint,
                method,
                500,
                "payload_serialization_failed",
            );
            return axum::http::StatusCode::INTERNAL_SERVER_ERROR;
        }
    };

    let bridge_auth = match verify_extension_bridge_signature(
        &conn, &headers, &body_json, "", endpoint, method,
    ) {
        Ok(b) => b,
        Err(code) => return code,
    };

    let client_id = match enforce_api_governance_internal(
        &conn,
        &headers,
        Some("browser:write"),
        bridge_auth,
    ) {
        Ok(client_id) => client_id,
        Err(code) => {
            write_api_audit_log(
                &conn,
                "",
                endpoint,
                method,
                code.as_u16() as i64,
                "governance_check_failed",
            );
            return code;
        }
    };

    let enabled = db::get_bool_setting(&conn, "browser_extension_enabled", true).unwrap_or(true);
    if !enabled {
        write_api_audit_log(
            &conn,
            &client_id,
            endpoint,
            method,
            403,
            "browser_extension_disabled",
        );
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
        write_api_audit_log(
            &conn,
            &client_id,
            endpoint,
            method,
            500,
            "insert_browser_session_failed",
        );
        return axum::http::StatusCode::INTERNAL_SERVER_ERROR;
    }
    let _ = db::set_setting(&conn, "browser_extension_last_sync_at", &synced_at);
    let _ = db::set_setting(
        &conn,
        "browser_extension_last_browser_name",
        &payload.browser_name,
    );
    let _ = db::set_setting(&conn, "browser_extension_last_locale", &payload.locale);
    write_api_audit_log(&conn, &client_id, endpoint, method, 204, "ok");
    axum::http::StatusCode::NO_CONTENT
}

async fn post_vscode_session(
    State(s): State<ApiState>,
    headers: HeaderMap,
    Json(payload): Json<VsCodeSessionInput>,
) -> impl IntoResponse {
    let endpoint = "/api/vscode/sessions";
    let method = "POST";
    let Ok(conn) = s.db.lock() else {
        return axum::http::StatusCode::INTERNAL_SERVER_ERROR;
    };

    let body_json = match serde_json::to_string(&payload) {
        Ok(j) => j,
        Err(_) => {
            write_api_audit_log(
                &conn,
                "",
                endpoint,
                method,
                500,
                "payload_serialization_failed",
            );
            return axum::http::StatusCode::INTERNAL_SERVER_ERROR;
        }
    };

    let bridge_auth = match verify_extension_bridge_signature(
        &conn, &headers, &body_json, "", endpoint, method,
    ) {
        Ok(b) => b,
        Err(code) => return code,
    };

    let client_id = match enforce_api_governance_internal(
        &conn,
        &headers,
        Some("vscode:write"),
        bridge_auth,
    ) {
        Ok(client_id) => client_id,
        Err(code) => {
            write_api_audit_log(
                &conn,
                "",
                endpoint,
                method,
                code.as_u16() as i64,
                "governance_check_failed",
            );
            return code;
        }
    };

    let enabled = db::get_bool_setting(&conn, "vscode_tracking_enabled", true).unwrap_or(true);
    if !enabled {
        write_api_audit_log(
            &conn,
            &client_id,
            endpoint,
            method,
            403,
            "vscode_tracking_disabled",
        );
        return axum::http::StatusCode::FORBIDDEN;
    }

    if payload.session_id.trim().is_empty() {
        write_api_audit_log(&conn, &client_id, endpoint, method, 400, "empty_session_id");
        return axum::http::StatusCode::BAD_REQUEST;
    }

    let date = chrono::DateTime::parse_from_rfc3339(&payload.started_at)
        .map(|dt| dt.format("%Y-%m-%d").to_string())
        .unwrap_or_else(|_| chrono::Local::now().format("%Y-%m-%d").to_string());

    let session = VsCodeSession {
        session_id: payload.session_id,
        date,
        started_at: payload.started_at,
        ended_at: payload.ended_at,
        duration_seconds: payload.duration_seconds.max(0),
        project_name: payload.project_name.unwrap_or_default(),
        project_path: payload.project_path.unwrap_or_default(),
        synced_at: chrono::Local::now().to_rfc3339(),
        language_durations: payload
            .language_durations
            .unwrap_or_default()
            .into_iter()
            .map(|item| VsCodeLanguageDuration {
                language: item.language,
                seconds: item.seconds.max(0),
            })
            .collect(),
    };

    if db::upsert_vscode_session(&conn, &session).is_err() {
        write_api_audit_log(
            &conn,
            &client_id,
            endpoint,
            method,
            500,
            "upsert_vscode_session_failed",
        );
        return axum::http::StatusCode::INTERNAL_SERVER_ERROR;
    }

    write_api_audit_log(&conn, &client_id, endpoint, method, 204, "ok");
    axum::http::StatusCode::NO_CONTENT
}

async fn get_vscode_stats_today(State(s): State<ApiState>, headers: HeaderMap) -> impl IntoResponse {
    let endpoint = "/api/vscode/stats/today";
    let method = "GET";
    let Ok(conn) = s.db.lock() else {
        return axum::http::StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };

    let client_id = match enforce_api_governance(&conn, &headers, Some("vscode:read")) {
        Ok(client_id) => client_id,
        Err(code) => {
            write_api_audit_log(
                &conn,
                "",
                endpoint,
                method,
                code.as_u16() as i64,
                "governance_check_failed",
            );
            return code.into_response();
        }
    };

    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let stats = db::get_vscode_stats_in_range(&conn, &today, &today).unwrap_or(
        crate::models::VsCodeStatsSummary {
            total_seconds: 0,
            session_count: 0,
        },
    );
    write_api_audit_log(&conn, &client_id, endpoint, method, 200, "ok");
    Json(stats).into_response()
}

async fn get_vscode_stats_range(
    State(s): State<ApiState>,
    headers: HeaderMap,
    Query(p): Query<RangeParams>,
) -> impl IntoResponse {
    let endpoint = "/api/vscode/stats/range";
    let method = "GET";
    let Ok(conn) = s.db.lock() else {
        return axum::http::StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };

    let client_id = match enforce_api_governance(&conn, &headers, Some("vscode:read")) {
        Ok(client_id) => client_id,
        Err(code) => {
            write_api_audit_log(
                &conn,
                "",
                endpoint,
                method,
                code.as_u16() as i64,
                "governance_check_failed",
            );
            return code.into_response();
        }
    };

    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let start = p.start.as_deref().unwrap_or(&today).to_string();
    let end = p.end.as_deref().unwrap_or(&today).to_string();
    let stats = db::get_vscode_stats_in_range(&conn, &start, &end).unwrap_or(
        crate::models::VsCodeStatsSummary {
            total_seconds: 0,
            session_count: 0,
        },
    );
    write_api_audit_log(&conn, &client_id, endpoint, method, 200, "ok");
    Json(stats).into_response()
}

async fn get_vscode_language_stats_range(
    State(s): State<ApiState>,
    headers: HeaderMap,
    Query(p): Query<RangeParams>,
) -> impl IntoResponse {
    let endpoint = "/api/vscode/languages/range";
    let method = "GET";
    let Ok(conn) = s.db.lock() else {
        return axum::http::StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };

    let client_id = match enforce_api_governance(&conn, &headers, Some("vscode:read")) {
        Ok(client_id) => client_id,
        Err(code) => {
            write_api_audit_log(
                &conn,
                "",
                endpoint,
                method,
                code.as_u16() as i64,
                "governance_check_failed",
            );
            return code.into_response();
        }
    };

    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let start = p.start.as_deref().unwrap_or(&today).to_string();
    let end = p.end.as_deref().unwrap_or(&today).to_string();
    let rows =
        db::get_vscode_language_stats_in_range(&conn, &start, &end).unwrap_or_default();
    write_api_audit_log(&conn, &client_id, endpoint, method, 200, "ok");
    Json(rows).into_response()
}

async fn get_vscode_project_stats_range(
    State(s): State<ApiState>,
    headers: HeaderMap,
    Query(p): Query<RangeParams>,
) -> impl IntoResponse {
    let endpoint = "/api/vscode/projects/range";
    let method = "GET";
    let Ok(conn) = s.db.lock() else {
        return axum::http::StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };

    let client_id = match enforce_api_governance(&conn, &headers, Some("vscode:read")) {
        Ok(client_id) => client_id,
        Err(code) => {
            write_api_audit_log(
                &conn,
                "",
                endpoint,
                method,
                code.as_u16() as i64,
                "governance_check_failed",
            );
            return code.into_response();
        }
    };

    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let start = p.start.as_deref().unwrap_or(&today).to_string();
    let end = p.end.as_deref().unwrap_or(&today).to_string();
    let rows =
        db::get_vscode_project_stats_in_range(&conn, &start, &end).unwrap_or_default();
    write_api_audit_log(&conn, &client_id, endpoint, method, 200, "ok");
    Json(rows).into_response()
}

async fn set_vscode_tracking_enabled(
    State(s): State<ApiState>,
    headers: HeaderMap,
    Json(payload): Json<TrackingEnabledInput>,
) -> impl IntoResponse {
    let endpoint = "/api/vscode/enabled";
    let method = "POST";
    let Ok(conn) = s.db.lock() else {
        return axum::http::StatusCode::INTERNAL_SERVER_ERROR;
    };

    let client_id = match enforce_api_governance(&conn, &headers, Some("vscode:write")) {
        Ok(client_id) => client_id,
        Err(code) => {
            write_api_audit_log(
                &conn,
                "",
                endpoint,
                method,
                code.as_u16() as i64,
                "governance_check_failed",
            );
            return code;
        }
    };

    if db::set_bool_setting(&conn, "vscode_tracking_enabled", payload.enabled).is_err() {
        return axum::http::StatusCode::INTERNAL_SERVER_ERROR;
    }

    if let Some(level) = &payload.tracking_level {
        if matches!(level.as_str(), "basic" | "standard" | "detailed") {
            let _ = db::set_setting(&conn, "vscode_tracking_level", level);
        }
    }

    write_api_audit_log(&conn, &client_id, endpoint, method, 204, "ok");
    axum::http::StatusCode::NO_CONTENT
}

async fn get_vscode_tracking_enabled(State(s): State<ApiState>, headers: HeaderMap) -> impl IntoResponse {
    let endpoint = "/api/vscode/enabled";
    let method = "GET";
    let Ok(conn) = s.db.lock() else {
        return axum::http::StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };

    let client_id = match enforce_api_governance(&conn, &headers, Some("vscode:read")) {
        Ok(client_id) => client_id,
        Err(code) => {
            write_api_audit_log(
                &conn,
                "",
                endpoint,
                method,
                code.as_u16() as i64,
                "governance_check_failed",
            );
            return code.into_response();
        }
    };

    let enabled =
        db::get_bool_setting(&conn, "vscode_tracking_enabled", true).unwrap_or(true);
    let tracking_level = db::get_setting(&conn, "vscode_tracking_level")
        .ok()
        .flatten()
        .unwrap_or_else(|| "standard".to_string());
    write_api_audit_log(&conn, &client_id, endpoint, method, 200, "ok");
    Json(TrackingEnabledResponse {
        enabled,
        tracking_level,
    })
    .into_response()
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    headers: HeaderMap,
    State(s): State<ApiState>,
) -> impl IntoResponse {
    let endpoint = "/ws/active-window";
    let method = "GET";
    let state_for_ws = s.clone();
    let Ok(conn) = s.db.lock() else {
        return axum::http::StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };

    match enforce_api_governance(&conn, &headers, Some("active-window:subscribe")) {
        Ok(client_id) => {
            write_api_audit_log(&conn, &client_id, endpoint, method, 101, "ok");
            ws.on_upgrade(move |socket| handle_ws(socket, state_for_ws))
        }
        Err(code) => {
            write_api_audit_log(
                &conn,
                "",
                endpoint,
                method,
                code.as_u16() as i64,
                "governance_check_failed",
            );
            code.into_response()
        }
    }
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
/// Binds to 127.0.0.1 on the default port (49152) and falls back to a small
/// range of higher ports if the default is unavailable (e.g. blocked by the
/// OS or an antivirus).
pub fn start_api_server(
    db: Arc<Mutex<rusqlite::Connection>>,
    monitor_status: SharedMonitorStatus,
    api_token: String,
) {
    let state = ApiState {
        db,
        monitor_status,
        api_token,
    };

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
        .route("/api/vscode/sessions", post(post_vscode_session))
        .route("/api/vscode/stats/today", get(get_vscode_stats_today))
        .route("/api/vscode/stats/range", get(get_vscode_stats_range))
        .route(
            "/api/vscode/languages/range",
            get(get_vscode_language_stats_range),
        )
        .route(
            "/api/vscode/projects/range",
            get(get_vscode_project_stats_range),
        )
        .route("/api/vscode/enabled", get(get_vscode_tracking_enabled))
        .route("/api/vscode/enabled", post(set_vscode_tracking_enabled))
        .route("/ws/active-window", get(ws_handler))
        .layer(cors)
        .with_state(state);

    tauri::async_runtime::spawn(async move {
        let mut bound_listener = None;
        let mut chosen_port = DEFAULT_LOCAL_API_PORT;
        for port in DEFAULT_LOCAL_API_PORT..=DEFAULT_LOCAL_API_PORT + LOCAL_API_PORT_FALLBACK_COUNT {
            let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
            match tokio::net::TcpListener::bind(addr).await {
                Ok(listener) => {
                    bound_listener = Some(listener);
                    chosen_port = port;
                    break;
                }
                Err(e) => {
                    log::warn!("Local API server failed to bind {addr}: {e}");
                }
            }
        }
        let Some(listener) = bound_listener else {
            log::error!(
                "Local API server could not bind to any port in the range {}-{}",
                DEFAULT_LOCAL_API_PORT,
                DEFAULT_LOCAL_API_PORT + LOCAL_API_PORT_FALLBACK_COUNT
            );
            return;
        };
        LOCAL_API_PORT.store(chosen_port, Ordering::SeqCst);
        log::info!("TimeLens local API listening on http://127.0.0.1:{chosen_port}");
        if let Err(e) = axum::serve(listener, app).await {
            log::error!("Local API server error: {e}");
        }
    });
}
