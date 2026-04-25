use tauri::State;

use crate::commands::storage_cmd::DbState;

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
    pub shortcuts: ShortcutSettings,
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
        shortcuts,
    })
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
