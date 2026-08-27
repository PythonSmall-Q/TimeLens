use crate::llm::{self, config::LlmConfig};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::ShellExt;

/// Load the LLM configuration from the local TOML file.
#[tauri::command]
pub fn get_llm_config(app_handle: AppHandle) -> Result<LlmConfig, String> {
    let path = llm::config_path(&app_handle)?;
    llm::load_config(&path)
}

/// Save the LLM configuration to the local TOML file.
#[tauri::command]
pub fn set_llm_config(config: LlmConfig, app_handle: AppHandle) -> Result<(), String> {
    let path = llm::config_path(&app_handle)?;
    llm::save_config(&path, &config)?;
    // Emit the changed event explicitly so the UI updates immediately,
    // even before the file watcher detects it.
    let _ = app_handle.emit(llm::CONFIG_CHANGED_EVENT, ());
    Ok(())
}

/// Return the absolute path to the LLM config file.
#[tauri::command]
pub fn get_llm_config_path(app_handle: AppHandle) -> Result<String, String> {
    llm::config_path(&app_handle)
        .map(|p| p.to_string_lossy().to_string())
}

/// Open the LLM config TOML file with the system default application.
#[tauri::command]
pub async fn open_llm_config_file(app_handle: AppHandle) -> Result<(), String> {
    let path = llm::config_path(&app_handle)?;
    app_handle
        .shell()
        .open(path.to_string_lossy(), None)
        .map_err(|e| e.to_string())
}

/// Open the folder containing the LLM config TOML file.
#[tauri::command]
pub async fn open_llm_config_dir(app_handle: AppHandle) -> Result<(), String> {
    let path = llm::config_path(&app_handle)?;
    let dir = path.parent().ok_or("Failed to resolve config directory")?;
    app_handle
        .shell()
        .open(dir.to_string_lossy(), None)
        .map_err(|e| e.to_string())
}
