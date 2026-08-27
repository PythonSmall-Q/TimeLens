pub mod config;

use std::path::{Path, PathBuf};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};
use tokio::time::interval;

pub use config::{LlmConfig, LlmProvider};

const CONFIG_FILE_NAME: &str = "llm_config.toml";
pub const CONFIG_CHANGED_EVENT: &str = "llm-config-changed";

/// Resolve the path to the LLM config TOML file in the app data directory.
pub fn config_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    app_handle
        .path()
        .app_data_dir()
        .map(|dir| dir.join(CONFIG_FILE_NAME))
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))
}

/// Load the config from disk, or return the default config if the file does not exist.
pub fn load_config(path: &Path) -> Result<LlmConfig, String> {
    if !path.exists() {
        return Ok(LlmConfig::default());
    }
    let contents = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read LLM config: {}", e))?;
    toml::from_str(&contents).map_err(|e| format!("Failed to parse LLM config: {}", e))
}

/// Save the config to disk atomically.
pub fn save_config(path: &Path, config: &LlmConfig) -> Result<(), String> {
    let contents = toml::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize LLM config: {}", e))?;
    let temp_path = path.with_extension("toml.tmp");
    std::fs::write(&temp_path, contents)
        .map_err(|e| format!("Failed to write temporary LLM config: {}", e))?;
    std::fs::rename(&temp_path, path)
        .map_err(|e| format!("Failed to finalize LLM config: {}", e))?;
    Ok(())
}

/// Spawn a lightweight polling watcher that emits `llm-config-changed`
/// whenever the config file's modified time changes.
pub fn spawn_config_watcher(app_handle: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let path = match config_path(&app_handle) {
            Ok(p) => p,
            Err(e) => {
                log::warn!("Cannot resolve LLM config path: {}", e);
                return;
            }
        };

        let mut last_mtime = std::fs::metadata(&path)
            .and_then(|m| m.modified())
            .ok();

        let mut ticker = interval(Duration::from_millis(800));
        loop {
            ticker.tick().await;

            let current_mtime = std::fs::metadata(&path)
                .and_then(|m| m.modified())
                .ok();

            if current_mtime != last_mtime {
                last_mtime = current_mtime;
                let _ = app_handle.emit(CONFIG_CHANGED_EVENT, ());
            }
        }
    });
}
