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

- **屏幕时间追踪** — 自动记录前台应用使用时长，支持每日总览、小时分布图表及 7 日趋势。
- **浮动小组件** — 透明无边框、始终置顶的悬浮窗：模拟/数字时钟、可拖拽排序的待办列表、多模式计时器（番茄钟 / 倒计时 / 正计时）。
- **毛玻璃 UI** — 深色优先设计，全局使用背景模糊与微透明效果。
- **系统托盘** — 最小化到托盘；可从托盘菜单新建小组件、暂停追踪或退出。
- **持久化会话** — 通过 SQLite 在每次启动时恢复小组件布局与位置。
- **多语言支持** — 内置 `en` 和 `zh-CN`，可轻松扩展（参见[添加语言](#添加语言)）。

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

## 🌐 添加语言

请参阅 [docs/ADD_LANGUAGE.md](docs/ADD_LANGUAGE.md) 获取分步指南。

---

## 🤝 贡献指南

提交 Pull Request 前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

---

## 📋 更新日志

见 [CHANGELOG.md](CHANGELOG.md)。

---

## 📄 许可证

MIT © 2024 TimeLens Contributors
