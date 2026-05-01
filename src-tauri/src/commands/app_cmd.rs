use tauri::State;

use crate::commands::storage_cmd::DbState;
use crate::models::{BrowserExtensionStatus, BrowserSession};

#[derive(serde::Serialize, serde::Deserialize)]
pub struct ShortcutSettings {
    pub open_widget_center: String,
    pub toggle_widget_visibility: String,
    pub start_recording: String,
    pub pause_recording: String,
}

#[derive(serde::Serialize)]
pub struct AppSettingsPayload {
    pub launch_at_startup: bool,
    pub silent_startup: bool,
    pub auto_open_widgets: bool,
    pub ignore_system_processes: bool,
    pub idle_time_policy: String,
    pub track_window_titles: bool,
    pub browser_extension_enabled: bool,
    pub shortcuts: ShortcutSettings,
}

#[derive(serde::Serialize)]
pub struct InstallChannelInfo {
    pub platform: String,
    pub channel: String,
    pub should_trigger_update: bool,
}

#[cfg(target_os = "windows")]
fn is_microsoft_store_install() -> bool {
    if std::env::var("APPX_PACKAGE_FAMILY_NAME").is_ok() {
        return true;
    }

    if let Ok(exe) = std::env::current_exe() {
        let p = exe.to_string_lossy().to_ascii_lowercase();
        if p.contains("\\windowsapps\\") {
            return true;
        }
    }

    false
}

#[cfg(not(target_os = "windows"))]
fn is_microsoft_store_install() -> bool {
    false
}

#[tauri::command]
pub fn get_install_channel_info() -> InstallChannelInfo {
    #[cfg(target_os = "windows")]
    {
        let is_store = is_microsoft_store_install();
        return InstallChannelInfo {
            platform: "windows".to_string(),
            channel: if is_store {
                "microsoft-store".to_string()
            } else {
                "direct".to_string()
            },
            should_trigger_update: !is_store,
        };
    }

    #[cfg(target_os = "macos")]
    {
        return InstallChannelInfo {
            platform: "macos".to_string(),
            channel: "direct".to_string(),
            should_trigger_update: true,
        };
    }

    #[cfg(target_os = "linux")]
    {
        return InstallChannelInfo {
            platform: "linux".to_string(),
            channel: "direct".to_string(),
            should_trigger_update: true,
        };
    }

    #[allow(unreachable_code)]
    InstallChannelInfo {
        platform: "unknown".to_string(),
        channel: "direct".to_string(),
        should_trigger_update: true,
    }
}

#[cfg(target_os = "windows")]
const RUN_KEY_PATH: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
#[cfg(target_os = "windows")]
const RUN_VALUE_NAME: &str = "TimeLens";

#[cfg(target_os = "windows")]
fn get_windows_autostart_enabled() -> Result<bool, String> {
    use winreg::RegKey;
    use winreg::enums::HKEY_CURRENT_USER;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let run = hkcu
        .open_subkey(RUN_KEY_PATH)
        .map_err(|e| format!("open Run key failed: {e}"))?;
    let value: Result<String, _> = run.get_value(RUN_VALUE_NAME);
    Ok(value.map(|v| !v.trim().is_empty()).unwrap_or(false))
}

#[cfg(not(target_os = "windows"))]
fn get_windows_autostart_enabled() -> Result<bool, String> {
    Ok(false)
}

#[cfg(target_os = "windows")]
fn set_windows_autostart_enabled(enabled: bool) -> Result<(), String> {
    use winreg::RegKey;
    use winreg::enums::HKEY_CURRENT_USER;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (run, _) = hkcu
        .create_subkey(RUN_KEY_PATH)
        .map_err(|e| format!("create/open Run key failed: {e}"))?;

    if enabled {
        let exe = std::env::current_exe().map_err(|e| format!("current_exe failed: {e}"))?;
        let cmd = format!("\"{}\" --autostart", exe.display());
        run.set_value(RUN_VALUE_NAME, &cmd)
            .map_err(|e| format!("set Run value failed: {e}"))?;
    } else {
        let _ = run.delete_value(RUN_VALUE_NAME);
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn set_windows_autostart_enabled(_enabled: bool) -> Result<(), String> {
    Ok(())
}

fn default_shortcuts() -> ShortcutSettings {
    ShortcutSettings {
        open_widget_center: "Alt+W".to_string(),
        toggle_widget_visibility: "Alt+Shift+W".to_string(),
        start_recording: "Alt+R".to_string(),
        pause_recording: "Alt+P".to_string(),
    }
}

#[tauri::command]
pub fn get_app_settings(db: State<DbState>) -> Result<AppSettingsPayload, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    let launch_at_startup = get_windows_autostart_enabled().unwrap_or(false);
    let silent_startup = crate::db::get_bool_setting(&conn, "silent_startup", true)
        .map_err(|e| e.to_string())?;
    let auto_open_widgets = crate::db::get_bool_setting(&conn, "auto_open_widgets", true)
        .map_err(|e| e.to_string())?;
    let ignore_system_processes = crate::db::get_bool_setting(&conn, "ignore_system_processes", false)
        .map_err(|e| e.to_string())?;
    let idle_time_policy = crate::db::get_setting(&conn, "idle_time_policy")
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| "count".to_string());
    let track_window_titles = crate::db::get_bool_setting(&conn, "track_window_titles", true)
        .map_err(|e| e.to_string())?;
    let browser_extension_enabled = crate::db::get_bool_setting(&conn, "browser_extension_enabled", true)
        .map_err(|e| e.to_string())?;

    let mut shortcuts = default_shortcuts();
    if let Some(v) = crate::db::get_setting(&conn, "shortcut_open_widget_center")
        .map_err(|e| e.to_string())?
    {
        shortcuts.open_widget_center = v;
    }
    if let Some(v) = crate::db::get_setting(&conn, "shortcut_toggle_widget_visibility")
        .map_err(|e| e.to_string())?
    {
        shortcuts.toggle_widget_visibility = v;
    }
    if let Some(v) = crate::db::get_setting(&conn, "shortcut_start_recording")
        .map_err(|e| e.to_string())?
    {
        shortcuts.start_recording = v;
    }
    if let Some(v) = crate::db::get_setting(&conn, "shortcut_pause_recording")
        .map_err(|e| e.to_string())?
    {
        shortcuts.pause_recording = v;
    }

    Ok(AppSettingsPayload {
        launch_at_startup,
        silent_startup,
        auto_open_widgets,
        ignore_system_processes,
        idle_time_policy,
        track_window_titles,
        browser_extension_enabled,
        shortcuts,
    })
}

#[tauri::command]
pub fn get_browser_extension_status(db: State<DbState>) -> Result<BrowserExtensionStatus, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let enabled = crate::db::get_bool_setting(&conn, "browser_extension_enabled", true)
        .map_err(|e| e.to_string())?;
    let last_sync_at = crate::db::get_setting(&conn, "browser_extension_last_sync_at")
        .map_err(|e| e.to_string())?;
    let last_browser_name = crate::db::get_setting(&conn, "browser_extension_last_browser_name")
        .map_err(|e| e.to_string())?;
    let last_locale = crate::db::get_setting(&conn, "browser_extension_last_locale")
        .map_err(|e| e.to_string())?;
    let recent_sessions = crate::db::get_recent_browser_sessions(&conn, 6)
        .map_err(|e| e.to_string())?;
    let recent_session_count = crate::db::count_browser_sessions(&conn).map_err(|e| e.to_string())?;

    Ok(BrowserExtensionStatus {
        enabled,
        api_base_url: "http://127.0.0.1:49152".to_string(),
        connected: last_sync_at.is_some(),
        last_sync_at,
        last_browser_name,
        last_locale,
        recent_session_count,
        recent_sessions,
    })
}

#[tauri::command]
pub fn set_browser_extension_enabled(enabled: bool, db: State<DbState>) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    crate::db::set_bool_setting(&conn, "browser_extension_enabled", enabled).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_launch_at_startup(enabled: bool, db: State<DbState>) -> Result<(), String> {
    set_windows_autostart_enabled(enabled)?;

    let conn = db.lock().map_err(|e| e.to_string())?;
    crate::db::set_bool_setting(&conn, "launch_at_startup", enabled).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_silent_startup(enabled: bool, db: State<DbState>) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    crate::db::set_bool_setting(&conn, "silent_startup", enabled).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_auto_open_widgets(enabled: bool, db: State<DbState>) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    crate::db::set_bool_setting(&conn, "auto_open_widgets", enabled).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_ignore_system_processes(enabled: bool, db: State<DbState>) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    crate::db::set_bool_setting(&conn, "ignore_system_processes", enabled).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_idle_time_policy(policy: String, db: State<DbState>) -> Result<(), String> {
    let normalized = match policy.as_str() {
        "count" | "exclude" => policy,
        _ => return Err("idle_time_policy must be 'count' or 'exclude'".to_string()),
    };
    let conn = db.lock().map_err(|e| e.to_string())?;
    crate::db::set_setting(&conn, "idle_time_policy", &normalized).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_track_window_titles(enabled: bool, db: State<DbState>) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    crate::db::set_bool_setting(&conn, "track_window_titles", enabled).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_shortcuts(shortcuts: ShortcutSettings, db: State<DbState>) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    crate::db::set_setting(&conn, "shortcut_open_widget_center", &shortcuts.open_widget_center)
        .map_err(|e| e.to_string())?;
    crate::db::set_setting(
        &conn,
        "shortcut_toggle_widget_visibility",
        &shortcuts.toggle_widget_visibility,
    )
    .map_err(|e| e.to_string())?;
    crate::db::set_setting(&conn, "shortcut_start_recording", &shortcuts.start_recording)
        .map_err(|e| e.to_string())?;
    crate::db::set_setting(&conn, "shortcut_pause_recording", &shortcuts.pause_recording)
        .map_err(|e| e.to_string())?;

    Ok(())
}

fn xml_escape(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(target_os = "windows")]
fn send_windows_toast(title: &str, body: &str, alarm: bool) -> Result<(), String> {
    use windows::Data::Xml::Dom::XmlDocument;
    use windows::UI::Notifications::{ToastNotification, ToastNotificationManager};

    let scenario = if alarm { " scenario=\"alarm\"" } else { "" };
    let audio = if alarm {
        "<audio src=\"ms-winsoundevent:Notification.Looping.Alarm2\" loop=\"true\"/>"
    } else {
        ""
    };

    let xml = format!(
        "<toast{scenario}><visual><binding template=\"ToastGeneric\"><text>{}</text><text>{}</text></binding></visual>{audio}</toast>",
        xml_escape(title),
        xml_escape(body)
    );

    let doc = XmlDocument::new().map_err(|e| format!("xml document create failed: {e}"))?;
    doc.LoadXml(&xml.into())
        .map_err(|e| format!("toast xml load failed: {e}"))?;

    let toast = ToastNotification::CreateToastNotification(&doc)
        .map_err(|e| format!("create toast failed: {e}"))?;

    let app_id = "ShanWenxiao.TimeLens-TimeManagementAppwithWidgets";
    let notifier = ToastNotificationManager::CreateToastNotifierWithId(&app_id.into())
        .or_else(|_| ToastNotificationManager::CreateToastNotifier())
        .map_err(|e| format!("create notifier failed: {e}"))?;

    notifier
        .Show(&toast)
        .map_err(|e| format!("show toast failed: {e}"))
}

#[tauri::command]
pub fn send_native_notification(title: String, body: String, alarm: Option<bool>) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        return send_windows_toast(&title, &body, alarm.unwrap_or(false));
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (&title, &body, &alarm);
        Err("native toast alarm is only implemented on Windows".to_string())
    }
}
