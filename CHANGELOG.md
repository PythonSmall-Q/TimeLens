# Changelog

All notable changes to TimeLens are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [0.4.0] - 2026-04-26

### Added

#### Global Shortcuts

- **System-level global shortcuts** — powered by Tauri `globalShortcut`; shortcuts work even when TimeLens is not focused
  - `Alt+W` — open Widget Center (focus main window + navigate)
  - `Alt+Shift+W` — toggle visibility of all floating widgets (hide if any visible, otherwise restore all)
  - `Alt+R` — resume screen-time monitoring
  - `Alt+P` — pause screen-time monitoring
- **Shortcut customization** — all four shortcuts are editable from Settings → Shortcuts; changes are saved to the backend and take effect immediately without restarting the app
- **Conflict handling** — registering new shortcuts automatically unregisters the old ones; failures are silently caught to avoid crashes

#### System Notifications

- **Native OS notifications for app limits** — replaced the in-app banner-only warnings with real system notifications using `tauri-plugin-notification`
  - 80 % warning — yellow notification when daily limit threshold is reached
  - 90 % warning — orange notification when approaching the limit
  - 100 % alert — red notification + blocking modal when limit is fully consumed
- **Click-to-navigate** — clicking a notification brings the main window to the foreground and jumps to the Limits page
- **Permission-aware** — gracefully handles denied notification permission (falls back silently)


### Changed

- App version bumped to **0.4.0** in `package.json`, `Cargo.toml`, `tauri.conf.json`, and the in-app update checker (`MainApp.tsx`)
- Limit warning delivery mechanism upgraded from pure frontend toast to hybrid frontend toast + native OS notification
- Shortcuts settings now stored in the backend database (`app_settings` table) instead of `localStorage` alone

### Fixed

- Potential race condition when rapidly changing shortcuts — shortcuts are now unregistered before new ones are registered
- Widget toggle visibility now correctly distinguishes between "some visible" and "all hidden" states using `isVisible()` checks on every widget window

---

## [0.3.0] - 2026-04-25

### Added

#### Dashboard — Period Stats

- **Day / Week / Month selector** — switch between daily, weekly, and monthly views from the dashboard header
- **Week navigator** — `<select>` dropdown listing every week of the year; prev / next arrow buttons
- **Month navigator** — `<select>` dropdown listing every month; prev / next arrow buttons
- **Average daily usage** — displayed per period (weekly / monthly view) showing mean screen time per day
- **Week-over-week comparison** — shows total usage change vs. the previous week (absolute + percentage delta, color-coded)
- **Week date range labels** — week dropdown now shows `W17: Apr 21 – Apr 27` instead of the raw ISO code
- **First day of week** — configurable in Settings (Monday or Sunday); affects the week date range display and data window

#### Settings — Excluded Apps

- New **Excluded Apps** section under Data settings
- Searchable app list populated from currently running processes (Windows: `tasklist`) merged with recent historical executables
- Checkbox-based multi-select; changes saved via a dedicated Save button
- Excluded apps are hidden from all stats queries (dashboard, charts, rankings)
- **Default exclude TimeLens** — on first run, TimeLens's own executable is auto-added to the exclusion list; a toggle in Settings can re-include it

#### Widgets

- **Start on launch** toggle per widget — each widget card in Widget Center now has a checkbox; widgets with this disabled are not restored at startup

#### UI / UX

- **Dropdown beautification** — unified `.ui-select` style with custom SVG chevron, 12 px rounded corners, and theme-aware option backgrounds
- **Dropdown beautification (enhanced)** — 14 px rounded corners, subtle box-shadow, smooth hover/active scale transitions
- **App exe path tooltip** — hovering over an app name in the ranked list shows the full executable path

#### App Usage Limits (new page)

- New **App Limits** sidebar page (`/limits`) for per-app daily usage warnings
- Searchable app picker; per-limit enable/disable toggle and inline hour/minute editing
- **80 % warning** — dismissable floating banner toast when 80 % of daily limit is reached
- **90 % warning** — orange banner toast when 90 % of limit is reached
- **100 % alert** — blocking modal popup when daily limit is fully consumed
- Warning state stored in localStorage, reset daily (fires once per threshold per day)

#### Update Check

- On startup (4 s delay) TimeLens fetches the latest GitHub release
- If a newer version is found, an **Update Available** modal shows release notes and a direct GitHub link
- Users can dismiss or choose "Remind me later"

#### Internationalization

- **System language auto-detect** — on first launch, TimeLens automatically selects `zh-CN` if the OS locale is Chinese, otherwise defaults to `en`; preference is saved to localStorage
- Language switcher removed from the Sidebar; language is now changed only from Settings
- New **limits** i18n namespace (`en` / `zh-CN`) covering the App Limits page
- `common` namespace extended with update-check message keys
- `settings` namespace extended with week-start-day and exclude-TimeLens keys

### Fixed

- **Startup race condition** — `DbState` is now registered with Tauri's state manager *before* widget windows are restored, preventing early IPC calls from failing with a missing-state error
- Two Rust compile errors introduced by `exe_path` tracking: missing tuple element in `monitor/mod.rs` and missing `start_on_launch` field in `WidgetConfig` initializer
- **macOS build compatibility** — removed unsupported `WebviewWindowBuilder::transparent(true)` call in `widget_cmd.rs`, fixing `error[E0599]` when building `aarch64-apple-darwin`

### Changed

- `exe_path` column added to `app_usage` table; existing databases are migrated automatically via `ALTER TABLE`
- `start_on_launch` column added to `widget_configs` table; existing databases are migrated automatically
- New `ignored_apps` table created on first run
- All stat queries now filter out rows whose `exe_path` is in the ignored-apps list
- Version bumped to **0.3.0** in `package.json`, `Cargo.toml`, and `tauri.conf.json`
- Added crate feature mapping `macos-private-api = ["tauri/macos-private-api"]` in `src-tauri/Cargo.toml` to avoid misconfiguring `tauri-build` features in release builds

---

## [0.1.0]

### Added

#### Screen Time Tracking

- Automatic foreground window monitoring (Windows via Win32 API; macOS via AppleScript)
- Per-app daily usage totals stored in SQLite
- Hourly distribution breakdown (0–23 h area chart)
- 7-day usage trend
- 500 ms debounce to suppress noise from rapid app switches
- Pause / resume tracking from tray menu or Settings

#### Dashboard

- Today overview cards: total time, current app, most-used app
- Top-8 apps horizontal bar chart (Recharts)
- 24-hour area chart with current-hour highlight
- Full ranked app list with progress bars
- Date navigator (prev / next day)

#### Floating Widgets

- **Clock Widget** — digital (12/24 h toggle) and analog display; draggable; frameless transparent window
- **Todo Widget** — quick-add input, checkbox toggle, @dnd-kit drag-reorder, per-item delete, clear completed
- **Timer Widget** — Pomodoro (25 min work / 5 min break with auto-phase switch), custom countdown, stopwatch; animated SVG progress ring
- Widget position/size persisted to DB; restored on next launch
- Focus-based always-on-top: widget rises to front on focus, recedes on blur

#### App Infrastructure

- Tauri 2.x multi-window with capability manifests
- System tray with Show, New Clock / Todo / Timer, Pause, Quit actions
- Main window hides to tray on close (no accidental data loss)
- Zustand stores with localStorage persistence for settings
- i18next with `en` and `zh-CN` locale files; runtime language switching
- GitHub Actions CI (lint + typecheck + `cargo check`) on push/PR
- GitHub Actions release workflow: builds Windows `.msi`/`.exe` + macOS universal `.dmg` on `v*` tags

---

#### Future Development


| 方向                 | 具体想法                                                        |
| -------------------- | --------------------------------------------------------------- |
| **数据洞察**   | 生产力分数、专注时段识别、与历史均值的对比趋势图                |
| **目标系统**   | 每日/每周使用目标（不只是限制，还有"至少用 X 小时"鼓励类）      |
| **分类管理**   | 将 App 手动分入"工作/娱乐/社交"类别，按类别统计                 |
| **报告导出**   | 周报/月报 PDF/CSV，可分享                                       |
| **通知集成**   | Windows 原生通知（目前用内嵌 toast），支持声音提醒              |
| **跨设备同步** | 可选云同步（S3/本地 NAS），多机汇总统计                         |
| **专注模式**   | 限额触发时可选择屏蔽某应用窗口（需管理员权限）                  |
| **API / 插件** | 暴露本地 REST API，让第三方工具（Obsidian、Raycast 等）读取数据 |
| **移动端伴侣** | 查看统计的手机端 App（只读），Tauri 2.x 支持 Android/iOS        |
