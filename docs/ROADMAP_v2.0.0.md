# TimeLens Roadmap to v2.0.0 (Local-First)

Last updated: 2026-06-06

## Canonical Source

This file is the single source of truth for the TimeLens local-first roadmap.
Legacy planning notes from `docs/ROADMAP_FROM_1.4.3.md` are merged into the post-v2.0 outlook section in this document.

## Vision

Build TimeLens into a stable, extensible, privacy-first personal productivity desktop platform while keeping all user data local.

## Non-Negotiable Principles

- No cloud account system.
- No cloud sync service.
- No telemetry upload by default.
- No user behavior data leaves the local device unless explicitly exported by the user.
- Core data remains in local SQLite (with optional encrypted backup file export/import).

## Scope Boundaries

### In Scope

- Local analytics and insights.
- Local API for extensions and local tools (localhost only by default).
- Local plugin/widget ecosystem with strict permission sandboxing.
- Data portability (local JSON/CSV/export package).

### Out of Scope

- Any hosted backend dependency for core features.
- Real-time cross-device cloud sync.
- Cloud-based AI analysis of personal usage data.

## Milestones

### v1.2.0 (Data Reliability and Trust)

Target window: 2026 Q2

### Product Goals

- Make local data more reliable, diagnosable, and recoverable.
- Expose data collection behavior to users in a transparent and understandable way.

### Planned Features (Detailed)

- Data Health Center:
  - Add local database integrity scan (schema check, index check, orphan row check).
  - Add timeline continuity check (detect missing days, abnormal zero-usage gaps).
  - Add repair assistant with dry-run preview before applying any fix.
- Backup and Restore v2:
  - Export to compressed package (`.timelens-backup`) with manifest metadata.
  - Store app version, schema version, locale, and checksum in package manifest.
  - Add import compatibility checker and conflict handling strategy (overwrite/merge/new profile).
- Data Retention Policy:
  - Add retention presets (3 months, 6 months, 12 months, keep all).
  - Add auto-archive task for old raw records into local archive tables/files.
  - Add retention impact preview (estimated storage saved before applying).
- Tracking Transparency Panel:
  - Show currently tracked process/window fields in plain language.
  - Show write frequency and last N local writes.
  - Add one-click pause + reason display (who paused, when paused, why tracking stopped).

### Engineering Breakdown

- Frontend:
  - Add `DataHealth` page/module and cards in Settings.
  - Add restore wizard UI (validate -> preview -> execute -> result report).
  - Add retention policy controls with warning and undo guidance.
- Backend (Rust Commands):
  - Add `check_data_integrity`, `scan_data_gaps`, `repair_data_issues` commands.
  - Add `export_backup_v2`, `import_backup_v2_validate`, `import_backup_v2_apply` commands.
  - Add `set_retention_policy`, `run_local_archive_now` commands.
- Data Layer:
  - Add backup metadata schema and checksum validation.
  - Add archive tables/indexes for old usage slices.
  - Add migration guardrails and rollback markers.

### QA and Validation

- Run migration forward/backward tests on sample datasets from v1.0.0 and v1.1.0.
- Validate backup round-trip with small, medium, and large datasets.
- Validate repair workflow with intentionally corrupted sample data.
- Verify all flows work with network disabled.

### Exit Criteria

- 100k+ records keep main dashboard interactions under acceptable latency targets.
- Backup restore round-trip succeeds with checksum verification.
- All data health checks and repairs are local-only and auditable in UI.

### v1.4.0 (Local Intelligence and Workflow)

Target window: 2026 Q3

### Product Goals

- Upgrade insights from descriptive metrics to actionable local coaching.
- Help users turn insights into repeatable daily habits.

### Planned Features (Detailed)

- Local Recommendation Engine:
  - Generate focus-window suggestions based on historical uninterrupted blocks.
  - Detect distraction hotspots using app-switch density and short-session ratio.
  - Recommend goal adjustments (too easy, too hard, realistic stretch).
- Advanced Comparison:
  - Add week-over-week and month-over-month drill-down by app/category/project.
  - Add anomaly markers (spike/drop) with explanation text.
  - Add "what changed" summary cards for recent 7/30 days.
- Local Rule Automation:
  - Add rules for auto pause/resume tracking in user-defined contexts.
  - Add local notifications for goal risk alerts and limit pre-alerts.
  - Add quiet hours and reminder cooldown controls.
- Unified Timeline:
  - Merge desktop and browser sessions into one local chronological stream.
  - Add filters by source/app/domain/category and interruption markers.

### Engineering Breakdown

- Frontend:
  - New insight cards and explainability panels on Dashboard.
  - Rule builder UI with simulation mode.
  - Unified timeline viewer with virtualized list rendering.
- Backend (Rust Commands):
  - Add deterministic scoring and suggestion commands.
  - Add comparative analytics commands with baseline windows.
  - Add local automation scheduler and rule evaluator.
- Data Layer:
  - Add derived metrics tables for switch density, focus streak, interruption count.
  - Add incremental aggregation jobs to avoid full-range heavy queries.

### QA and Validation

- Golden dataset tests for recommendation determinism.
- Property-based tests for aggregation correctness.
- Performance tests for 365-day timeline rendering and query latency.
- Verify explainability text always maps to concrete local factors.

### Exit Criteria

- Insight generation and rule evaluation are fully available offline.
- Median dashboard load time improves compared with v1.1.0 baseline.
- Users can see why each recommendation was made (no black-box outputs).

### v1.6.0 (Widget and Extension Platform Maturity)

Target window: 2026 Q4

### Product Goals

- Make extensibility safe-by-default and predictable for third-party developers.
- Keep all extension data exchange local, explicit, and permissioned.

### Planned Features (Detailed)

- Widget Permission Model v2:
  - Split permissions into read metrics, write data, automation trigger, and local API call.
  - Add runtime permission revocation with immediate effect.
  - Add per-permission risk labels and last access timestamp.
- Widget SDK Stabilization:
  - Publish manifest spec `v2` and compatibility policy.
  - Provide local dev harness for widget preview and permission simulation.
  - Add official template upgrades and migration guide from old manifests.
- VS Code Extension Integration:
  - Improve local session attribution accuracy for workspace/language.
  - Add coding focus indicators to TimeLens dashboard.
  - Add extension-side buffering for intermittent local API unavailability.
- Local API Governance:
  - Add scoped localhost tokens and revocation list.
  - Add per-client allowlist and rate limits.
  - Add local API audit log view in settings.

### Engineering Breakdown

- Frontend:
  - Permission center redesign with per-widget capability matrix.
  - SDK docs portal updates and troubleshooting section.
  - API client manager UI for localhost consumers.
- Backend (Rust Commands/API):
  - Introduce capability-aware permission middleware.
  - Add token issue/rotate/revoke command set.
  - Add audit log query commands with pagination.
- Security:
  - Strengthen signature verification and checksum mismatch handling.
  - Enforce default-deny policy for third-party capabilities.

### QA and Validation

- Contract tests for widget API backward compatibility.
- Security tests for permission bypass and token misuse scenarios.
- Regression tests for official widgets under new permission model.
- Localhost API disable mode test across extension and widgets.

### Exit Criteria

- Third-party widget onboarding path is documented and stable.
- Permission revoke applies without app restart.
- Local API can be disabled entirely and core app remains functional.

### v2.0.0 (Local-First Platform Release)

Target window: 2027 Q1

### Product Goals

- Deliver a polished and reliable local-first productivity platform release.
- Make privacy guarantees testable, visible, and enforceable.

### Planned Features (Detailed)

- Unified Insight Workspace:
  - Introduce narrative dashboards (daily review, weekly reflection, goal health).
  - Enable cross-module drill-down from summary -> category -> app -> session.
  - Add advanced date-range exploration with saved local views.
- Privacy and Security Upgrade:
  - Provide optional encryption-at-rest for local database.
  - Add passphrase-protected backup export.
  - Consolidate all capability toggles in a single permission/security center.
- Long-Term Data Lifecycle:
  - Introduce archival tiers (hot/warm/archive) managed locally.
  - Add historical compression options for old high-frequency records.
  - Add restore preview and diff summary before apply.
- Platform Quality:
  - Guarantee migration path from supported 1.x versions.
  - Improve startup latency and reduce memory overhead on large datasets.
  - Complete accessibility and localization quality pass.

### Engineering Breakdown

- Frontend:
  - Dashboard IA refinement and reusable analytics component system.
  - Permission and privacy center final redesign.
  - Improved empty/error/loading states for all core pages.
- Backend:
  - Encryption key lifecycle management (local only).
  - Unified migration runner with pre-check and post-verify phases.
  - Performance tuning for top N heavy queries and startup command path.
- Release Engineering:
  - Add upgrade rehearsals from representative 1.x snapshots.
  - Add offline test matrix in CI for critical user journeys.

### QA and Validation

- Full end-to-end offline scenario testing across dashboard, widgets, backup, restore, and extension integration.
- Security checklist verification for local storage, permission boundaries, and API exposure.
- Long-run stability tests (multi-day local logging workload).
- Accessibility checks for keyboard navigation and screen reader critical flows.

### Release Gates (Must Pass)

- Full offline usability for all primary user journeys.
- Zero mandatory cloud dependency in architecture and runtime.
- No hidden external upload channel for usage data.
- Migration from supported 1.x versions passes integrity checks.
- End-to-end privacy checklist is publicly documented.

## Post-v2.0 Outlook (Merged)

### v2.2.0 (2026 Q3) - Widget Workflow Expansion

- Upgrade Widget Center into a high-frequency workflow entry surface.
- Add scenario presets and one-click layout switching.
- Add widget performance observability with local fallback strategies.

### v2.4.0 (2026 Q4) - Focus and Goal Execution

- Convert insights into executable daily plans.
- Add goal coaching, session review summaries, and anti-distraction policies.
- Expand official workflow widgets for planning and review loops.

### v2.6.0 (2027 Q1) - Developer Ecosystem and Governance

- Improve third-party widget developer workflow with SDK and local debugging.
- Strengthen permission governance and localhost API auditing.
- Introduce widget quality scoring for startup, stability, and resource usage.

### v3.0.0 (2027 Q2) - Local-First Productivity Platform

- Complete the loop of insight, planning, execution, and reflection.
- Expand local automation and long-term data lifecycle controls.
- Finish accessibility and localization quality coverage.

## Governance and Decision Rules

- Any new feature proposal must include a local-first data flow design.
- Any network capability must be optional, explicit, and disabled by default unless required for user-requested actions (for example manual update checks).
- If a feature cannot deliver meaningful value without cloud processing, it is deferred or rejected for the 2.0 scope.

## Risks and Mitigations

- Risk: local dataset growth slows queries.
  - Mitigation: incremental aggregation, index tuning, archive strategy.
- Risk: plugin ecosystem introduces safety concerns.
  - Mitigation: permission sandboxing, signature checks, stricter defaults.
- Risk: feature growth reduces maintainability.
  - Mitigation: modular command boundaries, contract tests, release hardening cycles.

## Tracking KPIs (Local Measurable)

- Cold start time and dashboard first-render time.
- Query latency at dataset sizes: 10k, 100k, 1M records.
- Crash-free sessions rate.
- Backup/restore success rate.
- Permission prompt acceptance/revocation clarity (UX metric via local feedback prompt).

## Communication Plan

- Publish roadmap updates every minor release.
- Keep changelog and roadmap cross-referenced for traceability.
