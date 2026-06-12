pub mod api_server;
pub mod commands;
pub mod db;
pub mod models;
pub mod monitor;
pub mod widget_registry;

use std::sync::{Arc, Mutex};
use std::path::{Path, PathBuf};

use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Listener, Manager,
};

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
            pause_or_resume: if is_active { "暂停记录" } else { "恢复记录" },
            quit: "退出",
        }
    } else {
        TrayTexts {
            show: "Open TimeLens",
            new_clock: "New Clock Widget",
            new_todo: "New Todo Widget",
            new_timer: "New Timer Widget",
            pause_or_resume: if is_active { "Pause Tracking" } else { "Resume Tracking" },
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
    if h > 0 { format!("{}h {}m", h, m) } else { format!("{}m", m) }
}

const LEGACY_APP_DIR_NAME: &str = "ShanWenxiao.TimeLens-TimeManagementAppwithWidgets";
const DEFAULT_PROFILE_ID: &str = "default";

fn copy_if_exists(src: &Path, dst: &Path) -> std::io::Result<()> {
    if src.exists() {
        std::fs::copy(src, dst)?;
    }
    Ok(())
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
fn legacy_db_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var_os("APPDATA")?;
        let legacy_db = PathBuf::from(appdata).join(LEGACY_APP_DIR_NAME).join("timelens.db");
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

fn db_path_for_profile(data_dir: &Path, profile_id: &str) -> PathBuf {
    data_dir.join("profiles").join(profile_id).join("timelens.db")
}

fn migrate_legacy_db(legacy_db: &Path, target_db: &Path) -> std::io::Result<()> {
    copy_db_with_sidecars(legacy_db, target_db)
}

fn resolve_database_path(data_dir: &Path, profile_id: Option<&str>) -> PathBuf {
    let profile_id = profile_id.unwrap_or(DEFAULT_PROFILE_ID);
    let target_db = db_path_for_profile(data_dir, profile_id);

    // Only the default profile attempts to auto-migrate from legacy 1.x paths.
    if profile_id == DEFAULT_PROFILE_ID {
        if let Some(legacy_path) = legacy_db_path() {
            let current_size = std::fs::metadata(&target_db)
                .map(|m| m.len())
                .unwrap_or(0);
            let legacy_size = std::fs::metadata(&legacy_path)
                .map(|m| m.len())
                .unwrap_or(0);

            let should_migrate = !target_db.exists()
                || (current_size <= 4096 && legacy_size > current_size);

            if should_migrate {
                match migrate_legacy_db(&legacy_path, &target_db) {
                    Ok(()) => {
                        log::info!(
                            "TimeLens DB migrated from legacy path to profile path: {} -> {}",
                            legacy_path.display(),
                            target_db.display()
                        );
                    }
                    Err(err) => {
                        log::warn!(
                            "TimeLens DB migration failed ({} -> {}): {}. Falling back to legacy DB path.",
                            legacy_path.display(),
                            target_db.display(),
                            err
                        );
                        return legacy_path;
                    }
                }
            }
        }
    }

    target_db
}

fn init_file_logger(log_dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(log_dir)
        .map_err(|e| format!("failed to create log directory {}: {}", log_dir.display(), e))?;

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
        .chain(std::io::stdout())
        .chain(file);

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

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .plugin(tauri_plugin_shell::init())
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

            // Open the default profile first to discover the active profile id, then
            // open the target profile database as the main DbState.
            let default_db_path = resolve_database_path(&data_dir, None);
            let default_conn = db::open(&default_db_path)
                .expect("Failed to open default SQLite database");
            let active_profile_id = db::migrations::current_profile_id_from_conn(&default_conn);
            let target_db_path = if active_profile_id == db::migrations::DEFAULT_PROFILE_ID {
                default_db_path
            } else {
                db::migrations::db_path_for_profile(&data_dir, &active_profile_id)
            };
            let conn = db::open(&target_db_path)
                .expect("Failed to open active profile SQLite database");
            let db_state: DbState = Arc::new(Mutex::new(conn));

            // Register shared DB state before opening any extra windows.
            // Widget/main windows can start invoking commands immediately.
            app.manage(db_state.clone());

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
                let conn = db::open(&target_db_path)
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
                    let conn = db::open(&target_db_path)
                        .expect("Third db connection for API server");
                    Arc::new(Mutex::new(conn))
                };
                let api_token = uuid::Uuid::new_v4().to_string();
                api_server::start_api_server(
                    api_db,
                    monitor_status.clone(),
                    49152,
                    api_token,
                );
            }

            // ── Browser domain limit monitor ──────────────────
            {
                let notif_db: DbState = {
                    let conn = db::open(&target_db_path)
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
            commands::repair_data_issues,
            commands::export_backup_v2,
            commands::import_backup_v2_validate,
            commands::import_backup_v2_apply,
            commands::get_retention_policy_info,
            commands::set_retention_policy,
            commands::run_local_archive_now,
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
            // App settings / startup / shortcuts
            commands::get_app_settings,
            commands::get_browser_extension_status,
            commands::get_install_channel_info,
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
            // Phase A: widget permissions
            commands::get_widget_permissions,
            commands::get_widget_permission_matrix,
            commands::get_widget_permission_audit_log,
            commands::set_widget_permissions,
            commands::revoke_all_widget_permissions,
            commands::record_widget_permission_access,
            commands::import_local_widget,
        ])
        .run(tauri::generate_context!())
        .expect("error while running TimeLens");
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
    let clock = MenuItem::with_id(app, "new_clock", initial_texts.new_clock, true, None::<&str>)?;
    let todo = MenuItem::with_id(app, "new_todo", initial_texts.new_todo, true, None::<&str>)?;
    let timer = MenuItem::with_id(app, "new_timer", initial_texts.new_timer, true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", initial_texts.pause_or_resume, true, None::<&str>)?;
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
                app.emit("monitoring-changed", active_now).unwrap_or_default();
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
        let active_now = monitor_status_for_lang.lock().map(|s| s.active).unwrap_or(true);
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
        "pet" => (420.0, 300.0),
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
    };
    let _ = commands::widget_cmd::build_widget_window_sync(app, &cfg);
}
