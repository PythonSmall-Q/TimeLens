# 第三方小组件模板

该模板演示了在 TimeLens 中运行第三方 JS 小组件所需的最小文件集。

## 文件说明

- `manifest.json`：小组件元数据与注册声明
- `index.js`：ESM 入口，需实现 `createWidget().mount/unmount`

## 测试步骤

1. 将本目录复制到本机 TimeLens 应用数据 widgets 目录，例如：
   - `widgets/third-party-widget-template/`
2. 启动 TimeLens。
3. 打开小组件中心 -> 添加小组件。
4. 添加 `Sample Hello Widget` 并打开。

## 说明

- 当前雏形仅支持本地目录加载。
- `widget_type` 必须在本地已安装小组件中唯一。
- 入口文件必须是有效 ESM，且导出 `createWidget()` 或 `mount()`。
