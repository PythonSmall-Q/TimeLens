use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use chrono::Local;
use tauri::{AppHandle, Emitter};

use crate::models::ActiveWindowInfo;

/// Snapshot of what was being tracked in the previous poll cycle.
#[derive(Debug, Clone)]
struct Segment {
    app_name: String,
    window_title: String,
    start: Instant,
    first_seen_at: String,
}

/// Shared state readable from Tauri commands.
#[derive(Debug, Default, Clone, serde::Serialize)]
pub struct MonitorStatus {
    pub active: bool,
    pub current_app: String,
    pub current_title: String,
}

pub type SharedMonitorStatus = Arc<Mutex<MonitorStatus>>;

// ── Platform-specific active-window detection ─────────────────

#[cfg(target_os = "windows")]
fn friendly_windows_app_name(process_stem: &str, window_title: &str) -> String {
    let key = process_stem.trim().to_ascii_lowercase();

    if window_title.contains("腾讯会议") {
        return "腾讯会议".to_string();
    }

    if let Some(name) = match key.as_str() {
        "wemeet" => Some("WeMeet"),
        "wechat" => Some("WeChat"),
        "qq" => Some("QQ"),
        "feishu" => Some("Feishu"),
        "dingtalk" => Some("DingTalk"),
        "code" => Some("Visual Studio Code"),
        "msedge" => Some("Microsoft Edge"),
        "chrome" => Some("Google Chrome"),
        "firefox" => Some("Mozilla Firefox"),
        "teams" => Some("Microsoft Teams"),
        "notepad" => Some("NotePad"),
        "explorer" => Some("File Explorer"),
        _ => None,
    } {
        return name.to_string();
    }

    let cleaned = process_stem.trim().trim_end_matches(".exe");
    if cleaned.is_empty() {
        return "Unknown".to_string();
    }

    cleaned
        .split(|c: char| c == '_' || c == '-' || c == '.')
        .filter(|s| !s.is_empty())
        .map(|segment| {
            let mut chars = segment.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + &chars.as_str().to_ascii_lowercase(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(target_os = "windows")]
fn get_foreground_window_info() -> Option<(String, String)> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
    };
    use windows::Win32::System::Threading::{
        OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ,
    };
    use windows::Win32::System::ProcessStatus::GetModuleFileNameExW;

    unsafe {
        let hwnd: HWND = GetForegroundWindow();
        if hwnd.0.is_null() {
            return None;
        }

        // Window title
        let mut title_buf = [0u16; 512];
        let title_len = GetWindowTextW(hwnd, &mut title_buf);
        let title = if title_len > 0 {
            String::from_utf16_lossy(&title_buf[..title_len as usize])
        } else {
            String::new()
        };

        // Process name
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 {
            return Some(("Unknown".into(), title));
        }

        let handle = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, pid)
            .unwrap_or_default();
        if handle.is_invalid() {
            return Some(("Unknown".into(), title));
        }

        let mut path_buf = [0u16; 260];
        let path_len = GetModuleFileNameExW(handle, None, &mut path_buf);
        let _ = windows::Win32::Foundation::CloseHandle(handle);

        let app_name = if path_len > 0 {
            let path = String::from_utf16_lossy(&path_buf[..path_len as usize]);
            let stem = std::path::Path::new(&path)
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "Unknown".into());
            friendly_windows_app_name(&stem, &title)
        } else {
            "Unknown".into()
        };

        Some((app_name, title))
    }
}

#[cfg(target_os = "macos")]
fn get_foreground_window_info() -> Option<(String, String)> {
    use std::process::Command;

    let script = r#"
        tell application "System Events"
            set frontApp to first application process whose frontmost is true
            set appName to name of frontApp
            set winTitle to ""
            try
                set winTitle to name of front window of frontApp
            end try
            return appName & "|" & winTitle
        end tell
    "#;

    let output = Command::new("osascript").arg("-e").arg(script).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8(output.stdout).ok()?;
    let text = text.trim();
    let mut parts = text.splitn(2, '|');
    let app_name = parts.next()?.trim().to_string();
    let window_title = parts.next().unwrap_or("").trim().to_string();
    if app_name.is_empty() {
        return None;
    }
    Some((app_name, window_title))
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn get_foreground_window_info() -> Option<(String, String)> {
    // Linux / other platforms: not supported in MVP
    None
}

// ── Background monitor task ───────────────────────────────────

/// Spawn a background task that polls every `interval_ms` milliseconds.
/// Each time the active window changes (and the previous segment lasted ≥ `debounce_ms`),
/// it writes the segment to SQLite and emits an event to the frontend.
pub fn start_monitor_task(
    app_handle: AppHandle,
    db: Arc<Mutex<rusqlite::Connection>>,
    status: SharedMonitorStatus,
    interval_ms: u64,
    debounce_ms: u64,
) {
    std::thread::spawn(move || {
        let mut current: Option<Segment> = None;
        let poll_interval = Duration::from_millis(interval_ms);
        let debounce = Duration::from_millis(debounce_ms);

        loop {
            std::thread::sleep(poll_interval);

            // Check if monitoring is paused
            let active = {
                let s = status.lock().unwrap();
                s.active
            };
            if !active {
                current = None;
                continue;
            }

            let now_ts = Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
            let today = Local::now().format("%Y-%m-%d").to_string();

            match get_foreground_window_info() {
                None => {
                    // Nothing to track
                }
                Some((app_name, window_title)) => {
                    // Update status for frontend queries
                    {
                        let mut s = status.lock().unwrap();
                        s.current_app = app_name.clone();
                        s.current_title = window_title.clone();
                    }

                    // Emit event so the frontend can show live "current app"
                    let _ = app_handle.emit(
                        "active-window-changed",
                        ActiveWindowInfo {
                            app_name: app_name.clone(),
                            window_title: window_title.clone(),
                            timestamp: now_ts.clone(),
                        },
                    );

                    match &current {
                        None => {
                            // Start a new segment
                            current = Some(Segment {
                                app_name,
                                window_title,
                                start: Instant::now(),
                                first_seen_at: now_ts,
                            });
                        }
                        Some(seg) if seg.app_name == app_name => {
                            // Same app – keep accumulating
                        }
                        Some(seg) => {
                            // App switched – flush segment if it lasted long enough
                            let elapsed = seg.start.elapsed();
                            if elapsed >= debounce {
                                let seconds = elapsed.as_secs() as i64;
                                let seg_clone = seg.clone();
                                let db_arc = db.clone();
                                let today_c = today.clone();
                                let last_seen = now_ts.clone();
                                std::thread::spawn(move || {
                                    if let Ok(conn) = db_arc.lock() {
                                        let _ = crate::db::insert_app_usage(
                                            &conn,
                                            &today_c,
                                            &seg_clone.app_name,
                                            &seg_clone.window_title,
                                            seconds,
                                            &seg_clone.first_seen_at,
                                            &last_seen,
                                        );
                                    }
                                });
                            }
                            // Start fresh segment
                            current = Some(Segment {
                                app_name,
                                window_title,
                                start: Instant::now(),
                                first_seen_at: now_ts,
                            });
                        }
                    }
                }
            }
        }
    });
}
