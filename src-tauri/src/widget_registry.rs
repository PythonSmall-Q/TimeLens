use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WidgetRegistryItem {
    pub widget_type: String,
    pub display_name: String,
    pub source: String,
    pub description: Option<String>,
    pub entry: Option<String>,
    pub icon: Option<String>,
    pub default_width: f64,
    pub default_height: f64,
    pub permissions: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WidgetRegistryLoadError {
    pub path: String,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WidgetRegistryResponse {
    pub items: Vec<WidgetRegistryItem>,
    pub errors: Vec<WidgetRegistryLoadError>,
}

#[derive(Debug, Deserialize)]
struct ThirdPartyWidgetManifest {
    widget_type: String,
    name: String,
    description: Option<String>,
    entry: String,
    icon: Option<String>,
    default_size: Option<ThirdPartyWidgetSize>,
    permissions: Option<Vec<String>>,
    /// Optional SHA-256 hex digest of the entry JS file for integrity verification.
    signature: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ThirdPartyWidgetSize {
    width: f64,
    height: f64,
}

fn official_widgets() -> Vec<WidgetRegistryItem> {
    vec![
        WidgetRegistryItem {
            widget_type: "clock".to_string(),
            display_name: "Clock".to_string(),
            source: "official".to_string(),
            description: Some("Built-in clock widget".to_string()),
            entry: None,
            icon: Some("clock".to_string()),
            default_width: 300.0,
            default_height: 180.0,
            permissions: Vec::new(),
        },
        WidgetRegistryItem {
            widget_type: "todo".to_string(),
            display_name: "Todo".to_string(),
            source: "official".to_string(),
            description: Some("Built-in todo widget".to_string()),
            entry: None,
            icon: Some("todo".to_string()),
            default_width: 320.0,
            default_height: 420.0,
            permissions: Vec::new(),
        },
        WidgetRegistryItem {
            widget_type: "timer".to_string(),
            display_name: "Timer".to_string(),
            source: "official".to_string(),
            description: Some("Built-in timer widget".to_string()),
            entry: None,
            icon: Some("timer".to_string()),
            default_width: 360.0,
            default_height: 320.0,
            permissions: Vec::new(),
        },
        WidgetRegistryItem {
            widget_type: "note".to_string(),
            display_name: "Note".to_string(),
            source: "official".to_string(),
            description: Some("Built-in note widget".to_string()),
            entry: None,
            icon: Some("note".to_string()),
            default_width: 560.0,
            default_height: 340.0,
            permissions: Vec::new(),
        },
        WidgetRegistryItem {
            widget_type: "status".to_string(),
            display_name: "Habit Tracker".to_string(),
            source: "official".to_string(),
            description: Some("Built-in status widget".to_string()),
            entry: None,
            icon: Some("status".to_string()),
            default_width: 520.0,
            default_height: 330.0,
            permissions: Vec::new(),
        },
    ]
}

fn third_party_widgets_root(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(data_dir.join("widgets"))
}

fn is_valid_widget_type(widget_type: &str) -> bool {
    !widget_type.is_empty()
        && widget_type
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn load_third_party_widget_from_manifest(
    manifest_path: &Path,
) -> Result<WidgetRegistryItem, WidgetRegistryLoadError> {
    load_third_party_widget_from_manifest_path(manifest_path).map_err(|e| WidgetRegistryLoadError {
        path: e.path,
        message: e.message,
    })
}

/// Public version used by widget_permissions commands.
pub fn load_third_party_widget_from_manifest_path(
    manifest_path: &Path,
) -> Result<WidgetRegistryItem, WidgetRegistryLoadError> {
    let manifest_text = fs::read_to_string(manifest_path).map_err(|e| WidgetRegistryLoadError {
        path: manifest_path.display().to_string(),
        message: format!("failed to read manifest: {e}"),
    })?;

    let manifest: ThirdPartyWidgetManifest =
        serde_json::from_str(&manifest_text).map_err(|e| WidgetRegistryLoadError {
            path: manifest_path.display().to_string(),
            message: format!("invalid manifest json: {e}"),
        })?;

    if !is_valid_widget_type(&manifest.widget_type) {
        return Err(WidgetRegistryLoadError {
            path: manifest_path.display().to_string(),
            message: "invalid widget_type: only [a-zA-Z0-9_-] allowed".to_string(),
        });
    }

    let Some(parent_dir) = manifest_path.parent() else {
        return Err(WidgetRegistryLoadError {
            path: manifest_path.display().to_string(),
            message: "manifest path has no parent directory".to_string(),
        });
    };

    let entry_path = parent_dir.join(&manifest.entry);
    if !entry_path.exists() {
        return Err(WidgetRegistryLoadError {
            path: manifest_path.display().to_string(),
            message: format!("entry file not found: {}", entry_path.display()),
        });
    }

    // ── Signature verification (Phase B) ─────────────────────
    if let Some(expected_sig) = &manifest.signature {
        let entry_bytes = fs::read(&entry_path).map_err(|e| WidgetRegistryLoadError {
            path: manifest_path.display().to_string(),
            message: format!("failed to read entry for signature check: {e}"),
        })?;
        let mut hasher = Sha256::new();
        hasher.update(&entry_bytes);
        let actual_hex = format!("{:x}", hasher.finalize());
        if actual_hex != expected_sig.to_ascii_lowercase() {
            return Err(WidgetRegistryLoadError {
                path: manifest_path.display().to_string(),
                message: format!(
                    "signature mismatch: expected {}, got {}",
                    expected_sig, actual_hex
                ),
            });
        }
    }

    let default_width = manifest.default_size.as_ref().map(|s| s.width).unwrap_or(320.0);
    let default_height = manifest.default_size.as_ref().map(|s| s.height).unwrap_or(240.0);

    Ok(WidgetRegistryItem {
        widget_type: manifest.widget_type,
        display_name: manifest.name,
        source: "third-party".to_string(),
        description: manifest.description,
        entry: Some(entry_path.display().to_string()),
        icon: manifest.icon,
        default_width,
        default_height,
        permissions: manifest.permissions.unwrap_or_default(),
    })
}

pub fn load_widget_registry(app: &AppHandle) -> WidgetRegistryResponse {
    let mut items = official_widgets();
    let mut errors: Vec<WidgetRegistryLoadError> = Vec::new();

    let root = match third_party_widgets_root(app) {
        Ok(root) => root,
        Err(e) => {
            errors.push(WidgetRegistryLoadError {
                path: "app_data/widgets".to_string(),
                message: format!("failed to resolve widgets directory: {e}"),
            });
            return WidgetRegistryResponse { items, errors };
        }
    };

    if !root.exists() {
        return WidgetRegistryResponse { items, errors };
    }

    let Ok(entries) = fs::read_dir(&root) else {
        errors.push(WidgetRegistryLoadError {
            path: root.display().to_string(),
            message: "failed to read widgets directory".to_string(),
        });
        return WidgetRegistryResponse { items, errors };
    };

    for entry in entries.flatten() {
        let widget_dir = entry.path();
        if !widget_dir.is_dir() {
            continue;
        }

        let manifest_path = widget_dir.join("manifest.json");
        if !manifest_path.exists() {
            continue;
        }

        match load_third_party_widget_from_manifest(&manifest_path) {
            Ok(item) => {
                if items.iter().any(|existing| existing.widget_type == item.widget_type) {
                    errors.push(WidgetRegistryLoadError {
                        path: manifest_path.display().to_string(),
                        message: format!("duplicate widget_type: {}", item.widget_type),
                    });
                    continue;
                }
                items.push(item);
            }
            Err(err) => errors.push(err),
        }
    }

    WidgetRegistryResponse { items, errors }
}

pub fn get_widget_by_type(app: &AppHandle, widget_type: &str) -> Option<WidgetRegistryItem> {
    let registry = load_widget_registry(app);
    registry
        .items
        .into_iter()
        .find(|item| item.widget_type == widget_type)
}
