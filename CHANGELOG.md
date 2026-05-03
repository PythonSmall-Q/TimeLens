# Changelog

All notable changes to TimeLens are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [1.1.0] - 2026-05-02

### Added

#### Widget Permission System

- New **third-party widget permission system** — official and third-party widgets now have separate trust tiers
- **WidgetPermissionDialog** component (`src/pages/WidgetCenter/WidgetPermissionDialog.tsx`) — modal for reviewing and granting individual data-access permissions before a third-party widget loads
- **Import local widget** support in WidgetCenter — browse filesystem to load external widget packages
- Permission persistence and management backend (`src-tauri/src/commands/widget_permissions.rs`) — stores granted permissions per widget in the database
- Widget **signature verification** — SHA-256 hash validation of the manifest entry file to ensure package integrity

#### Widget Data Channels

- Expanded widget channel data interfaces — additional query endpoints exposed to widgets via IPC
- Fine-grained permission control — widgets must request explicit permission for each data category they access
- `ExternalWidgetHost` updated with permission filtering and expanded channel capabilities

#### VS Code Integration

- New **VS Code Insights** page (`src/pages/VsCodeInsights/index.tsx`) — dedicated page for Visual Studio Code usage analytics
  - Total coding time, session count, and tracking toggle
  - Three tracking levels: **basic** (time only), **standard** (+ language stats), **detailed** (+ project stats)
- **VS Code API endpoints** (`src-tauri/src/api_server/mod.rs`) — REST API for the VS Code extension to push session data
  - `POST /api/vscode/sessions` — receive coding sessions with per-language durations
  - `GET /api/vscode/stats/today` / `stats/range` — coding time summaries
  - `GET /api/vscode/languages/range` — programming language usage ranking
  - `GET /api/vscode/projects/range` — project-level time breakdown
  - `GET|POST /api/vscode/enabled` — tracking toggle and level configuration
- **Database schema** — new `vscode_sessions` and `vscode_session_languages` tables with indexes for fast date/project/language queries
- **Dashboard TodayOverview** — new VS Code card showing today's coding time, top language, and top project
- **Dashboard customization** — VS Code card visibility toggle in Home Customize
- **Sidebar navigation** — new `/vscode` route with `Code2` icon in the main nav

#### Productivity Score

- New **Productivity Score** algorithm — calculates daily and date-range scores from focus time, app switch count, and usage patterns
- **ProductivityScoreCard** component — new dashboard card displaying the current period's productivity score
- **ProductivityTrendChart** component — line chart visualizing productivity score trends across days

#### Interruption Detection

- New **interruption detection** engine — identifies high-frequency app switching via a sliding window algorithm
- Dashboard **fragmentation indicator** — red dot badge on the dashboard header when frequent context switches are detected

#### Global Search

- New **Global Search** (`Ctrl+K`) — system-wide quick search and navigation
  - Search scope covers pages, apps, categories, todos, and goals
  - Grouped results with highlighted matches
  - Full keyboard navigation (arrow keys to move, Enter to select)
- **GlobalSearch** component (`src/components/GlobalSearch.tsx`) — overlay search panel with fuzzy matching and category grouping

#### Widget UX

- Widget **auto-blur on mouse leave** — floating widgets fade out 2 seconds after the mouse leaves, reducing visual distraction
- Widget idle state — widgets enter a low-attention mode when not actively interacted with

#### Dashboard Customization

- New **Home Customize** page (`src/pages/HomeCustomize/index.tsx`) — manage visibility and reorder of individual dashboard cards; each card can be shown or hidden independently
- **Dashboard layout store** (`src/stores/dashboardLayoutStore.ts`) — Zustand store with `localStorage` persistence for card visibility and ordering preferences
- Dashboard index refactored with modular conditional card rendering based on layout configuration

#### App Detail Modal

- New **AppDetailModal** component (`src/components/AppDetailModal.tsx`) — detailed usage view accessible by clicking any app in the dashboard ranking
  - Displays today's usage, 7-day total, and assigned category
  - 7-day bar chart with daily breakdown
  - Quick navigation to the Categories page for re-categorization

#### Developer Resources

- New **Widget Development Guide** (`docs/WIDGETS_DEV_GUIDE.md` and `docs/WIDGETS_DEV_GUIDE.zh-CN.md`) — comprehensive documentation for building third-party widgets including manifest format, render contract, and permission system
- New **third-party widget template** (`examples/third-party-widget-template/`) — minimal starter template with `manifest.json`, `index.js`, and bilingual README

#### Backend

- New **`productivity_cmd.rs`** module (`src-tauri/src/commands/productivity_cmd.rs`) — Rust commands for productivity score calculation and interruption detection metrics
  - `get_productivity_score` — single-day score from focus time, switch count, and usage patterns
  - `get_productivity_score_range` — daily scores across a date range for trend charts
  - `get_interruption_periods` — per-hour fragment data (switch count + fragmentation score) for a given date
- **Database schema expanded** — new tables and indexes for productivity tracking, widget permissions, and signature verification storage
- **`storage_cmd.rs`** expanded with additional aggregate query endpoints for range statistics and category insights
  - `get_app_comparison_in_ranges` — period-over-period usage comparison
  - `get_category_totals_in_range` / `get_category_daily_totals_in_range` — category-level aggregation
  - `get_hourly_distribution_for_date` / `get_recent_daily_totals_range` / `get_app_category_map` — widget channel data APIs

#### Internationalization

- **`dashboard`** namespace significantly expanded — productivity score, interruption detection, dashboard customization, and app detail labels
- **`widgets`** namespace expanded — permission dialog, signature verification, and third-party widget management labels
- **`common`** namespace expanded — global search and app detail action labels

### Changed

- **WidgetCenter** page refactored — official and third-party widgets are now displayed in separate sections with distinct visual treatment
- **Dashboard** heavily refactored — modular card system with conditional rendering, AppDetailModal integration, and layout store support
- **Dashboard** enhanced — new productivity score card, productivity trend chart, and interruption fragmentation indicator added
- **ExternalWidgetHost** — updated with permission filtering and expanded data channel interfaces
- Code structure optimization — Rust and TypeScript types aligned, API surfaces unified
- Various bug fixes and stability improvements

#### App Infrastructure

- `get_install_channel_info` command — detects whether the app was installed via Microsoft Store or direct download, determining the appropriate update strategy

### Fixed

- Fixed `WidgetRegistryLoadError` error type not convertible to `String` (compilation failure)
- Removed unused `chrono::Local` import

---

## [1.0.0] - 2026-05-01

### Added

#### Categories

- New **Categories** page — manually group apps into custom categories such as "Work / Entertainment / Social / Utilities"
- **CategoryInsights** component — new dashboard card visualizing category time distribution and trends via pie and area charts
- Category data persisted to SQLite with aggregate queries and stats by category

#### Goals

- New **Goals** page — create, edit, and delete daily / weekly usage goals
  - Goals can target a **category** or a **single app**
  - Configurable duration down to hour + minute granularity
- **GoalProgressBar** component — new dashboard progress bars showing completion percentage for each goal

#### Focus Mode

- New **FocusMode** page — start focused timer sessions
  - Real-time countdown display with option to abandon mid-session
  - Configurable focus duration

#### Dashboard Enhancements

- **TrendComparePanel** — compare usage trends across different periods (period-over-period change, absolute and percentage deltas, color-coded)
- **UsageHeatmap** — yearly usage heatmap rendered as calendar cells showing daily screen-time intensity over the past year

#### Browser Extension

- New **Chrome browser extension** (`browser-extension/`)
  - Tracks browsing time per website / tab
  - Standalone popup showing browser usage stats (progress bars + percentages)
  - Supports `en` / `zh_CN` localization
  - Includes `build-chrome.js` script for one-click packaging

#### Browser Domain Limits

- New **per-domain daily usage limits** for browser sessions
  - `save_browser_domain_limit` / `remove_browser_domain_limit` commands
  - Domain-level time tracking synced from the browser extension
  - Ignored-domains list to exclude sites such as `localhost` or corporate SSO pages

#### Data Import / Export

- **Export to CSV** — one-click export of all `app_usage` records as a CSV string
- **Export to JSON** — full database snapshot export as structured JSON
- **Import from JSON** — restore data from a previously exported JSON payload
- Useful for backups, migrating to a new machine, or sharing usage reports

#### API Server

- New local **REST API** module (`src-tauri/src/api_server/`)
  - Exposes endpoints for third-party tools (e.g. Obsidian, Raycast) to read usage data
  - Supports querying app lists, usage statistics, and browser data

#### UI / Components

- **ExePickerInput** — improved app-picker component supporting search / selection from currently running processes and historical executables
- **WidgetCenter upgrades** — improved per-widget startup configuration and friendlier empty-state messaging

#### Internationalization

- New i18n namespaces:
  - `categories` — category management labels
  - `goals` — goal system labels
  - `focus` — focus mode labels
  - `browserUsage` — browser extension labels
- `dashboard`, `settings`, and `widgets` namespaces significantly expanded to cover all new features

### Changed

- Version bumped to **1.0.0**, marking the first stable release
- `get_running_executables` and `get_recent_executables` commands added to support the improved app picker
- `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` synchronized to the new version
- Settings page refactored with new configuration entries for categories, goals, and browser data
- Database schema significantly expanded with new tables / indexes for categories, goals, and browser usage
- Backend command modules (`storage_cmd`, `widget_cmd`, etc.) refactored to support new features

---

## [0.5.0] - 2026-05-01

### Added

- Update channel split policy:
  - Microsoft Store installs now only receive update reminders (no in-app updater trigger)
  - macOS and non-Store installs attempt in-app updater first, with release-page fallback
- Linux foreground-window detection MVP:
  - Wayland path via `zbus` (GNOME Shell `Eval` best-effort)
  - X11 path via `x11rb` (`_NET_ACTIVE_WINDOW` + `_NET_WM_PID`)
- Data-layer performance upgrades:
  - New `daily_app_usage` pre-aggregation table for date/range queries
  - New paginated command `get_app_usage_page` for large history reads
- New setting: **Ignore system processes**
  - Excludes non-interactive processes under `System32` / `SysWOW64`
  - Keeps interactive executables such as `explorer.exe` and `taskmgr.exe`

### Changed

- App version bumped to **0.5.0** in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, and UI version labels
- App-limit alerts now rely on OS notifications only (removed in-app blocking modal)
- Dashboard date behavior:
  - Removed implicit day-mode re-fetch loop that could override historical views
  - Auto-refresh of today data now only happens when currently viewing **today** in day mode
- "Current App / 正在使用" now appears only in **today + day mode**; hidden for historical day/week/month navigation
- Widget spawn behavior:
  - Prefers the user's last moved widget position
  - If occupied, applies collision avoidance in order: **down first, then right**
- `ignored_apps` values are normalized for path separator and case to improve matching reliability

### Fixed

- Prevented mismatch where historical dashboard views displayed real-time active-app info
- Reduced large-range query pressure by switching range/day totals to pre-aggregated source table

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

