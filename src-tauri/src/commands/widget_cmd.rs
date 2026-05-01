use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use uuid::Uuid;

use crate::commands::storage_cmd::DbState;
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

#[derive(Clone, Copy)]
struct Rect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

fn overlaps(a: Rect, b: Rect) -> bool {
    a.x < b.x + b.width
        && a.x + a.width > b.x
        && a.y < b.y + b.height
        && a.y + a.height > b.y
}

fn clamp_to_bounds(mut rect: Rect, bounds: Rect) -> Rect {
    if rect.x < bounds.x {
        rect.x = bounds.x;
    }
    if rect.y < bounds.y {
        rect.y = bounds.y;
    }
    if rect.x + rect.width > bounds.x + bounds.width {
        rect.x = (bounds.x + bounds.width - rect.width).max(bounds.x);
    }
    if rect.y + rect.height > bounds.y + bounds.height {
        rect.y = (bounds.y + bounds.height - rect.height).max(bounds.y);
    }
    rect
}

fn widget_window_label(label: &str) -> bool {
    ["clock-", "todo-", "timer-", "note-", "status-"]
        .iter()
        .any(|p| label.starts_with(p))
}

fn infer_monitor_bounds(app: &AppHandle) -> Option<Rect> {
    let main = app.get_webview_window("main")?;
    let monitor = main.current_monitor().ok()??;
    let pos = monitor.position();
    let size = monitor.size();
    Some(Rect {
        x: pos.x as f64,
        y: pos.y as f64,
        width: size.width as f64,
        height: size.height as f64,
    })
}

fn collect_open_widget_rects(app: &AppHandle) -> Vec<Rect> {
    let mut out = Vec::new();
    for (label, win) in app.webview_windows() {
        if !widget_window_label(label.as_str()) {
            continue;
        }
        let Ok(pos) = win.outer_position() else {
            continue;
        };
        let Ok(size) = win.outer_size() else {
            continue;
        };
        out.push(Rect {
            x: pos.x as f64,
            y: pos.y as f64,
            width: size.width as f64,
            height: size.height as f64,
        });
    }
    out
}

fn compute_spawn_position(app: &AppHandle, preferred_x: f64, preferred_y: f64, width: f64, height: f64) -> (f64, f64) {
    let bounds = infer_monitor_bounds(app).unwrap_or(Rect {
        x: 0.0,
        y: 0.0,
        width: 2560.0,
        height: 1440.0,
    });
    let occupied = collect_open_widget_rects(app);
    let step = 36.0;

    let mut candidate = clamp_to_bounds(
        Rect {
            x: preferred_x,
            y: preferred_y,
            width,
            height,
        },
        bounds,
    );

    for _ in 0..200 {
        if occupied.iter().all(|r| !overlaps(candidate, *r)) {
            return (candidate.x, candidate.y);
        }

        // Move down first, then right.
        candidate.y += step;
        if candidate.y + candidate.height > bounds.y + bounds.height {
            candidate.y = bounds.y;
            candidate.x += step;
        }
        candidate = clamp_to_bounds(candidate, bounds);
    }

    (candidate.x, candidate.y)
}

/// Create a floating widget window and return its config id.
#[tauri::command]
pub async fn create_widget(
    widget_type: String,
    app: AppHandle,
    db: tauri::State<'_, DbState>,
) -> Result<WidgetConfig, String> {
    let id = format!("{}-{}", widget_type, short_id());
    let (width, height) = default_size(&widget_type);

    let (preferred_x, preferred_y) = {
        let conn = db.lock().map_err(|e| e.to_string())?;
        let x = crate::db::get_setting(&conn, "last_widget_x")
            .map_err(|e| e.to_string())?
            .and_then(|v| v.parse::<f64>().ok())
            .unwrap_or(100.0);
        let y = crate::db::get_setting(&conn, "last_widget_y")
            .map_err(|e| e.to_string())?
            .and_then(|v| v.parse::<f64>().ok())
            .unwrap_or(100.0);
        (x, y)
    };

    let (x, y) = compute_spawn_position(&app, preferred_x, preferred_y, width, height);

    let config = WidgetConfig {
        id: id.clone(),
        widget_type: widget_type.clone(),
        x,
        y,
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
        .always_on_top(config.always_on_top_mode == "always")
        .skip_taskbar(false)
        .resizable(true)
        .min_inner_size(min_w, min_h)
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}
