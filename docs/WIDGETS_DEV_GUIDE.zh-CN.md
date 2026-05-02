# 小组件开发指南

本文档说明如何为 TimeLens v0.8.0 小组件注册表雏形开发第三方 JavaScript 小组件。

## 当前范围（v0.8.0）

- 仅支持本地目录加载（`manifest.json` + JS 入口）
- 从应用数据目录 `widgets` 自动扫描注册表
- 渲染接口：`createWidget()` 或 `mount()` 导出
- 数据通道：当前以只读能力为主

暂不包含：
- 远程市场
- 签名校验
- 云端分发

## 目录结构

每个第三方小组件在应用数据目录 `widgets` 下使用独立文件夹。

```text
widgets/
  my-widget/
    manifest.json
    index.js
    assets/
```

## manifest.json

最小示例：

```json
{
  "widget_type": "sample_hello",
  "name": "Sample Hello Widget",
  "description": "Minimal third-party widget example",
  "entry": "index.js",
  "default_size": {
    "width": 360,
    "height": 240
  },
  "permissions": [
    "screen-time:read",
    "active-window:subscribe"
  ]
}
```

### 必填字段

- `widget_type`：唯一类型标识（仅允许 `[a-zA-Z0-9_-]`）
- `name`：注册表展示名称
- `entry`：相对 manifest 目录的 JS 入口文件

### 可选字段

- `description`
- `icon`
- `default_size.width` / `default_size.height`
- `permissions`

## 渲染接口约定

TimeLens 会按 ESM 模块加载入口文件。

支持两种导出方式：

1. 导出 `createWidget()`，返回包含 `mount()` 和可选 `unmount()` 的对象
2. 直接导出 `mount()`，可选导出 `unmount()`

```js
export function createWidget() {
  let root;

  return {
    mount(container, context) {
      root = document.createElement("div");
      root.textContent = `Hello from ${context.widgetType}`;
      container.appendChild(root);
    },
    unmount() {
      root?.remove();
      root = null;
    }
  };
}
```

## Context 与数据通道

`mount(container, context)` 可用字段：

- `context.widgetId`
- `context.widgetType`
- `context.channel`

当前 channel 方法：

- `getTodayAppTotals()`
- `getAppTotalsInRange(startDate, endDate)`
- `getCategoryTotalsInRange(startDate, endDate)`
- `onActiveWindowChanged(callback)`

## 权限模型（雏形）

manifest 中的 `permissions` 会进入注册表元数据。当前里程碑尚未完成强制拦截，主要用于后续“安装时授权 UI”准备。

建议权限字符串：

- `screen-time:read`
- `active-window:subscribe`
- `todo:read`
- `todo:write`
- `settings:write`

## 本地联调

1. 将小组件目录复制到应用数据 `widgets` 目录。
2. 启动 TimeLens 开发模式。
3. 打开小组件中心，切换到“添加小组件”。
4. 找到你的第三方条目并点击添加。
5. 打开创建出的实例窗口。

## 排错

- 注册表看不到条目：
  - 检查 `manifest.json` 是否可解析
  - 检查 `widget_type` 格式
  - 确认 `entry` 文件存在
- 窗口打开但未渲染：
  - 确认导出了 `createWidget()` 或 `mount()`
  - 查看控制台的动态 import 错误
- 创建时报未知类型：
  - 注册表加载失败或 `widget_type` 重复
