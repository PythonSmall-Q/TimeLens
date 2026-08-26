# TimeLens

<div align="center">

![TimeLens Logo](docs/assets/icon.png)

**轻量级桌面屏幕时间追踪器 & 浮动小组件管理器**

[![CI](https://github.com/PythonSmall-Q/TimeLens/actions/workflows/ci.yml/badge.svg)](https://github.com/PythonSmall-Q/TimeLens/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/PythonSmall-Q/TimeLens)](https://github.com/PythonSmall-Q/TimeLens/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/平台-Windows-lightgrey)](https://github.com/PythonSmall-Q/TimeLens/releases)

[English](README.md) · [简体中文](#)

</div>

---

## ✨ 功能特性

- **屏幕时间追踪** — 自动记录前台应用使用时长，支持每日总览、24 小时分布、7 日趋势对比与 365 天使用热力图。
- **Insight Hub** — 周期对比 "What Changed"、分心热点识别、跨桌面/浏览器/中断的统一时间线，支持保存自定义分析视图。
- **浮动小组件** — 透明无边框、始终置顶的悬浮窗：模拟/数字时钟、可拖拽待办、多模式计时器、便签、习惯追踪与桌面宠物。
- **毛玻璃 UI** — 深色优先设计，全局使用背景模糊、微透明与渐变光效。
- **应用限制 & 目标** — 为应用或分类设置每日限额与生产力目标，超额前自动提醒。
- **专注模式** — 一键开启专注时段，支持自动规则与深度工作时间记录。
- **浏览器 & VS Code 集成** — 浏览器扩展采集域名级网页使用数据；VS Code 扩展按语言、项目统计编码时长。
- **第三方小组件 SDK** — 开放式小组件 SDK v2，含权限矩阵、审计日志与开发者 Harness。
- **数据健康 & 加密备份** — 完整性检查、数据缺口扫描、孤立行清理，支持 AES-256-GCM 加密备份与多 Profile 隔离。
- **本地 API 服务** — 内置本地 API 服务器，基于 scoped token、allowlist 与速率限制，安全对接小组件与外部工具。
- **系统托盘** — 最小化到托盘；可从托盘菜单新建小组件、暂停追踪或退出。
- **持久化会话** — 通过 SQLite 在每次启动时恢复小组件布局与位置。
- **多语言支持** — 内置 8 种语言：`en`、`zh-CN`、`zh-TW`、`ja`、`ko`、`fr`、`de`、`es`，可轻松扩展（参见[添加语言](#添加语言)）。

---


## 🗺 产品生态

TimeLens 不仅是一款桌面应用，更是围绕屏幕时间构建的跨端工具集合：

| 组件 | 路径 | 说明 |
| ---- | ---- | ---- |
| **TimeLens 桌面端** | `src/` + `src-tauri/` | 基于 Tauri + React 的主应用，提供追踪、洞察、小组件与完整设置。 |
| **浏览器扩展** | [`browser-extension/`](browser-extension/index.html) | 采集域名级网页使用数据，并与桌面端数据合并展示。 |
| **VS Code 扩展** | [`vscode-extension/`](vscode-extension/index.html) | 按语言、项目、工作区统计编码时长，开发者生产力洞察的好帮手。 |

---

## 🛠 技术栈

| 层级 | 技术 |
|------|------|
| 桌面壳 | [Tauri 2.x](https://tauri.app) |
| UI 框架 | React 18 + TypeScript 5 |
| 样式 | Tailwind CSS 3.4 + 毛玻璃工具类 |
| 状态管理 | Zustand 4.5 |
| 图表 | Recharts 2.12 |
| 国际化 | i18next + react-i18next |
| 小组件拖拽 | @dnd-kit/core + @dnd-kit/sortable |
| 数据库 | SQLite（rusqlite bundled） |
| 构建工具 | Vite 5 |

---

## 🚀 快速开始

### 前置条件

| 工具 | 版本要求 |
|------|---------|
| Node.js | ≥ 18 |
| Rust | ≥ 1.77 |
| Tauri CLI | 2.x（`cargo install tauri-cli --version "^2"`） |
| WebView2（Windows） | Windows 11 已内置 / Win 10 可单独下载 |
| Xcode（macOS） | 最新稳定版 |

### 开发模式

```bash
# 1. 克隆仓库
git clone https://github.com/PythonSmall-Q/TimeLens.git
cd TimeLens

# 2. 安装前端依赖
npm install

# 3. 启动开发服务器 + Tauri 窗口
npm run tauri:dev
```

### 生产构建

```bash
npm run tauri:build
# 输出：
#   Windows: src-tauri/target/release/bundle/msi/*.msi
#            src-tauri/target/release/bundle/nsis/*.exe
#   macOS:   src-tauri/target/release/bundle/dmg/*.dmg
```

### 发布 Release（以 v0.5.0 为例）

```bash
# 1. 先推送 master（按当前仓库约定）
git push origin refs/heads/master:refs/heads/master

# 2. 创建并推送版本标签
git tag -a v0.5.0 -m "release: v0.5.0"
git push origin v0.5.0
```

说明：推送 `v*` 标签后会触发 `.github/workflows/release.yml` 自动发布流程。

---

## 🗂 项目结构

```
TimeLens/
├── src/                        # React 前端
│   ├── components/             #   共享 UI 组件
│   ├── i18n/                   #   i18next 配置与语言文件
│   ├── pages/                  #   仪表盘、小组件中心、设置页
│   ├── services/               #   Tauri 命令封装
│   ├── stores/                 #   Zustand 状态仓库
│   ├── types/                  #   共享 TypeScript 类型
│   ├── utils/                  #   格式化工具
│   └── widgets/                #   浮动小组件组件
├── src-tauri/                  # Rust 后端
│   ├── src/
│   │   ├── commands/           #   Tauri 命令处理器
│   │   ├── db/                 #   SQLite 查询
│   │   ├── models/             #   Serde 数据结构
│   │   └── monitor/           #   后台窗口轮询器
│   ├── capabilities/           #   Tauri 2 权限清单
│   ├── Cargo.toml
│   └── tauri.conf.json
├── .github/workflows/          # CI + 发布自动化
└── docs/                       # 开发文档
```

---

## 🧩 小组件开发

- [小组件开发指南](docs/WIDGETS_DEV_GUIDE.zh-CN.md)
- [第三方小组件模板](examples/third-party-widget-template/README.zh-CN.md)

---

## 🌐 添加语言

请参阅 [docs/ADD_LANGUAGE.md](docs/ADD_LANGUAGE.md) 获取分步指南。

---

## 🤝 贡献指南

提交 Pull Request 前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

---

## 🗺 路线图

- [统一路线图](docs/ROADMAP.md)
- [小组件底层重写专项路线图（提案）](docs/ROADMAP_WIDGET_RUNTIME_REWRITE.md)
- [小组件底层重写详细实施方案（草案）](docs/WIDGET_RUNTIME_REWRITE_IMPLEMENTATION_PLAN.md)

---

## 📋 更新日志

见 [CHANGELOG.md](CHANGELOG.md)。

---

## 📄 许可证

MIT © 2026 TimeLens Contributors
