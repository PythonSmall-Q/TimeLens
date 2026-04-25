use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use uuid::Uuid;

use crate::models::WidgetConfig;

fn short_id() -> String {
    Uuid::new_v4().to_string()[..8].to_string()
}

fn default_size(widget_type: &str) -> (f64, f64) {
    match widget_type {
        "clock" => (300.0, 180.0),
        "todo" => (320.0, 420.0),
        "timer" => (360.0, 320.0),
        "note" => (560.0, 340.0),
        "status" => (520.0, 330.0),
        _ => (320.0, 240.0),
    }
}

/// Create a floating widget window and return its config id.
#[tauri::command]
pub async fn create_widget(
    widget_type: String,
    app: AppHandle,
) -> Result<WidgetConfig, String> {
    let id = format!("{}-{}", widget_type, short_id());
    let (width, height) = default_size(&widget_type);

    let config = WidgetConfig {
        id: id.clone(),
        widget_type: widget_type.clone(),
        x: 100.0,
        y: 100.0,
        width,
        height,
        opacity: 0.88,
        always_on_top_mode: "focus".to_string(),
        pinned: false,
        start_on_launch: true,
    };

    build_widget_window(&app, &config)?;

    Ok(config)
}

/// Re-open a previously saved widget window.
#[tauri::command]
pub async fn open_widget(config: WidgetConfig, app: AppHandle) -> Result<(), String> {
    // If already open, just focus it
    if let Some(win) = app.get_webview_window(&config.id) {
        win.show().map_err(|e| e.to_string())?;
        win.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    build_widget_window(&app, &config)?;
    Ok(())
}

/// Close a widget window (the config stays in DB for future restore).
#[tauri::command]
pub async fn close_widget(id: String, app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(&id) {
        win.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Update always-on-top mode for a running widget window.
#[tauri::command]
pub async fn set_widget_always_on_top(
    id: String,
    mode: String,
    app: AppHandle,
) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(&id) {
        let on_top = mode == "always";
        win.set_always_on_top(on_top).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn build_widget_window(app: &AppHandle, config: &WidgetConfig) -> Result<(), String> {
    build_widget_window_sync(app, config)
}

/// Public helper so lib.rs can call it directly without async overhead.
pub fn build_widget_window_sync(app: &AppHandle, config: &WidgetConfig) -> Result<(), String> {
    // Skip if window already exists
    if app.get_webview_window(&config.id).is_some() {
        return Ok(());
    }
    let url = WebviewUrl::App("index.html".into());
    let is_timer = config.widget_type == "timer";
    let is_note = config.widget_type == "note";
    let is_status = config.widget_type == "status";
    let (width, height) = if is_timer {
        (config.width.max(360.0), config.height.max(320.0))
    } else if is_note {
        (config.width.max(560.0), config.height.max(340.0))
    } else if is_status {
        (config.width.max(520.0), config.height.max(330.0))
    } else {
        (config.width, config.height)
    };
    let (min_w, min_h) = if is_timer {
        (320.0, 280.0)
    } else if is_note {
        (500.0, 300.0)
    } else if is_status {
        (460.0, 300.0)
    } else {
        (200.0, 120.0)
    };

    WebviewWindowBuilder::new(app, &config.id, url)
        .title(&format!("TimeLens - {}", config.widget_type))
        .inner_size(width, height)
        .position(config.x, config.y)
        .decorations(false)
        .transparent(true)
        .always_on_top(config.always_on_top_mode == "always")
        .skip_taskbar(false)
        .resizable(true)
        .min_inner_size(min_w, min_h)
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}
