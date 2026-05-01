pub mod api_server;
pub mod commands;
pub mod db;
pub mod models;
pub mod monitor;

use std::sync::{Arc, Mutex};

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

pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // ── Database ──────────────────────────────────────
            let data_dir = app.path().app_data_dir()?;
            let db_path = data_dir.join("timelens.db");
            let conn = db::open(&db_path)
                .expect("Failed to open SQLite database");
            let db_state: DbState = Arc::new(Mutex::new(conn));

            // Register shared DB state before opening any extra windows.
            // Widget/main windows can start invoking commands immediately.
            app.manage(db_state.clone());

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
            let monitor_status: SharedMonitorStatus = Arc::new(Mutex::new(MonitorStatus {
                active: true,
                current_app: String::new(),
                current_exe_path: String::new(),
                current_title: String::new(),
            }));
            app.manage(monitor_status.clone());

            let tray_language: SharedTrayLanguage = Arc::new(Mutex::new("en".to_string()));
            app.manage(tray_language.clone());

            let db_for_monitor: DbState = {
                let conn = db::open(&db_path)
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
                    let conn = db::open(&db_path)
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
                    let conn = db::open(&db_path)
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
            setup_tray(app, monitor_status, tray_language)?;

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
        })
        .invoke_handler(tauri::generate_handler![
            // Monitor
            commands::get_monitor_status,
            commands::set_monitoring_active,
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
            // App settings / startup / shortcuts
            commands::get_app_settings,
            commands::get_browser_extension_status,
            commands::get_install_channel_info,
            commands::set_launch_at_startup,
            commands::set_silent_startup,
            commands::set_auto_open_widgets,
            commands::set_browser_extension_enabled,
            commands::set_ignore_system_processes,
            commands::set_idle_time_policy,
            commands::set_track_window_titles,
            commands::set_shortcuts,
            commands::send_native_notification,
            // Browser domain
            commands::get_browser_domain_stats,
            commands::get_browser_ignored_domains,
            commands::set_browser_ignored_domains,
            commands::get_browser_domain_limits,
            commands::save_browser_domain_limit,
            commands::remove_browser_domain_limit,
        ])
        .run(tauri::generate_context!())
        .expect("error while running TimeLens");
}

// ── Tray setup ────────────────────────────────────────────────

fn setup_tray(
    app: &tauri::App,
    monitor_status: SharedMonitorStatus,
    tray_language: SharedTrayLanguage,
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

    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
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
    };
    let _ = commands::widget_cmd::build_widget_window_sync(app, &cfg);
}
