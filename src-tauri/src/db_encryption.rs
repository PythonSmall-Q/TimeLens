use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::thread;
use std::time::Duration;

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use rand::rngs::OsRng;
use rand::RngCore;
use serde::{Deserialize, Serialize};

const KEY_CHECK_PLAINTEXT: &str = "timelens-db-key-check";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptionMetadata {
    pub salt: String,
    pub nonce: String,
    pub key_check: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptionStatus {
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingEncryptionAction {
    pub action: String, // "enable" | "disable"
    pub passphrase: String,
}

pub fn derive_key(passphrase: &str, salt: &[u8]) -> [u8; 32] {
    let params = Params::new(65536, 3, 4, Some(32)).expect("valid argon2 params");
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; 32];
    argon2
        .hash_password_into(passphrase.as_bytes(), salt, &mut key)
        .expect("argon2 key derivation failed");
    key
}

fn generate_salt() -> [u8; 16] {
    let mut salt = [0u8; 16];
    OsRng.fill_bytes(&mut salt);
    salt
}

fn generate_nonce() -> [u8; 12] {
    let mut nonce = [0u8; 12];
    OsRng.fill_bytes(&mut nonce);
    nonce
}

pub fn encryption_meta_path(db_path: &Path) -> PathBuf {
    PathBuf::from(format!("{}.encryption-meta", db_path.display()))
}

pub fn encrypted_db_path(db_path: &Path) -> PathBuf {
    PathBuf::from(format!("{}.encrypted", db_path.display()))
}

pub fn pending_encryption_path(data_dir: &Path) -> PathBuf {
    data_dir.join("db_encryption_pending.json")
}

pub fn is_database_encrypted(db_path: &Path) -> bool {
    encryption_meta_path(db_path).exists()
}

pub fn read_pending_action(data_dir: &Path) -> Option<PendingEncryptionAction> {
    let path = pending_encryption_path(data_dir);
    if !path.exists() {
        return None;
    }
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|json| serde_json::from_str(&json).ok())
}

pub fn write_pending_action(
    data_dir: &Path,
    action: &PendingEncryptionAction,
) -> Result<(), String> {
    let path = pending_encryption_path(data_dir);
    let json = serde_json::to_string_pretty(action).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

pub fn delete_pending_action(data_dir: &Path) -> std::io::Result<()> {
    let path = pending_encryption_path(data_dir);
    if path.exists() {
        std::fs::remove_file(&path)?;
    }
    Ok(())
}

/// Retry a filesystem operation a few times with a short delay.
/// Useful on Windows where files may stay locked briefly after a handle is closed.
fn retry_io<F>(mut op: F, desc: &str) -> std::io::Result<()>
where
    F: FnMut() -> std::io::Result<()>,
{
    let mut last_err = None;
    for attempt in 0..5 {
        match op() {
            Ok(()) => return Ok(()),
            Err(e) => {
                last_err = Some(e);
                if attempt < 4 {
                    thread::sleep(Duration::from_millis(50 * (attempt + 1)));
                }
            }
        }
    }
    Err(last_err.unwrap_or_else(|| std::io::Error::new(std::io::ErrorKind::Other, desc)))
}

pub fn encrypt_file(
    plaintext_path: &Path,
    ciphertext_path: &Path,
    passphrase: &str,
) -> Result<EncryptionMetadata, String> {
    let mut plaintext = Vec::new();
    let mut file = File::open(plaintext_path).map_err(|e| e.to_string())?;
    file.read_to_end(&mut plaintext)
        .map_err(|e| e.to_string())?;

    let salt = generate_salt();
    let nonce_bytes = generate_nonce();
    let key = derive_key(passphrase, &salt);
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let nonce = Nonce::from_slice(&nonce_bytes);

    let key_check = cipher
        .encrypt(nonce, KEY_CHECK_PLAINTEXT.as_bytes())
        .map_err(|e| e.to_string())?;
    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_ref())
        .map_err(|e| e.to_string())?;

    let meta = EncryptionMetadata {
        salt: hex::encode(salt),
        nonce: hex::encode(nonce_bytes),
        key_check: hex::encode(key_check),
    };

    // Write to a temporary file and rename atomically so a crash during write
    // never leaves a partially-written encrypted database behind.
    let temp_path = ciphertext_path.with_extension("encrypted.tmp");
    {
        let mut out = File::create(&temp_path).map_err(|e| e.to_string())?;
        out.write_all(&ciphertext).map_err(|e| e.to_string())?;
        out.flush().map_err(|e| e.to_string())?;
    }
    retry_io(|| std::fs::rename(&temp_path, ciphertext_path), "rename encrypted database")
        .map_err(|e| e.to_string())?;

    Ok(meta)
}

pub fn decrypt_file(
    ciphertext_path: &Path,
    plaintext_path: &Path,
    passphrase: &str,
    meta: &EncryptionMetadata,
) -> Result<(), String> {
    let salt = hex::decode(&meta.salt).map_err(|e| e.to_string())?;
    let nonce_bytes = hex::decode(&meta.nonce).map_err(|e| e.to_string())?;
    let key_check = hex::decode(&meta.key_check).map_err(|e| e.to_string())?;

    if nonce_bytes.len() != 12 {
        return Err("invalid nonce length in encryption metadata".to_string());
    }

    let key = derive_key(passphrase, &salt);
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let nonce = Nonce::from_slice(&nonce_bytes);

    let decrypted_check = cipher
        .decrypt(nonce, key_check.as_ref())
        .map_err(|_| "Invalid passphrase".to_string())?;
    if decrypted_check != KEY_CHECK_PLAINTEXT.as_bytes() {
        return Err("Invalid passphrase".to_string());
    }

    let mut ciphertext = Vec::new();
    let mut file = File::open(ciphertext_path).map_err(|e| e.to_string())?;
    file.read_to_end(&mut ciphertext)
        .map_err(|e| e.to_string())?;

    let plaintext = cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|_| "Failed to decrypt database (invalid passphrase or corrupted backup)".to_string())?;

    // Write to a temporary file and rename atomically. This avoids corrupting an
    // existing plaintext file if the write is interrupted, and avoids lock races
    // on Windows when replacing a still-locked file.
    let temp_path = plaintext_path.with_extension("db.tmp");
    {
        let mut out = File::create(&temp_path).map_err(|e| {
            format!("Failed to create temporary plaintext database: {}", e)
        })?;
        out.write_all(&plaintext).map_err(|e| {
            format!("Failed to write temporary plaintext database: {}", e)
        })?;
        out.flush().map_err(|e| {
            format!("Failed to flush temporary plaintext database: {}", e)
        })?;
    }
    retry_io(|| {
        if plaintext_path.exists() {
            std::fs::remove_file(plaintext_path)?;
        }
        std::fs::rename(&temp_path, plaintext_path)
    }, "replace plaintext database")
    .map_err(|e| format!("Failed to replace plaintext database: {}", e))?;

    Ok(())
}

pub fn read_metadata(path: &Path) -> Result<EncryptionMetadata, String> {
    let json = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&json).map_err(|e| e.to_string())
}

pub fn write_metadata(path: &Path, meta: &EncryptionMetadata) -> Result<(), String> {
    let json = serde_json::to_string_pretty(meta).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

pub fn wipe_plaintext_db(plaintext_path: &Path) -> std::io::Result<()> {
    if plaintext_path.exists() {
        // Best-effort retry on Windows where the file may still be locked by an
        // open SQLite connection while the process is shutting down.
        let _ = retry_io(|| std::fs::remove_file(plaintext_path), "remove plaintext database");
    }
    let wal = PathBuf::from(format!("{}-wal", plaintext_path.display()));
    let shm = PathBuf::from(format!("{}-shm", plaintext_path.display()));
    if wal.exists() {
        let _ = retry_io(|| std::fs::remove_file(&wal), "remove wal file");
    }
    if shm.exists() {
        let _ = retry_io(|| std::fs::remove_file(&shm), "remove shm file");
    }
    Ok(())
}

pub fn copy_db_sidecars(src: &Path, dst: &Path) -> std::io::Result<()> {
    let src_wal = PathBuf::from(format!("{}-wal", src.display()));
    let src_shm = PathBuf::from(format!("{}-shm", src.display()));
    let dst_wal = PathBuf::from(format!("{}-wal", dst.display()));
    let dst_shm = PathBuf::from(format!("{}-shm", dst.display()));

    if src_wal.exists() {
        std::fs::copy(&src_wal, &dst_wal)?;
    }
    if src_shm.exists() {
        std::fs::copy(&src_shm, &dst_shm)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn tmp_dir() -> std::path::PathBuf {
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let tid = std::thread::current().id();
        let rand = rand::random::<u32>();
        let dir = std::env::temp_dir().join(format!(
            "timelens_db_encryption_test_{}_{:?}_{}",
            ts, tid, rand
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn test_encrypt_decrypt_file() {
        let dir = tmp_dir();
        let plaintext = dir.join("plain.db");
        let encrypted = dir.join("plain.db.encrypted");
        let meta_path = dir.join("plain.db.encryption-meta");
        let decrypted = dir.join("decrypted.db");

        std::fs::write(&plaintext, b"hello encrypted database").unwrap();

        let meta = encrypt_file(&plaintext, &encrypted, "secret").unwrap();
        write_metadata(&meta_path, &meta).unwrap();

        let read_meta = read_metadata(&meta_path).unwrap();
        decrypt_file(&encrypted, &decrypted, "secret", &read_meta).unwrap();

        let contents = std::fs::read_to_string(&decrypted).unwrap();
        assert_eq!(contents, "hello encrypted database");

        assert!(decrypt_file(&encrypted, &decrypted, "wrong", &read_meta).is_err());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn test_reencrypt_uses_fresh_metadata() {
        // Simulates the shutdown re-encryption path: encrypt, modify plaintext,
        // re-encrypt, update metadata, then decrypt with the latest metadata.
        let dir = tmp_dir();
        let plaintext = dir.join("plain.db");
        let encrypted = dir.join("plain.db.encrypted");
        let meta_path = dir.join("plain.db.encryption-meta");
        let decrypted = dir.join("decrypted.db");

        std::fs::write(&plaintext, b"first snapshot").unwrap();

        let meta1 = encrypt_file(&plaintext, &encrypted, "secret").unwrap();
        write_metadata(&meta_path, &meta1).unwrap();

        // Simulate runtime changes followed by shutdown re-encryption.
        std::fs::write(&plaintext, b"second snapshot").unwrap();
        let meta2 = encrypt_file(&plaintext, &encrypted, "secret").unwrap();
        assert_ne!(meta1.nonce, meta2.nonce, "re-encryption must use a fresh nonce");
        write_metadata(&meta_path, &meta2).unwrap();

        // Decrypt with the updated metadata must succeed.
        decrypt_file(&encrypted, &decrypted, "secret", &meta2).unwrap();
        let contents = std::fs::read_to_string(&decrypted).unwrap();
        assert_eq!(contents, "second snapshot");

        // Decrypt with stale metadata must fail.
        assert!(decrypt_file(&encrypted, &decrypted, "secret", &meta1).is_err());

        std::fs::remove_dir_all(&dir).ok();
    }
}
