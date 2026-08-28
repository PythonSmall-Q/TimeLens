use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

const MAX_SKIN_BYTES: u64 = 4 * 1024 * 1024;

fn image_extension(path: &Path, bytes: &[u8]) -> Option<&'static str> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    let valid = match extension.as_str() {
        "png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "jpg" | "jpeg" => bytes.starts_with(&[0xff, 0xd8, 0xff]),
        "webp" => bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP",
        "gif" => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
        _ => false,
    };
    if !valid {
        return None;
    }
    Some(match extension.as_str() {
        "png" => "png",
        "jpg" | "jpeg" => "jpg",
        "webp" => "webp",
        "gif" => "gif",
        _ => return None,
    })
}

pub fn skin_path(data_dir: &Path, relative: &str) -> Result<PathBuf, String> {
    let relative_path = Path::new(relative);
    if relative_path.is_absolute()
        || relative_path.components().any(|component| matches!(component, std::path::Component::ParentDir))
        || !relative.starts_with("skins/")
    {
        return Err("skin path is not allowed".to_string());
    }
    let root = data_dir.join("skins").canonicalize().unwrap_or_else(|_| data_dir.join("skins"));
    let candidate = data_dir.join(relative_path);
    if candidate.parent().and_then(|parent| parent.canonicalize().ok()).as_deref() != Some(root.as_path()) {
        return Err("skin path is outside the managed directory".to_string());
    }
    Ok(candidate)
}

#[tauri::command]
pub fn import_skin_image(source: String, app: AppHandle) -> Result<String, String> {
    let source_path = Path::new(&source);
    let metadata = fs::metadata(source_path).map_err(|_| "skin file cannot be read".to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_SKIN_BYTES {
        return Err("skin file is missing or exceeds the 4 MB limit".to_string());
    }
    let bytes = fs::read(source_path).map_err(|_| "skin file cannot be read".to_string())?;
    let extension = image_extension(source_path, &bytes)
        .ok_or_else(|| "only valid PNG, JPEG, WebP, or GIF images are allowed".to_string())?;
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let skin_dir = data_dir.join("skins");
    fs::create_dir_all(&skin_dir).map_err(|e| e.to_string())?;
    let filename = format!("{}.{}", Uuid::new_v4(), extension);
    fs::write(skin_dir.join(&filename), bytes).map_err(|e| e.to_string())?;
    Ok(skin_dir.join(filename).to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::{image_extension, skin_path, MAX_SKIN_BYTES};
    use std::path::Path;

    #[test]
    fn rejects_absolute_and_traversal_skin_paths() {
        let root = std::env::temp_dir().join("timelens-skin-test");
        assert!(skin_path(Path::new(&root), "C:/secret.png").is_err());
        assert!(skin_path(Path::new(&root), "skins/../secret.png").is_err());
        assert!(skin_path(Path::new(&root), "skins/nested/secret.png").is_err());
    }

    #[test]
    fn accepts_only_matching_image_magic_bytes() {
        assert_eq!(image_extension(Path::new("skin.png"), b"\x89PNG\r\n\x1a\nrest"), Some("png"));
        assert_eq!(image_extension(Path::new("skin.png"), b"not-a-png"), None);
        assert_eq!(image_extension(Path::new("skin.jpg"), &[0xff, 0xd8, 0xff, 0xe0]), Some("jpg"));
        assert_eq!(image_extension(Path::new("skin.webp"), b"RIFF1234WEBP"), Some("webp"));
        assert_eq!(image_extension(Path::new("skin.gif"), b"GIF89arest"), Some("gif"));
        assert_eq!(image_extension(Path::new("skin.svg"), b"<svg>"), None);
    }

    #[test]
    fn keeps_the_four_megabyte_upload_limit() {
        assert_eq!(MAX_SKIN_BYTES, 4 * 1024 * 1024);
    }
}
