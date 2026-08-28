use std::fs;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::commands::storage_cmd::DbState;
use crate::models::{IssuedApiToken, WidgetPermissionAuditEntry, WidgetPermissionEntry};
use crate::widget_registry::{load_third_party_widget_from_manifest_path, WidgetRegistryItem};

// ── Permission CRUD ───────────────────────────────────────────

#[tauri::command]
pub fn get_widget_permissions(
    widget_id: String,
    db: State<'_, DbState>,
) -> Result<Vec<String>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    crate::db::get_widget_permissions(&conn, &widget_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_widget_permissions(
    widget_id: String,
    permissions: Vec<String>,
    actor: Option<String>,
    db: State<'_, DbState>,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    crate::db::set_widget_permissions(&conn, &widget_id, &permissions, actor.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn revoke_all_widget_permissions(
    widget_id: String,
    actor: Option<String>,
    app: AppHandle,
    db: State<'_, DbState>,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    crate::db::revoke_all_widget_permissions(&conn, &widget_id, actor.as_deref())
        .map_err(|e| e.to_string())?;
    crate::db::clear_widget_subscriptions(&conn, &widget_id).map_err(|e| e.to_string())?;
    let _ = app.emit(
        "widget-permission-revoked",
        serde_json::json!({ "widgetId": widget_id, "scope": null, "all": true }),
    );
    Ok(())
}

#[tauri::command]
pub fn get_widget_permission_audit_log(
    widget_id: String,
    limit: Option<i64>,
    db: State<'_, DbState>,
) -> Result<Vec<WidgetPermissionAuditEntry>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    crate::db::get_widget_permission_audit_log(&conn, &widget_id, limit.unwrap_or(50))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_widget_permission_matrix(
    widget_id: String,
    db: State<'_, DbState>,
) -> Result<Vec<WidgetPermissionEntry>, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    crate::db::get_widget_permission_entries(&conn, &widget_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn record_widget_permission_access(
    widget_id: String,
    permission: String,
    db: State<'_, DbState>,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    crate::db::touch_widget_permission_access(&conn, &widget_id, &permission)
        .map_err(|e| e.to_string())
}

// ── Import local widget ───────────────────────────────────────

/// Copy a local widget directory into app_data/widgets/<widget_type>/
/// and return the parsed registry item.
#[tauri::command]
pub fn import_local_widget(src_dir: String, app: AppHandle) -> Result<WidgetRegistryItem, String> {
    let src = std::path::Path::new(&src_dir);
    let manifest_path = src.join("manifest.json");

    // Validate the manifest first (reuse existing registry logic).
    let item = load_third_party_widget_from_manifest_path(&manifest_path).map_err(|e| e.message)?;

    // Resolve destination: app_data/widgets/<widget_type>/
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let dest = data_dir.join("widgets").join(&item.widget_type);

    if dest.exists() {
        fs::remove_dir_all(&dest)
            .map_err(|e| format!("failed to remove existing widget dir: {e}"))?;
    }
    copy_dir_all(src, &dest)?;

    // Re-parse from the installed location so entry path is correct.
    let installed_manifest = dest.join("manifest.json");
    let installed =
        load_third_party_widget_from_manifest_path(&installed_manifest).map_err(|e| e.message)?;
    Ok(installed)
}

/// Issue a scoped local API token for a widget that has the `local-api:call`
/// permission. The plaintext token is returned only once.
#[tauri::command]
pub fn issue_widget_api_token(
    widget_id: String,
    scopes: Vec<String>,
    db: State<'_, DbState>,
) -> Result<IssuedApiToken, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let permissions = crate::db::get_widget_permissions(&conn, &widget_id)
        .map_err(|e| format!("failed to load widget permissions: {e}"))?;
    let has_local_api = permissions
        .iter()
        .any(|p| p == "local-api:call" || p == "api:call");
    if !has_local_api {
        return Err("widget does not have local-api:call permission".to_string());
    }

    let label = format!("Widget: {}", widget_id);
    let token = crate::commands::extension_bridge_cmd::issue_api_token_impl(
        &conn,
        label,
        scopes.clone(),
        None,
    )?;

    let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string();
    let scopes_detail = if scopes.is_empty() {
        "none".to_string()
    } else {
        scopes.join(", ")
    };
    conn.execute(
        "INSERT INTO widget_permission_audit_log
         (widget_id, permission, action, actor, occurred_at, detail)
         VALUES (?1, ?2, 'issue_token', 'widget-runtime', ?3, ?4)",
        rusqlite::params![
            widget_id,
            "local-api:call",
            now,
            format!("issued local API token with scopes: {}", scopes_detail)
        ],
    )
    .map_err(|e| format!("failed to record token audit log: {e}"))?;

    Ok(token)
}

fn copy_dir_all(src: &std::path::Path, dst: &std::path::Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("create_dir_all failed: {e}"))?;
    for entry in fs::read_dir(src).map_err(|e| format!("read_dir failed: {e}"))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let ty = entry.file_type().map_err(|e| e.to_string())?;
        let dest_path = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_all(&entry.path(), &dest_path)?;
        } else {
            fs::copy(entry.path(), &dest_path)
                .map_err(|e| format!("copy failed {}: {e}", entry.path().display()))?;
        }
    }
    Ok(())
}
