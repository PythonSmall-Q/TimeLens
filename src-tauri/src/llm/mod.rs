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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::config::{AnalysisRange, LlmDataSharing, LlmProvider};
    use std::collections::HashMap;

    /// Unique per-test temp directory so parallel tests never share a config file.
    fn temp_config_dir(test_name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "timelens-llm-config-test-{}-{}",
            test_name,
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn sample_config() -> LlmConfig {
        let mut providers = HashMap::new();
        providers.insert(
            "local".to_string(),
            LlmProvider {
                name: "Local LLM".to_string(),
                nickname: Some("Work Laptop".to_string()),
                base_url: "http://localhost:11434/v1".to_string(),
                model: "llama3.1".to_string(),
                api_key: Some("sk-local-secret".to_string()),
                builtin: false,
                referral_url: None,
            },
        );
        providers.insert(
            "openai".to_string(),
            LlmProvider {
                name: "OpenAI".to_string(),
                nickname: None,
                base_url: "https://api.openai.com/v1".to_string(),
                model: "gpt-4o-mini".to_string(),
                api_key: Some("sk-openai-secret".to_string()),
                builtin: true,
                referral_url: Some("https://platform.openai.com".to_string()),
            },
        );

        LlmConfig {
            active_provider_id: Some("local".to_string()),
            providers,
            data_sharing: LlmDataSharing {
                total_time: true,
                top_apps: false,
                categories: true,
                focus_time: false,
                goals: true,
                interruptions: false,
            },
            default_range: AnalysisRange::Last7Days,
        }
    }

    #[test]
    fn save_and_load_config_roundtrips_all_fields() {
        let dir = temp_config_dir("roundtrip");
        let path = dir.join("llm_config.toml");

        let config = sample_config();
        save_config(&path, &config).expect("save_config should succeed");
        assert!(path.is_file(), "config file should exist after save");

        let loaded = load_config(&path).expect("load_config should succeed");
        assert_eq!(loaded, config);

        assert_eq!(loaded.active_provider_id.as_deref(), Some("local"));
        assert_eq!(loaded.providers.len(), 2);

        let local = loaded.providers.get("local").expect("local provider");
        assert_eq!(local.name, "Local LLM");
        assert_eq!(local.nickname.as_deref(), Some("Work Laptop"));
        assert_eq!(local.base_url, "http://localhost:11434/v1");
        assert_eq!(local.model, "llama3.1");
        assert_eq!(local.api_key.as_deref(), Some("sk-local-secret"));
        assert!(!local.builtin);
        assert_eq!(local.referral_url, None);

        let openai = loaded.providers.get("openai").expect("openai provider");
        assert_eq!(openai.nickname, None);
        assert!(openai.builtin);
        assert_eq!(openai.api_key.as_deref(), Some("sk-openai-secret"));
        assert_eq!(
            openai.referral_url.as_deref(),
            Some("https://platform.openai.com")
        );

        assert!(loaded.data_sharing.total_time);
        assert!(!loaded.data_sharing.top_apps);
        assert!(loaded.data_sharing.categories);
        assert!(!loaded.data_sharing.focus_time);
        assert!(loaded.data_sharing.goals);
        assert!(!loaded.data_sharing.interruptions);

        assert_eq!(loaded.default_range, AnalysisRange::Last7Days);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn load_config_returns_default_when_file_missing() {
        let dir = temp_config_dir("missing");
        let path = dir.join("sub").join("llm_config.toml");

        let loaded = load_config(&path).expect("missing file should yield default config");
        assert_eq!(loaded, LlmConfig::default());
        assert!(loaded.providers.contains_key("orcarouter"));

        std::fs::remove_dir_all(&dir).ok();
    }
}
