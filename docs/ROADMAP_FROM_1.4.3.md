# TimeLens Roadmap (From v1.4.3)

Last updated: 2026-05-23

## Starting Point

Current stable baseline: **v1.4.3**

Existing foundation already in place:

- Local-first desktop time tracking with SQLite
- Widget Center with official widgets and third-party widget loading
- Permission and bridge-key based extension integration
- Data Health, Backup/Restore v2, and cross-platform startup controls

## Product Direction After v1.4.3

- Keep local-first as the default architecture.
- Upgrade from "data display" to "action guidance".
- Grow widgets into a practical daily workflow system.
- Make extension and widget ecosystem safe, observable, and stable.

## Milestones

## v2.2.0 (2026 Q3) - 小组件爆发期

### 主题目标

把 Widget Center 做成真正高频入口。

### 核心功能

- 小组件商店页升级：分类、搜索、推荐、最近使用。
- 组件组合场景：晨间面板、专注面板、复盘面板，一键启用布局。
- 组件状态同步：同一组件多实例支持独立配置模板。
- 组件性能监测：CPU/内存占用可视化、异常自动降级。

### 新增官方小组件（第一批）

- Habits Tracker（习惯打卡）
- Calendar Agenda（日程清单，支持本地 iCal/ics）
- Quick Capture（极速收集箱）
- Focus Music Controller（本地播放器控制）
- Water Break（喝水与休息提醒）
- Sticky Board（便签看板，多便签）
- Daily Quote（每日一句，可本地词库）
- Battery & Device Status（设备状态）

### 验收指标

- 小组件日活使用率提升到 60%+。
- 单日平均打开组件次数提升 40%。

## v2.4.0 (2026 Q4) - 深度专注与目标执行

### 主题目标

把洞察变成“可执行计划”。

### 核心功能

- Focus Plan：基于历史行为自动生成今日专注计划。
- Goal Coach：目标拆分、风险提示、延期建议。
- Session Review：每次专注会话后自动总结（本地规则引擎）。
- Anti-Distraction：分心应用预警和弹性封锁策略。

### 新增官方小组件（第二批）

- Focus Session Timeline（专注会话时间轴）
- Goal Progress Ring（目标环）
- Distraction Radar（分心雷达）
- Session Notes（会话笔记）
- Pomodoro Matrix（番茄矩阵）
- Break Stretch Guide（拉伸指导）

### 验收指标

- 用户周均专注时长提升 20%。
- 目标达成率提升 15%。

## v2.6.0 (2027 Q1) - 开发生态与可扩展平台

### 主题目标

让第三方组件开发“易上手、可运营、可审计”。

### 核心功能

- Widget SDK v3：脚手架、热重载、调试面板。
- 权限中心 v3：细粒度授权、按来源隔离、调用审计。
- 本地 API 治理：限流、配额、错误分析、客户端信誉分。
- 组件质量分：启动耗时、稳定性、资源占用评分。

### 新增官方小组件（第三批，偏开发与效率）

- Code Focus Heatmap（编码热力图）
- Git Activity Summary（本地 Git 活动概览）
- Build Monitor（构建状态）
- Meeting Guard（会议防打断）
- Context Switch Counter（上下文切换计数器）

### 验收指标

- 第三方组件安装占比 30%+。
- 组件崩溃率下降 50%。

## v3.0.0 (2027 Q2) - Local-First 生产力平台

### 主题目标

形成“仪表盘 + 行动系统 + 组件生态”的完整闭环。

### 核心功能

- Unified Workspace 2.0：洞察、计划、执行、复盘同屏联动。
- Personal Automation：本地规则自动触发（时间、状态、应用场景）。
- Data Lifecycle Pro：冷热分层、压缩、快速恢复。
- Accessibility & i18n 全面补齐。

### 新增官方小组件（第四批，平台级）

- AI-Free Smart Assistant（纯本地规则助手，非云 AI）
- Weekly Review Board（周复盘看板）
- Time Budget Planner（时间预算）
- Multi-Goal Kanban（多目标看板）
- Life Balance Radar（生活平衡雷达）

### 验收指标

- 离线核心流程覆盖率 100%。
- 首次启动到可用时间降低 30%。
- NPS 与留存明显提升。

## Widget Roadmap Matrix

### Category Plan

- Execution widgets: tasks, timers, planning, review
- Focus-health widgets: break, water, stretch, recovery
- Insight widgets: trends, anomaly, heatmap, category monitor
- Developer widgets: coding sessions, build status, project rhythm
- Ambient widgets: pet, quotes, lightweight motivation

### Priority Recommendation

- P0:
  - Habits Tracker
  - Quick Capture Inbox
  - Calendar Agenda
  - Goal Progress Ring
- P1:
  - Distraction Radar
  - Focus Session Timeline
  - Weekly Review Board
- P2:
  - Git Activity Summary
  - Build Monitor
  - Life Balance Radar

## Release Gates (Every Version)

- Performance gate:
  - Widget open/render/memory limits are measured and enforced.
- Security gate:
  - Principle of least privilege for widget permissions.
  - User can audit and revoke access at any time.
- Reliability gate:
  - Backup/restore compatibility passes for supported versions.
  - Data integrity checks pass on upgrade datasets.
- Local-first gate:
  - Core journeys are fully usable when offline.

## Scope Boundaries

Still out of scope for this roadmap window:

- Mandatory cloud account dependency for core features
- Mandatory cloud sync for daily usage data
- Uploading user behavior data by default
