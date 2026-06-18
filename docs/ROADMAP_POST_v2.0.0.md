# TimeLens Roadmap Post-v2.0.0 (Extension Platform)

Last updated: 2026-06-13

## Canonical Source

This file is the single source of truth for TimeLens planning **after** the v2.0.0 local-first platform release.

For the roadmap **up to and including** v2.0.0, see `docs/ROADMAP_v2.0.0.md`.

## Vision

Evolve TimeLens from a local-first personal productivity desktop app into a trustworthy, offline extension platform where users and third-party developers can build privacy-preserving tools for insight, planning, execution, and reflection — without any user data leaving the device.

## Non-Negotiable Principles

- No cloud account system.
- No cloud sync service.
- No telemetry upload by default.
- No user behavior data leaves the local device unless explicitly exported by the user.
- Core data remains in local SQLite.
- Extension network access is **off by default** and requires explicit, revocable permission.

## Scope Boundaries

### In Scope

- Local widget runtime and direct data access APIs.
- Multi-language extension model (JavaScript/TypeScript and Rust).
- Local extension catalog, developer tooling, and quality signals.
- Unified extension platform with panels, tool windows, background scripts, and user-programmable workflows.

### Out of Scope

- Any hosted backend dependency for core features.
- Real-time cross-device cloud sync.
- Cloud-based AI analysis of personal usage data.
- Remote extension store or remote code delivery.

---

## v2.2.0 (2027 Q2) — Widget Runtime and Direct Information Access

### Product Goals

- Allow widgets to directly query structured local information without routing every call through the dashboard UI.
- Establish a safe, capability-gated runtime where widgets can react to data changes in real time.
- Improve widget reliability and user control over widget behavior.

### Planned Features (Detailed)

#### Widget Direct Invocation API

- Expose read-only queries for:
  - Aggregated metrics (daily, weekly, monthly).
  - Raw and summarized sessions.
  - Categories, projects, and tags.
  - Goals and rule execution status.
- Allow widgets to subscribe to local data streams:
  - Current focus session start/end.
  - Goal progress ticks and limit warnings.
  - Rule trigger events and automation outcomes.
  - Idle/return notifications.
- Enforce per-widget allowlists for which data namespaces can be read.
- Provide typed query helpers and runtime validation.

#### In-Process Widget Runtime

- Run official widgets inside a lightweight sandbox with capped CPU and memory budgets.
- Add crash isolation so a failing widget cannot destabilize the main window.
- Provide local fallback content when a widget exceeds its resource quota or crashes repeatedly.
- Add per-widget process health indicator in the Widget Center.

#### Widget State and Lifecycle

- Add background/foreground lifecycle events for widgets.
- Add local state persistence scoped to each widget, automatically cleared on uninstall.
- Add "pause updates" and "refresh now" controls from the Widget Center.
- Add per-widget error log viewer for debugging.

#### User Experience Improvements

- Widget permission matrix in Settings showing exact data namespaces accessed.
- In-product explanation of why a widget needs each permission.
- One-click reset of all widget local state and permissions.

### Engineering Breakdown

- Frontend:
  - Widget container with sandboxed iframe / webview and secure message bridge.
  - Widget Center redesign with runtime status, pause/resume, and error logs.
  - Settings permission matrix for widget data namespaces.
- Backend (Rust):
  - Add `widget_query`, `widget_subscribe`, and `widget_unsubscribe` commands.
  - Enforce query-time permission checks and per-widget rate limits.
  - Add widget resource monitor and kill logic.
- SDK:
  - Ship `timelens-widget-sdk` TypeScript package with typed query helpers and lifecycle hooks.
  - Publish SDK reference documentation and sample widgets.

### QA and Validation

- Contract tests for widget query and subscription APIs.
- Crash and resource-quota tests for misbehaving widgets.
- Verify widget pause/resume does not leak subscriptions or memory.
- Test offline operation with no network access for widgets.

### Exit Criteria

- Official widgets can read metrics and react to session changes without dashboard interaction.
- Widget crashes are isolated and do not require an app restart.
- Users can see exactly which data namespaces each widget accesses.

---

## v2.4.0 (2027 Q3) — Multi-Language Extension Model

### Product Goals

- Let developers write extensions in Rust, JavaScript, or TypeScript and run them side-by-side with core widgets.
- Gradually evolve the widget system toward an Edge-like extension platform with background scripts, content scripts, and manifest-based capabilities.
- Maintain strict default-deny security for all extension capabilities.

### Planned Features (Detailed)

#### Extension Manifest v3 (Edge-like)

- Manifest schema with:
  - `permissions`: data access, automation, notifications, storage, clipboard, system (read-only).
  - `host_permissions`: localhost-only by default; no external hosts without explicit user grant.
  - `background`: persistent or event-driven background script entry.
  - `content_scripts`: injection rules for local app surfaces (if applicable).
  - `action`: toolbar button, side panel, and keyboard shortcut declarations.
- Extension identity, versioning, update URL (local/offline only), and icon resources.
- Default-deny permission model with explicit user grants and revocation.

#### Multi-Language Extension Runtime

- JavaScript/TypeScript extensions run in a Deno-like sandbox with:
  - Limited standard library.
  - No network by default.
  - Capability-gated access to `timelens.*` APIs.
- Rust extensions run as isolated native plugins via Tauri sidecar / plugin ABI with strict capability gating.
- Unified message bus so JS and Rust extensions can communicate with widgets and the core app.

#### Background Scripts and Event Model

- Background tasks for extensions, e.g.:
  - React to session start/end.
  - Schedule local automations.
  - Trigger notifications based on local rules.
- Event-driven architecture with events such as:
  - `onSessionChange`
  - `onGoalTick`
  - `onFocusLock`
  - `onIdleReturn`
- Throttled event delivery to prevent battery and CPU drain.
- Background script lifecycle: install, startup, suspend, resume, uninstall.

#### Extension API Surface

- `timelens.*` API namespaces:
  - `metrics`: read aggregated metrics.
  - `sessions`: read session data with filters.
  - `goals`: read goal progress and receive tick events.
  - `rules`: read rules and trigger custom automations.
  - `notifications`: show local notifications.
  - `storage`: per-extension local storage, capped in size, exportable with backups.
  - `clipboard`: read/write clipboard (explicit permission).
  - `system`: read-only system info (OS version, locale, timezone — explicit permission).
- Async Promise-based API for JS/TS; async callback / stream API for Rust.
- Local storage API isolated per extension, capped in size, and exportable with backups.

#### Extension Installation and Management

- Install extension from local file (`.timelens-extension` package).
- Enable/disable extensions without uninstalling.
- View extension permissions, logs, and resource usage.
- Uninstall with optional "remove all extension data" confirmation.

### Engineering Breakdown

- Frontend:
  - Extension manager UI: install, enable/disable, permissions, logs, uninstall.
  - Extension store preview (offline, curated local JSON index).
  - Toolbar and side-panel surfaces for extension actions.
- Backend:
  - Rust extension host process with IPC bridge and capability enforcement.
  - JS/TS runtime built on top of the widget sandbox; shared event dispatcher.
  - Extension registry, version resolution, and signature verification.
- Security:
  - Mandatory code signing for third-party extensions.
  - Runtime permission revocation with immediate IPC cutoff.
  - Resource quotas: memory, CPU time, storage, and event frequency.

### QA and Validation

- Contract tests for each `timelens.*` API namespace.
- Security tests for permission bypass and signature tampering.
- Mixed-load tests with JS/TS and Rust extensions running together.
- Verify no network access without explicit user grant.

### Exit Criteria

- Developers can install and run JS/TS and Rust extensions locally.
- Extensions cannot access data outside their granted permissions.
- Background scripts receive and respond to local events correctly.

---

## v2.6.0 (2027 Q4) — Extension Ecosystem and Governance

### Product Goals

- Build a trustworthy extension ecosystem while keeping every data flow local.
- Provide developer tooling and quality signals comparable to a lightweight browser extension store.
- Give users clear visibility into extension behavior and enforcement tools.

### Planned Features (Detailed)

#### Developer Tooling

- Local extension dev harness with:
  - Hot reload during development.
  - Mock data and simulated permissions.
  - Console and log viewer.
  - Package validator for manifest, signing, and resource limits.
- CLI scaffolding (`npm create timelens-extension`) for JS/TS and Rust templates.
- Extension test runner with:
  - Contract tests.
  - Permission-bypass tests.
  - Resource-quota tests.
- Local documentation server with live API reference and samples.

#### Quality and Discovery

- Extension quality score based on:
  - Startup time.
  - Crash rate.
  - Resource usage.
  - User feedback (local-only).
- Local extension catalog shipped as an offline JSON bundle:
  - Curated list of official and community extensions.
  - Search and filter by category, language, and permission risk.
  - No remote server required.
- User ratings and optional local-only telemetry for extension performance diagnostics.

#### Governance

- Extension audit log:
  - Permission grants and revocations.
  - Data access events (namespace, timestamp, extension name).
  - Background task executions.
  - Network capability usage (if any).
- Policy enforcement:
  - Mandatory privacy label for every extension.
  - No external network by default.
  - Explicit opt-in for any network call with per-domain allowlist.
- Review checklist and automated static analysis for submitted extensions.
- Kill switch and quarantine for extensions that violate policy or exceed quotas.

#### User Controls

- Redesigned Widget/Extension Center with tabs for Widgets, Extensions, Store, and Developer.
- Audit log viewer with filters and export to local file.
- Bulk permission review wizard.
- Recommendation to disable unused or high-risk extensions.

### Engineering Breakdown

- Frontend:
  - Redesigned Widget/Extension Center.
  - Audit log viewer with filters and export.
  - Quality score and privacy label rendering.
- Backend:
  - Extension telemetry pipeline (local aggregation only, no upload).
  - Static analyzer for manifest and permission usage.
  - Quota enforcement and kill switch for misbehaving extensions.
- Documentation:
  - Extension development guide.
  - API reference.
  - Sample extensions for common use cases.

### QA and Validation

- Static analysis test suite with good/bad manifest samples.
- Audit log completeness tests for all permissioned actions.
- Kill-switch response-time tests.
- Community extension simulation (local catalog load, install, run, uninstall).

### Exit Criteria

- Developer can scaffold, test, and package an extension locally.
- Users can browse, install, and review extensions without any network call.
- Audit log captures every permissioned data access.

---

## v3.0.0 (2028 Q1) — Local-First Productivity Extension Platform

### Product Goals

- Complete the transition from a widget system to a full local-first extension platform modeled after Edge/Chrome extensions, but offline and privacy-preserving.
- Make insight, planning, execution, and reflection programmable by users and trusted third-party developers.
- Provide a stable, long-term platform contract with graceful backward compatibility.

### Planned Features (Detailed)

#### Unified Extension Platform

- Single manifest and runtime for:
  - Widgets.
  - Panels.
  - Tool windows.
  - Background automations.
- Support for:
  - Toolbar buttons.
  - Side panels.
  - Context menus.
  - Keyboard shortcuts backed by extensions.
- Unified permission/security center covering widgets and extensions.
- Extension surface theming aligned with TimeLens appearance settings.

#### User-Programmable Workflows

- Built-in rule/visual editor can invoke extension-provided actions.
- Users can compose automations from core features and installed extensions without writing code.
- Workflow primitives:
  - Trigger: time, event, idle/return, goal state, session change.
  - Condition: data threshold, category active, time of day.
  - Action: notification, focus lock, rule enable/disable, extension action call.
- Optional TypeScript-based "user scripts" for advanced personalization.
- Local workflow import/export and backup inclusion.

#### Platform Maturity

- Stable extension ABI/API contract with documented backward-compatibility policy.
- Encrypted extension storage included in backup/restore.
- Performance budgets and graceful degradation when many extensions are installed.
- Accessibility and localization parity for all extension surfaces.
- Long-term archive compatibility for extension data.

#### Discovery and Trust

- Verified publisher badges using local-only signature verification.
- Extension reputation signals based on local usage and user feedback.
- Suggested extensions based on local usage patterns (no data leaves device).

### Engineering Breakdown

- Frontend:
  - Refactor Widget Center into Extensibility Hub.
  - Reusable extension surface components: panel, badge, notification, modal, toolbar button.
  - Visual workflow editor with drag-and-drop trigger/condition/action blocks.
- Backend:
  - Hardened multi-process extension host with crash recovery.
  - Unified capability token system for widgets and extensions.
  - Long-term archive compatibility for extension data.
  - Workflow engine with execution tracing and rollback.
- Release Engineering:
  - Extension API deprecation and migration guides.
  - Long-run stability tests with mixed JS/TS and Rust extensions.
  - v2.x widget adapter layer validation.

### QA and Validation

- End-to-end tests for user-programmable workflows.
- Accessibility checks for all extension surfaces.
- Long-run stability tests with 20+ extensions installed.
- Backward-compatibility tests for v2.x widgets running on v3.0 runtime.

### Release Gates (Must Pass)

- All data access remains local unless the user explicitly triggers an export.
- Network access for extensions is off by default and requires explicit, revocable permission.
- Rust and JavaScript/TypeScript extensions share the same capability and audit model.
- Backward compatibility for v2.x widgets is maintained through an adapter layer.
- Extension storage is included in encrypted backup/restore.

---

## v3.x Outlook (2028+)

The following themes are under consideration for post-v3.0 releases. They will be refined into concrete versions as v3.0 nears completion.

- **Advanced Local Analytics**: Custom charts, derived metrics, and local machine-learning-based insight suggestions (no cloud).
- **Team/Family Local Sharing**: Optional peer-to-peer or LAN-only data sharing with end-to-end encryption; never a cloud backend.
- **Mobile Companion**: Local data export/import to a mobile companion app; no sync service.
- **Marketplace Quality Programs**: Verified extension tiers, local-only ratings, and automated security scanning.

---

## Cross-Version Principles

- All data access remains local unless the user explicitly triggers an export.
- Network access for extensions is off by default and requires an explicit, revocable permission.
- Rust and JavaScript/TypeScript extensions share the same capability and audit model.
- Backward compatibility for v2.x widgets is maintained through an adapter layer in v3.0.
- Every permissioned action must be auditable in the local audit log.

## Governance and Decision Rules

- Any new feature proposal must include a local-first data flow design.
- Any network capability must be optional, explicit, and disabled by default unless required for user-requested actions (for example manual update checks).
- If a feature cannot deliver meaningful value without cloud processing, it is deferred or rejected for the post-2.0 scope.
- Every new API or permission must have a documented use case, risk label, and revocation path.

## Risks and Mitigations

- Risk: extension ecosystem introduces safety concerns.
  - Mitigation: permission sandboxing, signature checks, stricter defaults, audit logs, kill switch.
- Risk: multi-language runtime increases maintenance burden.
  - Mitigation: shared message bus, unified capability tokens, strong contract tests.
- Risk: feature growth reduces maintainability.
  - Mitigation: modular command boundaries, contract tests, release hardening cycles.
- Risk: local dataset growth slows queries.
  - Mitigation: incremental aggregation, index tuning, archive strategy from v2.0.

## Tracking KPIs (Local Measurable)

- Extension install/enable/disable/uninstall success rate.
- Median extension startup time.
- Crash-free extension sessions rate.
- Permission grant/revocation clarity (UX metric via local feedback prompt).
- Audit log completeness score in automated tests.
- Query latency at dataset sizes: 100k, 1M, 5M records.

## Communication Plan

- Publish roadmap updates every minor release.
- Share post-v2.0 progress updates via changelog, blog, and in-app release notes.
- Maintain this document as the canonical source for post-v2.0 planning.
