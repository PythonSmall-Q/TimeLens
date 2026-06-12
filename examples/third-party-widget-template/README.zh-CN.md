# 第三方小组件模板

该模板演示了在 TimeLens 中运行第三方 JS 小组件所需的最小文件集。

## 文件说明

- `manifest.json`：小组件元数据与注册声明（Widget SDK v2）
- `index.js`：ESM 入口，需实现 `createWidget().mount/unmount`
- `index.ts`：同一小组件的 TypeScript 源码（可选）
- `package.json`：构建脚本；运行 `npm install && npm run build` 可将 `index.ts` 编译为 `dist/index.js`
- `tsconfig.json`：TypeScript 编译选项

## Manifest v2

```json
{
  "manifest_version": 2,
  "widget_type": "sample_hello",
  "name": "Sample Hello Widget",
  "entry": "index.js",
  "capabilities": ["read_metrics", "automation_trigger"]
}
```

### 能力（Capabilities）

| 能力 | 授予的运行时权限 |
|---|---|
| `read_metrics` | `screen-time:read`、`todo:read` |
| `write_data` | `todo:write`、`settings:write` |
| `automation_trigger` | `active-window:subscribe` |
| `local_api_call` | `local-api:call` |

## 测试步骤

1. 将本目录复制到本机 TimeLens 应用数据 widgets 目录，例如：
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
- 通过 `context.channel.localApiCall({ method, path, scopes })` 调用 TimeLens 本地 HTTP API。
- 从 v1 清单迁移请参考 `docs/WIDGET_SDK_v2_MIGRATION.md`。
