use crate::db;
use crate::models::{ApiAuditLogEntry, ApiTokenMetadata, IssuedApiToken, LocalApiSecuritySettings};
use rusqlite::Connection;
use sha2::{Digest, Sha256};
use uuid::Uuid;

/// Generate or get the current extension bridge key.
/// If no key exists, generate a new UUID-based key and store it.
#[tauri::command]
pub fn get_extension_bridge_key(
    db_state: tauri::State<super::storage_cmd::DbState>,
) -> Result<String, String> {
    let db = db_state
        .lock()
        .map_err(|e| format!("Database lock error: {}", e))?;

    // Try to get existing key
    if let Ok(Some(key)) = db::get_setting(&db, "extension_bridge_key") {
        return Ok(key);
    }

    // Generate new key if it doesn't exist
    generate_extension_bridge_key_impl(&db)
}

/// Rotate the extension bridge key (generate a new one, invalidate old signatures).
#[tauri::command]
pub fn rotate_extension_bridge_key(
    db_state: tauri::State<super::storage_cmd::DbState>,
) -> Result<String, String> {
    let db = db_state
        .lock()
        .map_err(|e| format!("Database lock error: {}", e))?;
    generate_extension_bridge_key_impl(&db)
}

fn generate_extension_bridge_key_impl(db: &Connection) -> Result<String, String> {
    let new_key = Uuid::new_v4().to_string();
    let now = chrono::Local::now().to_rfc3339();

    db::set_setting(db, "extension_bridge_key", &new_key)
        .map_err(|e| format!("Failed to store key: {}", e))?;
    db::set_setting(db, "extension_bridge_key_rotated_at", &now)
        .map_err(|e| format!("Failed to store rotation timestamp: {}", e))?;

    Ok(new_key)
}

pub(crate) fn hash_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hex::encode(hasher.finalize())
}

pub(crate) fn issue_api_token_impl(
    db: &Connection,
    label: String,
    data_scopes: Vec<String>,
    operation_scopes: Vec<String>,
    expires_at: Option<String>,
) -> Result<IssuedApiToken, String> {
    let trimmed_label = label.trim();
    if trimmed_label.is_empty() {
        return Err("label cannot be empty".to_string());
    }

    let nickname = trimmed_label.to_string();
    let normalized_data: Vec<String> = data_scopes
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    let normalized_operations: Vec<String> = operation_scopes
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    let scopes = {
        let mut merged = normalized_data.clone();
        merged.extend(normalized_operations.iter().cloned());
        merged
    };

    let token_id = Uuid::new_v4().to_string();
    let secret = format!("{}.{}", Uuid::new_v4(), Uuid::new_v4());
    let token_hash = hash_token(&secret);
    let now = chrono::Local::now().to_rfc3339();
    let normalized_scopes: Vec<String> = scopes
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    db::insert_api_token(
        db,
        &token_id,
        &nickname,
        trimmed_label,
        &token_hash,
        &normalized_data,
        &normalized_operations,
        &normalized_scopes,
        &now,
        expires_at.as_deref(),
    )
    .map_err(|e| format!("Failed to persist API token: {e}"))?;

    Ok(IssuedApiToken {
        id: token_id,
        token: secret,
        nickname: nickname.clone(),
        label: trimmed_label.to_string(),
        scopes: normalized_scopes,
        data_scopes: normalized_data,
        operation_scopes: normalized_operations,
        created_at: now,
        expires_at,
    })
}

#[tauri::command]
pub fn issue_api_token(
    label: String,
    data_scopes: Vec<String>,
    operation_scopes: Vec<String>,
    expires_at: Option<String>,
    db_state: tauri::State<super::storage_cmd::DbState>,
) -> Result<IssuedApiToken, String> {
    let db = db_state
        .lock()
        .map_err(|e| format!("Database lock error: {}", e))?;
    issue_api_token_impl(&db, label, data_scopes, operation_scopes, expires_at)
}

#[tauri::command]
pub fn rotate_api_token(
    token_id: String,
    expires_at: Option<String>,
    db_state: tauri::State<super::storage_cmd::DbState>,
) -> Result<IssuedApiToken, String> {
    let db = db_state
        .lock()
        .map_err(|e| format!("Database lock error: {}", e))?;
    let existing = db::get_api_token_by_id(&db, &token_id)
        .map_err(|e| format!("Failed to load token: {e}"))?
        .ok_or_else(|| "token not found".to_string())?;

    let now = chrono::Local::now().to_rfc3339();
    db::revoke_api_token(&db, &token_id, &now)
        .map_err(|e| format!("Failed to revoke previous token: {e}"))?;

    issue_api_token_impl(
        &db,
        existing.label,
        existing.data_scopes,
        existing.operation_scopes,
        expires_at.or(existing.expires_at),
    )
}

#[tauri::command]
pub fn revoke_api_token(
    token_id: String,
    db_state: tauri::State<super::storage_cmd::DbState>,
) -> Result<(), String> {
    let db = db_state
        .lock()
        .map_err(|e| format!("Database lock error: {}", e))?;
    let now = chrono::Local::now().to_rfc3339();
    db::revoke_api_token(&db, &token_id, &now).map_err(|e| format!("Failed to revoke token: {e}"))
}

#[tauri::command]
pub fn list_api_tokens(
    db_state: tauri::State<super::storage_cmd::DbState>,
) -> Result<Vec<ApiTokenMetadata>, String> {
    let db = db_state
        .lock()
        .map_err(|e| format!("Database lock error: {}", e))?;
    db::list_api_tokens(&db).map_err(|e| format!("Failed to list API tokens: {e}"))
}

#[tauri::command]
pub fn get_api_audit_log(
    limit: Option<i64>,
    offset: Option<i64>,
    client_id: Option<String>,
    endpoint: Option<String>,
    db_state: tauri::State<super::storage_cmd::DbState>,
) -> Result<Vec<ApiAuditLogEntry>, String> {
    let db = db_state
        .lock()
        .map_err(|e| format!("Database lock error: {}", e))?;
    db::list_api_audit_log(
        &db,
        limit.unwrap_or(100),
        offset.unwrap_or(0),
        client_id.as_deref(),
        endpoint.as_deref(),
    )
    .map_err(|e| format!("Failed to query API audit log: {e}"))
}

#[tauri::command]
pub fn get_api_client_allowlist(
    db_state: tauri::State<super::storage_cmd::DbState>,
) -> Result<Vec<String>, String> {
    let db = db_state
        .lock()
        .map_err(|e| format!("Database lock error: {}", e))?;
    db::get_api_client_allowlist(&db).map_err(|e| format!("Failed to load API allowlist: {e}"))
}

#[tauri::command]
pub fn set_api_client_allowlist(
    client_ids: Vec<String>,
    db_state: tauri::State<super::storage_cmd::DbState>,
) -> Result<(), String> {
    let db = db_state
        .lock()
        .map_err(|e| format!("Database lock error: {}", e))?;
    db::replace_api_client_allowlist(&db, &client_ids)
        .map_err(|e| format!("Failed to persist API allowlist: {e}"))
}

#[tauri::command]
pub fn get_local_api_security_settings(
    db_state: tauri::State<super::storage_cmd::DbState>,
) -> Result<LocalApiSecuritySettings, String> {
    let db = db_state
        .lock()
        .map_err(|e| format!("Database lock error: {}", e))?;
    let token_required = db::get_bool_setting(&db, "local_api_token_required", false)
        .map_err(|e| format!("Failed to load token-required setting: {e}"))?;
    let allowlist_enforced = db::get_bool_setting(&db, "local_api_allowlist_enforced", false)
        .map_err(|e| format!("Failed to load allowlist setting: {e}"))?;
    let rate_limit_per_min = db::get_setting(&db, "local_api_rate_limit_per_min")
        .map_err(|e| format!("Failed to load rate-limit setting: {e}"))?
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(240);

    Ok(LocalApiSecuritySettings {
        token_required,
        allowlist_enforced,
        rate_limit_per_min,
    })
}

#[tauri::command]
pub fn set_local_api_security_settings(
    token_required: Option<bool>,
    allowlist_enforced: Option<bool>,
    rate_limit_per_min: Option<i64>,
    db_state: tauri::State<super::storage_cmd::DbState>,
) -> Result<(), String> {
    let db = db_state
        .lock()
        .map_err(|e| format!("Database lock error: {}", e))?;

    if let Some(v) = token_required {
        db::set_bool_setting(&db, "local_api_token_required", v)
            .map_err(|e| format!("Failed to persist token-required setting: {e}"))?;
    }
    if let Some(v) = allowlist_enforced {
        db::set_bool_setting(&db, "local_api_allowlist_enforced", v)
            .map_err(|e| format!("Failed to persist allowlist setting: {e}"))?;
    }
    if let Some(v) = rate_limit_per_min {
        let normalized = v.clamp(10, 10_000);
        db::set_setting(&db, "local_api_rate_limit_per_min", &normalized.to_string())
            .map_err(|e| format!("Failed to persist rate-limit setting: {e}"))?;
    }

    Ok(())
}

/// Verify a local API token and return its scopes if valid.
/// Also updates the token's last-used metadata.
pub fn verify_api_token(
    db: &Connection,
    token: &str,
    client_id: &str,
) -> Result<Option<Vec<String>>, String> {
    if token.is_empty() {
        return Ok(None);
    }
    let token_hash = hash_token(token);
    let now = chrono::Local::now().to_rfc3339();
    let meta = db::find_active_api_token_by_hash(db, &token_hash, &now)
        .map_err(|e| format!("Failed to verify token: {e}"))?;
    if let Some(meta) = meta {
        db::touch_api_token_use(db, &meta.id, &now, client_id)
            .map_err(|e| format!("Failed to update token usage: {e}"))?;
        return Ok(Some(meta.scopes));
    }
    Ok(None)
}

/// Verify that a request signature is valid.
/// Used by the API server middleware.
pub fn verify_request_signature(body: &[u8], provided_signature: &str, key: &str) -> bool {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;

    type HmacSha256 = Hmac<Sha256>;

    // Compute the expected signature
    let mut mac = HmacSha256::new_from_slice(key.as_bytes())
        .unwrap_or_else(|_| HmacSha256::new_from_slice(b"").unwrap());
    mac.update(body);
    let expected_bytes = mac.finalize().into_bytes();
    let expected_signature = hex::encode(expected_bytes);

    // Constant-time comparison to prevent timing attacks
    expected_signature.as_bytes().len() == provided_signature.len()
        && expected_signature
            .as_bytes()
            .iter()
            .zip(provided_signature.as_bytes().iter())
            .all(|(a, b)| a == b)
}

/// Sign a request body with the given key.
/// Returns the HMAC-SHA256 signature as a hex string.
pub fn sign_request_body(body: &[u8], key: &str) -> String {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;

    type HmacSha256 = Hmac<Sha256>;

    let mut mac = HmacSha256::new_from_slice(key.as_bytes())
        .unwrap_or_else(|_| HmacSha256::new_from_slice(b"").unwrap());
    mac.update(body);
    let bytes = mac.finalize().into_bytes();
    hex::encode(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_signature_verify() {
        let key = "test-key";
        let body = b"test body";
        let signature = sign_request_body(body, key);
        assert!(verify_request_signature(body, &signature, key));
        assert!(!verify_request_signature(b"wrong body", &signature, key));
        assert!(!verify_request_signature(body, "wrong signature", key));
    }

    #[test]
    fn test_issue_api_token_tracks_nickname_and_grants() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::initialize(&conn).unwrap();

        let issued = issue_api_token_impl(
            &conn,
            "vscode-local-client".to_string(),
            vec!["usage:read".to_string()],
            vec!["session:write".to_string()],
            Some("2099-01-01T00:00:00+00:00".to_string()),
        )
        .unwrap();

        assert_eq!(issued.nickname, "vscode-local-client");
        assert_eq!(issued.data_scopes, vec!["usage:read"]);
        assert_eq!(issued.operation_scopes, vec!["session:write"]);

        let listed = crate::db::list_api_tokens(&conn).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].nickname, "vscode-local-client");
        assert_eq!(listed[0].data_scopes, vec!["usage:read"]);
        assert_eq!(listed[0].operation_scopes, vec!["session:write"]);
    }
}
