# VS Code Extension API Key Configuration Guide

## 问题

VS Code 扩展需要配置一个 API 密钥才能将数据同步到 TimeLens 桌面应用。如果没有配置，会看到以下问题：

- 错误信息：`TimeLens: Extension bridge key authentication failed`
- 数据无法同步到桌面应用
- 侧边栏显示无法连接到 TimeLens 桌面端

## 解决步骤

### 1. 从 TimeLens 桌面应用获取 API 密钥

1. 打开 **TimeLens 桌面应用**
2. 进入 **Settings (设置)** → **Local API / Extension Bridge**
3. 查找 **Extension Bridge Key** 字段
4. 复制显示的密钥

### 2. 在 VS Code 扩展中配置密钥

#### 方式 A：使用侧边栏（推荐）

1. 打开 VS Code
2. 看 **TimeLens** 侧边栏（左侧活动栏）
3. 如果没有配置密钥，会看到 **⚙️ 配置 API 密钥** 按钮
4. 点击按钮输入从桌面应用复制的密钥

#### 方式 B：使用命令面板

1. 按 `Ctrl+Shift+P`（或 `Cmd+Shift+P` on Mac）
2. 搜索 **TimeLens: Set Extension Bridge Key**
3. 输入从桌面应用复制的密钥

#### 方式 C：直接编辑设置

1. 打开 VS Code 设置 (`Ctrl+,`)
2. 搜索 `timelens.bridgeKey`
3. 在值字段中粘贴密钥

### 3. 验证连接

配置后：

- 侧边栏应显示 **"未连接到 TimeLens 桌面端"** 消息消失
- 状态栏显示 `TimeLens: On [standard] (0)`
- 每 30 秒自动同步一次数据到桌面应用
- 侧边栏显示今日 VS Code 使用时长

## 常见问题

### "Extension bridge key authentication failed" 错误

**原因**：
- 密钥不正确或已过期
- TimeLens 桌面应用未运行
- API 端点配置错误

**解决**：
1. 检查密钥是否从 Settings 正确复制
2. 确保 TimeLens 桌面应用正在运行
3. 使用按钮或命令重新配置密钥

### 侧边栏显示 "未连接到 TimeLens 桌面端"

**原因**：
- TimeLens 桌面应用未运行
- API 地址配置错误（默认 `http://127.0.0.1:49152`）

**解决**：
1. 启动 TimeLens 桌面应用
2. 确保 TimeLens 应用中启用了 Local API
3. 检查 VS Code 设置中的 `timelens.apiBaseUrl`

### 数据无法同步

**原因**：
- 密钥未设置或错误
- 追踪功能已禁用
- 数据队列中有错误的记录

**解决**：
1. 重新配置 API 密钥（见上面的步骤）
2. 确保侧边栏中 **记录开关** 已启用
3. 重启 VS Code 扩展

## 配置选项

在 VS Code 设置中可用的 TimeLens 配置：

- `timelens.bridgeKey` - Extension Bridge Key（必需）
- `timelens.apiBaseUrl` - TimeLens API 地址（默认：`http://127.0.0.1:49152`）
- `timelens.enabled` - 启用/禁用追踪（默认：true）
- `timelens.trackingLevel` - 追踪详细程度（basic/standard/detailed）
- `timelens.flushIntervalSeconds` - 同步间隔秒数（默认：30）
- `timelens.idleThresholdSeconds` - 空闲阈值秒数（默认：120）

## 数据流

```
VS Code Extension
    ↓ (records sessions)
Session Queue
    ↓ (every 30 seconds)
TimeLens API (with bridge key auth)
    ↓
TimeLens Desktop App
```

当密钥配置正确时，数据会自动同步到桌面应用。

## 调试

如需查看详细日志：

1. 打开 VS Code **Output** 面板（`Ctrl+Shift+U`）
2. 选择 **Extension Host** 或搜索 `[TimeLens]`
3. 查看认证和网络相关的错误消息

## 支持

如果问题仍未解决：

1. 检查 TimeLens 桌面应用中的日志
2. 确认 API 密钥在桌面应用设置中仍然有效
3. 尝试重新启动 VS Code 和 TimeLens 桌面应用
