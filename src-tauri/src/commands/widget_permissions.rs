use std::fs;
use tauri::{AppHandle, Manager, State};

use crate::commands::storage_cmd::DbState;
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
    db: State<'_, DbState>,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    crate::db::set_widget_permissions(&conn, &widget_id, &permissions).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn revoke_all_widget_permissions(
    widget_id: String,
    db: State<'_, DbState>,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    crate::db::revoke_all_widget_permissions(&conn, &widget_id).map_err(|e| e.to_string())
}

// ── Import local widget ───────────────────────────────────────

/// Copy a local widget directory into app_data/widgets/<widget_type>/
/// and return the parsed registry item.
#[tauri::command]
pub fn import_local_widget(
    src_dir: String,
    app: AppHandle,
) -> Result<WidgetRegistryItem, String> {
    let src = std::path::Path::new(&src_dir);
    let manifest_path = src.join("manifest.json");

    // Validate the manifest first (reuse existing registry logic).
    let item = load_third_party_widget_from_manifest_path(&manifest_path)
        .map_err(|e| e.message)?;

    // Resolve destination: app_data/widgets/<widget_type>/
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let dest = data_dir.join("widgets").join(&item.widget_type);

    if dest.exists() {
        fs::remove_dir_all(&dest).map_err(|e| format!("failed to remove existing widget dir: {e}"))?;
    }
    copy_dir_all(src, &dest)?;

    // Re-parse from the installed location so entry path is correct.
    let installed_manifest = dest.join("manifest.json");
    let installed = load_third_party_widget_from_manifest_path(&installed_manifest)
        .map_err(|e| e.message)?;
    Ok(installed)
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
