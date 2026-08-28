use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Deserializer, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

#[derive(Debug, Default, Serialize, Deserialize, Clone)]
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
    #[serde(default = "default_manifest_version")]
    pub manifest_version: String,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sdk_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub csp: Option<String>,
    // v4 runtime rewrite fields
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_entry: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_memory_budget_mb: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_cpu_budget_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ui_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capability_justifications: Option<HashMap<String, String>>,
    #[serde(default)]
    pub network_domains_requested: Vec<String>,
    #[serde(default)]
    pub media_sources_requested: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub publisher_verification: Option<String>,
}

fn default_manifest_version() -> String {
    "v1".to_string()
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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WidgetManifestSize {
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WidgetManifestRuntime {
    pub language: String,
    pub version: String,
    pub entry: Option<String>,
    pub memory_budget_mb: Option<i64>,
    pub cpu_budget_ms: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WidgetManifestUi {
    pub model: String,
}

/// Normalized manifest representation used by the registry (covers v2 and v4).
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WidgetManifestV2 {
    pub widget_type: String,
    pub name: String,
    pub description: Option<String>,
    pub entry: String,
    pub icon: Option<String>,
    pub default_size: Option<WidgetManifestSize>,
    pub manifest_version: String,
    pub capabilities: Vec<String>,
    pub permissions: Vec<String>,
    pub sdk_version: Option<String>,
    pub csp: Option<String>,
    pub signature: Option<String>,
    pub runtime: Option<WidgetManifestRuntime>,
    pub ui: Option<WidgetManifestUi>,
    pub capability_justifications: Option<HashMap<String, String>>,
    pub network_domains_requested: Vec<String>,
    pub media_sources_requested: Vec<String>,
    pub publisher_verification: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(untagged)]
pub enum RawCapability {
    Name(String),
    Object {
        capability: String,
        permission: Option<String>,
    },
}

impl RawCapability {
    pub fn capability(&self) -> &str {
        match self {
            RawCapability::Name(s) | RawCapability::Object { capability: s, .. } => s,
        }
    }

    pub fn explicit_permission(&self) -> Option<&str> {
        match self {
            RawCapability::Object {
                permission: Some(p),
                ..
            } => Some(p),
            _ => None,
        }
    }
}

fn deserialize_manifest_version<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    use serde::de::Error;
    let value = serde_json::Value::deserialize(deserializer)?;
    match value {
        serde_json::Value::String(s) => Ok(s),
        serde_json::Value::Number(n) => Ok(format!(
            "v{}",
            n.as_i64().ok_or_else(|| D::Error::custom("invalid manifest version number"))?
        )),
        _ => Err(D::Error::custom(
            "manifest_version must be a string or integer",
        )),
    }
}

#[derive(Debug, Deserialize, Clone)]
pub struct RawWidgetRuntime {
    language: String,
    version: String,
    #[serde(default)]
    entry: Option<String>,
    #[serde(default)]
    memory_budget_mb: Option<i64>,
    #[serde(default)]
    cpu_budget_ms: Option<i64>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct RawWidgetUi {
    model: String,
}

#[derive(Debug, Default, Deserialize)]
pub struct RawWidgetManifest {
    widget_type: String,
    name: String,
    description: Option<String>,
    entry: String,
    icon: Option<String>,
    default_size: Option<ThirdPartyWidgetSize>,
    #[serde(
        default = "default_manifest_version",
        deserialize_with = "deserialize_manifest_version"
    )]
    manifest_version: String,
    permissions: Option<Vec<String>>,
    capabilities: Option<Vec<RawCapability>>,
    sdk_version: Option<String>,
    csp: Option<String>,
    /// Optional SHA-256 hex digest of the entry JS file for integrity verification.
    signature: Option<String>,
    #[serde(default)]
    runtime: Option<RawWidgetRuntime>,
    #[serde(default)]
    ui: Option<RawWidgetUi>,
    #[serde(default)]
    capability_justifications: Option<HashMap<String, String>>,
    #[serde(default)]
    network_domains_requested: Option<Vec<String>>,
    #[serde(default)]
    media_sources_requested: Option<Vec<String>>,
    #[serde(default)]
    publisher_verification: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ThirdPartyWidgetSize {
    width: f64,
    height: f64,
}

/// Map legacy v1 permission strings to v2 capability names.
fn map_permission_to_capability(permission: &str) -> &'static str {
    match permission {
        "todo:write" | "settings:write" => "write_data",
        "active-window:subscribe" => "automation_trigger",
        "local-api:call" | "api:call" => "local_api_call",
        _ => "read_metrics",
    }
}

/// Map v2 capability names back to the runtime permission strings they imply.
pub fn expand_capability_to_permissions(capability: &str) -> Vec<&'static str> {
    match capability {
        "read_metrics" => vec!["screen-time:read", "todo:read"],
        "write_data" => vec!["todo:write", "settings:write"],
        "automation_trigger" => vec!["active-window:subscribe"],
        "local_api_call" => vec!["local-api:call"],
        _ => vec![],
    }
}

fn dedup_sort(items: Vec<String>) -> Vec<String> {
    let mut unique: Vec<String> = items.into_iter().collect();
    unique.sort();
    unique.dedup();
    unique
}

fn parse_manifest_version_number(version: &str) -> u32 {
    version
        .strip_prefix('v')
        .or_else(|| version.strip_prefix('V'))
        .and_then(|n| n.parse::<u32>().ok())
        .unwrap_or(0)
}

/// Convert a legacy v1/v2 manifest or a v4 manifest into a normalized
/// `WidgetManifestV2`. Returns an error if `manifest_version > v4`.
pub fn normalize_manifest_v1_to_v2(manifest: RawWidgetManifest) -> Result<WidgetManifestV2, String> {
    let version_num = parse_manifest_version_number(&manifest.manifest_version);
    if version_num > 4 {
        return Err("unsupported manifest version".to_string());
    }

    let is_v4 = version_num == 4;

    let (capabilities, permissions) = if let Some(caps) = manifest.capabilities {
        let mut cap_names: Vec<String> = Vec::new();
        let mut perms: Vec<String> = Vec::new();
        for cap in caps {
            let name = cap.capability().to_string();
            cap_names.push(name.clone());
            if is_v4 {
                // v4 uses capability scopes directly as runtime permissions.
                perms.push(name.clone());
            } else if let Some(p) = cap.explicit_permission() {
                perms.push(p.to_string());
            } else {
                perms.extend(
                    expand_capability_to_permissions(&name)
                        .into_iter()
                        .map(String::from),
                );
            }
        }
        // Also preserve any explicit permissions if present (for forward compat).
        if let Some(explicit) = manifest.permissions {
            perms.extend(explicit);
        }
        (dedup_sort(cap_names), dedup_sort(perms))
    } else {
        // v1 manifest: permissions are authoritative; derive capabilities.
        let perms = manifest.permissions.unwrap_or_default();
        let caps: Vec<String> = if is_v4 {
            perms.clone()
        } else {
            perms
                .iter()
                .map(|p| map_permission_to_capability(p).to_string())
                .collect()
        };
        (dedup_sort(caps), dedup_sort(perms))
    };

    let runtime = manifest.runtime.map(|r| WidgetManifestRuntime {
        language: r.language,
        version: r.version,
        entry: r.entry,
        memory_budget_mb: r.memory_budget_mb,
        cpu_budget_ms: r.cpu_budget_ms,
    });
    let ui = manifest.ui.map(|u| WidgetManifestUi { model: u.model });

    Ok(WidgetManifestV2 {
        widget_type: manifest.widget_type,
        name: manifest.name,
        description: manifest.description,
        entry: manifest.entry,
        icon: manifest.icon,
        default_size: manifest.default_size.map(|s| WidgetManifestSize {
            width: s.width,
            height: s.height,
        }),
        manifest_version: if is_v4 { "v4".to_string() } else { "v2".to_string() },
        capabilities,
        permissions,
        sdk_version: manifest.sdk_version,
        csp: manifest.csp,
        signature: manifest.signature,
        runtime,
        ui,
        capability_justifications: manifest.capability_justifications,
        network_domains_requested: manifest.network_domains_requested.unwrap_or_default(),
        media_sources_requested: manifest.media_sources_requested.unwrap_or_default(),
        publisher_verification: manifest.publisher_verification,
    })
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
            manifest_version: "v2".to_string(),
            capabilities: vec!["read_metrics".to_string()],
            sdk_version: None,
            csp: None,
            ..Default::default()
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
            manifest_version: "v2".to_string(),
            capabilities: vec!["read_metrics".to_string()],
            sdk_version: None,
            csp: None,
            ..Default::default()
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
            manifest_version: "v2".to_string(),
            capabilities: Vec::new(),
            sdk_version: None,
            csp: None,
            ..Default::default()
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
            manifest_version: "v2".to_string(),
            capabilities: Vec::new(),
            sdk_version: None,
            csp: None,
            ..Default::default()
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
            manifest_version: "v2".to_string(),
            capabilities: vec!["read_metrics".to_string()],
            sdk_version: None,
            csp: None,
            ..Default::default()
        },
        WidgetRegistryItem {
            widget_type: "pet".to_string(),
            display_name: "Desktop Pet".to_string(),
            source: "official".to_string(),
            description: Some("Built-in manifest-driven desktop pet widget".to_string()),
            entry: None,
            icon: Some("pet".to_string()),
            default_width: 420.0,
            default_height: 300.0,
            permissions: Vec::new(),
            manifest_version: "v2".to_string(),
            capabilities: vec!["read_metrics".to_string()],
            sdk_version: None,
            csp: None,
            ..Default::default()
        },
        WidgetRegistryItem {
            widget_type: "focus-coach".to_string(),
            display_name: "Focus Coach".to_string(),
            source: "official".to_string(),
            description: Some("Built-in focus session coach widget".to_string()),
            entry: None,
            icon: Some("focus-coach".to_string()),
            default_width: 300.0,
            default_height: 320.0,
            permissions: Vec::new(),
            manifest_version: "v2".to_string(),
            capabilities: vec!["read_metrics".to_string()],
            sdk_version: None,
            csp: None,
            ..Default::default()
        },
        WidgetRegistryItem {
            widget_type: "quick-capture".to_string(),
            display_name: "Quick Capture".to_string(),
            source: "official".to_string(),
            description: Some("Built-in quick capture widget".to_string()),
            entry: None,
            icon: Some("quick-capture".to_string()),
            default_width: 320.0,
            default_height: 220.0,
            permissions: Vec::new(),
            manifest_version: "v2".to_string(),
            capabilities: Vec::new(),
            sdk_version: None,
            csp: None,
            ..Default::default()
        },
        WidgetRegistryItem {
            widget_type: "session-pulse".to_string(),
            display_name: "Session Pulse".to_string(),
            source: "official".to_string(),
            description: Some("Built-in session pulse widget".to_string()),
            entry: None,
            icon: Some("session-pulse".to_string()),
            default_width: 360.0,
            default_height: 340.0,
            permissions: Vec::new(),
            manifest_version: "v2".to_string(),
            capabilities: vec!["read_metrics".to_string()],
            sdk_version: None,
            csp: None,
            ..Default::default()
        },
        WidgetRegistryItem {
            widget_type: "goal-progress".to_string(),
            display_name: "Goal Progress".to_string(),
            source: "official".to_string(),
            description: Some("Built-in goal progress widget".to_string()),
            entry: None,
            icon: Some("goal-progress".to_string()),
            default_width: 340.0,
            default_height: 360.0,
            permissions: Vec::new(),
            manifest_version: "v2".to_string(),
            capabilities: vec!["read_metrics".to_string()],
            sdk_version: None,
            csp: None,
            ..Default::default()
        },
        WidgetRegistryItem {
            widget_type: "browser-activity".to_string(),
            display_name: "Browser Activity".to_string(),
            source: "official".to_string(),
            description: Some("Built-in browser activity widget".to_string()),
            entry: None,
            icon: Some("browser-activity".to_string()),
            default_width: 320.0,
            default_height: 340.0,
            permissions: Vec::new(),
            manifest_version: "v2".to_string(),
            capabilities: Vec::new(),
            sdk_version: None,
            csp: None,
            ..Default::default()
        },
        WidgetRegistryItem { widget_type: "skin-preview".to_string(), display_name: "Skin Preview".to_string(), source: "official".to_string(), description: Some("Built-in skin preview widget".to_string()), icon: Some("skin-preview".to_string()), default_width: 320.0, default_height: 240.0, manifest_version: "v2".to_string(), ..Default::default() },
        WidgetRegistryItem { widget_type: "layout-switcher".to_string(), display_name: "Layout Switcher".to_string(), source: "official".to_string(), description: Some("Built-in layout preset widget".to_string()), icon: Some("layout-switcher".to_string()), default_width: 320.0, default_height: 300.0, manifest_version: "v2".to_string(), ..Default::default() },
        WidgetRegistryItem { widget_type: "widget-health".to_string(), display_name: "Widget Health".to_string(), source: "official".to_string(), description: Some("Built-in widget health widget".to_string()), icon: Some("widget-health".to_string()), default_width: 320.0, default_height: 260.0, manifest_version: "v2".to_string(), ..Default::default() },
        WidgetRegistryItem { widget_type: "focus-streak".to_string(), display_name: "Focus Streak".to_string(), source: "official".to_string(), description: Some("Built-in focus streak widget".to_string()), icon: Some("focus-streak".to_string()), default_width: 280.0, default_height: 220.0, manifest_version: "v2".to_string(), ..Default::default() },
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

    let raw: RawWidgetManifest =
        serde_json::from_str(&manifest_text).map_err(|e| WidgetRegistryLoadError {
            path: manifest_path.display().to_string(),
            message: format!("invalid manifest json: {e}"),
        })?;

    if !is_valid_widget_type(&raw.widget_type) {
        return Err(WidgetRegistryLoadError {
            path: manifest_path.display().to_string(),
            message: "invalid widget_type: only [a-zA-Z0-9_-] allowed".to_string(),
        });
    }

    let manifest = normalize_manifest_v1_to_v2(raw).map_err(|message| WidgetRegistryLoadError {
        path: manifest_path.display().to_string(),
        message,
    })?;

    let Some(parent_dir) = manifest_path.parent() else {
        return Err(WidgetRegistryLoadError {
            path: manifest_path.display().to_string(),
            message: "manifest path has no parent directory".to_string(),
        });
    };

    if manifest
        .runtime
        .as_ref()
        .is_some_and(|runtime| runtime.language.eq_ignore_ascii_case("java"))
    {
        return Err(WidgetRegistryLoadError {
            path: manifest_path.display().to_string(),
            message: "java runtime is unsupported: no JVM host is enabled".to_string(),
        });
    }

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

    let default_width = manifest
        .default_size
        .as_ref()
        .map(|s| s.width)
        .unwrap_or(320.0);
    let default_height = manifest
        .default_size
        .as_ref()
        .map(|s| s.height)
        .unwrap_or(240.0);

    Ok(WidgetRegistryItem {
        widget_type: manifest.widget_type,
        display_name: manifest.name,
        source: "third-party".to_string(),
        description: manifest.description,
        entry: Some(entry_path.display().to_string()),
        icon: manifest.icon,
        default_width,
        default_height,
        permissions: manifest.permissions,
        manifest_version: manifest.manifest_version,
        capabilities: manifest.capabilities,
        sdk_version: manifest.sdk_version,
        csp: manifest.csp,
        runtime_language: manifest.runtime.as_ref().map(|r| r.language.clone()),
        runtime_version: manifest.runtime.as_ref().map(|r| r.version.clone()),
        runtime_entry: manifest.runtime.as_ref().and_then(|r| r.entry.clone()),
        runtime_memory_budget_mb: manifest.runtime.as_ref().and_then(|r| r.memory_budget_mb),
        runtime_cpu_budget_ms: manifest.runtime.as_ref().and_then(|r| r.cpu_budget_ms),
        ui_model: manifest.ui.as_ref().map(|u| u.model.clone()),
        capability_justifications: manifest.capability_justifications.clone(),
        network_domains_requested: manifest.network_domains_requested.clone(),
        media_sources_requested: manifest.media_sources_requested.clone(),
        publisher_verification: manifest.publisher_verification.clone(),
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
                if items
                    .iter()
                    .any(|existing| existing.widget_type == item.widget_type)
                {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_v1_permissions_to_capabilities() {
        let raw = RawWidgetManifest {
            widget_type: "test".to_string(),
            name: "Test".to_string(),
            description: None,
            entry: "index.js".to_string(),
            icon: None,
            default_size: None,
            manifest_version: "v1".to_string(),
            permissions: Some(vec![
                "screen-time:read".to_string(),
                "todo:write".to_string(),
                "local-api:call".to_string(),
            ]),
            capabilities: None,
            sdk_version: None,
            csp: None,
            signature: None,
            ..Default::default()
        };
        let v2 = normalize_manifest_v1_to_v2(raw).unwrap();
        assert_eq!(v2.manifest_version, "v2");
        assert!(v2.capabilities.contains(&"read_metrics".to_string()));
        assert!(v2.capabilities.contains(&"write_data".to_string()));
        assert!(v2.capabilities.contains(&"local_api_call".to_string()));
        assert!(v2.permissions.contains(&"screen-time:read".to_string()));
        assert!(v2.permissions.contains(&"todo:write".to_string()));
        assert!(v2.permissions.contains(&"local-api:call".to_string()));
    }

    #[test]
    fn test_normalize_v1_integer_manifest_version() {
        let raw = RawWidgetManifest {
            widget_type: "test".to_string(),
            name: "Test".to_string(),
            description: None,
            entry: "index.js".to_string(),
            icon: None,
            default_size: None,
            manifest_version: "1".to_string(),
            permissions: Some(vec!["screen-time:read".to_string()]),
            capabilities: None,
            sdk_version: None,
            csp: None,
            signature: None,
            ..Default::default()
        };
        let v2 = normalize_manifest_v1_to_v2(raw).unwrap();
        assert_eq!(v2.manifest_version, "v2");
        assert!(v2.capabilities.contains(&"read_metrics".to_string()));
    }

    #[test]
    fn test_normalize_v2_capabilities_to_permissions() {
        let raw = RawWidgetManifest {
            widget_type: "test".to_string(),
            name: "Test".to_string(),
            description: None,
            entry: "index.js".to_string(),
            icon: None,
            default_size: None,
            manifest_version: "v2".to_string(),
            permissions: None,
            capabilities: Some(vec![
                RawCapability::Name("read_metrics".to_string()),
                RawCapability::Name("write_data".to_string()),
            ]),
            sdk_version: None,
            csp: None,
            signature: None,
            ..Default::default()
        };
        let v2 = normalize_manifest_v1_to_v2(raw).unwrap();
        assert!(v2.permissions.contains(&"screen-time:read".to_string()));
        assert!(v2.permissions.contains(&"todo:read".to_string()));
        assert!(v2.permissions.contains(&"todo:write".to_string()));
        assert!(v2.permissions.contains(&"settings:write".to_string()));
    }

    #[test]
    fn test_normalize_v2_capability_objects() {
        let raw = RawWidgetManifest {
            widget_type: "test".to_string(),
            name: "Test".to_string(),
            description: None,
            entry: "index.js".to_string(),
            icon: None,
            default_size: None,
            manifest_version: "v2".to_string(),
            permissions: None,
            capabilities: Some(vec![
                RawCapability::Object {
                    capability: "read_metrics".to_string(),
                    permission: Some("screen-time:read".to_string()),
                },
                RawCapability::Object {
                    capability: "local_api_call".to_string(),
                    permission: None,
                },
            ]),
            sdk_version: None,
            csp: None,
            signature: None,
            ..Default::default()
        };
        let v2 = normalize_manifest_v1_to_v2(raw).unwrap();
        assert!(v2.capabilities.contains(&"read_metrics".to_string()));
        assert!(v2.capabilities.contains(&"local_api_call".to_string()));
        assert!(v2.permissions.contains(&"screen-time:read".to_string()));
        assert!(!v2.permissions.contains(&"todo:read".to_string()));
        assert!(v2.permissions.contains(&"local-api:call".to_string()));
    }

    #[test]
    fn test_reject_unsupported_manifest_version() {
        let raw = RawWidgetManifest {
            widget_type: "test".to_string(),
            name: "Test".to_string(),
            description: None,
            entry: "index.js".to_string(),
            icon: None,
            default_size: None,
            manifest_version: "v99".to_string(),
            permissions: None,
            capabilities: None,
            sdk_version: None,
            csp: None,
            signature: None,
            ..Default::default()
        };
        let err = normalize_manifest_v1_to_v2(raw).unwrap_err();
        assert_eq!(err, "unsupported manifest version");
    }
}
