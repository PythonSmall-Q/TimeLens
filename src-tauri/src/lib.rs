pub mod api_server;
pub mod commands;
pub mod db;
pub mod db_encryption;
pub mod llm;
pub mod models;
pub mod monitor;
pub mod widget_gateway;
pub mod widget_kernel;
pub mod widget_registry;

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::Timelike;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Listener, Manager,
};
use tauri_plugin_autostart::ManagerExt;

use commands::storage_cmd::DbState;
use monitor::{MonitorStatus, SharedMonitorStatus};

type SharedTrayLanguage = Arc<Mutex<String>>;

#[derive(Clone)]
struct TrayTexts {
    show: &'static str,
    new_clock: &'static str,
    new_todo: &'static str,
    new_timer: &'static str,
    pause_or_resume: &'static str,
    quit: &'static str,
}

fn tray_texts(lang: &str, is_active: bool) -> TrayTexts {
    let zh = lang.starts_with("zh");
    if zh {
        TrayTexts {
            show: "打开 TimeLens",
            new_clock: "新建时钟小组件",
            new_todo: "新建待办小组件",
            new_timer: "新建计时器小组件",
            pause_or_resume: if is_active {
                "暂停记录"
            } else {
                "恢复记录"
            },
            quit: "退出",
        }
    } else {
        TrayTexts {
            show: "Open TimeLens",
            new_clock: "New Clock Widget",
            new_todo: "New Todo Widget",
            new_timer: "New Timer Widget",
            pause_or_resume: if is_active {
                "Pause Tracking"
            } else {
                "Resume Tracking"
            },
            quit: "Quit",
        }
    }
}

fn set_tray_menu_texts<R: tauri::Runtime>(
    show: &MenuItem<R>,
    clock: &MenuItem<R>,
    todo: &MenuItem<R>,
    timer: &MenuItem<R>,
    pause: &MenuItem<R>,
    quit: &MenuItem<R>,
    lang: &str,
    is_active: bool,
) {
    let texts = tray_texts(lang, is_active);
    let _ = show.set_text(texts.show);
    let _ = clock.set_text(texts.new_clock);
    let _ = todo.set_text(texts.new_todo);
    let _ = timer.set_text(texts.new_timer);
    let _ = pause.set_text(texts.pause_or_resume);
    let _ = quit.set_text(texts.quit);
}

fn format_seconds(secs: i64) -> String {
    let h = secs / 3600;
    let m = (secs % 3600) / 60;
    if h > 0 {
        format!("{}h {}m", h, m)
    } else {
        format!("{}m", m)
    }
}

const LEGACY_APP_DIR_NAME: &str = "ShanWenxiao.TimeLens-TimeManagementAppwithWidgets";
pub(crate) const PENDING_LEGACY_IMPORT_KEY: &str = "pending_legacy_import";

fn copy_if_exists(src: &Path, dst: &Path) -> std::io::Result<()> {
    if src.exists() {
        std::fs::copy(src, dst)?;
    }
    Ok(())
}

/// Open the SQLite database with a short retry loop. This helps on Windows
/// where `app.restart()` may start the new process before the old one has fully
/// released its file locks.
fn open_db_with_retry(path: &Path, retries: usize, delay: Duration) -> Result<rusqlite::Connection, String> {
    let mut last_err = None;
    for attempt in 0..=retries {
        match db::open(path) {
            Ok(conn) => return Ok(conn),
            Err(e) => {
                let is_lock_error = matches!(
                    e,
                    rusqlite::Error::SqliteFailure(code, _)
                        if code.extended_code == rusqlite::ffi::SQLITE_BUSY
                            || code.extended_code == rusqlite::ffi::SQLITE_BUSY_RECOVERY
                            || code.extended_code == rusqlite::ffi::SQLITE_LOCKED
                            || code.extended_code == rusqlite::ffi::SQLITE_LOCKED_SHAREDCACHE
                            || code.extended_code == rusqlite::ffi::SQLITE_CANTOPEN
                );
                last_err = Some(e);
                if attempt < retries && is_lock_error {
                    std::thread::sleep(delay * (attempt as u32 + 1));
                } else {
                    break;
                }
            }
        }
    }
    Err(format!(
        "Failed to open database after {} attempts: {}",
        retries + 1,
        last_err.unwrap_or_else(|| rusqlite::Error::InvalidPath("unknown".into()))
    ))
}

fn copy_db_with_sidecars(src: &Path, dst: &Path) -> std::io::Result<()> {
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let src_wal = PathBuf::from(format!("{}-wal", src.display()));
    let src_shm = PathBuf::from(format!("{}-shm", src.display()));
    let dst_wal = PathBuf::from(format!("{}-wal", dst.display()));
    let dst_shm = PathBuf::from(format!("{}-shm", dst.display()));

    std::fs::copy(src, dst)?;
    copy_if_exists(&src_wal, &dst_wal)?;
    copy_if_exists(&src_shm, &dst_shm)?;

    Ok(())
}

/// Best-effort detection of a legacy 1.x database path on all supported
/// platforms. Tauri v1 placed app data differently than v2; this function
/// probes the most likely locations without requiring Tauri APIs.
pub(crate) fn legacy_db_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var_os("APPDATA")?;
        let legacy_db = PathBuf::from(appdata)
            .join(LEGACY_APP_DIR_NAME)
            .join("timelens.db");
        if legacy_db.exists() {
            return Some(legacy_db);
        }
    }

    #[cfg(target_os = "macos")]
    {
        let home = std::env::var_os("HOME")?;
        let legacy_db = PathBuf::from(home)
            .join("Library/Application Support")
            .join(LEGACY_APP_DIR_NAME)
            .join("timelens.db");
        if legacy_db.exists() {
            return Some(legacy_db);
        }
    }

    #[cfg(target_os = "linux")]
    {
        let home = std::env::var_os("HOME")?;
        let config_db = PathBuf::from(home)
            .join(".config")
            .join(LEGACY_APP_DIR_NAME)
            .join("timelens.db");
        if config_db.exists() {
            return Some(config_db);
        }
    }

    None
}

fn migrate_legacy_db(legacy_db: &Path, target_db: &Path) -> std::io::Result<()> {
    copy_db_with_sidecars(legacy_db, target_db)
}

fn resolve_database_path(data_dir: &Path, profile_id: Option<&str>) -> PathBuf {
    let profile_id = profile_id.unwrap_or(db::migrations::DEFAULT_PROFILE_ID);
    db::migrations::db_path_for_profile(data_dir, profile_id)
}

/// If the legacy root database does not exist yet but an encrypted default
/// profile was created by v2.0.0, move its encryption artifacts to the root
/// path so the normal decryption step handles them on the next startup.
fn maybe_relocate_encrypted_default_profile(data_dir: &Path) -> std::io::Result<()> {
    let old_default = db::migrations::old_default_profile_db_path(data_dir);
    let legacy = db::migrations::db_path_for_profile(data_dir, db::migrations::DEFAULT_PROFILE_ID);

    if !old_default.exists() || legacy.exists() {
        return Ok(());
    }
    if !db_encryption::is_database_encrypted(&old_default) {
        return Ok(());
    }

    let old_meta = db_encryption::encryption_meta_path(&old_default);
    let old_encrypted = db_encryption::encrypted_db_path(&old_default);
    let new_meta = db_encryption::encryption_meta_path(&legacy);
    let new_encrypted = db_encryption::encrypted_db_path(&legacy);

    if old_meta.exists() {
        std::fs::rename(&old_meta, &new_meta)?;
    }
    if old_encrypted.exists() {
        std::fs::rename(&old_encrypted, &new_encrypted)?;
    }
    std::fs::rename(&old_default, &legacy)?;

    let old_dir = data_dir.join("profiles").join("default");
    if old_dir.exists() && old_dir.read_dir().map(|mut d| d.next().is_none()).unwrap_or(false) {
        let _ = std::fs::remove_dir(&old_dir);
    }

    log::info!(
        "Relocated encrypted default profile database to legacy path: {}",
        legacy.display()
    );
    Ok(())
}

/// Apply a pending user-approved legacy import before any profile database is
/// opened. This is invoked once per restart after the frontend confirms the
/// import; it copies the legacy 1.x database into the default profile and
/// leaves the flag cleared so the prompt does not repeat.
fn maybe_apply_pending_legacy_import(
    app_state_conn: &rusqlite::Connection,
    data_dir: &Path,
) -> Result<(), String> {
    let pending = db::get_setting(app_state_conn, PENDING_LEGACY_IMPORT_KEY)
        .ok()
        .flatten()
        .unwrap_or_default()
        == "1";
    if !pending {
        return Ok(());
    }

    // Clear the flag immediately so a failed import does not loop on restart.
    let _ = db::set_setting(app_state_conn, PENDING_LEGACY_IMPORT_KEY, "0");

    let current_profile_id = db::migrations::current_profile_id_from_app_state(app_state_conn);
    if current_profile_id != db::migrations::DEFAULT_PROFILE_ID {
        log::info!("Pending legacy import ignored: current profile is not default");
        return Ok(());
    }

    let Some(legacy_path) = legacy_db_path() else {
        log::info!("Pending legacy import ignored: no legacy database found");
        return Ok(());
    };

    let target_db = db::migrations::db_path_for_profile(data_dir, db::migrations::DEFAULT_PROFILE_ID);
    let target_size = std::fs::metadata(&target_db).map(|m| m.len()).unwrap_or(0);
    if target_size > 4096 {
        log::info!("Pending legacy import ignored: default profile already contains data");
        return Ok(());
    }

    // Remove any existing empty/small default profile database so the copy is clean.
    let _ = std::fs::remove_file(&target_db);
    let _ = std::fs::remove_file(format!("{}-wal", target_db.display()));
    let _ = std::fs::remove_file(format!("{}-shm", target_db.display()));

    migrate_legacy_db(&legacy_path, &target_db).map_err(|e| {
        format!("Failed to import legacy data into default profile: {}", e)
    })?;

    log::info!(
        "TimeLens legacy database imported into default profile: {} -> {}",
        legacy_path.display(),
        target_db.display()
    );
    Ok(())
}

fn init_file_logger(log_dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(log_dir).map_err(|e| {
        format!(
            "failed to create log directory {}: {}",
            log_dir.display(),
            e
        )
    })?;

    let log_file = log_dir.join("timelens.log");
    let file = fern::log_file(&log_file)
        .map_err(|e| format!("failed to open log file {}: {}", log_file.display(), e))?;

    let mut dispatch = fern::Dispatch::new()
        .format(|out, message, record| {
            out.finish(format_args!(
                "{} [{}] {} - {}",
                chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f"),
                record.level(),
                record.target(),
                message
            ));
        })
        .chain(file);

    // Only write logs to stdout in debug builds. Release builds are GUI
    // subsystem apps and writing to stdout can cause a terminal window to
    // appear when launched via autostart or from an existing console.
    if cfg!(debug_assertions) {
        dispatch = dispatch.chain(std::io::stdout());
    }

    dispatch = if cfg!(debug_assertions) {
        dispatch.level(log::LevelFilter::Debug)
    } else {
        dispatch.level(log::LevelFilter::Info)
    };

    dispatch
        .apply()
        .map_err(|e| format!("failed to initialize logger: {}", e))
}

pub(crate) fn load_tray_icon(style: &str) -> Result<tauri::image::Image<'static>, String> {
    let bytes: &'static [u8] = match style {
        "black" => include_bytes!("../icons/tray-black.png"),
        "white" => include_bytes!("../icons/tray-white.png"),
        _ => include_bytes!("../icons/32x32.png"),
    };
    tauri::image::Image::from_bytes(bytes).map_err(|e| e.to_string())
}

fn system_theme_prefers_white_tray_icon(app: &AppHandle) -> bool {
    // Dark system theme generally means dark tray/taskbar background,
    // so a white monochrome icon has better contrast.
    if let Some(main) = app.get_webview_window("main") {
        if let Ok(theme) = main.theme() {
            return matches!(theme, tauri::Theme::Dark);
        }
    }
    true
}

pub(crate) fn resolve_tray_icon_style(app: &AppHandle, style: &str) -> &'static str {
    match style {
        "auto" => {
            if system_theme_prefers_white_tray_icon(app) {
                "white"
            } else {
                "black"
            }
        }
        "black" => "black",
        "white" => "white",
        _ => "color",
    }
}

pub(crate) fn apply_tray_icon_style(app: &AppHandle, style: &str) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id("main") {
        let effective = resolve_tray_icon_style(app, style);
        let icon = load_tray_icon(effective)?;
        tray.set_icon(Some(icon)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn prepare_encrypted_database(db_path: &Path, data_dir: &Path) -> Result<(), String> {
    let meta_path = db_encryption::encryption_meta_path(db_path);
    let encrypted_path = db_encryption::encrypted_db_path(db_path);
    let pending = db_encryption::read_pending_action(data_dir);

    if meta_path.exists() {
        let action = pending
            .ok_or_else(|| "Database is encrypted but no passphrase is available.".to_string())?;
        if action.passphrase.is_empty() {
            return Err("Database encryption passphrase is empty".to_string());
        }
        let meta = db_encryption::read_metadata(&meta_path)?;

        if action.action == "disable" {
            // When disabling, the runtime plaintext already contains the latest
            // data written during the session. The encrypted backup on disk may
            // be stale if the previous shutdown did not re-encrypt. Decrypting
            // the backup would overwrite the current plaintext and lose data.
            // Only decrypt as a last resort if the plaintext is missing.
            if !db_path.exists() {
                db_encryption::decrypt_file(&encrypted_path, db_path, &action.passphrase, &meta)?;
            }

            // Make sure the plaintext we are about to use is a valid SQLite DB.
            {
                let conn = db::open(db_path)
                    .map_err(|e| format!("Encryption disable failed: plaintext database is unusable: {}", e))?;
                drop(conn);
            }

            std::fs::remove_file(&encrypted_path).map_err(|e| e.to_string())?;
            std::fs::remove_file(&meta_path).map_err(|e| e.to_string())?;
            db_encryption::delete_pending_action(data_dir).ok();
            log::info!("Database encryption disabled; using plaintext database");
            return Ok(());
        }

        // Decrypt the encrypted backup to the runtime plaintext path. If the
        // plaintext file still exists because a previous shutdown could not wipe
        // it, we try to overwrite it. If overwriting fails and the existing
        // plaintext looks usable, fall back to it so the app can still start.
        match db_encryption::decrypt_file(&encrypted_path, db_path, &action.passphrase, &meta) {
            Ok(()) => {}
            Err(e) => {
                if db_path.exists() {
                    log::warn!(
                        "Failed to decrypt encrypted database ({}); attempting to use existing runtime plaintext as recovery",
                        e
                    );
                    // Verify the existing plaintext is a valid SQLite database.
                    match db::open(db_path) {
                        Ok(conn) => {
                            drop(conn);
                            log::info!("Using existing runtime plaintext database as recovery");
                        }
                        Err(open_err) => {
                            return Err(format!(
                                "Failed to decrypt database and existing plaintext is unusable: {} (open error: {})",
                                e, open_err
                            ));
                        }
                    }
                } else {
                    return Err(e);
                }
            }
        }

        return Ok(());
    }

    if let Some(action) = pending {
        if action.action == "enable" {
            if action.passphrase.is_empty() {
                return Err("Database encryption passphrase is empty".to_string());
            }
            if !db_path.exists() {
                return Err("Cannot enable encryption: database file does not exist".to_string());
            }
            let meta = db_encryption::encrypt_file(db_path, &encrypted_path, &action.passphrase)?;
            db_encryption::write_metadata(&meta_path, &meta)?;
            db_encryption::decrypt_file(&encrypted_path, db_path, &action.passphrase, &meta)?;
            return Ok(());
        }
        // Pending disable without encryption artifacts: nothing to do.
        db_encryption::delete_pending_action(data_dir).ok();
    }

    Ok(())
}

fn cleanup_database_encryption(target_db_path: &Path, data_dir: &Path) {
    let meta_path = db_encryption::encryption_meta_path(target_db_path);
    if !meta_path.exists() {
        let _ = db_encryption::delete_pending_action(data_dir);
        return;
    }

    let pending = match db_encryption::read_pending_action(data_dir) {
        Some(p) => p,
        None => {
            log::warn!(
                "Database at {} is encrypted but pending passphrase file is missing; leaving runtime plaintext in place",
                target_db_path.display()
            );
            return;
        }
    };

    let encrypted_path = db_encryption::encrypted_db_path(target_db_path);
    match db_encryption::encrypt_file(target_db_path, &encrypted_path, &pending.passphrase) {
        Ok(meta) => {
            // The encryption process generates a fresh nonce/salt every time, so
            // we must persist the new metadata before wiping the plaintext.
            // Otherwise the next startup will try to decrypt with stale metadata
            // and fail with "Failed to decrypt database".
            if let Err(e) = db_encryption::write_metadata(&meta_path, &meta) {
                log::warn!(
                    "Re-encrypted database on exit but failed to write metadata: {}. Leaving runtime plaintext in place.",
                    e
                );
                return;
            }
            log::info!(
                "Re-encrypted database on exit: {}",
                encrypted_path.display()
            );
            if let Err(e) = db_encryption::wipe_plaintext_db(target_db_path) {
                log::warn!("Failed to wipe runtime plaintext DB on exit: {}", e);
            }
            // Keep the pending passphrase file so the next startup can decrypt.
        }
        Err(e) => {
            log::warn!("Failed to re-encrypt database on exit: {}", e);
        }
    }
}

pub fn run() {
    // When Windows launches us via autostart from a console process (for
    // example, if the executable is a debug/console-subsystem build), detach
    // from the inherited console so no terminal window is shown to the user.
    #[cfg(target_os = "windows")]
    {
        let is_autostart = std::env::args().any(|a| a == "--autostart");
        if is_autostart {
            unsafe {
                let _ = windows::Win32::System::Console::FreeConsole();
            }
        }
    }

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Initialize file logger as early as possible in setup.
            if let Ok(log_dir) = app.path().app_log_dir() {
                if let Err(e) = init_file_logger(&log_dir) {
                    eprintln!("TimeLens logger initialization failed: {}", e);
                } else {
                    log::info!("Logger initialized at {}", log_dir.join("timelens.log").display());
                }
            }

            // ── Database ──────────────────────────────────────
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;

            // Open the unencrypted app state database first (before any profile DB)
            // so profile metadata is available even when profile DBs are encrypted.
            let app_state_conn = db::migrations::open_app_state_db(&data_dir)
                .map_err(|e| format!("Failed to open app state database: {}", e))?;

            // Apply any user-approved legacy 1.x import before we resolve the default
            // profile path so the imported database is used on this startup.
            if let Err(e) = maybe_apply_pending_legacy_import(&app_state_conn, &data_dir) {
                log::warn!("Failed to apply pending legacy import: {}", e);
            }

            let default_db_path = resolve_database_path(&data_dir, None);

            // One-time migration of profile metadata from the legacy default
            // profile DB into the separate app state DB.
            let _ = db::migrations::migrate_profile_state_from_default_db(
                &app_state_conn,
                &default_db_path,
            );

            let active_profile_id = db::migrations::current_profile_id_from_app_state(&app_state_conn);
            drop(app_state_conn);

            // If a v2.0.0 default-profile database was encrypted and the legacy root
            // path is empty, relocate its encryption artifacts before decryption.
            if let Err(e) = maybe_relocate_encrypted_default_profile(&data_dir) {
                log::warn!("Failed to relocate encrypted default profile: {}", e);
            }

            let target_db_path: PathBuf = if active_profile_id == db::migrations::DEFAULT_PROFILE_ID {
                default_db_path.clone()
            } else {
                db::migrations::db_path_for_profile(&data_dir, &active_profile_id)
            };

            // Prepare target database (handle at-rest encryption if enabled).
            prepare_encrypted_database(&target_db_path, &data_dir)
                .map_err(|e| format!("Failed to prepare target database: {}", e))?;

            // For the default profile, automatically merge any v2.0.0 data that
            // lives in the separate `profiles/default` folder into the legacy root
            // database. Conflicting rows are skipped.
            if active_profile_id == db::migrations::DEFAULT_PROFILE_ID {
                if let Err(e) = db::migrations::merge_default_profile_into_legacy_db(&data_dir) {
                    log::warn!("Failed to merge default profile database into legacy path: {}", e);
                }
            }

            let conn = open_db_with_retry(&target_db_path, 10, Duration::from_millis(100))
                .map_err(|e| format!("Failed to open active profile SQLite database: {}", e))?;

            // Clear pending encryption settings now that the database is open.
            {
                let _ = conn.execute(
                    "DELETE FROM app_settings WHERE key IN ('pending_db_encryption_enable', 'pending_db_encryption_disable', 'pending_db_encryption_passphrase')",
                    [],
                );
            }

            let db_state: DbState = Arc::new(Mutex::new(conn));

            // Remember the target DB path for exit cleanup.
            app.manage(target_db_path.clone());
            // Register shared DB state before opening any extra windows.
            // Widget/main windows can start invoking commands immediately.
            app.manage(db_state.clone());

            // Sync OS-level autostart with the stored user preference. Re-installing the
            // app often clears the registry/launch-agent entry, so re-apply it here.
            {
                let conn = db_state.lock().unwrap();
                match crate::db::get_bool_setting(&conn, "launch_at_startup", false) {
                    Ok(true) => {
                        if let Err(e) = app.autolaunch().enable() {
                            log::warn!("Failed to enable launch at startup: {}", e);
                        }
                    }
                    Ok(false) => {
                        if let Err(e) = app.autolaunch().disable() {
                            log::warn!("Failed to disable launch at startup: {}", e);
                        }
                    }
                    Err(e) => log::warn!("Failed to read launch_at_startup setting: {}", e),
                }
            }

            // Widget runtime v2.2.0 rate limiters
            let widget_call_rate_limiter = commands::WidgetCallRateLimiter::new();
            let widget_event_rate_limiter = commands::WidgetEventRateLimiter::new();
            app.manage(widget_call_rate_limiter.clone());
            app.manage(widget_event_rate_limiter.clone());

            // Widget Runtime Rewrite kernel + gateway
            let widget_kernel =
                widget_kernel::WidgetKernel::new(db_state.clone(), widget_call_rate_limiter.clone());
            app.manage(widget_kernel);

            // Initialize extension bridge key on first run
            {
                let conn = db_state.lock().unwrap();
                if let Ok(None) = db::get_setting(&conn, "extension_bridge_key") {
                    let new_key = uuid::Uuid::new_v4().to_string();
                    let now = chrono::Local::now().to_rfc3339();
                    let _ = db::set_setting(&conn, "extension_bridge_key", &new_key);
                    let _ = db::set_setting(&conn, "extension_bridge_key_rotated_at", &now);
                    log::info!("Generated initial extension bridge key for local API authentication");
                }
            }

            // Restore widget windows that were open last session (if setting enabled)
            {
                let conn = db_state.lock().unwrap();
                let auto_open = crate::db::get_bool_setting(&conn, "auto_open_widgets", true)
                    .unwrap_or(true);
                if auto_open {
                    if let Ok(configs) = db::get_all_widget_configs(&conn) {
                        let app_handle = app.handle().clone();
                        drop(conn); // release lock before async work
                        for cfg in configs {
                            if !cfg.start_on_launch {
                                continue;
                            }
                            let _ = commands::widget_cmd::build_widget_window_sync(&app_handle, &cfg);
                        }
                    }
                }
            }

            // Hide main window when launched by autostart with silent-startup enabled.
            let is_autostart = std::env::args().any(|a| a == "--autostart");
            if is_autostart {
                let db_state = app.state::<DbState>();
                let conn = db_state.lock().unwrap();
                let silent_startup = crate::db::get_bool_setting(&conn, "silent_startup", true)
                    .unwrap_or(true);
                drop(conn);
                if silent_startup {
                    if let Some(main) = app.get_webview_window("main") {
                        let _ = main.hide();
                    }
                }
            }

            // ── Monitor ───────────────────────────────────────
            let monitoring_active = {
                let conn = db_state.lock().unwrap();
                db::get_bool_setting(&conn, "tracking_monitoring_active", true).unwrap_or(true)
            };
            let monitor_status: SharedMonitorStatus = Arc::new(Mutex::new(MonitorStatus {
                active: monitoring_active,
                current_app: String::new(),
                current_exe_path: String::new(),
                current_title: String::new(),
            }));
            app.manage(monitor_status.clone());

            let tray_language: SharedTrayLanguage = Arc::new(Mutex::new("en".to_string()));
            app.manage(tray_language.clone());

            let db_for_monitor: DbState = {
                let conn = open_db_with_retry(&target_db_path, 10, Duration::from_millis(100))
                    .expect("Second db connection for monitor");
                Arc::new(Mutex::new(conn))
            };

            monitor::start_monitor_task(
                app.handle().clone(),
                db_for_monitor,
                monitor_status.clone(),
                1000,  // poll every 1 s
                500,   // ignore segments shorter than 500 ms
            );

            // ── Local HTTP API ────────────────────────────────
            {
                let api_db: DbState = {
                    let conn = open_db_with_retry(&target_db_path, 10, Duration::from_millis(100))
                        .expect("Third db connection for API server");
                    Arc::new(Mutex::new(conn))
                };
                let api_token = uuid::Uuid::new_v4().to_string();
                api_server::start_api_server(
                    api_db,
                    monitor_status.clone(),
                    api_token,
                );
            }

            // ── Browser domain limit monitor ──────────────────
            {
                let notif_db: DbState = {
                    let conn = open_db_with_retry(&target_db_path, 10, Duration::from_millis(100))
                        .expect("Fourth db connection for domain limit notifier");
                    Arc::new(Mutex::new(conn))
                };
                let app_handle_notif = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    // in-memory set to avoid repeated notifications per day
                    let mut notified: std::collections::HashMap<String, Vec<u8>> =
                        std::collections::HashMap::new();
                    let mut last_date = String::new();

                    loop {
                        tokio::time::sleep(std::time::Duration::from_secs(60)).await;

                        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
                        if today != last_date {
                            notified.clear();
                            last_date = today.clone();
                        }

                        let Ok(conn) = notif_db.lock() else { continue };
                        let Ok(limits) = db::get_browser_domain_limits(&conn) else { continue };
                        let enabled_limits: Vec<_> = limits.into_iter().filter(|l| l.enabled).collect();
                        if enabled_limits.is_empty() { continue }

                        for lim in &enabled_limits {
                            let used = db::get_browser_domain_today_seconds(&conn, &lim.host, &today)
                                .unwrap_or(0);
                            if lim.daily_limit_seconds <= 0 { continue }
                            let ratio = used as f64 / lim.daily_limit_seconds as f64;
                            let threshold: u8 = if ratio >= 1.0 { 100 } else if ratio >= 0.9 { 90 } else { 0 };
                            if threshold == 0 { continue }
                            let already = notified.entry(lim.host.clone()).or_default();
                            if already.contains(&threshold) { continue }
                            already.push(threshold);

                            let (title, body) = if threshold == 100 {
                                (
                                    format!("TimeLens – {} limit reached", lim.host),
                                    format!(
                                        "You've reached the daily limit for {} ({})",
                                        lim.host,
                                        format_seconds(lim.daily_limit_seconds),
                                    ),
                                )
                            } else {
                                (
                                    format!("TimeLens – {} at {}%", lim.host, threshold),
                                    format!(
                                        "You've used {}% of your daily limit for {} ({} / {})",
                                        threshold,
                                        lim.host,
                                        format_seconds(used),
                                        format_seconds(lim.daily_limit_seconds),
                                    ),
                                )
                            };

                            let _ = app_handle_notif.emit("browser-domain-limit-reached", serde_json::json!({
                                "host": lim.host,
                                "threshold": threshold,
                                "used_seconds": used,
                                "limit_seconds": lim.daily_limit_seconds,
                            }));

                            #[cfg(target_os = "windows")]
                            {
                                use tauri_plugin_notification::NotificationExt;
                                let _ = app_handle_notif.notification()
                                    .builder()
                                    .title(&title)
                                    .body(&body)
                                    .show();
                            }
                            #[cfg(not(target_os = "windows"))]
                            {
                                let _ = app_handle_notif.emit("native-notification", serde_json::json!({
                                    "title": title,
                                    "body": body,
                                }));
                            }
                        }
                    }
                });
            }

            // ── Archive scheduler background task ─────────────
            {
                let archive_db: DbState = {
                    let conn = open_db_with_retry(&target_db_path, 10, Duration::from_millis(100))
                        .expect("Fifth db connection for archive scheduler");
                    Arc::new(Mutex::new(conn))
                };
                tauri::async_runtime::spawn(async move {
                    loop {
                        tokio::time::sleep(std::time::Duration::from_secs(60)).await;

                        let Ok(conn) = archive_db.lock() else { continue };
                        let settings: commands::ArchiveSchedulerSettings = {
                            let result: Result<commands::ArchiveSchedulerSettings, rusqlite::Error> =
                                conn.prepare(
                                    "SELECT enabled, daily_run_hour, run_on_battery
                                     FROM archive_scheduler_state WHERE id = 1",
                                )
                                .and_then(|mut stmt| {
                                    stmt.query_row([], |row| {
                                        Ok(commands::ArchiveSchedulerSettings {
                                            enabled: row.get::<_, i32>(0)? != 0,
                                            daily_run_hour: row.get(1)?,
                                            run_on_battery: row.get::<_, i32>(2)? != 0,
                                        })
                                    })
                                });
                            match result {
                                Ok(s) => s,
                                Err(_) => continue,
                            }
                        };

                        if !settings.enabled {
                            continue;
                        }

                        let now = chrono::Local::now();
                        let current_hour = now.hour() as i32;
                        if current_hour != settings.daily_run_hour {
                            continue;
                        }

                        let last_run_today: bool = conn
                            .query_row(
                                "SELECT COALESCE(date(last_run_at), '') = date('now')
                                 FROM archive_scheduler_state WHERE id = 1",
                                [],
                                |row| row.get::<_, bool>(0),
                            )
                            .unwrap_or(false);
                        if last_run_today {
                            continue;
                        }

                        let policy = db::get_setting(&conn, "retention_policy")
                            .ok()
                            .flatten()
                            .unwrap_or_else(|| "keep_all".to_string());

                        let run_result: Result<(), String> = (|| {
                            let result = commands::archive_by_policy(&conn, &policy)?;
                            log::info!(
                                "Archive scheduler ran policy {}: {} app usage rows, {} daily rows, {} warm, {} archive",
                                result.policy,
                                result.archived_app_usage_rows,
                                result.archived_daily_rows,
                                result.warm_rows,
                                result.archive_rows
                            );
                            let now_str = now.format("%Y-%m-%dT%H:%M:%S").to_string();
                            conn.execute(
                                "INSERT INTO archive_scheduler_state (id, last_run_at) VALUES (1, ?1)
                                 ON CONFLICT(id) DO UPDATE SET last_run_at = excluded.last_run_at",
                                rusqlite::params![&now_str],
                            )
                            .map_err(|e| e.to_string())?;
                            Ok(())
                        })();

                        if let Err(e) = run_result {
                            log::warn!("Archive scheduler run failed: {}", e);
                        }
                    }
                });
            }

            // ── Derived metrics scheduler ─────────────────────
            {
                let derived_db: DbState = {
                    let conn = open_db_with_retry(&target_db_path, 10, Duration::from_millis(100))
                        .expect("Sixth db connection for derived metrics scheduler");
                    Arc::new(Mutex::new(conn))
                };
                tauri::async_runtime::spawn(async move {
                    loop {
                        tokio::time::sleep(std::time::Duration::from_secs(300)).await;
                        let Ok(conn) = derived_db.lock() else { continue };
                        if let Err(e) = crate::db::rebuild_derived_metrics(&conn) {
                            log::warn!("Derived metrics scheduler failed: {}", e);
                        }
                    }
                });
            }

            // ── Goal risk notifier ────────────────────────────
            {
                let risk_db: DbState = {
                    let conn = open_db_with_retry(&target_db_path, 10, Duration::from_millis(100))
                        .expect("Seventh db connection for goal risk notifier");
                    Arc::new(Mutex::new(conn))
                };
                let app_handle_risk = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    loop {
                        tokio::time::sleep(std::time::Duration::from_secs(900)).await;
                        let Ok(conn) = risk_db.lock() else { continue };
                        let alerts = match crate::commands::productivity_cmd::evaluate_goal_risks_inner(&conn) {
                            Ok(a) => a,
                            Err(e) => {
                                log::warn!("Goal risk evaluation failed: {}", e);
                                continue;
                            }
                        };
                        drop(conn);
                        for alert in alerts {
                            let _ = app_handle_risk.emit("goal-risk-alert", &alert);
                            let title = format!("TimeLens – Goal risk ({})", alert.severity);
                            let body = format!("{}: {}", alert.scope_value, alert.message);
                            #[cfg(target_os = "windows")]
                            {
                                let _ = crate::commands::app_cmd::send_native_notification(
                                    title, body, Some(false),
                                );
                            }
                            #[cfg(not(target_os = "windows"))]
                            {
                                let _ = app_handle_risk.emit("native-notification", serde_json::json!({
                                    "title": title,
                                    "body": body,
                                }));
                            }
                        }
                    }
                });
            }

            // ── Focus rule evaluator ──────────────────────────
            {
                let focus_db: DbState = {
                    let conn = open_db_with_retry(&target_db_path, 10, Duration::from_millis(100))
                        .expect("Eighth db connection for focus rule evaluator");
                    Arc::new(Mutex::new(conn))
                };
                let focus_status = monitor_status.clone();
                let focus_app = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    loop {
                        tokio::time::sleep(std::time::Duration::from_secs(60)).await;
                        let status = {
                            let guard = focus_status.lock().unwrap();
                            guard.clone()
                        };
                        if !status.active {
                            continue;
                        }
                        let Ok(conn) = focus_db.lock() else { continue };
                        match crate::commands::storage_cmd::evaluate_focus_rules_inner(&conn, &status) {
                            Ok(matches) => {
                                for m in matches.into_iter().filter(|m| m.matched) {
                                    crate::commands::widget_runtime_cmd::broadcast_widget_event(
                                        &focus_app,
                                        "rule-triggered",
                                        serde_json::json!({
                                            "rule_id": m.rule_id,
                                            "rule_name": m.rule_name,
                                            "action": m.action,
                                            "reason": m.reason,
                                        }),
                                    );
                                }
                            }
                            Err(e) => {
                                log::warn!("Focus rule evaluation failed: {}", e);
                            }
                        }
                    }
                });
            }

            // ── Widget goal-tick emitter ──────────────────────
            {
                let goal_tick_app = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    loop {
                        tokio::time::sleep(std::time::Duration::from_secs(900)).await;
                        crate::commands::widget_runtime_cmd::broadcast_widget_event(
                            &goal_tick_app,
                            "goal-tick",
                            serde_json::json!({ "reason": "periodic goal progress refresh" }),
                        );
                    }
                });
            }

            // ── LLM config watcher ────────────────────────────
            {
                let llm_path = crate::llm::config_path(app.handle())?;
                if !llm_path.exists() {
                    if let Err(e) = crate::llm::save_config(&llm_path, &crate::llm::LlmConfig::default()) {
                        log::warn!("Failed to create default LLM config: {}", e);
                    }
                }
                crate::llm::spawn_config_watcher(app.handle().clone());
            }

            // ── System tray ───────────────────────────────────
            let tray_icon_style = {
                let db_state = app.state::<DbState>();
                let conn = db_state.lock().unwrap();
                crate::db::get_setting(&conn, "tray_icon_style")
                    .unwrap_or(None)
                    .unwrap_or_else(|| "auto".to_string())
            };
            setup_tray(app, monitor_status, tray_language, &tray_icon_style)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // Hide main window to tray instead of closing
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    window.hide().unwrap_or_default();
                    api.prevent_close();
                }
            }

            // Follow system theme for tray icon when tray style is set to auto.
            if let tauri::WindowEvent::ThemeChanged(_theme) = event {
                if window.label() == "main" {
                    let app = window.app_handle();
                    let style = {
                        let db_state = app.state::<DbState>();
                        let conn = db_state.lock().unwrap();
                        crate::db::get_setting(&conn, "tray_icon_style")
                            .ok()
                            .flatten()
                            .unwrap_or_else(|| "auto".to_string())
                    };
                    if style == "auto" {
                        let _ = apply_tray_icon_style(&app, &style);
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            // Monitor
            commands::get_monitor_status,
            commands::set_monitoring_active,
            commands::get_data_health_summary,
            commands::check_data_integrity,
            commands::scan_data_gaps,
            commands::check_orphan_rows,
            commands::run_migration_rehearsal,
            commands::get_migration_status,
            commands::list_profiles,
            commands::create_profile,
            commands::switch_profile,
            commands::get_current_profile,
            commands::detect_legacy_data,
            commands::import_legacy_data,
            commands::repair_data_issues,
            commands::export_backup_v2,
            commands::import_backup_v2_validate,
            commands::import_backup_v2_apply,
            commands::enable_database_encryption,
            commands::disable_database_encryption,
            commands::get_database_encryption_status,
            commands::get_retention_policy_info,
            commands::set_retention_policy,
            commands::run_local_archive_now,
            commands::get_archive_scheduler_settings,
            commands::set_archive_scheduler_settings,
            commands::compress_archive_older_than_days,
            commands::get_compressed_archive_for_date_app,
            commands::get_tracking_transparency,
            // Storage – screen time
            commands::get_today_app_totals,
            commands::get_app_totals_for_date,
            commands::get_app_totals_in_range,
            commands::get_app_comparison_in_ranges,
            commands::get_today_hourly,
            commands::get_recent_daily_totals,
            commands::get_category_totals_in_range,
            commands::get_daily_totals_in_range,
            commands::get_category_daily_totals_in_range,
            commands::get_app_categories,
            commands::upsert_app_category,
            commands::remove_app_category,
            commands::suggest_category_for_app,
            commands::get_usage_goals,
            commands::save_usage_goal,
            commands::remove_usage_goal,
            commands::get_goal_progress,
            commands::set_focus_mode_active,
            commands::get_focus_mode_active,
            commands::get_quiet_hours,
            commands::set_quiet_hours,
            commands::start_focus_session,
            commands::stop_focus_session,
            commands::list_focus_sessions,
            commands::get_recent_executables,
            commands::get_running_executables,
            commands::get_ignored_apps,
            commands::set_ignored_apps,
            commands::get_app_usage_page,
            commands::export_data_csv,
            commands::export_data_json,
            commands::import_data_json,
            // Storage – todos
            commands::get_todos,
            commands::add_todo,
            commands::toggle_todo,
            commands::delete_todo,
            commands::reorder_todos,
            // Storage – widgets
            commands::get_all_widgets,
            commands::save_widget_config,
            commands::remove_widget_config,
            // Widget windows
            commands::create_widget,
            commands::open_widget,
            commands::close_widget,
            commands::set_widget_always_on_top,
            commands::get_widget_registry,
            commands::import_pet_pack,
            // App settings / startup / shortcuts
            commands::get_app_settings,
            commands::get_browser_extension_status,
            commands::get_local_api_base_url,
            commands::get_install_channel_info,
            commands::relaunch_app,
            commands::set_launch_at_startup,
            commands::get_tray_icon_style,
            commands::set_tray_icon_style,
            commands::set_silent_startup,
            commands::set_auto_open_widgets,
            commands::set_browser_extension_enabled,
            commands::set_ignore_system_processes,
            commands::set_idle_time_policy,
            commands::set_track_window_titles,
            commands::set_shortcuts,
            commands::send_native_notification,
            commands::open_log_directory,
            commands::get_extension_bridge_key,
            commands::rotate_extension_bridge_key,
            commands::issue_api_token,
            commands::rotate_api_token,
            commands::revoke_api_token,
            commands::list_api_tokens,
            commands::get_api_audit_log,
            commands::get_api_client_allowlist,
            commands::set_api_client_allowlist,
            commands::get_local_api_security_settings,
            commands::set_local_api_security_settings,
            commands::append_frontend_log,
            // Browser domain
            commands::get_browser_domain_stats,
            commands::get_browser_domain_stats_for_hour,
            commands::get_browser_ignored_domains,
            commands::set_browser_ignored_domains,
            commands::get_browser_domain_limits,
            commands::save_browser_domain_limit,
            commands::remove_browser_domain_limit,
            // Phase C: extra data channel commands
            commands::get_hourly_distribution_for_date,
            commands::get_recent_daily_totals_range,
            commands::get_app_category_map,
            // Phase D+E: productivity + interruption
            commands::get_productivity_score,
            commands::get_productivity_score_range,
            commands::get_interruption_periods,
            commands::suggest_focus_windows,
            commands::suggest_goal_adjustments,
            commands::detect_usage_anomalies,
            // Phase 4: local intelligence + workflow
            commands::rebuild_derived_metrics,
            commands::get_distraction_hotspots,
            commands::get_category_comparison_in_ranges,
            commands::get_project_comparison_in_ranges,
            commands::evaluate_goal_risks,
            commands::get_focus_rules,
            commands::save_focus_rule,
            commands::delete_focus_rule,
            commands::evaluate_focus_rules,
            // Phase A: widget permissions
            commands::get_widget_permissions,
            commands::get_widget_permission_matrix,
            commands::get_widget_permission_audit_log,
            commands::set_widget_permissions,
            commands::revoke_all_widget_permissions,
            commands::record_widget_permission_access,
            commands::import_local_widget,
            commands::issue_widget_api_token,
            // Widget runtime v2.2.0
            commands::widget_query,
            commands::widget_subscribe,
            // LLM integration
            commands::get_llm_config,
            commands::set_llm_config,
            commands::get_llm_config_path,
            commands::open_llm_config_file,
            commands::open_llm_config_dir,
            commands::list_llm_conversations,
            commands::get_llm_conversation,
            commands::save_llm_conversation,
            commands::delete_llm_conversation,
            commands::archive_llm_conversation,
            commands::pin_llm_conversation,
            commands::widget_unsubscribe,
            commands::get_widget_state,
            commands::set_widget_state,
            commands::delete_widget_state,
            commands::emit_widget_lifecycle,
            commands::record_widget_error,
            commands::get_widget_error_log,
            commands::clear_widget_error_log,
            commands::set_widget_paused,
            commands::reset_widget_permissions_and_state,
        ])
        .build(tauri::generate_context!())
        .expect("error while building TimeLens");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            // Best-effort WAL checkpoint on the main connection before re-encryption.
            if let Some(db_state) = app_handle.try_state::<DbState>() {
                if let Ok(conn) = db_state.lock() {
                    let _ = conn.execute("PRAGMA wal_checkpoint(TRUNCATE)", []);
                }
            }
            if let Some(target_db_path) = app_handle.try_state::<PathBuf>() {
                if let Ok(data_dir) = app_handle.path().app_data_dir() {
                    cleanup_database_encryption(&target_db_path, &data_dir);
                }
            }
        }
    });
}

// ── Tray setup ────────────────────────────────────────────────

fn setup_tray(
    app: &tauri::App,
    monitor_status: SharedMonitorStatus,
    tray_language: SharedTrayLanguage,
    tray_icon_style: &str,
) -> tauri::Result<()> {
    let initial_active = monitor_status.lock().map(|s| s.active).unwrap_or(true);
    let initial_lang = tray_language
        .lock()
        .map(|l| l.clone())
        .unwrap_or_else(|_| "en".to_string());
    let initial_texts = tray_texts(&initial_lang, initial_active);

    let show = MenuItem::with_id(app, "show", initial_texts.show, true, None::<&str>)?;
    let clock = MenuItem::with_id(
        app,
        "new_clock",
        initial_texts.new_clock,
        true,
        None::<&str>,
    )?;
    let todo = MenuItem::with_id(app, "new_todo", initial_texts.new_todo, true, None::<&str>)?;
    let timer = MenuItem::with_id(
        app,
        "new_timer",
        initial_texts.new_timer,
        true,
        None::<&str>,
    )?;
    let pause = MenuItem::with_id(
        app,
        "pause",
        initial_texts.pause_or_resume,
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", initial_texts.quit, true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&show, &clock, &todo, &timer, &pause, &quit])?;

    let effective_style = resolve_tray_icon_style(&app.handle().clone(), tray_icon_style);
    let tray_icon = load_tray_icon(effective_style)
        .ok()
        .unwrap_or_else(|| app.default_window_icon().unwrap().clone());

    TrayIconBuilder::with_id("main")
        .icon(tray_icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                button_state: tauri::tray::MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                toggle_main_window(app);
            }
        })
        .on_menu_event({
            let show_item = show.clone();
            let clock_item = clock.clone();
            let todo_item = todo.clone();
            let timer_item = timer.clone();
            let pause_item = pause.clone();
            let quit_item = quit.clone();
            let monitor_status = monitor_status.clone();
            let tray_language = tray_language.clone();
            move |app, event| match event.id.as_ref() {
                "show" => toggle_main_window(app),
                "new_clock" => spawn_widget(app, "clock"),
                "new_todo" => spawn_widget(app, "todo"),
                "new_timer" => spawn_widget(app, "timer"),
                "pause" => {
                    let mut active_now = true;
                    if let Ok(mut s) = monitor_status.lock() {
                        s.active = !s.active;
                        active_now = s.active;
                    }
                    let lang = tray_language
                        .lock()
                        .map(|l| l.clone())
                        .unwrap_or_else(|_| "en".to_string());
                    set_tray_menu_texts(
                        &show_item,
                        &clock_item,
                        &todo_item,
                        &timer_item,
                        &pause_item,
                        &quit_item,
                        &lang,
                        active_now,
                    );
                    app.emit("monitoring-changed", active_now)
                        .unwrap_or_default();
                }
                "quit" => app.exit(0),
                _ => {}
            }
        })
        .build(app)?;

    // Sync tray language from frontend i18n language changes.
    let show_item = show.clone();
    let clock_item = clock.clone();
    let todo_item = todo.clone();
    let timer_item = timer.clone();
    let pause_item = pause.clone();
    let quit_item = quit.clone();
    let monitor_status_for_lang = monitor_status.clone();
    let tray_language_for_lang = tray_language.clone();
    app.listen("language-changed", move |event| {
        let payload = event.payload();
        let Ok(lang) = serde_json::from_str::<String>(payload) else {
            return;
        };
        if let Ok(mut l) = tray_language_for_lang.lock() {
            *l = lang.clone();
        }
        let active_now = monitor_status_for_lang
            .lock()
            .map(|s| s.active)
            .unwrap_or(true);
        set_tray_menu_texts(
            &show_item,
            &clock_item,
            &todo_item,
            &timer_item,
            &pause_item,
            &quit_item,
            &lang,
            active_now,
        );
    });

    Ok(())
}

fn toggle_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
            let _ = win.show();
            let _ = win.set_focus();
        }
    }
}

fn spawn_widget(app: &AppHandle, widget_type: &str) {
    use uuid::Uuid;
    let id = format!("{}-{}", widget_type, &Uuid::new_v4().to_string()[..8]);
    let (width, height) = match widget_type {
        "clock" => (300.0_f64, 180.0_f64),
        "todo" => (320.0, 420.0),
        "timer" => (360.0, 320.0),
        "note" => (560.0, 340.0),
        "status" => (520.0, 330.0),
        "pet" => (420.0, 300.0),
        "focus-coach" => (320.0, 360.0),
        "quick-capture" => (320.0, 240.0),
        "session-pulse" => (360.0, 420.0),
        "goal-progress" => (320.0, 400.0),
        "browser-activity" => (360.0, 380.0),
        _ => (320.0, 240.0),
    };
    let cfg = models::WidgetConfig {
        id,
        widget_type: widget_type.to_string(),
        monitor_index: -1,
        x: 120.0,
        y: 120.0,
        width,
        height,
        opacity: 0.88,
        always_on_top_mode: "focus".to_string(),
        pinned: false,
        start_on_launch: true,
        data_json: commands::widget_cmd::default_widget_data_json(widget_type),
        paused: false,
        consecutive_failures: 0,
        suspended_until: None,
    };
    let _ = commands::widget_cmd::build_widget_window_sync(app, &cfg);
}
