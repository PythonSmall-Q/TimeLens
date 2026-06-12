use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs::File;
use std::io::{Read, Write};

use chrono::{Duration, Local, NaiveDate};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{Manager, State};
use zip::{write::FileOptions, CompressionMethod, ZipArchive, ZipWriter};

use crate::commands::storage_cmd::DbState;
use crate::db;
use crate::db_encryption;
use crate::models::{
    ApiClientAllowlistEntry, ApiTokenMetadata, AppCategoryRule, AppUsageRecord, BrowserDomainLimit,
    BrowserSession, FocusRule, FocusSession, TodoItem, UsageGoal, VsCodeLanguageDuration,
    VsCodeSession, WidgetConfig, WidgetPermissionAuditEntry,
};
use crate::monitor::{MonitorStatus, SharedMonitorStatus};

const BACKUP_VERSION: &str = "v2";
const BACKUP_PACKAGE_FILE: &str = "backup.json";
const BACKUP_MANIFEST_FILE: &str = "manifest.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupBundleCounts {
    pub app_usage: usize,
    pub browser_sessions: usize,
    pub todos: usize,
    pub widget_configs: usize,
    pub ignored_apps: usize,
    pub app_settings: usize,
    pub app_categories: usize,
    pub usage_goals: usize,
    pub focus_sessions: usize,
    pub focus_rules: usize,
    pub browser_ignored_domains: usize,
    pub browser_domain_limits: usize,
    pub widget_permissions: usize,
    pub widget_permission_audit_log: usize,
    pub vscode_sessions: usize,
    pub api_tokens: usize,
    pub api_client_allowlist: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupManifest {
    pub version: String,
    pub app_version: String,
    pub schema_version: String,
    pub locale: String,
    pub created_at: String,
    pub checksum: String,
    pub counts: BackupBundleCounts,
    #[serde(default)]
    pub encrypted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedBackupHeader {
    pub salt: String,
    pub nonce: String,
    pub ciphertext: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SettingEntry {
    key: String,
    value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BackupBundle {
    app_usage: Vec<AppUsageRecord>,
    browser_sessions: Vec<BrowserSession>,
    todos: Vec<TodoItem>,
    widget_configs: Vec<WidgetConfig>,
    ignored_apps: Vec<String>,
    app_settings: Vec<SettingEntry>,
    app_categories: Vec<AppCategoryRule>,
    usage_goals: Vec<UsageGoal>,
    focus_sessions: Vec<FocusSession>,
    focus_rules: Vec<FocusRule>,
    browser_ignored_domains: Vec<String>,
    browser_domain_limits: Vec<BrowserDomainLimit>,
    widget_permissions: Vec<WidgetPermissionBackupEntry>,
    widget_permission_audit_log: Vec<WidgetPermissionAuditEntry>,
    vscode_sessions: Vec<VsCodeSession>,
    api_tokens: Vec<ApiTokenMetadata>,
    api_client_allowlist: Vec<ApiClientAllowlistEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WidgetPermissionBackupEntry {
    widget_id: String,
    permission: String,
    granted_at: String,
    capability: String,
    risk_label: String,
    last_access_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DataHealthIssue {
    pub code: String,
    pub severity: String,
    pub title: String,
    pub detail: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DataHealthSummary {
    pub schema_version: String,
    pub integrity_ok: bool,
    pub foreign_key_ok: bool,
    pub index_ok: bool,
    pub app_usage_rows: i64,
    pub daily_app_usage_rows: i64,
    pub archive_rows: i64,
    pub missing_days: Vec<String>,
    pub zero_usage_days: Vec<String>,
    pub issues: Vec<DataHealthIssue>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RepairActionPreview {
    pub code: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RepairAssistantResult {
    pub dry_run: bool,
    pub actions: Vec<RepairActionPreview>,
    pub rebuilt_daily_rows: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct BackupPreview {
    pub manifest: BackupManifest,
    pub compatible: bool,
    pub supported_strategies: Vec<String>,
    pub warnings: Vec<String>,
    pub diff: BackupDiffSummary,
}

#[derive(Debug, Clone, Serialize)]
pub struct TableDiffCounts {
    pub backup_rows: usize,
    pub current_rows: usize,
    pub to_add: usize,
    pub to_update: usize,
    pub conflicts: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct BackupDiffSummary {
    pub table_counts: HashMap<String, TableDiffCounts>,
    pub settings_conflicts: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BackupApplyResult {
    pub manifest: BackupManifest,
    pub strategy: String,
    pub imported_rows: usize,
    pub warnings: Vec<String>,
    pub new_profile_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RetentionPolicyInfo {
    pub policy: String,
    pub label: String,
    pub cutoff_date: Option<String>,
    pub estimated_rows: i64,
    pub estimated_storage_bytes: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct RetentionRunResult {
    pub policy: String,
    pub cutoff_date: Option<String>,
    pub archived_app_usage_rows: i64,
    pub archived_daily_rows: i64,
    pub warm_rows: i64,
    pub archive_rows: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchiveSchedulerSettings {
    pub enabled: bool,
    pub daily_run_hour: i32,
    pub run_on_battery: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct CompressionResult {
    pub compressed_groups: i64,
    pub original_rows: i64,
    pub saved_bytes: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct TrackingFieldInfo {
    pub field: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TrackingWriteEntry {
    pub date: String,
    pub app_name: String,
    pub exe_path: String,
    pub window_title: String,
    pub active_seconds: i64,
    pub first_seen_at: String,
    pub last_seen_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TrackingTransparencyReport {
    pub status: MonitorStatus,
    pub paused_at: Option<String>,
    pub paused_by: Option<String>,
    pub pause_reason: Option<String>,
    pub tracked_fields: Vec<TrackingFieldInfo>,
    pub writes_last_24h: i64,
    pub writes_last_7d: i64,
    pub recent_writes: Vec<TrackingWriteEntry>,
}

fn now_ts() -> String {
    Local::now().format("%Y-%m-%dT%H:%M:%S").to_string()
}

fn system_locale() -> String {
    std::env::var("LC_ALL")
        .or_else(|_| std::env::var("LANGUAGE"))
        .or_else(|_| std::env::var("LANG"))
        .unwrap_or_else(|_| "unknown".to_string())
}

fn current_schema_version(conn: &rusqlite::Connection) -> String {
    db::get_setting(conn, "schema_version")
        .ok()
        .flatten()
        .unwrap_or_else(|| "unknown".to_string())
}

fn manifest_to_json(manifest: &BackupManifest) -> Result<String, String> {
    serde_json::to_string_pretty(manifest).map_err(|e| e.to_string())
}

fn bundle_to_json(bundle: &BackupBundle) -> Result<String, String> {
    serde_json::to_string_pretty(bundle).map_err(|e| e.to_string())
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn parse_scopes_json(raw: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(raw).unwrap_or_default()
}

fn build_bundle(conn: &rusqlite::Connection) -> Result<BackupBundle, String> {
    let app_usage = {
        let mut stmt = conn
            .prepare(
                "SELECT id, date, app_name, exe_path, window_title, active_seconds, first_seen_at, last_seen_at
                 FROM app_usage
                 ORDER BY id ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(AppUsageRecord {
                    id: row.get(0)?,
                    date: row.get(1)?,
                    app_name: row.get(2)?,
                    exe_path: row.get(3)?,
                    window_title: row.get(4)?,
                    active_seconds: row.get(5)?,
                    first_seen_at: row.get(6)?,
                    last_seen_at: row.get(7)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    let todos = {
        let mut stmt = conn
            .prepare("SELECT id, content, done, created_at, order_index FROM todos ORDER BY order_index ASC, id ASC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(TodoItem {
                    id: row.get(0)?,
                    content: row.get(1)?,
                    done: row.get::<_, i32>(2)? != 0,
                    created_at: row.get(3)?,
                    order_index: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    let browser_sessions =
        db::get_recent_browser_sessions(conn, 100_000).map_err(|e| e.to_string())?;
    let widget_configs = db::get_all_widget_configs(conn).map_err(|e| e.to_string())?;
    let ignored_apps = db::get_ignored_apps(conn).map_err(|e| e.to_string())?;
    let app_categories = db::get_all_app_categories(conn).map_err(|e| e.to_string())?;
    let browser_ignored_domains =
        db::get_browser_ignored_domains(conn).map_err(|e| e.to_string())?;
    let browser_domain_limits = db::get_browser_domain_limits(conn).map_err(|e| e.to_string())?;

    let app_settings = {
        let mut stmt = conn
            .prepare("SELECT key, value FROM app_settings ORDER BY key ASC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(SettingEntry {
                    key: row.get(0)?,
                    value: row.get(1)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    let usage_goals = {
        let mut stmt = conn
            .prepare(
                "SELECT id, scope_type, scope_value, period, operator, target_seconds, enabled, notify_risk
                 FROM usage_goals
                 ORDER BY id DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(UsageGoal {
                    id: row.get(0)?,
                    scope_type: row.get(1)?,
                    scope_value: row.get(2)?,
                    period: row.get(3)?,
                    operator: row.get(4)?,
                    target_seconds: row.get(5)?,
                    enabled: row.get::<_, i32>(6)? != 0,
                    notify_risk: row.get::<_, Option<i32>>(7)?.unwrap_or(1) != 0,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    let focus_sessions = {
        let mut stmt = conn
            .prepare(
                "SELECT id, started_at, ended_at, trigger_type, reason
                 FROM focus_sessions
                 ORDER BY started_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(FocusSession {
                    id: row.get(0)?,
                    started_at: row.get(1)?,
                    ended_at: row.get(2)?,
                    trigger_type: row.get(3)?,
                    reason: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    let focus_rules = {
        let mut stmt = conn
            .prepare(
                "SELECT id, name, enabled, rule_type, condition_json, action, auto_start, quiet_hours_respect, created_at
                 FROM focus_rules
                 ORDER BY id DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(FocusRule {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    enabled: row.get::<_, i32>(2)? != 0,
                    rule_type: row.get(3)?,
                    condition_json: row.get(4)?,
                    action: row.get(5)?,
                    auto_start: row.get::<_, i32>(6)? != 0,
                    quiet_hours_respect: row.get::<_, i32>(7)? != 0,
                    created_at: row.get(8)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    let widget_permissions = {
        let mut stmt = conn
            .prepare(
                "SELECT widget_id, permission, granted_at, capability, risk_label, last_access_at
                 FROM widget_permissions
                 ORDER BY widget_id, permission",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(WidgetPermissionBackupEntry {
                    widget_id: row.get(0)?,
                    permission: row.get(1)?,
                    granted_at: row.get(2)?,
                    capability: row.get(3)?,
                    risk_label: row.get(4)?,
                    last_access_at: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    let widget_permission_audit_log = {
        let mut stmt = conn
            .prepare(
                "SELECT id, widget_id, permission, action, actor, occurred_at, detail
                 FROM widget_permission_audit_log
                 ORDER BY occurred_at DESC, id DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(WidgetPermissionAuditEntry {
                    id: row.get(0)?,
                    widget_id: row.get(1)?,
                    permission: row.get(2)?,
                    action: row.get(3)?,
                    actor: row.get(4)?,
                    occurred_at: row.get(5)?,
                    detail: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    let vscode_sessions = {
        let mut stmt = conn
            .prepare(
                "SELECT session_id, date, started_at, ended_at, duration_seconds, project_name, project_path, synced_at
                 FROM vscode_sessions
                 ORDER BY started_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let mut sessions = stmt
            .query_map([], |row| {
                Ok(VsCodeSession {
                    session_id: row.get(0)?,
                    date: row.get(1)?,
                    started_at: row.get(2)?,
                    ended_at: row.get(3)?,
                    duration_seconds: row.get(4)?,
                    project_name: row.get(5)?,
                    project_path: row.get(6)?,
                    synced_at: row.get(7)?,
                    language_durations: Vec::new(),
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        let mut lang_stmt = conn
            .prepare("SELECT session_id, language, duration_seconds FROM vscode_session_languages")
            .map_err(|e| e.to_string())?;
        let lang_rows = lang_stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    VsCodeLanguageDuration {
                        language: row.get(1)?,
                        seconds: row.get(2)?,
                    },
                ))
            })
            .map_err(|e| e.to_string())?;
        let mut by_session: std::collections::HashMap<String, Vec<VsCodeLanguageDuration>> =
            std::collections::HashMap::new();
        for row in lang_rows {
            let (session_id, lang) = row.map_err(|e| e.to_string())?;
            by_session.entry(session_id).or_default().push(lang);
        }
        for session in &mut sessions {
            if let Some(langs) = by_session.remove(&session.session_id) {
                session.language_durations = langs;
            }
        }
        sessions
    };

    let api_tokens = {
        let mut stmt = conn
            .prepare(
                "SELECT id, label, token_hash, scopes_json, created_at, expires_at, revoked_at, last_used_at, last_client_id
                 FROM api_tokens
                 ORDER BY created_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                let scopes_json: String = row.get(3)?;
                Ok(ApiTokenMetadata {
                    id: row.get(0)?,
                    label: row.get(1)?,
                    token_hash: row.get(2)?,
                    scopes: parse_scopes_json(&scopes_json),
                    created_at: row.get(4)?,
                    expires_at: row.get(5)?,
                    revoked_at: row.get(6)?,
                    last_used_at: row.get(7)?,
                    last_client_id: row.get(8)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    let api_client_allowlist = {
        let mut stmt = conn
            .prepare(
                "SELECT client_id, created_at
                 FROM api_client_allowlist
                 ORDER BY client_id ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(ApiClientAllowlistEntry {
                    client_id: row.get(0)?,
                    created_at: row.get(1)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    Ok(BackupBundle {
        app_usage,
        browser_sessions,
        todos,
        widget_configs,
        ignored_apps,
        app_settings,
        app_categories,
        usage_goals,
        focus_sessions,
        focus_rules,
        browser_ignored_domains,
        browser_domain_limits,
        widget_permissions,
        widget_permission_audit_log,
        vscode_sessions,
        api_tokens,
        api_client_allowlist,
    })
}

fn build_manifest(
    conn: &rusqlite::Connection,
    bundle: &BackupBundle,
    payload_json: &str,
    encrypted: bool,
) -> BackupManifest {
    let checksum = sha256_hex(payload_json.as_bytes());
    BackupManifest {
        version: BACKUP_VERSION.to_string(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        schema_version: current_schema_version(conn),
        locale: system_locale(),
        created_at: now_ts(),
        checksum,
        counts: BackupBundleCounts {
            app_usage: bundle.app_usage.len(),
            browser_sessions: bundle.browser_sessions.len(),
            todos: bundle.todos.len(),
            widget_configs: bundle.widget_configs.len(),
            ignored_apps: bundle.ignored_apps.len(),
            app_settings: bundle.app_settings.len(),
            app_categories: bundle.app_categories.len(),
            usage_goals: bundle.usage_goals.len(),
            focus_sessions: bundle.focus_sessions.len(),
            focus_rules: bundle.focus_rules.len(),
            browser_ignored_domains: bundle.browser_ignored_domains.len(),
            browser_domain_limits: bundle.browser_domain_limits.len(),
            widget_permissions: bundle.widget_permissions.len(),
            widget_permission_audit_log: bundle.widget_permission_audit_log.len(),
            vscode_sessions: bundle.vscode_sessions.len(),
            api_tokens: bundle.api_tokens.len(),
            api_client_allowlist: bundle.api_client_allowlist.len(),
        },
        encrypted,
    }
}

fn derive_key(passphrase: &str, salt: &[u8]) -> [u8; 32] {
    use argon2::{Algorithm, Argon2, Params, Version};
    let params = Params::new(65536, 3, 4, Some(32)).expect("valid argon2 params");
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; 32];
    argon2
        .hash_password_into(passphrase.as_bytes(), salt, &mut key)
        .expect("argon2 key derivation failed");
    key
}

fn encrypt_bytes(plaintext: &[u8], passphrase: &str) -> Result<EncryptedBackupHeader, String> {
    use aes_gcm::aead::{Aead, KeyInit};
    use aes_gcm::{Aes256Gcm, Nonce};
    use rand::rngs::OsRng;
    use rand::RngCore;

    let mut salt = [0u8; 16];
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut salt);
    OsRng.fill_bytes(&mut nonce_bytes);

    let key = derive_key(passphrase, &salt);
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| e.to_string())?;

    Ok(EncryptedBackupHeader {
        salt: hex::encode(salt),
        nonce: hex::encode(nonce_bytes),
        ciphertext: hex::encode(ciphertext),
        version: "v1".to_string(),
    })
}

fn decrypt_bytes(header: &EncryptedBackupHeader, passphrase: &str) -> Result<Vec<u8>, String> {
    use aes_gcm::aead::{Aead, KeyInit};
    use aes_gcm::{Aes256Gcm, Nonce};

    let salt = hex::decode(&header.salt).map_err(|e| e.to_string())?;
    let nonce_bytes = hex::decode(&header.nonce).map_err(|e| e.to_string())?;
    let ciphertext = hex::decode(&header.ciphertext).map_err(|e| e.to_string())?;

    if nonce_bytes.len() != 12 {
        return Err("invalid backup nonce length".to_string());
    }

    let key = derive_key(passphrase, &salt);
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let nonce = Nonce::from_slice(&nonce_bytes);
    cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|_| "failed to decrypt backup (wrong passphrase?)".to_string())
}

fn write_backup_package(
    path: &str,
    manifest: &BackupManifest,
    payload_json: &str,
) -> Result<(), String> {
    let file = File::create(path).map_err(|e| e.to_string())?;
    let mut zip = ZipWriter::new(file);
    let options = FileOptions::default().compression_method(CompressionMethod::Deflated);

    zip.start_file(BACKUP_MANIFEST_FILE, options)
        .map_err(|e| e.to_string())?;
    zip.write_all(manifest_to_json(manifest)?.as_bytes())
        .map_err(|e| e.to_string())?;

    zip.start_file(BACKUP_PACKAGE_FILE, options)
        .map_err(|e| e.to_string())?;
    zip.write_all(payload_json.as_bytes())
        .map_err(|e| e.to_string())?;

    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

fn read_backup_package(
    path: &str,
    passphrase: Option<&str>,
) -> Result<(BackupManifest, BackupBundle, String), String> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    let mut zip = ZipArchive::new(file).map_err(|e| e.to_string())?;

    let mut manifest_text = String::new();
    zip.by_name(BACKUP_MANIFEST_FILE)
        .map_err(|e| e.to_string())?
        .read_to_string(&mut manifest_text)
        .map_err(|e| e.to_string())?;
    let manifest: BackupManifest =
        serde_json::from_str(&manifest_text).map_err(|e| e.to_string())?;

    let mut stored_payload = String::new();
    zip.by_name(BACKUP_PACKAGE_FILE)
        .map_err(|e| e.to_string())?
        .read_to_string(&mut stored_payload)
        .map_err(|e| e.to_string())?;

    if manifest.encrypted && passphrase.is_none() {
        return Err("Passphrase required for encrypted backup".to_string());
    }
    if !manifest.encrypted && passphrase.is_some() {
        return Err("Backup is not encrypted but passphrase was provided".to_string());
    }

    let payload_checksum = sha256_hex(stored_payload.as_bytes());
    if payload_checksum != manifest.checksum {
        return Err("backup checksum mismatch".to_string());
    }

    let (payload_text, bundle) = if manifest.encrypted {
        let header: EncryptedBackupHeader =
            serde_json::from_str(&stored_payload).map_err(|e| e.to_string())?;
        let decrypted = decrypt_bytes(&header, passphrase.unwrap())?;
        let payload_text = String::from_utf8(decrypted).map_err(|e| e.to_string())?;
        let bundle: BackupBundle =
            serde_json::from_str(&payload_text).map_err(|e| e.to_string())?;
        (payload_text, bundle)
    } else {
        let bundle: BackupBundle =
            serde_json::from_str(&stored_payload).map_err(|e| e.to_string())?;
        (stored_payload, bundle)
    };

    Ok((manifest, bundle, payload_text))
}

fn supported_strategies() -> Vec<String> {
    vec![
        "overwrite".to_string(),
        "merge".to_string(),
        "new_profile".to_string(),
    ]
}

fn clear_all_user_data(tx: &rusqlite::Transaction<'_>) -> Result<(), String> {
    for table in [
        "app_usage",
        "daily_app_usage",
        "app_usage_archive",
        "daily_app_usage_archive",
        "todos",
        "browser_sessions",
        "widget_configs",
        "ignored_apps",
        "app_settings",
        "app_categories",
        "usage_goals",
        "focus_sessions",
        "focus_rules",
        "browser_ignored_domains",
        "browser_domain_limits",
        "widget_permissions",
        "widget_permission_audit_log",
        "vscode_sessions",
        "vscode_session_languages",
        "api_tokens",
        "api_client_allowlist",
    ] {
        tx.execute(&format!("DELETE FROM {table}"), [])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn apply_bundle(
    tx: &rusqlite::Transaction<'_>,
    bundle: BackupBundle,
) -> Result<(usize, Vec<String>), String> {
    let mut imported_rows = 0usize;
    let mut warnings = Vec::new();

    for row in bundle.app_usage {
        tx.execute(
            "INSERT OR IGNORE INTO app_usage (date, app_name, exe_path, window_title, active_seconds, first_seen_at, last_seen_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                row.date,
                row.app_name,
                row.exe_path,
                row.window_title,
                row.active_seconds,
                row.first_seen_at,
                row.last_seen_at,
            ],
        )
        .map_err(|e| e.to_string())?;
        imported_rows += 1;
    }

    for row in bundle.todos {
        tx.execute(
            "INSERT INTO todos (id, content, done, created_at, order_index)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET
               content = excluded.content,
               done = excluded.done,
               created_at = excluded.created_at,
               order_index = excluded.order_index",
            params![
                row.id,
                row.content,
                row.done as i32,
                row.created_at,
                row.order_index
            ],
        )
        .map_err(|e| e.to_string())?;
        imported_rows += 1;
    }

    for session in bundle.browser_sessions {
        tx.execute(
            "INSERT INTO browser_sessions
             (id, browser_name, tab_url, host, title, started_at, ended_at, duration_seconds, locale, synced_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(id) DO UPDATE SET
               browser_name = excluded.browser_name,
               tab_url = excluded.tab_url,
               host = excluded.host,
               title = excluded.title,
               started_at = excluded.started_at,
               ended_at = excluded.ended_at,
               duration_seconds = excluded.duration_seconds,
               locale = excluded.locale,
               synced_at = excluded.synced_at",
            params![
                session.id,
                session.browser_name,
                session.tab_url,
                session.host,
                session.title,
                session.started_at,
                session.ended_at,
                session.duration_seconds,
                session.locale,
                session.synced_at,
            ],
        )
        .map_err(|e| e.to_string())?;
        imported_rows += 1;
    }

    for cfg in bundle.widget_configs {
        tx.execute(
            "INSERT INTO widget_configs
             (id, widget_type, monitor_index, x, y, width, height, opacity, always_on_top_mode, pinned, start_on_launch, data_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
             ON CONFLICT(id) DO UPDATE SET
                 widget_type = excluded.widget_type,
                 monitor_index = excluded.monitor_index,
                 x = excluded.x,
                 y = excluded.y,
                 width = excluded.width,
                 height = excluded.height,
                 opacity = excluded.opacity,
                 always_on_top_mode = excluded.always_on_top_mode,
                 pinned = excluded.pinned,
                 start_on_launch = excluded.start_on_launch,
                 data_json = excluded.data_json",
            params![
                cfg.id,
                cfg.widget_type,
                cfg.monitor_index,
                cfg.x,
                cfg.y,
                cfg.width,
                cfg.height,
                cfg.opacity,
                cfg.always_on_top_mode,
                cfg.pinned as i32,
                cfg.start_on_launch as i32,
                cfg.data_json,
            ],
        )
        .map_err(|e| e.to_string())?;
        imported_rows += 1;
    }

    tx.execute("DELETE FROM ignored_apps", [])
        .map_err(|e| e.to_string())?;
    for p in bundle.ignored_apps {
        tx.execute(
            "INSERT OR IGNORE INTO ignored_apps(exe_path) VALUES(?1)",
            params![p],
        )
        .map_err(|e| e.to_string())?;
        imported_rows += 1;
    }

    for setting in bundle.app_settings {
        tx.execute(
            "INSERT INTO app_settings (key, value)
             VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![setting.key, setting.value],
        )
        .map_err(|e| e.to_string())?;
        imported_rows += 1;
    }

    for row in bundle.app_categories {
        tx.execute(
            "INSERT OR REPLACE INTO app_categories (app_name, exe_path, category, source, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![row.app_name, row.exe_path, row.category, row.source, row.updated_at],
        )
        .map_err(|e| e.to_string())?;
        imported_rows += 1;
    }

    for row in bundle.usage_goals {
        tx.execute(
            "INSERT INTO usage_goals (id, scope_type, scope_value, period, operator, target_seconds, enabled, notify_risk)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET
               scope_type = excluded.scope_type,
               scope_value = excluded.scope_value,
               period = excluded.period,
               operator = excluded.operator,
               target_seconds = excluded.target_seconds,
               enabled = excluded.enabled,
               notify_risk = excluded.notify_risk",
            params![
                row.id,
                row.scope_type,
                row.scope_value,
                row.period,
                row.operator,
                row.target_seconds,
                row.enabled as i32,
                row.notify_risk as i32,
            ],
        )
        .map_err(|e| e.to_string())?;
        imported_rows += 1;
    }

    for row in bundle.focus_sessions {
        tx.execute(
            "INSERT OR IGNORE INTO focus_sessions (id, started_at, ended_at, trigger_type, reason)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                row.id,
                row.started_at,
                row.ended_at,
                row.trigger_type,
                row.reason
            ],
        )
        .map_err(|e| e.to_string())?;
        imported_rows += 1;
    }

    for row in bundle.focus_rules {
        tx.execute(
            "INSERT OR IGNORE INTO focus_rules (id, name, enabled, rule_type, condition_json, action, auto_start, quiet_hours_respect, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                row.id,
                row.name,
                row.enabled as i32,
                row.rule_type,
                row.condition_json,
                row.action,
                row.auto_start as i32,
                row.quiet_hours_respect as i32,
                row.created_at,
            ],
        )
        .map_err(|e| e.to_string())?;
        imported_rows += 1;
    }

    tx.execute("DELETE FROM browser_ignored_domains", [])
        .map_err(|e| e.to_string())?;
    for host in bundle.browser_ignored_domains {
        tx.execute(
            "INSERT OR IGNORE INTO browser_ignored_domains (host) VALUES (?1)",
            params![host],
        )
        .map_err(|e| e.to_string())?;
        imported_rows += 1;
    }

    for row in bundle.browser_domain_limits {
        tx.execute(
            "INSERT OR REPLACE INTO browser_domain_limits (host, daily_limit_seconds, enabled, updated_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                row.host,
                row.daily_limit_seconds,
                row.enabled as i32,
                row.updated_at,
            ],
        )
        .map_err(|e| e.to_string())?;
        imported_rows += 1;
    }

    for row in bundle.widget_permissions {
        tx.execute(
            "INSERT OR REPLACE INTO widget_permissions (widget_id, permission, granted_at, capability, risk_label, last_access_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                row.widget_id,
                row.permission,
                row.granted_at,
                row.capability,
                row.risk_label,
                row.last_access_at,
            ],
        )
        .map_err(|e| e.to_string())?;
        imported_rows += 1;
    }

    for row in bundle.widget_permission_audit_log {
        tx.execute(
            "INSERT INTO widget_permission_audit_log (widget_id, permission, action, actor, occurred_at, detail)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                row.widget_id,
                row.permission,
                row.action,
                row.actor,
                row.occurred_at,
                row.detail,
            ],
        )
        .map_err(|e| e.to_string())?;
        imported_rows += 1;
    }

    for row in bundle.vscode_sessions {
        tx.execute(
            "INSERT OR REPLACE INTO vscode_sessions (session_id, date, started_at, ended_at, duration_seconds, project_name, project_path, synced_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                row.session_id,
                row.date,
                row.started_at,
                row.ended_at,
                row.duration_seconds,
                row.project_name,
                row.project_path,
                row.synced_at,
            ],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "DELETE FROM vscode_session_languages WHERE session_id = ?1",
            params![row.session_id],
        )
        .map_err(|e| e.to_string())?;
        for lang in row.language_durations {
            tx.execute(
                "INSERT INTO vscode_session_languages (session_id, language, duration_seconds)
                 VALUES (?1, ?2, ?3)",
                params![row.session_id, lang.language, lang.seconds],
            )
            .map_err(|e| e.to_string())?;
            imported_rows += 1;
        }
        imported_rows += 1;
    }

    for row in bundle.api_tokens {
        let Some(token_hash) = row.token_hash else {
            warnings.push(format!("api token {} skipped: missing token_hash", row.id));
            continue;
        };
        let scopes_json = serde_json::to_string(&row.scopes).unwrap_or_else(|_| "[]".to_string());
        tx.execute(
            "INSERT OR REPLACE INTO api_tokens (id, label, token_hash, scopes_json, created_at, expires_at, revoked_at, last_used_at, last_client_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                row.id,
                row.label,
                token_hash,
                scopes_json,
                row.created_at,
                row.expires_at,
                row.revoked_at,
                row.last_used_at,
                row.last_client_id,
            ],
        )
        .map_err(|e| e.to_string())?;
        imported_rows += 1;
    }

    for row in bundle.api_client_allowlist {
        tx.execute(
            "INSERT OR REPLACE INTO api_client_allowlist (client_id, created_at)
             VALUES (?1, ?2)",
            params![row.client_id, row.created_at],
        )
        .map_err(|e| e.to_string())?;
        imported_rows += 1;
    }

    Ok((imported_rows, warnings))
}

fn date_days_ago(days: i64) -> String {
    (Local::now() - Duration::days(days))
        .format("%Y-%m-%d")
        .to_string()
}

fn retention_days(policy: &str) -> Option<i64> {
    match policy {
        "3m" => Some(90),
        "6m" => Some(180),
        "12m" => Some(365),
        _ => None,
    }
}

fn retention_label(policy: &str) -> String {
    match policy {
        "3m" => "3 months".to_string(),
        "6m" => "6 months".to_string(),
        "12m" => "12 months".to_string(),
        _ => "Keep all".to_string(),
    }
}

fn missing_and_zero_days(
    conn: &rusqlite::Connection,
) -> Result<(Vec<String>, Vec<String>), String> {
    let mut stmt = conn
        .prepare("SELECT date, COALESCE(SUM(total_seconds), 0) FROM daily_app_usage GROUP BY date ORDER BY date")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(|e| e.to_string())?;
    let mut day_map = BTreeMap::new();
    for row in rows {
        let (date, total) = row.map_err(|e| e.to_string())?;
        day_map.insert(date, total);
    }

    if day_map.is_empty() {
        return Ok((Vec::new(), Vec::new()));
    }

    let min_date = NaiveDate::parse_from_str(day_map.keys().next().unwrap(), "%Y-%m-%d")
        .map_err(|e| e.to_string())?;
    let max_date = NaiveDate::parse_from_str(day_map.keys().last().unwrap(), "%Y-%m-%d")
        .map_err(|e| e.to_string())?;

    let mut missing_days = Vec::new();
    let mut zero_usage_days = Vec::new();
    let mut current = min_date;
    while current <= max_date {
        let key = current.format("%Y-%m-%d").to_string();
        match day_map.get(&key).copied() {
            Some(total) if total <= 0 => zero_usage_days.push(key),
            Some(_) => {}
            None => missing_days.push(key),
        }
        current += chrono::Duration::days(1);
    }

    Ok((missing_days, zero_usage_days))
}

fn index_ok(conn: &rusqlite::Connection) -> Result<bool, String> {
    let expected = [
        "idx_app_usage_date",
        "idx_app_usage_app_date",
        "idx_daily_app_usage_date",
    ];
    let mut stmt = conn
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let mut existing = BTreeSet::new();
    for row in rows {
        existing.insert(row.map_err(|e| e.to_string())?);
    }
    Ok(expected.iter().all(|name| existing.contains(*name)))
}

fn ensure_core_indexes(conn: &rusqlite::Connection) -> Result<i64, String> {
    let specs = [
        (
            "idx_app_usage_date",
            "CREATE INDEX IF NOT EXISTS idx_app_usage_date ON app_usage(date)",
        ),
        (
            "idx_app_usage_app_date",
            "CREATE INDEX IF NOT EXISTS idx_app_usage_app_date ON app_usage(app_name, date)",
        ),
        (
            "idx_daily_app_usage_date",
            "CREATE INDEX IF NOT EXISTS idx_daily_app_usage_date ON daily_app_usage(date)",
        ),
    ];

    let mut stmt = conn
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;

    let mut existing = BTreeSet::new();
    for row in rows {
        existing.insert(row.map_err(|e| e.to_string())?);
    }

    let mut repaired = 0_i64;
    for (name, ddl) in specs {
        if !existing.contains(name) {
            conn.execute(ddl, []).map_err(|e| e.to_string())?;
            repaired += 1;
        }
    }

    Ok(repaired)
}

#[tauri::command]
pub fn get_data_health_summary(db: State<DbState>) -> Result<DataHealthSummary, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let integrity_ok = conn
        .query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        == "ok";

    let fk_rows: Vec<String> = {
        let mut stmt = conn
            .prepare("PRAGMA foreign_key_check")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |_| Ok(String::new()))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    let index_ok = index_ok(&conn)?;
    let app_usage_rows = conn
        .query_row("SELECT COUNT(1) FROM app_usage", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let daily_app_usage_rows = conn
        .query_row("SELECT COUNT(1) FROM daily_app_usage", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let archive_rows = conn
        .query_row(
            "SELECT (SELECT COUNT(1) FROM app_usage_archive) + (SELECT COUNT(1) FROM daily_app_usage_archive)",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let (missing_days, zero_usage_days) = missing_and_zero_days(&conn)?;

    let mut issues = Vec::new();
    if !integrity_ok {
        issues.push(DataHealthIssue {
            code: "integrity_check".to_string(),
            severity: "error".to_string(),
            title: "SQLite integrity check failed".to_string(),
            detail: "PRAGMA integrity_check returned a non-ok result".to_string(),
            count: 1,
        });
    }
    if !fk_rows.is_empty() {
        issues.push(DataHealthIssue {
            code: "foreign_key_check".to_string(),
            severity: "error".to_string(),
            title: "Foreign key violations found".to_string(),
            detail: "One or more rows failed PRAGMA foreign_key_check".to_string(),
            count: fk_rows.len() as i64,
        });
    }
    if !index_ok {
        issues.push(DataHealthIssue {
            code: "index_check".to_string(),
            severity: "warning".to_string(),
            title: "Expected indexes are missing".to_string(),
            detail: "One or more core app_usage indexes are absent".to_string(),
            count: 1,
        });
    }
    if !missing_days.is_empty() {
        issues.push(DataHealthIssue {
            code: "missing_days".to_string(),
            severity: "info".to_string(),
            title: "Missing timeline days".to_string(),
            detail: "Detected gaps in the daily usage timeline".to_string(),
            count: missing_days.len() as i64,
        });
    }
    if !zero_usage_days.is_empty() {
        issues.push(DataHealthIssue {
            code: "zero_usage_days".to_string(),
            severity: "info".to_string(),
            title: "Zero-usage days detected".to_string(),
            detail: "Days with no tracked usage were found in the timeline".to_string(),
            count: zero_usage_days.len() as i64,
        });
    }

    Ok(DataHealthSummary {
        schema_version: current_schema_version(&conn),
        integrity_ok,
        foreign_key_ok: fk_rows.is_empty(),
        index_ok,
        app_usage_rows,
        daily_app_usage_rows,
        archive_rows,
        missing_days,
        zero_usage_days,
        issues,
    })
}

#[tauri::command]
pub fn export_backup_v2(
    path: String,
    passphrase: Option<String>,
    db: State<DbState>,
) -> Result<BackupManifest, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let bundle = build_bundle(&conn)?;
    let payload_json = bundle_to_json(&bundle)?;

    let (stored_payload, encrypted) = match passphrase {
        Some(p) => {
            let header = encrypt_bytes(payload_json.as_bytes(), &p)?;
            (
                serde_json::to_string_pretty(&header).map_err(|e| e.to_string())?,
                true,
            )
        }
        None => (payload_json, false),
    };

    let manifest = build_manifest(&conn, &bundle, &stored_payload, encrypted);
    write_backup_package(&path, &manifest, &stored_payload)?;
    Ok(manifest)
}

fn compute_backup_diff(
    conn: &rusqlite::Connection,
    bundle: &BackupBundle,
) -> Result<BackupDiffSummary, String> {
    let count_table = |table: &str| -> Result<usize, String> {
        conn.query_row(&format!("SELECT COUNT(1) FROM {}", table), [], |row| {
            row.get::<_, i64>(0)
        })
        .map(|n| n as usize)
        .map_err(|e| e.to_string())
    };

    let mut table_counts: HashMap<String, TableDiffCounts> = HashMap::new();

    let simple_tables = [
        ("app_usage", bundle.app_usage.len()),
        ("browser_sessions", bundle.browser_sessions.len()),
        ("todos", bundle.todos.len()),
        ("widget_configs", bundle.widget_configs.len()),
        ("ignored_apps", bundle.ignored_apps.len()),
        ("app_categories", bundle.app_categories.len()),
        ("usage_goals", bundle.usage_goals.len()),
        ("focus_sessions", bundle.focus_sessions.len()),
        ("focus_rules", bundle.focus_rules.len()),
        (
            "browser_ignored_domains",
            bundle.browser_ignored_domains.len(),
        ),
        ("browser_domain_limits", bundle.browser_domain_limits.len()),
        ("widget_permissions", bundle.widget_permissions.len()),
        (
            "widget_permission_audit_log",
            bundle.widget_permission_audit_log.len(),
        ),
        ("vscode_sessions", bundle.vscode_sessions.len()),
        ("api_tokens", bundle.api_tokens.len()),
        ("api_client_allowlist", bundle.api_client_allowlist.len()),
    ];

    for (table, backup_rows) in simple_tables {
        let current_rows = count_table(table).unwrap_or(0);
        table_counts.insert(
            table.to_string(),
            TableDiffCounts {
                backup_rows,
                current_rows,
                to_add: backup_rows,
                to_update: 0,
                conflicts: 0,
            },
        );
    }

    let current_settings: HashMap<String, String> = {
        let mut stmt = conn
            .prepare("SELECT key, value FROM app_settings")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<HashMap<_, _>, _>>()
            .map_err(|e| e.to_string())?
    };

    let mut to_add = 0usize;
    let mut to_update = 0usize;
    let mut settings_conflicts = Vec::new();
    for entry in &bundle.app_settings {
        match current_settings.get(&entry.key) {
            None => to_add += 1,
            Some(current_value) => {
                if current_value != &entry.value {
                    to_update += 1;
                    settings_conflicts.push(format!(
                        "settings key '{}' differs (backup vs current)",
                        entry.key
                    ));
                }
            }
        }
    }

    table_counts.insert(
        "app_settings".to_string(),
        TableDiffCounts {
            backup_rows: bundle.app_settings.len(),
            current_rows: current_settings.len(),
            to_add,
            to_update,
            conflicts: to_update,
        },
    );

    Ok(BackupDiffSummary {
        table_counts,
        settings_conflicts,
    })
}

#[tauri::command]
pub fn import_backup_v2_validate(
    path: String,
    passphrase: Option<String>,
    db: State<DbState>,
) -> Result<BackupPreview, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let (manifest, bundle, _payload_json) = read_backup_package(&path, passphrase.as_deref())?;
    let current_schema = current_schema_version(&conn);
    let compatible =
        manifest.schema_version == current_schema || manifest.schema_version == "unknown";
    let mut warnings = Vec::new();
    if manifest.schema_version != current_schema {
        warnings.push(format!(
            "backup schema {} does not match current schema {}",
            manifest.schema_version, current_schema
        ));
    }
    if manifest.version != BACKUP_VERSION {
        warnings.push(format!(
            "backup version {} is not the expected {}",
            manifest.version, BACKUP_VERSION
        ));
    }

    let diff = compute_backup_diff(&conn, &bundle)?;

    Ok(BackupPreview {
        manifest,
        compatible,
        supported_strategies: supported_strategies(),
        warnings,
        diff,
    })
}

#[tauri::command]
pub fn import_backup_v2_apply(
    path: String,
    strategy: String,
    passphrase: Option<String>,
    db: State<DbState>,
    app: tauri::AppHandle,
) -> Result<BackupApplyResult, String> {
    let (manifest, bundle, _payload_json) = read_backup_package(&path, passphrase.as_deref())?;

    match strategy.as_str() {
        "overwrite" => {
            let conn = db.lock().map_err(|e| e.to_string())?;
            let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
            clear_all_user_data(&tx)?;
            let (imported_rows, warnings) = apply_bundle(&tx, bundle)?;
            tx.commit().map_err(|e| e.to_string())?;
            Ok(BackupApplyResult {
                manifest,
                strategy: "overwrite".to_string(),
                imported_rows,
                warnings,
                new_profile_id: None,
            })
        }
        "merge" => {
            let conn = db.lock().map_err(|e| e.to_string())?;
            let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
            let (imported_rows, warnings) = apply_bundle(&tx, bundle)?;
            tx.commit().map_err(|e| e.to_string())?;
            Ok(BackupApplyResult {
                manifest,
                strategy: "merge".to_string(),
                imported_rows,
                warnings,
                new_profile_id: None,
            })
        }
        "new_profile" => {
            let profile_id = format!("restored_{}", chrono::Local::now().format("%Y%m%d_%H%M%S"));
            let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
            let profile_db_path =
                crate::db::migrations::db_path_for_profile(&data_dir, &profile_id);

            {
                let conn = db.lock().map_err(|e| e.to_string())?;
                conn.execute(
                    "INSERT INTO profiles (id, name, is_default, created_at) VALUES (?1, ?2, 0, ?3)",
                    params![&profile_id, &profile_id, now_ts()],
                )
                .map_err(|e| e.to_string())?;
            }

            let profile_conn = crate::db::open(&profile_db_path).map_err(|e| e.to_string())?;
            let tx = profile_conn
                .unchecked_transaction()
                .map_err(|e| e.to_string())?;
            let (imported_rows, warnings) = apply_bundle(&tx, bundle)?;
            tx.commit().map_err(|e| e.to_string())?;
            drop(profile_conn);

            {
                let conn = db.lock().map_err(|e| e.to_string())?;
                crate::db::set_setting(&conn, "current_profile_id", &profile_id)
                    .map_err(|e| e.to_string())?;
            }

            log::info!(
                "Restored {} rows into new profile {} (warnings: {}); restarting app",
                imported_rows,
                profile_id,
                warnings.len()
            );
            app.restart();
        }
        _ => Err("invalid backup restore strategy".to_string()),
    }
}

#[tauri::command]
pub fn enable_database_encryption(
    passphrase: String,
    db: State<DbState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    if passphrase.is_empty() {
        return Err("Passphrase cannot be empty".to_string());
    }
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::set_setting(&conn, "pending_db_encryption_enable", "1").map_err(|e| e.to_string())?;
    db::set_setting(&conn, "pending_db_encryption_passphrase", &passphrase)
        .map_err(|e| e.to_string())?;
    drop(conn);

    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let action = db_encryption::PendingEncryptionAction {
        action: "enable".to_string(),
        passphrase,
    };
    db_encryption::write_pending_action(&data_dir, &action)?;

    log::info!("Database encryption requested; restarting app");
    app.restart();
}

#[tauri::command]
pub fn disable_database_encryption(
    passphrase: String,
    db: State<DbState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    if passphrase.is_empty() {
        return Err("Passphrase cannot be empty".to_string());
    }
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::set_setting(&conn, "pending_db_encryption_disable", "1").map_err(|e| e.to_string())?;
    db::set_setting(&conn, "pending_db_encryption_passphrase", &passphrase)
        .map_err(|e| e.to_string())?;
    drop(conn);

    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let action = db_encryption::PendingEncryptionAction {
        action: "disable".to_string(),
        passphrase,
    };
    db_encryption::write_pending_action(&data_dir, &action)?;

    log::info!("Database encryption disable requested; restarting app");
    app.restart();
}

#[tauri::command]
pub fn get_database_encryption_status(
    db: State<DbState>,
    _app: tauri::AppHandle,
) -> Result<db_encryption::EncryptionStatus, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let db_path: std::path::PathBuf = conn
        .path()
        .map(std::path::PathBuf::from)
        .ok_or_else(|| "Database path is not available".to_string())?;
    let enabled = db_encryption::is_database_encrypted(&db_path);
    Ok(db_encryption::EncryptionStatus { enabled })
}

#[tauri::command]
pub fn get_retention_policy_info(db: State<DbState>) -> Result<RetentionPolicyInfo, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let policy = db::get_setting(&conn, "retention_policy")
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| "keep_all".to_string());
    let days = retention_days(&policy);
    let cutoff_date = days.map(date_days_ago);
    let estimated_rows = if let Some(days) = days {
        let cutoff = date_days_ago(days);
        let app_rows: i64 = conn
            .query_row(
                "SELECT COUNT(1) FROM app_usage WHERE date < ?1",
                params![cutoff],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        let daily_rows: i64 = conn
            .query_row(
                "SELECT COUNT(1) FROM daily_app_usage WHERE date < ?1",
                params![cutoff],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        app_rows + daily_rows
    } else {
        0
    };
    Ok(RetentionPolicyInfo {
        policy: policy.clone(),
        label: retention_label(&policy),
        cutoff_date,
        estimated_rows,
        estimated_storage_bytes: estimated_rows.saturating_mul(256),
    })
}

#[tauri::command]
pub fn set_retention_policy(policy: String, db: State<DbState>) -> Result<(), String> {
    let policy = match policy.as_str() {
        "keep_all" | "3m" | "6m" | "12m" => policy,
        _ => return Err("invalid retention policy".to_string()),
    };
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::set_setting(&conn, "retention_policy", &policy).map_err(|e| e.to_string())
}

pub fn archive_by_policy(
    conn: &rusqlite::Connection,
    policy: &str,
) -> Result<RetentionRunResult, String> {
    let Some(days) = retention_days(policy) else {
        return Ok(RetentionRunResult {
            policy: policy.to_string(),
            cutoff_date: None,
            archived_app_usage_rows: 0,
            archived_daily_rows: 0,
            warm_rows: 0,
            archive_rows: 0,
        });
    };

    let cutoff = date_days_ago(days);
    let warm_cutoff = date_days_ago(days / 2);
    let archived_at = now_ts();
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;

    let mut warm_rows: i64 = 0;
    let mut archive_rows: i64 = 0;

    let app_rows: Vec<(i64, String, String, String, String, i64, String, String)> = {
        let mut stmt = tx
            .prepare(
                "SELECT id, date, app_name, exe_path, window_title, active_seconds, first_seen_at, last_seen_at
                 FROM app_usage WHERE date < ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![cutoff], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, String>(7)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    for row in &app_rows {
        let tier = if row.1 >= warm_cutoff {
            warm_rows += 1;
            "warm"
        } else {
            archive_rows += 1;
            "archive"
        };
        tx.execute(
            "INSERT OR IGNORE INTO app_usage_archive
             (id, date, app_name, exe_path, window_title, active_seconds, first_seen_at, last_seen_at,
              archived_at, tier, compression, compressed_bytes)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'none', NULL)",
            params![row.0, &row.1, &row.2, &row.3, &row.4, row.5, &row.6, &row.7, &archived_at, tier],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.execute("DELETE FROM app_usage WHERE date < ?1", params![cutoff])
        .map_err(|e| e.to_string())?;
    let archived_app_usage_rows = app_rows.len() as i64;

    let daily_rows: Vec<(String, String, String, i64, String, String)> = {
        let mut stmt = tx
            .prepare(
                "SELECT date, app_name, exe_path, total_seconds, first_seen_at, last_seen_at
                 FROM daily_app_usage WHERE date < ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![cutoff], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    for row in &daily_rows {
        let tier = if row.0 >= warm_cutoff {
            warm_rows += 1;
            "warm"
        } else {
            archive_rows += 1;
            "archive"
        };
        tx.execute(
            "INSERT OR REPLACE INTO daily_app_usage_archive
             (date, app_name, exe_path, total_seconds, first_seen_at, last_seen_at,
              archived_at, tier, compression, compressed_bytes)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'none', NULL)",
            params![
                &row.0,
                &row.1,
                &row.2,
                row.3,
                &row.4,
                &row.5,
                &archived_at,
                tier
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.execute(
        "DELETE FROM daily_app_usage WHERE date < ?1",
        params![cutoff],
    )
    .map_err(|e| e.to_string())?;
    let archived_daily_rows = daily_rows.len() as i64;

    tx.commit().map_err(|e| e.to_string())?;

    Ok(RetentionRunResult {
        policy: policy.to_string(),
        cutoff_date: Some(cutoff),
        archived_app_usage_rows,
        archived_daily_rows,
        warm_rows,
        archive_rows,
    })
}

#[tauri::command]
pub fn run_local_archive_now(db: State<DbState>) -> Result<RetentionRunResult, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let policy = db::get_setting(&conn, "retention_policy")
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| "keep_all".to_string());
    archive_by_policy(&conn, &policy)
}

#[tauri::command]
pub fn get_archive_scheduler_settings(
    db: State<DbState>,
) -> Result<ArchiveSchedulerSettings, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let result: Result<ArchiveSchedulerSettings, String> = (|| {
        let mut stmt = conn
            .prepare(
                "SELECT enabled, daily_run_hour, run_on_battery FROM archive_scheduler_state WHERE id = 1",
            )
            .map_err(|e| e.to_string())?;
        stmt.query_row([], |row| {
            Ok(ArchiveSchedulerSettings {
                enabled: row.get::<_, i32>(0)? != 0,
                daily_run_hour: row.get(1)?,
                run_on_battery: row.get::<_, i32>(2)? != 0,
            })
        })
        .map_err(|e| e.to_string())
    })();
    match result {
        Ok(settings) => Ok(settings),
        Err(_) => {
            let default = ArchiveSchedulerSettings {
                enabled: false,
                daily_run_hour: 2,
                run_on_battery: true,
            };
            let _ = conn.execute(
                "INSERT OR IGNORE INTO archive_scheduler_state (id, enabled, daily_run_hour, run_on_battery)
                 VALUES (1, 0, 2, 1)",
                [],
            );
            Ok(default)
        }
    }
}

#[tauri::command]
pub fn set_archive_scheduler_settings(
    settings: ArchiveSchedulerSettings,
    db: State<DbState>,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let daily_run_hour = settings.daily_run_hour.clamp(0, 23);
    conn.execute(
        "INSERT INTO archive_scheduler_state (id, enabled, daily_run_hour, run_on_battery)
         VALUES (1, ?1, ?2, ?3)
         ON CONFLICT(id) DO UPDATE SET
            enabled = excluded.enabled,
            daily_run_hour = excluded.daily_run_hour,
            run_on_battery = excluded.run_on_battery",
        params![
            settings.enabled as i32,
            daily_run_hour,
            settings.run_on_battery as i32
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn compress_archive_older_than_days(
    days: i64,
    db: State<DbState>,
) -> Result<CompressionResult, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    if days < 0 {
        return Err("days must be non-negative".to_string());
    }
    let cutoff = date_days_ago(days);
    let archived_at = now_ts();

    let rows: Vec<(i64, String, String, String, String, i64, String, String)> = {
        let mut stmt = conn.prepare(
            "SELECT id, date, app_name, exe_path, window_title, active_seconds, first_seen_at, last_seen_at
             FROM app_usage_archive
             WHERE date < ?1 AND tier = 'archive' AND (compression IS NULL OR compression = 'none')",
        ).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![&cutoff], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, String>(7)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    let original_rows = rows.len() as i64;
    if original_rows == 0 {
        return Ok(CompressionResult {
            compressed_groups: 0,
            original_rows: 0,
            saved_bytes: 0,
        });
    }

    let mut groups: HashMap<(String, String, String), Vec<serde_json::Value>> = HashMap::new();
    let mut original_bytes: i64 = 0;
    for row in rows {
        let record = serde_json::json!({
            "id": row.0,
            "date": row.1,
            "app_name": row.2,
            "exe_path": row.3,
            "window_title": row.4,
            "active_seconds": row.5,
            "first_seen_at": row.6,
            "last_seen_at": row.7,
        });
        original_bytes += serde_json::to_string(&record)
            .map_err(|e| e.to_string())?
            .len() as i64;
        groups
            .entry((row.1.clone(), row.2.clone(), row.3.clone()))
            .or_default()
            .push(record);
    }

    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let mut compressed_groups: i64 = 0;
    let mut compressed_total_bytes: i64 = 0;

    for ((date, app_name, exe_path), records) in groups {
        let json_bytes = serde_json::to_vec(&records).map_err(|e| e.to_string())?;
        let compressed = zstd::encode_all(json_bytes.as_slice(), 3).map_err(|e| e.to_string())?;
        let compressed_len = compressed.len() as i64;

        tx.execute(
            "INSERT INTO app_usage_archive_compressed
             (date, app_name, exe_path, compression, compressed_bytes, payload, archived_at)
             VALUES (?1, ?2, ?3, 'zstd', ?4, ?5, ?6)",
            params![
                &date,
                &app_name,
                &exe_path,
                compressed_len,
                &compressed,
                &archived_at
            ],
        )
        .map_err(|e| e.to_string())?;

        compressed_groups += 1;
        compressed_total_bytes += compressed_len;
    }

    tx.execute(
        "DELETE FROM app_usage_archive
         WHERE date < ?1 AND tier = 'archive' AND (compression IS NULL OR compression = 'none')",
        params![&cutoff],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    let saved_bytes = original_bytes.saturating_sub(compressed_total_bytes);
    Ok(CompressionResult {
        compressed_groups,
        original_rows,
        saved_bytes,
    })
}

#[tauri::command]
pub fn get_compressed_archive_for_date_app(
    date: String,
    app_name: String,
    db: State<DbState>,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT payload FROM app_usage_archive_compressed
             WHERE date = ?1 AND app_name = ?2",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![&date, &app_name], |row| {
            let payload: Vec<u8> = row.get(0)?;
            Ok(payload)
        })
        .map_err(|e| e.to_string())?;

    let mut result: Vec<serde_json::Value> = Vec::new();
    for payload in rows {
        let payload = payload.map_err(|e| e.to_string())?;
        let decompressed = zstd::decode_all(payload.as_slice()).map_err(|e| e.to_string())?;
        let records: Vec<serde_json::Value> =
            serde_json::from_slice(&decompressed).map_err(|e| e.to_string())?;
        result.extend(records);
    }
    Ok(result)
}

#[tauri::command]
pub fn get_tracking_transparency(
    status: State<SharedMonitorStatus>,
    db: State<DbState>,
) -> Result<TrackingTransparencyReport, String> {
    let monitor_status = status.lock().map_err(|e| e.to_string())?.clone();
    let conn = db.lock().map_err(|e| e.to_string())?;
    let paused_at = db::get_setting(&conn, "tracking_paused_at")
        .map_err(|e| e.to_string())?
        .filter(|s| !s.is_empty());
    let paused_by = db::get_setting(&conn, "tracking_paused_by")
        .map_err(|e| e.to_string())?
        .filter(|s| !s.is_empty());
    let pause_reason = db::get_setting(&conn, "tracking_pause_reason")
        .map_err(|e| e.to_string())?
        .filter(|s| !s.is_empty());

    let tracked_fields = vec![
        TrackingFieldInfo {
            field: "app_name".to_string(),
            description: "Human-readable application name".to_string(),
        },
        TrackingFieldInfo {
            field: "exe_path".to_string(),
            description: "Executable path used for grouping and exclusions".to_string(),
        },
        TrackingFieldInfo {
            field: "window_title".to_string(),
            description: "Current foreground window title".to_string(),
        },
        TrackingFieldInfo {
            field: "active_seconds".to_string(),
            description: "Tracked duration for the usage slice".to_string(),
        },
        TrackingFieldInfo {
            field: "first_seen_at".to_string(),
            description: "Timestamp when the slice started".to_string(),
        },
        TrackingFieldInfo {
            field: "last_seen_at".to_string(),
            description: "Timestamp when the slice ended".to_string(),
        },
    ];

    let recent_writes = {
        let mut stmt = conn
            .prepare(
                "SELECT date, app_name, exe_path, window_title, active_seconds, first_seen_at, last_seen_at
                 FROM app_usage
                 ORDER BY id DESC
                 LIMIT 8",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(TrackingWriteEntry {
                    date: row.get(0)?,
                    app_name: row.get(1)?,
                    exe_path: row.get(2)?,
                    window_title: row.get(3)?,
                    active_seconds: row.get(4)?,
                    first_seen_at: row.get(5)?,
                    last_seen_at: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    let now = now_ts();
    let writes_last_24h = conn
        .query_row(
            "SELECT COUNT(1) FROM app_usage WHERE first_seen_at >= ?1",
            params![(Local::now() - Duration::hours(24))
                .format("%Y-%m-%dT%H:%M:%S")
                .to_string()],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let writes_last_7d = conn
        .query_row(
            "SELECT COUNT(1) FROM app_usage WHERE first_seen_at >= ?1",
            params![(Local::now() - Duration::days(7))
                .format("%Y-%m-%dT%H:%M:%S")
                .to_string()],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let _ = now;

    Ok(TrackingTransparencyReport {
        status: monitor_status,
        paused_at,
        paused_by,
        pause_reason,
        tracked_fields,
        writes_last_24h,
        writes_last_7d,
        recent_writes,
    })
}

#[tauri::command]
pub fn repair_data_issues(
    dry_run: bool,
    db: State<DbState>,
    status: State<SharedMonitorStatus>,
) -> Result<RepairAssistantResult, String> {
    let mut restore_monitor = false;
    if !dry_run {
        if let Ok(mut monitor) = status.lock() {
            restore_monitor = monitor.active;
            monitor.active = false;
        }
    }

    let run_result: Result<RepairAssistantResult, String> = (|| {
        let conn = db.lock().map_err(|e| e.to_string())?;
        let actions = vec![
            RepairActionPreview {
                code: "rebuild_daily_aggregates".to_string(),
                description:
                    "Rebuild daily_app_usage from app_usage to restore aggregate consistency"
                        .to_string(),
            },
            RepairActionPreview {
                code: "ensure_core_indexes".to_string(),
                description: "Ensure missing core indexes are present for stable query performance"
                    .to_string(),
            },
        ];

        if dry_run {
            let rebuilt_daily_rows = conn
                .query_row(
                    "SELECT COUNT(1)
                     FROM (
                        SELECT 1
                        FROM app_usage
                        GROUP BY date, app_name, COALESCE(exe_path, '')
                     )",
                    [],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            return Ok(RepairAssistantResult {
                dry_run: true,
                actions,
                rebuilt_daily_rows,
            });
        }

        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM daily_app_usage", [])
            .map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO daily_app_usage (date, app_name, exe_path, total_seconds, first_seen_at, last_seen_at)
             SELECT date,
                    app_name,
                    COALESCE(exe_path, '') as exe_path,
                    SUM(active_seconds) as total_seconds,
                    MIN(first_seen_at) as first_seen_at,
                    MAX(last_seen_at) as last_seen_at
             FROM app_usage
             GROUP BY date, app_name, COALESCE(exe_path, '')",
            [],
        )
        .map_err(|e| e.to_string())?;
        let rebuilt_daily_rows = tx
            .query_row("SELECT COUNT(1) FROM daily_app_usage", [], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;

        let _ = ensure_core_indexes(&conn)?;

        Ok(RepairAssistantResult {
            dry_run: false,
            actions,
            rebuilt_daily_rows,
        })
    })();

    if restore_monitor {
        if let Ok(mut monitor) = status.lock() {
            monitor.active = true;
        }
    }

    run_result
}

#[derive(Debug, Clone, Serialize)]
pub struct DataIntegrityResult {
    pub integrity_ok: bool,
    pub foreign_key_ok: bool,
    pub index_ok: bool,
    pub integrity_message: String,
    pub foreign_key_message: String,
}

#[tauri::command]
pub fn check_data_integrity(db: State<DbState>) -> Result<DataIntegrityResult, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let integrity: String = conn
        .pragma_query_value(None, "integrity_check", |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let fk_violations: Vec<String> = conn
        .prepare("PRAGMA foreign_key_check")
        .map_err(|e| e.to_string())?
        .query_map([], |row| {
            let table: String = row.get(0)?;
            let rowid: i64 = row.get(1)?;
            let parent: String = row.get(2)?;
            let fkid: i64 = row.get(3)?;
            Ok(format!(
                "table={} rowid={} parent={} fkid={}",
                table, rowid, parent, fkid
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let index_ok = db::migrations::ensure_core_indexes(&conn).is_ok();

    Ok(DataIntegrityResult {
        integrity_ok: integrity.eq_ignore_ascii_case("ok"),
        foreign_key_ok: fk_violations.is_empty(),
        index_ok,
        integrity_message: integrity,
        foreign_key_message: if fk_violations.is_empty() {
            "No foreign key violations".to_string()
        } else {
            fk_violations.join("; ")
        },
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct DataGapResult {
    pub missing_days: Vec<String>,
    pub zero_usage_days: Vec<String>,
    pub earliest_date: Option<String>,
    pub latest_date: Option<String>,
}

#[tauri::command]
pub fn scan_data_gaps(db: State<DbState>) -> Result<DataGapResult, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let (missing_days, zero_usage_days) = missing_and_zero_days(&conn)?;

    let earliest: Option<String> = conn
        .query_row(
            "SELECT MIN(date) FROM daily_app_usage WHERE total_seconds > 0",
            [],
            |row| row.get(0),
        )
        .ok();
    let latest: Option<String> = conn
        .query_row(
            "SELECT MAX(date) FROM daily_app_usage WHERE total_seconds > 0",
            [],
            |row| row.get(0),
        )
        .ok();

    Ok(DataGapResult {
        missing_days,
        zero_usage_days,
        earliest_date: earliest,
        latest_date: latest,
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct OrphanRowResult {
    pub table: String,
    pub description: String,
    pub count: i64,
}

#[tauri::command]
pub fn check_orphan_rows(db: State<DbState>) -> Result<Vec<OrphanRowResult>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let mut results = Vec::new();

    // daily_app_usage rows without underlying app_usage rows for that (date, app, exe).
    let orphan_daily: i64 = conn
        .query_row(
            "SELECT COUNT(1) FROM daily_app_usage d
             WHERE NOT EXISTS (
                 SELECT 1 FROM app_usage a
                 WHERE a.date = d.date
                   AND a.app_name = d.app_name
                   AND COALESCE(a.exe_path, '') = COALESCE(d.exe_path, '')
             )",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    results.push(OrphanRowResult {
        table: "daily_app_usage".to_string(),
        description: "Daily aggregates with no matching raw usage rows".to_string(),
        count: orphan_daily,
    });

    // vscode_session_languages rows without parent session.
    let orphan_lang: i64 = conn
        .query_row(
            "SELECT COUNT(1) FROM vscode_session_languages l
             WHERE NOT EXISTS (
                 SELECT 1 FROM vscode_sessions s WHERE s.session_id = l.session_id
             )",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    results.push(OrphanRowResult {
        table: "vscode_session_languages".to_string(),
        description: "Language rows with no matching VS Code session".to_string(),
        count: orphan_lang,
    });

    // widget permission audit log entries for widgets no longer in configs.
    let orphan_audit: i64 = conn
        .query_row(
            "SELECT COUNT(1) FROM widget_permission_audit_log a
             WHERE NOT EXISTS (
                 SELECT 1 FROM widget_configs c WHERE c.id = a.widget_id
             )",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    results.push(OrphanRowResult {
        table: "widget_permission_audit_log".to_string(),
        description: "Permission audit entries for deleted widgets".to_string(),
        count: orphan_audit,
    });

    Ok(results)
}

#[tauri::command]
pub fn run_migration_rehearsal(
    db: State<DbState>,
) -> Result<db::migrations::MigrationRehearsalReport, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let path: std::path::PathBuf = conn
        .path()
        .map(std::path::PathBuf::from)
        .ok_or_else(|| "Database path is not available".to_string())?;
    drop(conn);

    db::migrations::run_migration_rehearsal(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_migration_status(db: State<DbState>) -> Result<db::migrations::MigrationStatus, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    db::migrations::get_status(&conn).map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Serialize)]
pub struct ProfileInfo {
    pub id: String,
    pub name: String,
    pub is_current: bool,
    pub is_default: bool,
    pub created_at: String,
}

#[tauri::command]
pub fn list_profiles(db: State<DbState>) -> Result<Vec<ProfileInfo>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let current = crate::db::migrations::current_profile_id_from_conn(&conn);
    let mut stmt = conn
        .prepare("SELECT id, name, is_default, created_at FROM profiles ORDER BY created_at")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            let id: String = row.get(0)?;
            Ok(ProfileInfo {
                id: id.clone(),
                name: row.get(1)?,
                is_current: id == current,
                is_default: row.get::<_, i32>(2)? != 0,
                created_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_profile(
    name: String,
    app: tauri::AppHandle,
    db: State<DbState>,
) -> Result<ProfileInfo, String> {
    let id = name.trim().to_lowercase().replace(' ', "_");
    if id.is_empty() || id == "default" {
        return Err("Invalid profile id".to_string());
    }
    let now = now_ts();
    {
        let conn = db.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO profiles (id, name, is_default, created_at) VALUES (?1, ?2, 0, ?3)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name",
            params![&id, name.trim(), &now],
        )
        .map_err(|e| e.to_string())?;
    }

    // Ensure the profile database file can be created.
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let profile_db = crate::db::migrations::db_path_for_profile(&data_dir, &id);
    let _ = crate::db::open(&profile_db).map_err(|e| e.to_string())?;

    Ok(ProfileInfo {
        id: id.clone(),
        name: name.trim().to_string(),
        is_current: false,
        is_default: false,
        created_at: now,
    })
}

#[tauri::command]
pub fn switch_profile(
    profile_id: String,
    app: tauri::AppHandle,
    db: State<DbState>,
) -> Result<(), String> {
    if profile_id.trim().is_empty() {
        return Err("Profile id is required".to_string());
    }
    let profile_id = profile_id.trim().to_string();

    {
        let conn = db.lock().map_err(|e| e.to_string())?;
        let exists: bool = conn
            .query_row(
                "SELECT 1 FROM profiles WHERE id = ?1",
                params![&profile_id],
                |_row| Ok(true),
            )
            .unwrap_or(false);
        if !exists && profile_id != "default" {
            return Err(format!("Profile '{}' does not exist", profile_id));
        }

        crate::db::set_setting(&conn, "current_profile_id", &profile_id)
            .map_err(|e| e.to_string())?;
    }

    log::info!("Switching to profile {}; restarting app", profile_id);
    app.restart();
}

#[tauri::command]
pub fn get_current_profile(db: State<DbState>) -> Result<String, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    Ok(crate::db::migrations::current_profile_id_from_conn(&conn))
}
