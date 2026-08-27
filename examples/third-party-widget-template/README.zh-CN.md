# 第三方小组件模板

该模板是一个完整的 TypeScript 小组件示例，展示重写后的 TimeLens 运行时。组件包含按钮，可调用当前 WidgetClient、兼容 channel、同意、本地 API，以及网络/媒体预留接口。

## 文件说明

- `manifest.json`：小组件元数据与 v4 运行时声明
- `index.ts`：TypeScript ESM 入口和完整 API 展示
- `dist/index.js`：TimeLens 实际加载的编译产物
- `package.json`：构建脚本；运行 `npm install && npm run build` 可将 `index.ts` 编译为 `dist/index.js`
- `tsconfig.json`：TypeScript 编译选项

## Manifest v4

```json
{
  "manifest_version": "v4",
  "widget_type": "sample_hello",
  "name": "Sample Hello Widget",
  "publisher": "TimeLens Example",
  "entry": "dist/index.js",
  "runtime": { "language": "typescript", "version": "5.0", "entry": "dist/index.js" },
  "ui": { "model": "web-sandbox" },
  "capabilities": [
    "screen-time:read", "todo:read", "todo:write", "browser:read",
    "settings:write", "local-api:call", "active-window:subscribe"
  ]
}
```

v4 中 capability 字符串就是运行时 Scope。示例声明全部已实现的 Scope，因为它会展示所有接口。网络和媒体调用仅用于展示当前尚未实现的返回结果。

## 构建

```bash
npm install
npm run build
```

## 测试步骤

1. 先构建，确保生成 `dist/index.js`。
2. 将本目录复制到本机 TimeLens 应用数据 widgets 目录，例如：
   - `widgets/sample_hello/`
2. 启动 TimeLens。
3. 打开小组件中心 → 添加小组件。
4. 添加 `Sample Hello Widget` 并打开。

如需快速迭代，可使用小组件开发调试台（仅开发模式）：

1. 打开小组件中心 → 「开发调试」。
2. 选择本模板文件夹。
3. 切换能力并即时重载。

## 说明

- `widget_type` 必须在本地已安装小组件中唯一。
- 入口文件必须是有效 ESM，且导出 `createWidget()` 或 `mount()`。
- 新小组件通过 `context.client.query(...)` 使用 Gateway 数据接口。
- 仅在兼容旧 API 时使用 `context.channel.localApiCall({ method, path, scopes })`。
- “Client queries/state” 会调用所有查询命名空间、浏览器活动和状态接口。
- “Todo write lifecycle” 会新增、切换、排序并删除一个临时待办。
- “Legacy read channel” 会调用兼容读取接口。
- “Focus/settings writes”和“Local API call”需要对应 Scope。
- “Test reserved network/media”预期会显示 Provider 尚未实现。
- 当前运行时指南见 `docs/WIDGETS_DEV_GUIDE.zh-CN.md`，v1/v2 迁移见 `docs/WIDGET_SDK_v2_MIGRATION.md`。
