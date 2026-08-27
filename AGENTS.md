# TimeLens Agent Guide

This document helps AI agents contribute to TimeLens safely and consistently.

## Project Overview

TimeLens is a local-first screen-time tracker and desktop widget platform built with:

- **Frontend**: React + TypeScript + Vite + Tailwind CSS
- **Desktop host**: Tauri v2 + Rust
- **Database**: SQLite (local only, no cloud)
- **Extensions**: Browser extension (Edge/Chrome), VS Code extension

The project root contains the web frontend. The Tauri backend lives in `src-tauri/`.

## Quick Commands

Always run these after non-trivial changes:

```bash
npm run typecheck      # TypeScript check
npm run lint           # ESLint (expect 8 pre-existing warnings)
npm run test           # Frontend unit tests
```

For Rust/backend changes (run from `src-tauri/`):

```bash
cargo test
cargo check
```

For a full release build:

```bash
npm run tauri:build
```

## Architecture

### Frontend (`src/`)

- `src/pages/` — Full-page views (Dashboard, Settings, Focus Mode, Widget Center, etc.)
- `src/widgets/` — First-party widget UIs (Todo, Note, Pet, Focus Coach, etc.)
- `src/components/` — Shared reusable components
- `src/hooks/` — Shared React hooks
- `src/stores/` — Zustand state stores
- `src/services/tauriApi.ts` — All Tauri command wrappers
- `src/services/llmApi.ts` — LLM streaming and screen-time context builder
- `src/types/index.ts` — Shared TypeScript types
- `src/types/llm.ts` — LLM provider, config, conversation types
- `src/i18n/locales/` — Translation JSON files (`en`, `zh-CN`, `zh-TW`, `ja`, `ko`, `de`, `fr`, `es`)
- `src/styles/globals.css` — Tailwind entry + custom glassmorphism utilities

### Backend (`src-tauri/src/`)

- `commands/` — Tauri command handlers
- `db/` — SQLite schema, migrations, and query helpers
- `db/llm_conversations.rs` — Persisted AI conversation storage
- `llm/` — Local LLM config (TOML) and provider model
- `models/` — Shared Rust data models
- `monitor/` — Active window / screen-time monitoring
- `widget_registry.rs` — Widget manifest loading and normalization

### Widgets

Widgets are loaded as separate Tauri webview windows. Official widgets live in `src/widgets/`. Third-party widgets can be imported from local directories.

Each widget receives a `widgetId` prop. Use it to namespace `localStorage` keys (e.g. `${widgetId}-notes`).

## Conventions

### Code Style

- Use **functional components** and hooks.
- Prefer `clsx` for conditional class names.
- Keep UI text in `i18n` JSON files; never hardcode user-facing strings.
- Add new i18n keys to `en` and `zh-CN` first; use English stubs for other languages unless you can translate accurately.
- Use the existing `glass-card`, `ui-field`, `ui-checkbox`, `btn-primary` utilities instead of inventing new styles.

### Backend

- Tauri commands return `Result<T, String>` for user-facing errors.
- Database access goes through `DbState` (a `Mutex<Connection>`).
- New tables need a migration in `src-tauri/src/db/migrations.rs`.
- When changing Rust models, update any hand-constructed instances in tests and commands.

### Cross-Window Events

Inside a widget, `window.dispatchEvent` only reaches the same window. To notify other widget windows or the main app, use Tauri events:

```ts
import { emit } from "@tauri-apps/api/event";
import { listen } from "@tauri-apps/api/event";
```

### Error Handling in Widgets

Use the `useWidgetErrorReporter` hook to automatically record unhandled errors to the per-widget error log:

```ts
import { useWidgetErrorReporter } from "@/hooks/useWidgetErrorReporter";

export default function MyWidget({ widgetId }: Props) {
  useWidgetErrorReporter(widgetId);
  // ...
}
```

## Localization Checklist

When adding user-facing text:

1. Add key to `src/i18n/locales/en/<namespace>.json`
2. Add key to `src/i18n/locales/zh-CN/<namespace>.json`
3. Add English stub to `src/i18n/locales/{es,de,fr,ko,ja,zh-TW}/<namespace>.json`

Namespaces include: `common`, `dashboard`, `widgets`, `settings`, `limits`, `categories`, `goals`, `focus`, `browserUsage`, `llm`.

## Version Bumps

When bumping the app version, update all of these:

- `package.json`
- `package-lock.json` (top-level + root package entries)
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.lock` (run `cargo update -p timelens` from `src-tauri/`)
- `src-tauri/windows/Package.appxmanifest`
- `CHANGELOG.md`

The `src/version.ts` file re-exports `package.json` version, so it does not need manual editing.

## Common Pitfalls

- **Date parsing**: Backend stores local datetimes as `YYYY-MM-DDTHH:MM:SS`. Parsing with `new Date()` can interpret them as UTC and shift by the local timezone offset. Use a local-component parser when computing durations.
- **Dropdown z-index**: `ExePickerInput` and similar popovers may render under later cards. Increase `z-index` on both the wrapper and the popup if needed.
- **Widget window events**: Each widget is its own window; use Tauri `emit`/`listen` for cross-widget communication.
- **Focus rules**: Frontend `FocusRule` does not include `created_at`; the backend model must keep it optional to avoid deserialization failures.
- **Cargo lockfile**: After editing `Cargo.toml`, run `cargo update -p timelens` instead of a full `cargo update` to avoid unnecessary dependency churn.
- **LLM config**: Provider settings live in `llm_config.toml` in the app data directory. API keys are stored locally in plain text; never log or expose them.
- **LLM conversations**: Conversations are persisted in SQLite (`llm_conversations` table, migration 013). New tables need a migration in `src-tauri/src/db/migrations.rs`.
- **Analysis context**: `buildScreenTimeContext` respects `LlmDataSharing` flags and `AnalysisRange`. When adding new data sources, expose them through both the data-sharing toggle and the context builder.

## Release Notes

Add a new section to `CHANGELOG.md` for every version bump. Follow the existing Keep a Changelog format with `Added`, `Changed`, and `Fixed` subsections.
