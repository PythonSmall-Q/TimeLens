use crate::db;
use rusqlite::Connection;
use uuid::Uuid;


/// Generate or get the current extension bridge key.
/// If no key exists, generate a new UUID-based key and store it.
#[tauri::command]
pub fn get_extension_bridge_key(db_state: tauri::State<super::storage_cmd::DbState>) -> Result<String, String> {
    let db = db_state.lock().map_err(|e| format!("Database lock error: {}", e))?;
    
    // Try to get existing key
    if let Ok(Some(key)) = db::get_setting(&db, "extension_bridge_key") {
        return Ok(key);
    }
    
    // Generate new key if it doesn't exist
    generate_extension_bridge_key_impl(&db)
}

/// Rotate the extension bridge key (generate a new one, invalidate old signatures).
#[tauri::command]
pub fn rotate_extension_bridge_key(db_state: tauri::State<super::storage_cmd::DbState>) -> Result<String, String> {
    let db = db_state.lock().map_err(|e| format!("Database lock error: {}", e))?;
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

/// Verify that a request signature is valid.
/// Used by the API server middleware.
pub fn verify_request_signature(
    body: &[u8],
    provided_signature: &str,
    key: &str,
) -> bool {
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
        && expected_signature.as_bytes().iter()
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
}
