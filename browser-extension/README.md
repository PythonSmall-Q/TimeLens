# TimeLens Browser Companion

> English | [简体中文](#timelens-浏览器伴侣)

This directory contains the official **TimeLens Browser Extension** — a companion plugin that tracks browser tab usage and syncs data with the local TimeLens desktop application.

## Overview

The browser extension runs as a Manifest V3 service-worker extension. It records how long you spend on each browser tab (grouped by domain) and forwards the sessions to the TimeLens desktop app via its local HTTP API (`127.0.0.1:49152`). This allows TimeLens to include browser usage alongside desktop app usage in your daily screen-time reports.

## Features

| Feature | Description |
|---------|-------------|
| **Tab Session Tracking** | Automatically records time on the active tab, paused when you switch tabs, minimise the browser, or go idle. |
| **Idle Detection** | Uses `chrome.idle` to stop counting when you are away from the keyboard for more than 60 seconds. |
| **Offline Buffering** | Sessions are queued locally when the desktop app is offline and flushed automatically once it comes back. |
| **Popup Dashboard** | Click the toolbar icon to see today's top domains, recent sessions, and the connection status to TimeLens. |
| **Multi-language UI** | Built-in English and Simplified Chinese support, matching the desktop app's locale. |
| **Chrome & Firefox** | Packaged for both Chromium-based browsers and Firefox (see `scripts/build-chrome.js`). |

## Architecture

```
browser-extension/
├── manifest.json          # Manifest V3 definition
├── background.js          # Service worker — tracking & sync logic
├── popup.html / popup.js  # Toolbar popup UI
├── popup.css              # Popup styles
├── i18n.js                # Lightweight i18n helper
├── _locales/              # Locale strings (en, zh_CN)
├── icons/                 # Extension icons
└── scripts/               # Build helpers
```

- **`background.js`** handles `tabs`, `windows`, `idle`, and `alarms` events, maintains the active session in `chrome.storage.local`, and POSTs completed sessions to the desktop API.
- **`popup.js`** reads the cached sessions and calls `/api/screen-time/today` to render the popup dashboard.

## Build

```bash
# Lint
npm run lint

# Build for Firefox (default)
npm run build

# Build for Chrome
npm run build:chrome
```

## Related

- [TimeLens Desktop README](../README.md)
- [TimeLens Desktop README (中文)](../README_zh.md)

---

# TimeLens 浏览器伴侣

> [English](#timelens-browser-companion) | 简体中文

本目录包含官方 **TimeLens 浏览器扩展** —— 一个用于跟踪浏览器标签页使用时长，并与本地 TimeLens 桌面应用同步数据的配套插件。

## 概述

该扩展以 Manifest V3 Service Worker 形式运行。它会记录你在各个浏览器标签页上的停留时间（按域名聚合），并通过本地 HTTP API（`127.0.0.1:49152`）将使用会话转发给 TimeLens 桌面端。这样，TimeLens 就能在每日屏幕时间报告中同时展示浏览器使用情况与桌面应用使用情况。

## 功能特性

| 功能 | 说明 |
|------|------|
| **标签页会话跟踪** | 自动记录当前活跃标签页的停留时间，切换标签页、最小化浏览器或进入空闲状态时自动暂停。 |
| **空闲检测** | 借助 `chrome.idle` API，当你超过 60 秒未操作键盘/鼠标时停止计时。 |
| **离线缓冲** | 桌面端离线时，会话数据先在本地排队缓存，待桌面端恢复后自动批量上报。 |
| **弹出面板** | 点击工具栏图标，即可查看今日热门域名、近期会话记录以及与 TimeLens 的连接状态。 |
| **多语言界面** | 内置英文与简体中文支持，与桌面端语言设置保持一致。 |
| **Chrome & Firefox** | 同时支持 Chromium 内核浏览器与 Firefox（参见 `scripts/build-chrome.js`）。 |

## 架构

```
browser-extension/
├── manifest.json          # Manifest V3 配置
├── background.js          # Service Worker —— 跟踪与同步逻辑
├── popup.html / popup.js  # 工具栏弹出面板 UI
├── popup.css              # 弹出面板样式
├── i18n.js                # 轻量国际化辅助模块
├── _locales/              # 本地化字符串（en、zh_CN）
├── icons/                 # 扩展图标
└── scripts/               # 构建脚本
```

- **`background.js`** 负责处理 `tabs`、`windows`、`idle` 和 `alarms` 事件，将当前会话保存在 `chrome.storage.local` 中，并通过 POST 请求将已完成的会话发送至桌面端 API。
- **`popup.js`** 读取缓存的会话数据，并调用 `/api/screen-time/today` 接口渲染弹出面板。

## 构建

```bash
# 代码检查
npm run lint

# 构建 Firefox 版本（默认）
npm run build

# 构建 Chrome 版本
npm run build:chrome
```

## 相关文档

- [TimeLens 桌面端 README](../README.md)
- [TimeLens 桌面端 README (中文)](../README_zh.md)
