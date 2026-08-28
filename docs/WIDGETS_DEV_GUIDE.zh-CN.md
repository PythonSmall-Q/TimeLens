# 小组件开发指南

本文档描述 Kernel 与 Gateway 重写后的第三方小组件运行时。当前首批支持沙箱 JavaScript/TypeScript 运行时；v4 清单已为 Java 预留字段，但当前版本尚未提供 Java Host。

## 当前范围

当前已支持：

- 从应用数据目录 `widgets` 加载本地小组件包。
- ESM JavaScript 或编译后的 TypeScript 入口文件。
- `createWidget()` 工厂导出，或直接导出 `mount()`。
- 通过 Gateway 访问使用数据查询、待办写入、小组件专属状态、事件订阅和本地 API。
- 运行时同意提示、权限撤销、请求限流、生命周期事件和审计记录。
- 通过兼容适配器继续加载 v1/v2 清单。

当前尚未提供远程市场、云端执行、Java Host、原始数据库/文件系统访问、无限制 `fetch` 或直接调用特权 Tauri API。Gateway 网络与媒体代理已实现：`client.fetch()` 受目标策略、防火墙、超时和响应大小限制；`client.loadMedia()` 还只接受图片、音频或视频，并返回 data URL。

## 小组件目录

```text
widgets/
  my-widget/
    manifest.json
    index.js
    assets/
```

当前 JavaScript 加载器使用顶层 `entry` 路径。编写 v4 清单时，请让它与 `runtime.entry` 保持一致；后者描述运行时契约，并且是共享 v4 Schema 的必填字段。

## Manifest v4

```json
{
  "manifest_version": "v4",
  "widget_type": "sample_hello",
  "name": "Sample Hello Widget",
  "description": "一个通过 Gateway 访问数据的小组件",
  "publisher": "Example Publisher",
  "entry": "index.js",
  "runtime": {
    "language": "javascript",
    "version": "ES2022",
    "entry": "index.js",
    "memory_budget_mb": 64,
    "cpu_budget_ms": 1000
  },
  "ui": { "model": "web-sandbox" },
  "default_size": { "width": 360, "height": 240 },
  "capabilities": ["metrics.summary.read"],
  "capability_justifications": {
    "metrics.summary.read": "用于展示今日使用时长。"
  },
  "sdk_version": "4.0.0"
}
```

v4 契约要求 `manifest_version: "v4"`、唯一的 `widget_type`、`name`、`publisher`、`runtime.language`、`runtime.version`、`runtime.entry`、`ui.model` 和 `capabilities` 数组。运行时语言为 `javascript`、`typescript`、`java`；UI 模型为 `web-sandbox`、`host-block`。

当前 JavaScript 加载器还要求兼容用的顶层 `entry`。`default_size`、`description`、`icon`、`sdk_version`、`signature`、`csp`、内存/CPU 配额、能力说明、请求的网络域名和媒体来源均为可选项。注册表会把 v4 信息归一化后提供给小组件中心。

## 能力与同意

所有特权请求都会先转换为 Gateway 请求。缺少授权时会返回可恢复的拒绝结果；Host 显示同意提示，只有用户允许后才重试一次。用户拒绝后不会被静默绕过。小组件中心支持撤销单项权限或全部权限。

| Scope | Gateway 访问范围 |
|---|---|
| `screen-time:read` | `metrics`、`sessions`、`categories`、`projects`、`tags`、`goals`、`rules`、`focus` 查询 |
| `todo:read` | `todos` 查询 |
| `todo:write` | 新增、切换、删除和排序待办 |
| `browser:read` | 浏览器活动查询 |
| `settings:write` | 通过 SDK 写入专注模式 |
| `local-api:call` | 调用带 Scope 的本地 TimeLens API |

只声明小组件真正需要的能力。`network_domains_requested` 和 `media_sources_requested` 用于声明意图；运行时请求仍会经过 Gateway 策略和同意检查。

## 入口与 Context

TimeLens 以 ESM 模块加载入口，支持 `createWidget()` 返回 `{ mount, unmount }`，或直接导出 `mount(container, context)` 与可选的 `unmount()`；`mount` 可以返回 Promise。

```js
export function createWidget() {
  let root;

  return {
    async mount(container, context) {
      root = document.createElement("div");
      root.textContent = `Hello from ${context.widgetType}`;
      container.appendChild(root);
      const data = await context.client.query("metrics");
      console.log(data);
    },
    unmount() {
      root?.remove();
      root = null;
    },
  };
}
```

Context 包含 `widgetId`、`widgetType`、新的 `client`、兼容旧组件的 `channel`，以及 mount、foreground、background、suspend、resume、uninstall 生命周期回调。新小组件应优先使用 `client`，`channel` 仅用于迁移旧组件。请在 `unmount` 中释放订阅，或对自行持有的 Client 调用 `context.client.dispose()`。

## WidgetClient API

```js
const metrics = await context.client.query("metrics", {
  start: "2026-08-01",
  end: "2026-08-27",
});

const value = await context.client.getState("selected-range");
await context.client.setState("selected-range", "today");
await context.client.deleteState("selected-range");

const todo = await context.client.addTodo("Review screen time");
await context.client.toggleTodo(todo.id);
await context.client.reorderTodos([todo.id]);

const handle = await context.client.subscribe("focus-started", (payload) => {
  console.log(payload);
});
await context.client.unsubscribe(handle);
```

可用查询命名空间为 `metrics`、`sessions`、`categories`、`projects`、`tags`、`goals`、`rules`、`focus`、`todos`、`browser`。浏览器活动也可以使用 `getBrowserActivity(start, end)`。

本地 API 仍通过兼容 channel 调用：

```js
const result = await context.channel.localApiCall({
  method: "GET",
  path: "/api/screen-time/today",
  scopes: ["screen-time:read"],
});
```

channel 会为小组件获取带 Scope 的令牌。不要使用无 Scope 令牌、原始特权桥接或直接调用本地 API。

## 错误、生命周期与测试

Gateway 状态包括 `success`、`denied`、`revoked`、`throttled`、`timed_out`、`degraded` 和 `error`。`WidgetGatewayError` 提供 `code`、`scope`、`recoverable` 字段；可用 `error.isConsentRequired()` 判断是否属于缺少或被拒绝的同意路径。Host 会发出 `mount`、`foreground`、`background`、`suspend`、`resume`、`uninstall` 事件，不要假设窗口会一直保持焦点。

本地测试时，将目录复制到应用数据目录的 `widgets` 下，以开发模式启动 TimeLens，打开小组件中心并添加小组件，检查首次 Gateway 请求的同意提示，再使用权限矩阵撤销和重新授予 Scope。开发模式提供“小组件开发调试台”时，可用它加载本地目录、模拟 Gateway 响应、切换能力并重新加载入口。

当前 Gateway 对每个小组件实例限制为每分钟 60 次 channel 请求。`permission_denied` 表示需要接受同意提示或重新授予 Scope；网络和媒体请求还可能返回策略拒绝、超时、Provider 或大小限制错误，组件应将其作为可恢复错误处理。

v1/v2 迁移细节见 [`WIDGET_SDK_v2_MIGRATION.md`](WIDGET_SDK_v2_MIGRATION.md)。共享 Schema 位于 `src-tauri/widget-contract/manifest-v4.schema.json`，参考模板位于 `examples/third-party-widget-template/`。