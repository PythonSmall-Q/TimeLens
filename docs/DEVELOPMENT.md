# Development Guide

This document covers everything needed to set up a full development environment, understand the architecture, and debug common issues.

---

## Prerequisites

| Tool | Minimum version | Install |
|------|----------------|---------|
| Node.js | 18 | https://nodejs.org |
| Rust | 1.77 | https://rustup.rs |
| Tauri CLI | 2.x | `cargo install tauri-cli --version "^2"` |
| WebView2 (Windows) | Any | Bundled with Windows 11; [standalone installer](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) for Windows 10 |
| Xcode CLI Tools (macOS) | Latest | `xcode-select --install` |

---

## Setup

```bash
git clone https://github.com/PythonSmall-Q/TimeLens.git
cd TimeLens
npm install
```

### Start dev mode

```bash
npm run tauri:dev
```

This starts the Vite dev server on `http://localhost:1420` and opens the Tauri window. Hot module replacement (HMR) works for all frontend code; Rust changes require a full restart.

---

## Architecture Overview

```
┌─────────────────────────────────────────────┐
│  Tauri Process (Rust)                        │
│                                              │
│  ┌──────────────┐  ┌──────────────────────┐ │
│  │  monitor/    │  │  db/ (SQLite)        │ │
│  │  (tokio task)│  │  app_usage           │ │
│  │  Win32/      │  │  todos               │ │
│  │  AppleScript │  │  widget_configs      │ │
│  └──────┬───────┘  └──────────┬───────────┘ │
│         │  emit events        │ queries      │
│  ┌──────▼───────────────────┐ │             │
│  │  commands/ (invoke)      ◄─┘             │
│  │  monitor_cmd.rs          │               │
│  │  storage_cmd.rs          │               │
│  │  widget_cmd.rs           │               │
│  └──────┬───────────────────┘               │
└─────────│─────────────────────────────────-─┘
          │ IPC (invoke / emit)
┌─────────▼────────────────────────────────────┐
│  React Frontend (WebView)                     │
│                                               │
│  App.tsx → window label detection             │
│    "main"    → MainApp (HashRouter)           │
│    "clock-*" → WidgetWindow<Clock>            │
│    "todo-*"  → WidgetWindow<Todo>             │
│    "timer-*" → WidgetWindow<Timer>            │
│                                               │
│  stores/  → Zustand (statsStore, widgetStore, │
│             settingsStore)                    │
│  services/ → tauriApi.ts wrappers            │
└──────────────────────────────────────────────┘
```

---

## Key Files

| File | Purpose |
|------|---------|
| `src-tauri/src/lib.rs` | App setup, DB init, tray, monitor start, window restore |
| `src-tauri/src/monitor/mod.rs` | Background window polling + DB writes |
| `src-tauri/src/db/mod.rs` | All SQLite schema + queries |
| `src/App.tsx` | Window label → component routing |
| `src/MainApp.tsx` | Main dashboard shell + event listeners |
| `src/i18n/config.ts` | i18next init; add languages here |

---

## Debugging

### Rust logs
Set `RUST_LOG=debug` before running:
```powershell
$env:RUST_LOG = "debug"; npm run tauri:dev   # Windows PowerShell
RUST_LOG=debug npm run tauri:dev             # macOS / bash
```

### Frontend DevTools
Press `F12` inside any Tauri window (dev build only).

### SQLite inspection
The database lives at:
- Windows: `%APPDATA%\com.timelens.app\timelens.db`
- macOS: `~/Library/Application Support/com.timelens.app/timelens.db`

Open with any SQLite viewer (e.g., [DB Browser for SQLite](https://sqlitebrowser.org/)).

### Widget windows not appearing
Check that the window label matches the pattern in `capabilities/default.json` (`clock-*`, `todo-*`, `timer-*`).

---

## Scripts Reference

```bash
npm run dev          # Vite dev server only (no Tauri)
npm run build        # Frontend production build
npm run tauri:dev    # Full Tauri dev mode
npm run tauri:build  # Full production build
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm run format       # Prettier write
npm run test         # Vitest (when tests are added)
```

---

## Adding Tests

Frontend tests go in `src/__tests__/` and use Vitest + @testing-library/react.  
Rust unit tests live alongside their modules (`#[cfg(test)] mod tests { … }`).

Run:
```bash
npm run test           # frontend
cd src-tauri && cargo test  # Rust
```
