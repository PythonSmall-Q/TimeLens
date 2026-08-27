# TimeLens Widget Runtime Rewrite Implementation Plan

Last updated: 2026-08-26

Status: Draft implementation plan for review.

This document turns the widget runtime rewrite roadmap into a technical execution plan. It is intentionally detailed, and it includes several review checkpoints where product, security, and developer-experience tradeoffs still need explicit approval before code should be frozen.

## Relationship To Other Documents

- Product-level roadmap: `docs/ROADMAP.md`
- Widget rewrite roadmap: `docs/ROADMAP_WIDGET_RUNTIME_REWRITE.md`
- Current widget guidance: `docs/WIDGETS_DEV_GUIDE.md`
- Current SDK migration notes: `docs/WIDGET_SDK_v2_MIGRATION.md`
- Current permission governance baseline: `docs/WIDGET_PERMISSION_E2E_CHECKLIST.md`

## Executive Summary

The widget rewrite replaces the current widget bridge with a kernel-and-gateway model.

The core design choices are:

- JavaScript and TypeScript are the first migration wave.
- Java support is introduced after the JS or TS runtime is stable.
- Every sensitive or external request flows through a Widget Gateway.
- First-time access to ungranted data or external content requires explicit Accept or Deny.
- Detailed usage duration access is treated as high risk and needs an extra confirmation layer.
- Network policy uses a hybrid model: broad widget-class approval for lower-risk outbound access, and firewall-style hard controls for high-risk domains and sensitive endpoints.
- Official widgets follow the same gateway behavior in dogfooding, with development-only bypass hooks.

## Goals

- Establish one runtime contract across first-party and third-party widgets.
- Make external widget permissions understandable, revocable, auditable, and enforceable.
- Support JavaScript, TypeScript, and Java without compromising local-first guarantees.
- Allow controlled access to images, video, network content, and user usage data.
- Preserve backward compatibility long enough for ecosystem migration.

## Constraints

- No hosted backend dependency.
- No raw database access by widgets.
- No raw filesystem access beyond user-approved handles.
- No direct unrestricted fetch from widget runtime code.
- No weakening of existing local API token and permission governance.

## Architecture Overview

### High-Level Layers

1. Widget Shell
   - User-facing surfaces inside TimeLens.
   - Hosts widget windows, sizing, placement, z-order, and lifecycle state.
2. Widget Kernel
   - Trusted local coordinator for widget identity, lifecycle, quotas, and routing.
3. Widget Gateway
   - Trusted policy and consent boundary for all privileged access.
4. Runtime Hosts
   - JS or TS sandbox host.
   - JVM widget host.
5. Data Providers
   - Usage query service.
   - Media proxy service.
   - Network fetch service.
   - Local API broker.
6. Audit and Policy Store
   - Records grants, denials, revocations, access logs, and policy overrides.

### Request Flow

1. Widget calls SDK method.
2. Runtime host converts the call into a normalized gateway request.
3. Kernel authenticates widget instance and routes the request.
4. Gateway checks manifest-declared capability, stored consent, Settings policy, and runtime quotas.
5. If consent is missing, gateway blocks the request and prompts the user.
6. If user accepts, the gateway records the decision and forwards the request to the correct provider.
7. Provider returns a scoped payload.
8. Gateway audits the result and returns a normalized response.
9. Widget receives success, denied, revoked, throttled, timed_out, or degraded result.

## Component Plan

### Widget Shell

Responsibilities:

- Window creation and restore.
- Focus, suspend, resume, and teardown events.
- Permission and health indicators in Widget Center.
- Consent prompt entry points.
- Error, denied, and degraded state rendering.

Required changes:

- Add kernel-backed widget status model.
- Add prompt queue support so multiple widgets cannot overwhelm the user simultaneously.
- Add stronger per-widget status badges: awaiting consent, denied, degraded, quota-limited, revoked.

### Widget Kernel

Responsibilities:

- Widget instance registry.
- Runtime host selection.
- Lifecycle transitions.
- Resource quota tracking.
- Structured bridge protocol.
- Compatibility adapters for existing widgets.

Required internal modules:

- InstanceManager
- HostSupervisor
- RequestRouter
- QuotaManager
- CompatibilityAdapter
- HealthReporter

Key decisions:

- The kernel is the only trusted caller into the gateway.
- Runtime hosts never talk directly to database services, network services, or local API endpoints.
- Old widgets are wrapped by the CompatibilityAdapter so the new gateway remains the only privileged path.

### Widget Gateway

Responsibilities:

- Capability lookup.
- Consent evaluation.
- Deny and revoke enforcement.
- Policy override handling from Settings.
- Provider dispatch.
- Audit event emission.

Internal subservices:

- ConsentService
- CapabilityResolver
- PolicyFirewall
- MediaProxy
- NetworkProxy
- UsageDataBroker
- LocalApiBroker
- AuditEmitter

Working rule:

- The gateway is one user-visible concept, but it may be implemented as several internal services so long as policy remains centralized and consistent.

## Runtime Host Strategy

### JS or TS Host

Execution direction:

- Continue with sandboxed web runtime.
- Enforce no raw fetch and no direct privileged bridge access.
- Generate a strongly typed SDK from shared contract definitions.

Packaging:

- Manifest plus bundled JS assets.
- Optional static media assets.
- Signature required for distributable packages.

### Java Host

Execution direction:

- Introduce JVM host after JS or TS migration reaches stable parity.
- Start with Java 21 LTS baseline.
- Prefer trust-boundary isolation before optimizing for pooled host reuse.

Packaging:

- Manifest plus widget JAR and dependency bundle.
- Self-contained dependency layout is the default starting point.
- Optional embedded web UI assets.

UI models:

- Embedded web surface.
- Optional host-rendered block UI for simpler utility widgets.

Review checkpoint:

- Confirm whether the first Java beta should require web UI only, leaving host-rendered blocks for a later subphase.

## Capability Model

### Capability Principles

- Capability groups are human-readable.
- Scopes are narrow enough for meaningful consent.
- High-risk access is clearly separated from summary analytics.
- Capabilities map to SDK methods, audit categories, and UI prompt language.

### Proposed Capability Groups

#### Summary Metrics

- metrics.summary.read
- metrics.goal.read
- metrics.focus.read
- metrics.browser.read
- metrics.vscode.read

#### Detailed Usage Data

- usage.duration.read
- usage.session.read
- usage.app.read
- usage.window.read
- usage.project.read
- usage.category.read

#### Media Access

- media.image.remote.read
- media.image.local.read
- media.video.remote.stream
- media.video.local.read
- media.thumbnail.generate

#### Network Access

- network.general.http
- network.general.https
- network.stream.read
- network.domain.allowlist

#### Interaction and Automation

- todo.read
- todo.write
- focus.mode.write
- notification.send
- widget.storage.read
- widget.storage.write

#### Platform Bridge

- local.api.call
- host.runtime.info.read
- widget.devtools.attach

### Consent Tiers

- Low risk: summary metrics, local widget storage, non-sensitive runtime info.
- Medium risk: todo writes, focus-mode writes, local API calls, general network classes.
- High risk: detailed duration, raw session access, remote video, window-title-linked usage, and high-risk domain access.

## Gateway Policy Model

### Policy Inputs

- Manifest declaration.
- User grant state.
- User deny state.
- Settings firewall rules.
- Widget publisher trust state.
- Runtime environment: development or normal mode.
- Quota and health status.

### Hybrid Network Policy

The approved direction is:

- General lower-risk network access is granted at the widget class level.
- High-risk domains and sensitive endpoints are controlled by firewall-style rules.
- If Settings block a domain or endpoint, the widget cannot override that through a runtime prompt.
- If a domain is neither globally blocked nor already granted, the gateway prompts the user before the first outbound request.

Examples of likely firewall categories for review:

- Authentication domains.
- Payment domains.
- File-hosting domains.
- User-configured denylist domains.
- Sensitive upload endpoints.

Review checkpoint:

- Confirm the initial built-in blocked-domain categories and whether they should be hard-coded, remotely updateable through app release, or fully user-configurable only.

### Detailed Usage Policy

- Install-time permission alone is not enough for detailed usage duration access.
- First runtime access to high-risk usage data requires an extra warning and confirmation.
- The warning must explain that the widget can inspect detailed time-allocation patterns.
- The gateway should return minimized payloads where possible, not full raw records by default.

### Media Policy

- Remote images and remote video are separate capabilities.
- Remote video always remains explicit opt-in.
- Local images and local video require user-approved file handles.
- MIME type validation, payload ceilings, and timeouts are enforced gateway-side.

## Consent UX Plan

### Prompt Types

1. Install-time capability review.
2. First runtime access prompt.
3. High-risk runtime escalation prompt.
4. Revocation warning prompt.
5. Blocked-by-policy explanation dialog.

### Prompt Content Standard

Every prompt should include:

- Widget name.
- Publisher name or source label.
- Requested action in plain language.
- Specific capability and scope.
- Reason declared by the widget.
- Risk level.
- Persistence of decision: this request only or remember decision.
- Consequence of denial.

### Prompt Outcomes

- Accept once.
- Accept and remember.
- Deny once.
- Deny and remember.
- Open advanced permission details.

Review checkpoint:

- Confirm whether high-risk permissions should even allow Accept once, or only Accept and remember versus Deny.

### Deny Handling

- Denied requests return explicit structured errors.
- Repeated denied attempts are rate-limited.
- Widget Center surfaces a denial history.
- A widget may render degraded UI but may not bypass consent through fallback transport paths.

### Revocation Handling

- Revocation is immediate.
- Open streams terminate immediately.
- Widgets receive revoked events.
- Cached tokens and handles become invalid.

## Manifest v4 Direction

### Required Fields

- manifest_version
- widget_type
- name
- description
- publisher
- runtime.language
- runtime.version
- runtime.entry
- ui.model
- capabilities
- capability_justifications
- signature

### Optional Fields

- runtime.memory_budget_mb
- runtime.cpu_budget_ms
- runtime.stream_limit
- network_domains_requested
- media_sources_requested
- migration_from
- sdk_version
- publisher_verification
- default_size
- localization_resources

### Example Review Shape

```json
{
  "manifest_version": "v4",
  "widget_type": "session_pulse",
  "name": "Session Pulse",
  "publisher": "TimeLens Labs",
  "runtime": {
    "language": "typescript",
    "version": "5.x",
    "entry": "dist/index.js",
    "memory_budget_mb": 96,
    "cpu_budget_ms": 40
  },
  "ui": {
    "model": "web-sandbox"
  },
  "capabilities": [
    "metrics.summary.read",
    "usage.duration.read",
    "network.general.https"
  ],
  "capability_justifications": {
    "metrics.summary.read": "Render current focus and summary usage state.",
    "usage.duration.read": "Compare session length patterns to suggest focus windows.",
    "network.general.https": "Load approved remote illustrations for the widget header."
  },
  "network_domains_requested": [
    "cdn.timelens.example"
  ],
  "signature": "sha256:..."
}
```

Review checkpoint:

- Confirm whether `publisher_verification` belongs inside the manifest or only in install metadata.

## SDK Plan

### Shared Contract

- Define one shared schema for gateway requests, responses, events, and errors.
- Generate TypeScript client types from the shared schema.
- Generate Java client stubs from the same schema.

### JavaScript and TypeScript SDK

- Promise-based request API.
- Event subscription helpers.
- Consent-required state helpers.
- Dev-mode trace helpers.
- Manifest validation helper.

### Java SDK

- Async request client.
- Event listener registration.
- DTOs generated from the shared schema.
- Packaging helper and local validator integration.

### Test SDK

- Mock gateway implementation.
- Permission simulation fixtures.
- Denied and revoked scenario helpers.
- Media and network mock providers.

## Data Model Changes

### New Storage Areas

- widget_runtime_hosts
- widget_gateway_policies
- widget_consent_decisions
- widget_access_audit
- widget_network_domain_rules
- widget_runtime_health
- widget_runtime_crashes
- widget_stream_sessions

### Suggested Fields

#### widget_consent_decisions

- widget_id
- scope
- decision
- remembered
- risk_level
- source
- granted_at
- revoked_at

#### widget_network_domain_rules

- widget_id
- domain_pattern
- decision
- policy_source
- created_at

#### widget_access_audit

- widget_id
- scope
- request_type
- decision
- resource_hint
- payload_class
- occurred_at

Review checkpoint:

- Confirm how much resource_hint data is safe to store without leaking private content into logs.

## Migration Plan

### Step 1: Compatibility Envelope

- Wrap current widgets behind the new kernel.
- Map current permissions into capability groups.
- Keep existing install flows working while new gateway logic is introduced.

### Step 2: Official Widget Migration

- Migrate clock, todo, timer, note, status, and pet first.
- Validate lifecycle, degraded-state rendering, and revoke behavior against first-party code.

### Step 3: External JS or TS Migration

- Publish migration tooling.
- Publish compatibility warnings and lint rules.
- Offer sample upgraded widgets.

### Step 4: Java Enablement

- Introduce JVM host beta.
- Publish Java SDK and package validator.
- Restrict early Java beta to approved examples until diagnostics are stable.

### Step 5: Compatibility Sunset

- Announce end-of-life window for legacy channel APIs.
- Keep at least one stable major transition window.
- Provide final compatibility scanner before hard shutdown of old bridge behavior.

## Delivery Phases

### Phase A: Contract and Threat Model ✅ Completed

Deliverables:

- Shared schema.
- Threat model.
- Initial manifest v4 draft.
- Consent UX copy draft.

### Phase B: Kernel and Gateway Core ✅ Completed

Deliverables:

- Kernel process model.
- Gateway request flow.
- Audit store.
- Compatibility adapter.

### Phase C: JS or TS Runtime Migration ✅ Completed

Deliverables:

- New JS or TS SDK.
- Migrated first-party widgets.
- External widget beta path.

### Phase D: Media and Sensitive Access Hardening

Deliverables:

- Media proxy.
- Network policy firewall.
- High-risk data prompts.
- Revocation termination handling.

### Phase E: Java Runtime Beta

Deliverables:

- JVM host.
- Java SDK.
- Java package validator.
- Example widgets.

### Phase F: GA and Compatibility Policy

Deliverables:

- Stable contract.
- Migration tools.
- End-user governance UI.
- Compatibility sunset timeline.

## Testing Strategy

### Contract Tests

- SDK request and response correctness.
- Event delivery semantics.
- Error normalization.

### Security Tests

- Permission bypass attempts.
- Hidden network path attempts.
- Media payload abuse.
- Revoked stream continuation attempts.
- Raw database or filesystem access escape attempts.

### Runtime Tests

- Crash isolation.
- Memory and CPU budget enforcement.
- Multi-widget concurrency.
- Prompt queue correctness.

### UX Tests

- Prompt clarity.
- Deny comprehension.
- Revocation discoverability.
- Audit log readability.

### Migration Tests

- Legacy manifest conversion.
- Legacy permission mapping.
- Degraded compatibility behavior.
- First-party widget parity after migration.

## Release Gates

- No privileged widget request bypasses the gateway.
- Deny and revoke are both immediately enforceable.
- Detailed usage access always triggers high-risk review behavior.
- Remote video is never merged into lower-risk image permission.
- JS or TS migration reaches parity before Java beta starts.
- Official widgets pass through the same gateway policy as external widgets outside development-only bypass mode.
- Audit logs are useful to normal users without exposing raw private content.

## Risks And Mitigations

- Risk: prompt fatigue from too many granular approvals.
  - Mitigation: grouped low-risk grants, better manifest justification quality, prompt queueing, and remember-decision options.
- Risk: Java host complexity slows overall rewrite.
  - Mitigation: make Java second wave and lock JS or TS contract first.
- Risk: widgets abuse network capability after broad approval.
  - Mitigation: firewall-style domain controls, audit visibility, and revocable grants.
- Risk: audit logs become privacy liabilities.
  - Mitigation: store minimal resource hints and redact sensitive payload details.
- Risk: legacy compatibility undermines the new security model.
  - Mitigation: compatibility adapter only, no raw legacy bypass paths.

## Review Checklist

- Approve Java as second-wave runtime.
- Approve hybrid network policy model.
- Approve high-risk treatment for detailed usage duration access.
- Approve remote video as separate capability.
- Approve optional host-rendered Java widget UI.
- Approve persistence model for Accept once versus Accept and remember.
- Approve initial blocked-domain policy categories.
- Approve audit-log redaction depth.

## Recommended Next Technical Artifact

After this plan is reviewed, the next artifact should be a narrow RFC that freezes:

- Contract schema.
- Manifest v4 schema.
- Gateway policy evaluation order.
- Consent prompt variants.
- Audit storage schema.
- Java packaging contract.

---

## 实际执行记录（Agent Implementation Log）

> 由 Kimi Code agent 基于本计划逐步实施，记录已完成阶段、关键文件变更与下一步建议。

### 已完成阶段

- **Phase A — 契约与 Schema 冻结**：已完成。
- **Phase B — Kernel 与 Gateway Core**：已完成。
- **Phase C — JS/TS Runtime 迁移**：已完成（SDK、ExternalWidgetHost、运行时同意提示、全部适用 Gateway 的官方组件迁移、SDK 测试均已落地）。

### 关键交付物

| 模块 | 主要文件 | 说明 |
|---|---|---|
| 数据库迁移 | `src-tauri/src/db/migrations.rs` migration 012 | 新增 8 张 runtime rewrite 表 |
| Rust 模型 | `src-tauri/src/models/mod.rs` | 新增表模型 + Gateway Request/Response 契约 |
| Manifest v4 | `src-tauri/src/widget_registry.rs` | 支持 `runtime`、`ui`、`capability_justifications`、网络/媒体域等 v4 字段 |
| 共享契约 Schema | `src-tauri/widget-contract/*.schema.json` | manifest-v4、gateway-request、gateway-response |
| 前端类型 | `src/types/index.ts` | 同步 WidgetRegistryItem v4 字段、Gateway 类型、Consent/Stream/Health 等 |
| Gateway | `src-tauri/src/widget_gateway/` | capability_resolver、consent_service、policy_firewall、usage_data_broker、audit_emitter |
| Kernel | `src-tauri/src/widget_kernel/` | instance_manager、WidgetKernel（生命周期/错误/健康/权限重置） |
| 命令改造 | `src-tauri/src/commands/widget_runtime_cmd.rs` | 现有命令改走 Kernel/Gateway；新增 `widget_gateway_request`、`widget_grant_consent`、`widget_deny_consent`、`widget_revoke_consent` |
| 状态注册 | `src-tauri/src/lib.rs` | 注册 `WidgetKernel` 状态 |
| 前端 API | `src/services/tauriApi.ts` | 新增 `widgetGatewayRequest`、`widgetGrantConsent`、`widgetDenyConsent`、`widgetRevokeConsent` |
| 前端 SDK | `src/widgets/sdk/index.ts` | `WidgetClient`、`WidgetGatewayError`、`buildLegacyChannel`、`LegacyChannel` |
| 第三方组件 Host | `src/widgets/ExternalWidgetHost.tsx` | 实例化 `WidgetClient`，通过 Gateway 请求；保留 legacy channel；集成运行时同意提示 |
| 同意提示组件 | `src/components/WidgetConsentPrompt.tsx` | 运行时权限请求弹窗，支持 Allow/Deny 与记住选择 |
| 文案 | `src/i18n/locales/*/widgets.json` | `consentPrompt.*` 多语言文案 |
| Hook | `src/hooks/useWidgetClient.ts` | 为官方组件提供自动 dispose 的 `WidgetClient` |
| 官方组件迁移 | `src/widgets/{Clock,Todo,Note,Status,GoalProgress,SessionPulse,FocusCoach,Pet}Widget.tsx` | 适用 Gateway 的官方组件均已迁移；Timer/QuickCapture/BrowserActivity 因无对应 Gateway API 暂保留直接调用 |
| 后端默认权限 | `src-tauri/src/commands/widget_cmd.rs`、`src-tauri/src/widget_registry.rs` | 创建官方组件时按 capability 自动授予默认权限 |
| Gateway query | `src-tauri/src/widget_gateway/usage_data_broker.rs`、capability_resolver | 新增 `focus` namespace，返回 `active` + `active_session` |
| SDK 测试 | `src/widgets/sdk/__tests__/WidgetClient.test.ts` | mock gateway 覆盖 query/state/subscribe/consent retry |
| 官方组件全量测试 | `src/widgets/__tests__/*.test.tsx` | 覆盖 Clock/Todo/Note/Status/GoalProgress/SessionPulse/FocusCoach/Pet/QuickCapture/Timer/BrowserActivity |
| 权限治理 UX | `src/pages/WidgetCenter/index.tsx` | 权限矩阵支持单个权限撤销，保留「撤销全部」入口 |

### 验证结果

- `npm run typecheck` ✅
- `npm run lint` ✅（0 errors，8 pre-existing warnings）
- `npm run test` ✅（56/56，含 11 个 WidgetClient 测试 + 34 个官方组件测试）
- `cargo check` ✅
- `cargo test` ✅（38/38）

### 当前限制

- Gateway 中的 `network_fetch`、`media_load`、`local_api_call`、`notification_send` 已占位，尚未实现完整代理逻辑，计划在 Phase D 补齐。
- 旧 widget 的 `widget_permissions` 被 Gateway 视为已授权，保证迁移期兼容。
- `WidgetClient.fetch` 与 `loadMedia` 为占位实现，会抛出未实现错误。
- 同意提示目前统一按 `low` 风险等级记录；后续应结合 capability 风险分级自动映射 `low/medium/high`。
- TimerWidget、QuickCaptureWidget、BrowserActivityWidget 仍使用直接 `tauriApi` 调用，待 Gateway 暴露对应能力后再迁移；但其渲染与交互已纳入官方组件测试覆盖。

### 建议下一步

进入 **Phase D — Media 与 Sensitive Access Hardening**：

1. 实现 Gateway `network_fetch` 代理与域名策略防火墙。
2. 实现 Gateway `media_load` 代理与本地/远程媒体白名单。
3. 实现高风险数据访问的二次确认提示。
4. 处理 widget 被撤销权限（revoked）后的降级 UI 与事件通知。
5. 评估是否将 `buildLegacyChannel` 标记为 deprecated，并更新 `WIDGET_SDK_v2_MIGRATION.md`。

---

## Agent 下一步计划（由当前 Kimi Code agent 制定）

- [x] Phase C 官方组件全量测试流程已落地。
- [x] LLM 集成与 AI 洞察对话管理已落地：多模型配置、数据共享设置、分析范围选择、对话持久化（SQLite）、归档/置顶/删除、上下文 Summarize。

基于 Phase C 与 LLM 功能已完成，当前建议继续推进 v2.2.0 剩余需求：

1. **桌宠重写**：改为纯宠物资源包模式，支持用户导入 JSON pack（参考 Codex 宠物）。
2. **快速记录后待办/便签页面自动刷新**：保存后触发对应 widget 刷新事件。
3. **错误日志筛选失效**：当前筛选输入不生效，所有行被隐藏。
4. **自动更新弹窗与下载安装**：应用内检测更新、每次下载/安装需用户确认、支持关闭/仅提示。

如果用户继续输入「继续」，则默认从第 1 项开始：桌宠重写为可导入宠物包。