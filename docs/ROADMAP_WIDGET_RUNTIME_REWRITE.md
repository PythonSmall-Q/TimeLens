# TimeLens Widget Runtime Rewrite Roadmap

Last updated: 2026-08-26

Status: Revised roadmap with review decisions folded in. Implementation details are expanded in a separate technical plan.

This document is intentionally more speculative than the main product roadmap. It captures a proposed plan for rewriting the widget foundation so TimeLens can support multi-language external widgets, richer media and network access, and stricter consent-gated access to sensitive user data.

## Review Decisions Incorporated

The following decisions are now assumed by this roadmap and should be treated as the current working direction unless a later RFC changes them:

- Java support remains in scope, but it ships after the JavaScript and TypeScript runtime rewrite is stable.
- JavaScript and TypeScript widgets move onto a rewritten capability gateway and remain the first migration wave.
- External widgets may request network content, images, video, and local usage data, but every such access path is routed through a central gateway rather than exposing raw unrestricted APIs.
- First-time access to any sensitive or external data path requires a user-facing Accept or Deny decision. Deny blocks access immediately and the widget must not silently retry around that decision.
- Network control uses a hybrid model: a firewall-style baseline policy automatically denies high-risk domains and sensitive outbound paths unless they are explicitly approved in Settings, while general lower-risk network classes can be granted at the widget class level through the gateway.
- Full usage-duration access is treated as highly sensitive and requires a dedicated permission group plus an additional confirmation step beyond install-time approval.
- Remote video access remains a separate permission from remote image access.
- Official widgets must use the same gateway prompts during dogfooding, with an internal bypass allowed only in development mode.

## Why This Rewrite Exists

The current widget architecture is good enough for a first-party catalog and basic third-party widgets, but it is not yet the right long-term base for a broader ecosystem.

Current limitations:

- Runtime assumptions are still biased toward JavaScript-only widgets.
- Capability boundaries are present, but the data bridge is not yet designed as a language-agnostic runtime contract.
- Media and network access are not modeled as first-class, consent-gated capabilities.
- Sensitive access to usage data needs a stronger gateway and audit story before external widgets can scale safely.
- Official widgets and third-party widgets still share too much historical behavior and not enough explicit lifecycle structure.

## Initiative Goals

- Rewrite the widget foundation into a language-agnostic runtime platform.
- Support external widgets written in Java, TypeScript, and JavaScript, with room for future runtimes.
- Route all data access through a unified Widget Gateway with auditability, throttling, and consent enforcement.
- Allow external widgets to render and work with images, video, network content, and local usage data without bypassing privacy controls.
- Preserve TimeLens local-first rules even when widgets become more powerful.
- Keep official widgets and external widgets on the same long-term runtime contract wherever practical.

## Non-Goals

- No remote widget store in this initiative.
- No cloud-hosted widget execution.
- No silent network permission grants.
- No raw database access for external widgets.
- No unrestricted filesystem read or write access for external widgets.
- No background data exfiltration path that bypasses user consent.

## Proposed Architecture Direction

### 1. Widget Kernel Rewrite

Replace the current widget execution assumptions with a dedicated kernel responsible for:

- Widget process lifecycle.
- Capability negotiation.
- Consent state lookup.
- Request routing.
- Resource quotas.
- Crash isolation.
- Audit events.
- Compatibility adapters for old widgets.

The kernel should become the only path between a widget and privileged data or external resources.

### 2. Widget Gateway

All widget requests should flow through a Widget Gateway. The gateway is the core trust boundary.

Gateway responsibilities:

- Authenticate the widget instance.
- Resolve manifest-declared capabilities.
- Check previously granted or denied consent.
- Interrupt the request and ask the user for Accept or Deny when consent is missing.
- Log every sensitive access decision and every granted data fetch.
- Enforce rate limits, payload limits, and timeout policies.
- Normalize errors so widgets receive explicit denied, revoked, or throttled responses.

The gateway should mediate these classes of access:

- Local usage metrics and summaries.
- Detailed session and duration data.
- Media acquisition and rendering inputs.
- Network fetches and streams.
- Local API calls.
- Widget-scoped persistent storage.

### 3. Multi-Language Widget Hosts

The rewritten system should treat each language runtime as a host behind the same kernel contract.

#### JavaScript and TypeScript Host

- Sandboxed runtime for ESM-based widgets.
- Typed SDK generated from a shared capability schema.
- No direct fetch, no direct raw local database access, and no direct privileged bridge calls outside the gateway.

#### Java Host

- Dedicated JVM host process per widget or per trust-isolated pool.
- JSON-RPC or protobuf-based bridge between the kernel and the JVM host.
- Manifest metadata declares Java entrypoint, runtime version, memory budget, and packaging metadata.
- Java widgets package business logic in JAR form, while UI rendering can target one of two proposed models:
  - Embedded web UI served locally by the widget host and rendered inside a TimeLens web surface.
  - Native headless logic plus gateway-provided widget shell UI blocks.

Decision note:

- Java widgets support two UI models: embedded web surface and optional host-rendered block UI. Host-rendered blocks are designed as an option, not a requirement for all Java widgets.

### 4. Compatibility Layer

Existing official and third-party widgets should not all break at once.

The rewrite should include:

- Legacy manifest adapter.
- Permission name mapping into the new capability model.
- Compatibility shim for the current widget channel APIs.
- Migration diagnostics that explain why an old widget is degraded or blocked.

## Proposed Capability Model

The rewrite should stop treating permissions as a flat string list and move to grouped capabilities with explicit reviewable scopes.

### Capability Groups

#### Core Local Data

- metrics.summary.read
- metrics.timeline.read
- metrics.goal.read
- metrics.focus.read
- metrics.browser.read
- metrics.vscode.read

#### Sensitive User Activity Data

- usage.duration.read
- usage.session.read
- usage.app.read
- usage.window.read
- usage.category.read
- usage.project.read

#### Media and Content

- media.image.read.remote
- media.image.read.local-approved
- media.video.stream.remote
- media.video.read.local-approved
- media.thumbnail.generate

#### Network

- network.fetch.http
- network.fetch.https
- network.stream.read
- network.domain.<approved-domain>

#### Automation and Interaction

- focus.mode.write
- todo.read
- todo.write
- notification.send
- widget.storage.read
- widget.storage.write

#### Local Platform Bridge

- local.api.call
- host.runtime.info.read
- widget.devtools.attach

Decision note:

- Scope names in this document are directional. The exact wire-level names will be frozen in the technical implementation plan and later RFC.

## Consent and Gateway Policy

This is the most important part of the rewrite.

### Core Rule

Every external widget request for a sensitive or external capability must pass through the gateway.

If the widget has not been authorized for that access path before:

- The request is paused.
- The user sees a consent prompt.
- The user can click Accept or Deny.
- If the user clicks Deny, the request fails and the widget cannot access that data.
- If the user clicks Accept, the gateway records the decision and the request can proceed under the granted scope.

### Consent Granularity

These rules are now the working direction for the rewrite:

- Usage data access should be granted per namespace, not as one giant all-data permission.
- Network access should use a hybrid model: widget-level approval for general network classes, plus firewall-style domain denial rules for high-risk domains and sensitive outbound paths.
- Media access should distinguish remote content from local approved files.
- Session-duration access should be treated as more sensitive than high-level daily totals.

### Proposed Prompt Content

Each consent prompt should show:

- Widget name.
- Widget publisher or package source.
- Requested action in plain language.
- Requested scope.
- Why the widget says it needs that scope.
- Whether the request is for local data, network data, remote media, or local approved files.
- What happens if the user denies it.

### Deny Behavior

- Deny must be enforceable immediately.
- Denied requests return a structured permission error.
- The widget is not allowed to silently fall back to hidden raw network calls.
- Repeated denied requests should be rate-limited and visible in audit logs.

### Revocation Behavior

- Users must be able to revoke previously accepted scopes.
- Revocation must cut off new access immediately.
- Long-lived streams should be terminated when consent is revoked.
- Widgets should receive an explicit revoked event so they can degrade gracefully.

## External Content Access Model

### Images

External widgets should not fetch arbitrary remote images directly. Proposed flow:

- Widget asks the gateway for a remote image resource.
- Gateway checks network scope and domain scope.
- If approved, gateway fetches the content or proxies it through a controlled fetch path.
- Gateway can downscale, validate MIME type, and cap payload size before the widget receives it.

For local images:

- Widget requests an approved user-selected file or folder handle.
- Gateway presents file approval UI if access has not been granted.
- Widget receives a safe reference rather than unrestricted filesystem access.

### Video

Video is higher risk and higher cost. Proposed flow:

- Streaming or loading remote video always goes through gateway review.
- Gateway enforces domain restrictions, bandwidth caps, and stream timeout policy.
- Local video access requires explicit user-approved file handles.
- Widget never receives unrestricted access to arbitrary local media paths.

### Network Content

All HTTP or HTTPS access must go through the gateway.

Proposed policy:

- No raw global fetch for external widgets.
- Widget declares network purpose and target domains in the manifest.
- First request to an undelegated external domain triggers Accept or Deny.
- Gateway stores domain-scoped consent and audit records.
- Gateway can apply caching, redaction, timeout, retry, and content-type restrictions.

Review note:

- Domain-level controls remain mandatory for high-risk domains and sensitive endpoints, even though lower-risk general network classes can be granted at the widget class level.

## Usage Data Access Model

The initiative should distinguish between low-sensitivity aggregate access and high-sensitivity detailed access.

### Low-Sensitivity Examples

- Today total usage by app.
- Weekly category totals.
- Goal progress percentages.
- Focus streak summaries.

### High-Sensitivity Examples

- Full app-by-app durations across long ranges.
- Window-title-linked duration slices.
- Raw session timelines.
- Cross-source activity reconstruction combining desktop, browser, and editor signals.

### Policy Direction

- Summary metrics can use simpler scoped consent.
- Detailed duration and session access should require stronger warnings.
- Access to full user time-allocation history should be tagged high risk in both install and runtime prompts.
- Widgets should only receive the minimum data shape needed for the request.
- Detailed duration access requires an additional runtime confirmation step even after install-time consent has already been granted.

## Packaging and Manifest Direction

This initiative likely needs a new widget manifest revision.

### Proposed Manifest Fields

- manifest_version: v4 for the rewritten widget kernel.
- widget_type
- name
- description
- publisher
- runtime.language
- runtime.version
- runtime.entry
- runtime.memory_budget_mb
- runtime.cpu_budget_ms
- ui.model
- capabilities
- capability_justifications
- network_domains_requested
- media_sources_requested
- signature
- sdk_version
- migration_from

### Packaging Proposals

#### JavaScript and TypeScript Package

- manifest.json
- compiled bundle or ESM entry
- static assets
- optional type metadata

#### Java Package

- manifest.json
- widget.jar
- dependency bundle strategy defined by packaging spec
- optional local web assets for UI

Decision note:

- Java packaging remains self-contained at the widget package level unless later performance testing proves a shared host-managed dependency model is necessary.

## Developer Experience Direction

### SDK Goals

- Shared capability schema for all runtimes.
- First-party SDKs for JavaScript, TypeScript, and Java.
- Mock gateway for local testing.
- Consent simulation tools.
- Contract test kit for gateway behavior and revocation handling.

### Tooling Goals

- Widget scaffolding templates per runtime.
- Local validator for manifest, scopes, signatures, and package shape.
- Event trace viewer for request and consent flow.
- Runtime inspector for memory, CPU, crash count, and blocked requests.

## Migration Strategy

### Official Widgets

- Migrate official widgets first onto the new kernel.
- Keep functional parity before adding major new features.
- Use first-party widgets as the proving ground for lifecycle and gateway rules.

### Existing Third-Party Widgets

- Provide compatibility mode for the current bridge.
- Warn developers when they use deprecated APIs.
- Provide a manifest migrator and capability mapping report.
- Publish a hard sunset window only after the adapter layer is proven stable.

## Milestone Plan

### Phase 0 - RFC, Threat Model, and Contract Freeze

#### Must Do

- Define the widget kernel responsibilities and trust boundaries.
- Define the first draft of the capability groups and scope naming rules.
- Define the consent gateway contract, including Accept and Deny behavior.
- Produce threat model coverage for network, media, and detailed usage-data access.
- Freeze the decision that Java support ships in the second rewrite wave after JS or TS stabilization.

#### Should Do

- Draft a shared IDL or schema for requests and responses across runtimes.
- Draft the compatibility story for existing widgets.
- Prototype consent prompts for high-risk scopes.

#### Could Do

- Explore Kotlin compatibility as a JVM follow-on.
- Explore future Python or WASM support without committing to implementation.

#### Decisions Locked In This Phase

- Java is a second-wave runtime.
- High-risk domains and sensitive outbound paths require firewall-style approval handling.
- Detailed duration access is high risk by default.

### Phase 1 - Kernel and Gateway Foundation

#### Must Do

- Build the new widget kernel and request router.
- Build the consent gateway and audit pipeline.
- Support current JavaScript widgets through a compatibility adapter.
- Add structured denied, revoked, throttled, and degraded error responses.
- Add gateway-backed access to local usage summaries and detailed duration APIs.

#### Should Do

- Add widget lifecycle events and stream revocation handling.
- Add per-widget quotas for CPU, memory, stream count, and request rate.
- Add developer trace tooling for gateway decisions.

#### Could Do

- Add gateway-side response caching for approved network content.
- Add richer developer diagnostics overlays.

#### Decisions Locked In This Phase

- The product surface uses one user-visible Widget Gateway, even if internal services split network and local-data mediation behind it.
- End users see a readable audit summary by default, with deeper technical detail available in advanced inspection views.

### Phase 2 - TypeScript and JavaScript Runtime Migration

#### Must Do

- Move first-party and external JS or TS widgets to the rewritten contract.
- Ship the new JS or TS SDK.
- Replace raw bridge assumptions with gateway-mediated APIs.
- Support controlled image, video, and network access through the gateway.

#### Should Do

- Add UI helpers for permission-required and denied states.
- Add local mock media and network fixtures for dev testing.
- Add automatic capability-usage linting for JS or TS packages.

#### Could Do

- Add optional devtools panels embedded in the Widget Center.
- Add starter templates for dashboard-style, utility, and media widgets.

#### Decisions Locked In This Phase

- External JS or TS widgets continue to use sandboxed web rendering in the first rewrite wave, with stricter host-rendered models left for later evaluation.

### Phase 3 - Java Runtime Support

#### Must Do

- Ship the JVM widget host and language bridge.
- Ship Java packaging, validation, and signing rules.
- Ship the Java SDK with gateway request helpers.
- Support gateway-mediated access to approved data, media, and network scopes from Java widgets.

#### Should Do

- Add code samples for polling widgets, event-driven widgets, and media widgets.
- Add test harness support for Java widgets.
- Add resource-budget diagnostics for JVM widgets.

#### Could Do

- Add Kotlin examples if the Java host model proves stable.
- Add pooled-JVM experiments for lower startup cost.

#### Decisions Locked In This Phase

- Java widgets may use embedded web UI or optional host-rendered block UI.
- Process model evaluation starts with trust-boundary isolation first, then measures whether pooled hosts are acceptable under the same consent and quota guarantees.

### Phase 4 - Media, Network, and Sensitive Data Hardening

#### Must Do

- Harden domain-scoped consent and revoke handling.
- Add payload, bandwidth, timeout, and MIME validation for media and network access.
- Add stronger warning flows for high-risk duration and raw session access.
- Add long-run testing for denied, revoked, and degraded widget states.

#### Should Do

- Add policy presets for safe media widgets, safe network widgets, and sensitive analytics widgets.
- Add user-facing audit summaries for who accessed what and when.
- Add more granular review controls for previously accepted scopes.

#### Could Do

- Add trusted offline content bundles for widgets that should work without network after initial approval.
- Add gateway caching and offline replay for selected low-risk content.

#### Decisions Locked In This Phase

- Network approval supports persistent grants, but high-risk domain overrides remain centrally revocable from Settings.
- Video capability remains explicit and opt-in, including for official partners outside development mode.

### Phase 5 - GA, Migration Cutover, and Ecosystem Rules

#### Must Do

- Move official widgets fully onto the rewritten kernel.
- Publish the stable manifest and SDK contract.
- Publish migration tooling for old widgets.
- Make consent, revocation, and audit views understandable to non-technical users.
- Define the compatibility sunset policy for the old widget bridge.

#### Should Do

- Publish a certification checklist for external widget packages.
- Publish best practices for data minimization and permission rationale text.
- Add ecosystem review tooling for package quality and gateway behavior.

#### Could Do

- Add a formal partner track for high-trust widget publishers.
- Add richer package reputation summaries based on local-only signals.

#### Decisions Locked In This Phase

- Compatibility mode remains active through one full stable major transition window after GA, with the exact sunset date published in the migration policy.
- TimeLens distinguishes between general publishers and verified publishers in install and review flows, but verification does not weaken consent requirements.

## Acceptance Criteria For The Initiative

- External widgets in JavaScript, TypeScript, and Java can run through one kernel contract.
- All sensitive and external data access goes through the gateway.
- First-time ungranted access prompts the user for Accept or Deny.
- Deny blocks access immediately and reliably.
- Revocation cuts off further access without restart.
- Official widgets and third-party widgets share the same long-term security model.
- Detailed user usage data is not exposed through any raw bypass path.
- Media and network access are auditable, rate-limited, and scope-bound.

## Resolved Product Decisions

- Java support follows the stabilized JavaScript or TypeScript rewrite rather than leading it.
- Network permission uses a hybrid model: firewall-style denial and Settings approval for high-risk domains and sensitive endpoints, widget-level approval classes for lower-risk network access.
- Remote video remains a separate permission from remote image access.
- Detailed usage duration access is always high risk and requires an additional confirmation layer even after installation consent.
- Java widgets support embedded web surfaces and optional host-rendered block UI.
- Official widgets use the same gateway prompts during dogfooding, with development-mode-only bypass support.

## Suggested Next Step After Review

This direction is now mature enough for an implementation plan that freezes:

- Capability names.
- Manifest fields.
- Consent prompt rules.
- Java packaging rules.
- SDK generation strategy.
- Compatibility sunset policy.

The detailed plan for that work is maintained in `docs/WIDGET_RUNTIME_REWRITE_IMPLEMENTATION_PLAN.md`.