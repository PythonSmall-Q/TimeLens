# Changelog

All notable changes to TimeLens are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [0.1.0][0.1.0]

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

[0.1.0]: https://github.com/PythonSmall-Q/TimeLens/releases/tag/v0.1.0
