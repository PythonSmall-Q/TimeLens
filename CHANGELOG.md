# Changelog

All notable changes to TimeLens are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [2.1.0] - 2026-08-27

### Added

- **AI Insights (LLM-powered screen-time analysis)** — new page that lets you ask an AI to analyze your screen-time data and focus habits.
  - Supports multiple configurable LLM providers with nicknames; add, delete, and switch providers from Settings.
  - Built-in presets for OpenAI, Groq, OpenRouter, and OrcaRouter, including a referral link for OrcaRouter.
  - Custom provider support with arbitrary base URL, model, and API key.
  - Real-time streaming responses with Markdown rendering.
  - Conversation sidebar with pin, archive, delete, and new-conversation actions.
  - Summarize conversation history to condense context and save tokens.
  - Choose which screen-time data is shared with AI (total time, top apps, categories, focus time, goals, interruptions).
  - Select analysis range: today, yesterday, last 7/30 days, this/last week, or a custom date range.
  - Persisted conversation history with full context for follow-up questions.
- **Open LLM config from Settings** — added buttons to open `llm_config.toml` and its containing folder with the system default app/file explorer.

### Changed

- **Navigation order** — AI Insights is now the second item in the left sidebar, right below Dashboard.
- **AI chat UX** — the system prompt and raw screen-time summary are no longer shown as chat bubbles; they remain in context sent to the model. Removed the bottom-right "New analysis" rotate button.

### Fixed

- **AI Insights header layout** — aligned all header controls to the same height and allowed wrapping on narrow windows for a cleaner toolbar.

---

## [2.0.5] - 2026-08-26

### Added

- **Widget Center two-column layout** — official widgets and third-party widgets now scroll independently, with a subtler divider and proper edge padding so the left column is no longer clipped.
- **Cross-window Quick Capture refresh** — capturing a todo or note from the Quick Capture widget now broadcasts a Tauri event, so open Todo and Note widgets refresh automatically.
- **Widget error reporter** — added `useWidgetErrorReporter` hook that catches unhandled errors and promise rejections in first-party widgets and records them to the per-widget error log with recovery hints.
- **Error log filtering** — the Widget Center error log panel now has a real-time filter input.
- **Settings auto-blur modal** — turning on "Fade widgets when unfocused" now opens a modal where users can choose which widgets auto-blur; the choice is persisted per widget and editable later from the same settings card.

### Changed

- **Pet widget rewrite** — simplified the desktop pet into a cleaner companion view with import success/error feedback and integrated error reporting.
- **Focus rule save UX** — the Focus Mode rule form now validates required fields, shows a loading state, and displays success or error messages after saving.

### Fixed

- **Focus Coach timer showing `-2` / freezing** — the widget now parses backend local datetimes as local time instead of UTC, preventing negative durations. The timer also starts counting immediately and the button label updates right away.
- **Focus Coach button state** — "Start Focus" now correctly becomes "Stop Focus" after a session is started.
- **Focus rule "Add rule" not working** — the backend `FocusRule` model now accepts an optional `created_at`, so rules submitted from the frontend save successfully instead of failing deserialization.
- **Goals and Categories dropdown layering** — the app/executable picker dropdown now renders above subsequent cards instead of being clipped underneath.
- **Widget auto-blur and permission item backgrounds** — lowered the background opacity of per-widget items in Settings for a lighter appearance.

---

## [2.0.2] - 2026-07-27

### Added

- **Browser extension debug logging** — the browser extension now emits detailed `[TimeLens API]`, `[TimeLens BG]`, and `[TimeLens Popup]` console logs for connection discovery, cache decisions, session lifecycle, sync attempts, and bridge-signature checks, making it easier to diagnose connection issues in Edge/Chrome DevTools.
- **Redesigned GitHub Pages documentation site** — rewrote all GitHub Pages HTML docs and added dedicated pages for the two extensions:
  - `docs/browser-extension/index.html` — Edge/Chrome extension overview, install steps, connection settings (manual port, cache mode, auto fallback scan), and troubleshooting.
  - `docs/vscode-extension/index.html` — VS Code extension overview, Marketplace/VSIX install, settings, commands, and troubleshooting.
  - `docs/help/index.html` — user help center with quick start, FAQ, and scenario-based troubleshooting.
  - Updated `docs/index.html` with v2.0.2 branding and links to the new pages; fixed footer links to use GitHub blob URLs for static-page compatibility.

### Fixed

- **Browser Usage timezone mismatch** — `browser_sessions.ended_at` is stored as UTC RFC3339 from the browser extension, but the desktop Browser Usage page queried by local date. This caused the page to appear empty when local midnight had passed while the session was still recorded on the previous UTC day. Queries in `get_browser_domain_stats`, `get_browser_domain_stats_for_hour`, and `get_browser_domain_today_seconds` now convert `ended_at` to local time (`date(ended_at, 'localtime')`) before comparing with user-facing dates.
- **Duplicate React keys in Browser Usage** — recent session list keys now use `session.id` when available, falling back to a composite including the array index, preventing the "two children with the same key" warning when the same URL was visited within the same millisecond.

---

## [2.0.1] - 2026-07-18

### Changed

- **Extension connection settings** — the browser extension popup now lets users set a manual API port, choose between duration-based cache or "until next startup" cache, and configure the cache duration. The VS Code extension gained `timelens.apiBaseUrlCacheMode` (`duration` / `startup`) and `timelens.apiBaseUrlCacheSeconds` settings for the same behavior. If a manually configured localhost port fails repeatedly, both extensions temporarily ignore it and automatically scan the fallback port range.
- **Settings page UI redesign** — rewrote the Settings page to use a reusable card-based layout consistent with Backup & Restore v2, including `glass-card` containers, icon-header cards, and inner content wells.

### Fixed

- **Local API port binding failure** — if the default port `49152` is blocked by Windows (excluded port range) or antivirus, the desktop backend now scans up to 1000 fallback ports (49152–50151) and binds to the first available one. A new `get_local_api_base_url` Tauri command exposes the actual bound URL, and the frontend, browser extension, and VS Code extension all discover the port dynamically instead of assuming `49152`. The Browser Usage and VS Code Insights pages now display the current local API port.
- **Extension bridge key migration** — when merging a v2.0.0 `profiles/default` database back into the legacy root path, the `extension_bridge_key` (and its rotation timestamp) from the v2.0.0 profile is now preserved and overwrites any legacy value. Previously the generic `INSERT OR IGNORE` merge kept the legacy root key, which broke VS Code and browser extensions that had already been paired with the v2.0.0 key.
- **Default profile storage path regression** — the default profile now uses the legacy low-version database path (`app_data/timelens.db`) instead of a separate `app_data/profiles/default/timelens.db` folder. On startup, any data already written to the v2.0.0 `profiles/default` folder is automatically merged into the legacy database; raw usage rows are inserted without their synthetic `id` to avoid accidental data loss, and `daily_app_usage` is rebuilt from the merged raw rows so today’s totals stay correct. Other conflicting rows are skipped (`INSERT OR IGNORE`). Encrypted default-profile databases are relocated to the legacy path before decryption so they continue to work.
- **Dashboard period total label** — the overview card now shows “Week Total” / “Month Total” instead of “Today’s Total” when the period selector is set to week or month; the numeric value already matched the selected range.
- **VS Code extension API network errors** — dashboard no longer logs `Failed to fetch` errors when the optional local VS Code extension API is unreachable; it falls back to empty stats and emits the unavailable event once.
- **Dependency security updates** — updated `sharp` to `^0.35.3` and added `overrides` for `brace-expansion`, `minimatch`, and `js-yaml` in the root `package.json` to resolve high-severity advisories. Updated `postcss` to `^8.5.23`. In `vscode-extension`, updated `@vscode/vsce` to `^3.9.2` and added overrides for `brace-expansion`/`minimatch`, clearing all high-severity Dependabot alerts in that package. `react-router-dom` remains at `^6.30.4` because the only patched v7 versions currently available introduce a separate high-severity advisory; this will be revisited once a clean patched release exists.

---

## [2.0.0] - 2026-07-17

### Added

- **Unified migration runner** — replaced ad-hoc `ALTER TABLE` checks with a numbered migration framework using `PRAGMA user_version`, a `_migration_log` table, and `pre-check` / `apply` / `post-verify` phases.
- **Migration rehearsal command** — `run_migration_rehearsal` copies the live database to a temporary path, runs all pending migrations, and returns a health report without modifying production data.
- **Migration status command** — `get_migration_status` exposes current, latest, and pending migration versions.
- **Roadmap-aligned data health commands** — added `check_data_integrity`, `scan_data_gaps`, and `check_orphan_rows` to match the v1.2.0 roadmap command surface.
- **Profile-aware database layout** — databases now live under `app_data/profiles/<profile_id>/timelens.db`. Added `list_profiles`, `create_profile`, `switch_profile`, and `get_current_profile` commands.
- **Cross-platform legacy 1.x migration** — startup now detects legacy database paths on Windows, macOS, and Linux and migrates them into the default profile.
- **Restore monitoring active state on startup** — monitor no longer defaults to active when the user had paused tracking before quitting.
- **Backup & Restore v2 completeness** — backup packages now include app categories, usage goals, focus sessions/rules, browser ignored domains/limits, widget permissions/audit log, VS Code sessions, API tokens, and client allowlist.
- **Automatic archive scheduler** — added background scheduler with configurable daily run hour and battery-aware toggle, plus `get_archive_scheduler_settings` / `set_archive_scheduler_settings` commands.
- **Hot/warm/archive tiering** — archived rows are now tagged with `tier` (`warm` or `archive`) based on age relative to the retention cutoff.
- **Historical compression** — old archived raw usage rows can be compressed into zstd blobs in `app_usage_archive_compressed`, freeing storage while preserving queryability.
- **Restore diff summary** — backup validation now reports per-table add/update/conflict counts and settings conflicts before applying a restore.
- **`new_profile` restore strategy** — importing a backup can create and switch to a fresh profile instead of overwriting or merging the current one.
- **Passphrase-protected backups** — Backup v2 packages can be AES-256-GCM encrypted with a passphrase derived key (Argon2id).
- **Database encryption at rest** — optional file-level AES-256-GCM encryption for the local SQLite database; runtime plaintext is wiped on app exit so only the encrypted file remains at rest.
- **Database encryption commands** — added `enable_database_encryption`, `disable_database_encryption`, and `get_database_encryption_status`.
- **Derived metrics tables** — added incremental maintenance of `app_switch_density`, `focus_streaks`, and `interruption_summary` in the monitor task and a periodic scheduler, plus `rebuild_derived_metrics` for full repair.
- **Distraction hotspot detection** — added `get_distraction_hotspots` command and data model for ranking high-switch-density / high-fragmentation apps and time windows.
- **Category and project comparison** — added `get_category_comparison_in_ranges` and `get_project_comparison_in_ranges` for period-over-period drill-down beyond apps.
- **Goal risk notifications** — added `evaluate_goal_risks` and a background notifier that emits `goal-risk-alert` events and native notifications when goals are off track.
- **Backend Focus rule automation** — moved Focus rules from frontend-only `localStorage` to the `focus_rules` table with CRUD commands and a background evaluator that auto starts/stops focus sessions.
- **Widget SDK v2** — `manifest.json` now supports `manifest_version`, `sdk_version`, structured `capabilities`, and `csp`. Legacy v1 manifests are auto-normalized to v2.
- **Widget `local_api_call` enforcement** — widgets can request `local-api:call`; the host issues scoped API tokens and the local API server enforces token scopes across all routes.
- **Widget dev harness** — updated the local widget preview page to handle SDK v2 capabilities and permission simulation.
- **Widget template & migration guide** — upgraded `examples/third-party-widget-template/` to SDK v2 with TypeScript types and `localApiCall` example; added `docs/WIDGET_SDK_v2_MIGRATION.md`.
- **Settings UI for v2.0.0 platform features** — added sections/cards for migration rehearsal/integrity checks, passphrase-protected backups, archive scheduler and compression, profile management, and database encryption.
- **CI quality gates** — added `npm test`, Rust `cargo test`, Tauri build smoke test, offline critical-journey tests, and migration-rehearsal job to `.github/workflows/ci.yml`.
- **Dashboard Insights enhancements** — added saved views, distraction hotspot card, and Apps/Categories/Projects comparison tabs.
- **VS Code Insights manual refresh** — added a refresh button to the VS Code Insights page header, matching the browser extension refresh behavior.
- **Focus rule backend integration** — Focus Mode rules now persist in the backend `focus_rules` table with CRUD commands and backend-driven auto start/stop.
- **Profile state isolation** — moved profile metadata and `current_profile_id` into a separate unencrypted `app_state.db` so profile switching remains reliable even when individual profile databases are encrypted.
- **Full Japanese, Korean, French, German, and Spanish localization** — completed frontend translations across all desktop namespaces (`common`, `dashboard`, `widgets`, `settings`, `limits`, `categories`, `goals`, `focus`, `browserUsage`) for `ja`, `ko`, `fr`, `de`, and `es`.
- **Frontend accessibility pass** — added "Skip to main content" link, global `:focus-visible` styles, ARIA live announcer for notifications, navigation landmark labels, `aria-current="page"`, icon-only button labels, dialog roles/modal attributes, and dynamic HTML `lang` updates.
- **Local API server governance** — hardened all API server routes to enforce widget-scoped API token scopes and reject unscoped or revoked tokens.
- **Offline test harness scripts** — added `scripts/offline-journey-tests.sh` and `scripts/migration-rehearsal.sh` for local critical-journey and migration validation.
- **VS Code extension sidebar home page redesign** — added connection status badge, focus-mode indicator, today's VS Code time card, language/project breakdown with progress bars, top desktop apps, and cleaner action buttons; sidebar API calls now include `X-Api-Token` and `X-Client-Id` headers for local API governance compatibility.
- **Legacy 1.x data import prompt** — when the default profile is empty and a legacy 1.x database (e.g. upgraded from 1.4.4) is detected, Settings now shows a one-time dialog asking whether to import the existing data. An "Import legacy data" button is also shown below the current profile card.
- **Backend commands for legacy data import** — added `detect_legacy_data` and `import_legacy_data` commands to support the new import flow.


### Changed

- Consolidated roadmap governance into the unified canonical source at `docs/ROADMAP.md`.
- Archived the parallel roadmap track to avoid split planning ownership and version drift.
- Normalized core desktop release metadata to `2.0.0` across npm, Tauri, and Windows MSIX manifest sources.
- Added advanced Browser Usage date-range exploration with local saved views (custom range, save/apply/delete presets).
- Added Dashboard "what changed" summary card for recent period comparison (top increase/decrease, new/stopped active apps, total delta).
- Added Dashboard "Unified Insight Workspace" narrative panel (daily review, weekly reflection, goal health) powered by local suggestions and anomaly detection.
- Added local notification automation controls in Tracking settings (quiet hours + reminder cooldown) and wired them into all in-app alert dispatches.
- Added Dashboard "Unified Timeline" panel with cross-source feed (desktop focus sessions, browser sessions, interruption markers) and local source/search filters.
- Moved "What Changed" summary, Unified Insight Workspace, and Unified Timeline into a dedicated Dashboard Insights page to reduce homepage density and improve analysis flow.
- Added cross-module drill-down actions from Dashboard summaries/timeline into Categories, Browser Usage, and Focus Mode, with URL-parameter context handoff.
- Fixed interruption marker detail drill-down target: `Open Detail` now routes to a dedicated interruption detail view with hour window, switch count, and fragment score context instead of Focus Mode landing.
- Added a unified Privacy & Permission Center entry in Settings to aggregate local-only boundary, tracking state, API governance, backup, and data health with one-click deep links.
- Added reusable async state cards (loading/empty/error) and applied them to core pages for consistent platform-level UX.
- Expanded async state card adoption to Goals, Dashboard, and Widget Center to reduce duplicated state UI logic.
- Added Focus Mode rule automation panel with local rule management, simulation, and one-click apply-to-start behavior.
- Hardened third-party widget permission enforcement by mapping `settings:write` to runtime channel interception and fixing install-time permission dialog state reset / instance targeting.
- Upgraded Widget permission matrix from read-only audit view to manageable controls with one-click permission revoke.
- Added secondary confirmation and success/failure feedback for widget permission revoke actions to reduce accidental operations.
- Added per-widget permission change timeline (grant/revoke actor + timestamp) for third-party widget governance audits.
- Completed i18n coverage for newly added Widget permission matrix and Browser Usage/Dashboard incremental features across `en` / `zh-CN` / `zh-TW`.
- **`getProjectDisplayName` helper** in `src/utils/format.ts` with unit tests: prefers `project_name`, falls back to the basename of `project_path`, and finally returns the localized `dashboard:unknownProject` label.
- **`dashboard:unknownProject`** i18n key across all desktop locales (`en`, `zh-CN`, `zh-TW`, `ja`, `ko`, `fr`, `de`, `es`).
- **`unknownProject`** runtime string to the VS Code extension i18n module, used by the extension dashboard panel when a project name is missing.
- **Profile switching UI entry removed** — the profile switch buttons in Settings > Profiles are no longer shown. The `switch_profile` backend command remains available for API/internal use.
- **Legacy data migration is now user-confirmed** — startup no longer silently imports legacy 1.x data into the default profile. Importing now requires explicit confirmation via the new prompt or button, and is applied on the next restart through a pending-import flag.
- **Desktop pet widget temporarily disabled** — the pet widget is marked as “Coming Soon ” in the Widget Center; its title, description, and add button are grayed out and disabled. A backend guard in `create_widget` also rejects `widget_type == "pet"` to prevent creation through any path.
- **Profile creation button disabled** — the “Create profile” button in Settings > Profiles is temporarily disabled and the creation dialog is hidden.

### Fixed

- **Backup & Restore UI/UX** — rewrote the Settings page into a clear export/import card layout, added explicit file-selection feedback, a step-by-step validate-then-restore flow, and native notifications on success.
- **Restore feedback** — restoring a backup now shows a clear status message instead of failing silently; encrypted backups correctly prompt for the passphrase before applying.
- **Native confirmation dialogs in Settings** — replaced `window.confirm` with `@tauri-apps/plugin-dialog` `confirm()` to prevent `dialog.confirm not allowed` errors in the Tauri webview.
- **Settings excluded apps could not be unchecked after saving** — fixed a path-normalization mismatch: the backend stores ignored app paths lowercased, but the frontend compared original-case paths, causing excluded apps to vanish from the list. The list now renders ignored apps directly with case-insensitive matching so they remain visible and togglable.
- **VS Code extension sidebar title showed raw `%timelens.homeView.name%`** — fixed invalid JSON in `vscode-extension/package.nls.json` and `vscode-extension/package.nls.zh-CN.json` (missing comma after `timelens.apiToken.description`), which prevented VS Code from resolving all `%...%` placeholder strings in `package.json`.
- **Profile switching reliability** — fixed a bug where switching profiles could result in a "connection refused" error or missing profiles because `current_profile_id` was stored inside the encrypted profile database.
- **Widget permission dialog state** — fixed install-time permission dialog state reset and instance targeting so permission grants are correctly associated with the widget being installed.
- **Database encryption shutdown corruption** — fixed a critical bug where shutdown re-encryption generated a fresh nonce/salt but did not update the stored metadata, causing the next startup to fail with "Failed to decrypt database". Re-encryption now writes updated metadata and uses atomic temp-file writes.
- **Database encryption file-lock resilience** — encryption/decryption and plaintext wipe now retry on Windows file locks and fall back to a usable runtime plaintext database if the encrypted backup cannot be decrypted on startup.
- **Database encryption disable flow** — fixed a bug where disabling encryption and restarting could corrupt or overwrite the latest plaintext with a stale encrypted backup. Disabling now preserves the current runtime plaintext and removes encrypted artifacts after verifying the plaintext is valid.
- **Database open retry on restart** — added a short retry loop when opening the profile database during startup to avoid "localhost refused connection" / startup failures caused by Windows file-lock races after `app.restart()`.
- **VS Code project name fallback** — when `project_name` is empty (for example, in detailed tracking where only the folder path was recorded), the Dashboard today overview and VS Code Insights project ranking now derive the display name from the opened folder path. If no folder information is available, they show a localized "Unknown project" label instead of "No data".
- **Tauri dialog permissions** — added `dialog:allow-confirm`, `dialog:allow-ask`, and `dialog:allow-message` to the default capability so that `@tauri-apps/plugin-dialog` confirmations and messages no longer fail with "dialog.confirm not allowed" or "dialog.message not allowed".
- **Legacy v2 backup compatibility** — older v2 backup packages created before the v2.0.0 schema expansion (which added app categories, usage goals, focus rules, VS Code sessions, API tokens, etc.) now deserialize safely. Missing tables default to empty, so validate/restore no longer fails with a generic "backup action failed" message.
- **Backup error messages** — improved error extraction in the Backup & Restore UI so that backend failure details are shown instead of falling back to the generic "backup action failed" translation whenever the thrown error is not a standard `Error` instance.

### Security

- **Resolved npm audit findings** — updated `esbuild` to `^0.28.1` and `react-router-dom` to `^6.30.4` to address GHSA-gv7w-rqvm-qjhr, GHSA-g7r4-m6w7-qqqr, and GHSA-2j2x-hqr9-3h42.
- **Updated VS Code extension dependencies** — ran `npm audit fix` in `vscode-extension/` to resolve `tmp` (GHSA-ph9p-34f9-6g65) and `qs` (GHSA-q8mj-m7cp-5q26) alerts.
- **Updated Rust transitive dependencies** — ran `cargo update` to pull in latest compatible versions of 46 crates, including `hyper`, `reqwest`, `rustls-native-certs`, `tao`, `zbus`, and `zerocopy`.
- **CodeQL: hard-coded cryptographic value** — refactored salt/nonce generation in `src-tauri/src/db_encryption.rs` and `src-tauri/src/commands/data_reliability_cmd.rs` to use `OsRng.gen()` instead of zero-initialized arrays, eliminating false-positive hard-coded crypto alerts.
- **CodeQL: workflow permissions** — added explicit `permissions: { contents: read, actions: write }` at workflow and job level in `.github/workflows/ci.yml`.
- **CI `npm test` failure** — added frontend unit tests for `src/utils/format.ts` and a `vitest.config.ts` so `npm test` no longer exits with "No test files found".
- **Patched npm vulnerabilities** — updated `vite` to `^8.0.16` in the root workspace to resolve the `server.fs.deny` Windows alternate-path bypass (GHSA-fx2h-pf6j-xcff) and the bundled `launch-editor` NTLMv2 hash disclosure via UNC paths (GHSA-v6wh-96g9-6wx3).
- **Patched VS Code extension dependencies** — ran `npm audit fix` in `vscode-extension/` to update `markdown-it` to `14.2.0` (quadratic complexity DoS in smartquotes, GHSA-6v5v-wf23-fmfq), `form-data` to `4.0.6`, and `js-yaml` to `4.2.0`.

## [1.4.4] - 2026-06-06

### Added

- **Backup & Restore v2 import-and-restore action** - added a direct import-and-restore entry in Settings so users can pick a backup package and apply restore in one flow
- **Browser Usage all-time query preset** - added an `All` date preset to query full historical browser records instead of being limited to today/week/month
- **Settings update controls** - added an `Auto-check updates` option and a manual `Check for Updates` action in Settings > About

### Changed

- **Data Health Center severity tuning** - timeline `gap days` now show as informational instead of warning-level risk
- **Repair and maintenance action feedback** - repair/backup/retention actions now provide visible in-page status and result summaries instead of silent behavior

### Fixed

- Fixed multiple repair and maintenance buttons that could appear unresponsive due to missing user-facing feedback
- Improved Backup & Restore v2 workflow discoverability by exposing a dedicated import-and-restore path

## [1.4.3] - 2026-05-23

### Changed

#### Dashboard and Global UI Polish

- **Balanced dashboard chart cards** - aligned the Hourly Distribution card and Top Apps card heights for a cleaner two-column layout
- **Refined app-wide visual style** - added layered ambient background gradients, enhanced glass-card depth/hover behavior, and shell-level decorative light effects across main pages
- **Typography refresh** - upgraded the global font stack for better readability in both Chinese and English UI surfaces
- **Full-width page layout for key modules** - removed fixed max-width constraints on Categories, Goals, and Focus Mode pages so content fills the available main area without a large right-side blank zone

#### Localization and Language Coverage

- **Traditional Chinese (zh-TW) localization pass** - completed a full zh-TW locale rollout for core desktop-app namespaces (`common`, `dashboard`, `widgets`, `settings`, `limits`, `categories`, `goals`, `focus`, `browserUsage`) and refined wording toward native traditional Chinese usage
- **Expanded desktop language options** - language selector and startup locale resolution now include `zh-TW`, `ja`, `ko`, `fr`, `de`, and `es`, with safe fallback behavior for untranslated locales
- **Browser extension zh-TW support** - added zh-TW runtime strings and locale mapping, plus a dedicated Chromium extension locale package under `_locales/zh_TW`
- **VS Code extension zh-TW runtime localization** - added a dedicated zh-TW message branch with locale-aware routing (`zh-TW`/`zh-HK`/`zh-Hant`) while preserving existing fallback behavior

### Fixed

- **Hourly distribution overflow bug** - fixed per-hour aggregation so usage segments are split across hour boundaries, preventing impossible values such as single-hour totals over 60 minutes
- **UWP app identification on Windows** - improved foreground window resolution to avoid reporting UWP apps as `ApplicationFrameHost` or `Unknown` by resolving the real process behind the frame host window
- **Microsoft Store taskbar icon blue background** - fixed packaged MSIX taskbar icon rendering by generating `Square44x44Logo.targetsize-*` and `Square44x44Logo.altform-unplated_targetsize-*` assets in the icon pipeline, preventing Windows from applying an automatic colored plate behind the icon

## [1.4.2] - 2026-05-22

### Added

#### Tray Icon and Startup

- **Black & white tray icon options** — Appearance settings now includes a Tray Icon Style selector (Color / Black / White); the chosen style is persisted and applied immediately at runtime without restart. Black/white variants are generated from the main icon via `generate-tray-icons.mjs`
- **Auto tray icon theme matching** — tray icon style now supports `Auto`; when enabled, TimeLens switches between white/black monochrome tray icons based on the current system theme (dark/light) and updates live when the theme changes
- **Standalone tray icon settings section** — tray/taskbar icon style controls are now exposed as an independent Settings entry instead of being nested under Appearance
- **macOS launch at startup** — startup-on-login now supported on macOS via LaunchAgent; migrated from manual Windows registry code to `tauri-plugin-autostart` for unified cross-platform (Windows + macOS) support; the Startup settings section is now shown on both platforms
- **Microsoft Store update routing** — when a newer TimeLens release is detected on Microsoft Store installs, TimeLens now opens the Microsoft Store updates page directly instead of only showing a reminder

#### Build and Packaging Utilities

- Added multiple icon-processing and troubleshooting scripts for MSIX/taskbar icon workflows, including generation and one-off fix helpers
- Added localized VS Code extension metadata resources for automatic language switching based on user locale
- Added VS Code extension runtime i18n module for dynamic UI/message localization
- Added VS Code extension setup guide for bridge-key configuration and local API connection
- Added packaged VS Code extension artifacts for versions 0.3.0 through 0.3.3

### Changed

#### Windows MSIX Packaging and Assets

- Updated MSIX manifest and staged asset set used for Windows packaging
- Refreshed Store and tile icon assets in all required sizes to improve packaged app icon consistency
- Updated staged Windows executable in MSIX output
- Updated npm scripts and lockfile to support icon generation/build flow integration
- Updated ignore rules to align with the current packaging/output workflow

#### Browser Usage Page

- Added a manual refresh control on the Browser Usage page header
- Added auto-refresh behavior when the app window regains focus while staying on Browser Usage
- Added refresh-related locale strings for Browser Usage in English and Chinese

#### VS Code Extension: Sync, Diagnostics, and Localization

- Updated extension API upload payload serialization to canonical JSON for stable signature verification against the desktop API
- Expanded extension bridge-key UX so key configuration/update remains accessible from extension surfaces
- Improved extension diagnostics with clearer output-channel logging and richer auth-failure prompts/actions
- Localized extension runtime UI/messages and package-contributed labels/descriptions with automatic language selection
- Updated extension README to match current bridge-key auth and setup flow

### Fixed

- Fixed packaged Microsoft Store/taskbar icon presentation issues caused by previous icon asset composition
- Fixed Tauri npm/rust minor-version mismatch warning by aligning `@tauri-apps/api` and `@tauri-apps/cli` with Rust `tauri` 2.11.x
- Fixed Browser Usage data staleness by allowing explicit refresh and focus-triggered refresh
- Fixed VS Code extension bridge auth mismatches in session upload requests caused by non-canonical request body serialization
- Fixed extension usability gap where users needed an easier path to reconfigure bridge key and inspect sync failures

## [1.4.1] - 2026-05-16

### Changed

#### Reliability and Diagnostics

- **Startup fallback hardened** — app boot now falls back to the main window render path when Tauri window label metadata is unavailable during early initialization, reducing black-screen startup failures seen after 1.2.0 upgrades
- **Persisted state safety guards** — settings and dashboard layout stores now tolerate malformed legacy localStorage payloads and fall back to defaults instead of breaking initial render
- **Unified file logging pipeline** — backend runtime logs and frontend `console` / unhandled error events now flow into persistent on-disk logs for post-mortem troubleshooting
- **Settings quick access to logs** — the About section now includes a one-click action to open the app log folder directly in the system file manager

### Fixed

- Fixed an issue where some upgraded environments could open to a black screen and appear unresponsive
- Fixed missing persistent diagnostics for startup/runtime failures by writing both frontend and backend logs to file

## [1.4.0] - 2026-05-16

### Added

#### Extension Bridge Authentication

- **Extension bridge key management** — the desktop app now generates a shared bridge key on first launch, stores it locally, and exposes it in Settings with copy and rotate actions
- **Capability negotiation for extension auth** — VS Code and browser extensions now probe the desktop API before signing requests, so old app versions without bridge auth support do not receive key-protected traffic
- **VS Code extension key entry** — the extension now includes an input command and settings key for saving, updating, and reusing the bridge key
- **Browser extension key entry** — the browser popup now keeps the bridge key field visible, auto-fills the saved key, and allows users to modify and re-save it at any time

#### Desktop Pet / Widget Center

- **Desktop pet widget** — added a built-in manifest-driven desktop pet widget with idle / focus / rest states and tap messages
- **Pet resource pack import** — users can import JSON pet packs and apply the manifest to all existing pet widgets from a prominent entry in Widget Center
- **Pet size controls** — Widget Center now exposes a visible pet settings panel for adjusting default pet window width and height in bulk
- **Pet default sizing** — the default pet window size was increased to better match the richer pet UI

#### Data Migration and Compatibility

- **Legacy database migration** — Windows startup now detects the old Roaming data directory and automatically copies the legacy database into the new app data location, including SQLite `-wal` / `-shm` sidecar files
- **Fallback compatibility** — [Crucial] older data directories remain readable during the transition so existing users do not hit a blank or empty state after the 1.2.0 path change

#### Widget Center / Registry

- **Widget Center pet section** — the widget marketplace now surfaces the pet widget more prominently alongside the official widget catalog
- **Widget registry alignment** — built-in pet registry sizing was aligned with the new default pet window dimensions

### Changed

#### Local API and Sync Flow

- **Local API status payload expanded** — `/api/status` now advertises whether extension bridge authentication is required so clients can decide whether to send signed traffic
- **Signed request flow tightened** — both extensions only attach signatures when the desktop API explicitly declares support, preventing bridge-key traffic from reaching older app builds

#### Settings UX

- **Settings bridge section** — the desktop Settings page now shows the bridge key in full, supports one-click copy, and lets users rotate the key without leaving the page
- **Browser and VS Code key UX** — both extensions now emphasize that the bridge key can be updated after initial save instead of being a one-time setup

#### Default Widget Behavior

- **Pet widget startup size** — the pet widget defaults were updated in both registry metadata and tray-based widget creation paths so new windows open at a more natural size

### Fixed

- Fixed browser and VS Code extensions sending bridge signatures to older desktop API versions that did not support key-based auth
- Fixed pet widget sizing being too tight for the richer built-in manifest-based UI
- Fixed legacy Windows users from landing on an empty database path after the app data migration change
- Fixed the browser extension key field being hidden after save, which made updating the saved key awkward


## [1.2.0] - 2026-05-10

### Added

#### Settings Experience

- New **Settings card hub** — the settings page now opens into a card-based section picker instead of a single long scroll view
- **Settings search** — quickly filter settings sections by keyword
- Platform-aware visibility — unsupported settings are hidden automatically on macOS, Windows, or Linux instead of being shown in a disabled state

#### Browser Extension Access

- **Browser extension download entry** — added a download button that navigates to the browser extension download page
- **Browser usage extension settings panel** — browser extension controls moved into a dedicated settings panel opened from the Browser Usage page

#### VS Code Integration

- **VS Code extension download entry** — added a download button that navigates to the VS Code extension download page
- **VS Code extension unavailable fallback** — when the extension is not open, the app now degrades gracefully and shows a clear notification instead of failing noisily

#### Release Workflow

- **Release version consistency guard** — release automation now checks that the git tag, `package.json`, and `src-tauri/tauri.conf.json` versions match before publishing
- **Windows MSIX packaging** — release workflow now builds a `.msix` package and uploads it to the GitHub release

### Changed

#### Data Management

- **Data settings simplified** — the Data section now focuses on excluding applications, while export/import actions were moved into Backup & Restore
- **Backup & Restore v2** — file selection was fixed so backup packages can be opened and restored reliably
- **Data Health Center** — repair now shows visible loading/error states and no longer feels frozen during long-running operations

#### Repair and Reliability

- **Data repair flow** — repair now pauses monitor writes during the rebuild step to avoid lock contention and timeout-like behavior
- **Repair scope expanded** — repair also restores missing core indexes in addition to rebuilding daily aggregates

#### App Infrastructure

- **Version sync** — app version values were synchronized across the frontend version display, packaging config, and MSIX build script
- **Windows packaging script** — MSIX build logic was updated to find SDK tools more robustly and generate a manifest when one is missing

### Fixed

- Fixed the Data Health Center repair button appearing to do nothing in some environments
- Fixed backup package file selection for Backup & Restore v2
- Fixed release packaging failures caused by version mismatches and missing MSIX artifacts
- Reduced noise from unavailable optional integrations by using soft-degradation behavior

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

