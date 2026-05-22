import * as vscode from "vscode";

function isZh(): boolean {
  return vscode.env.language.toLowerCase().startsWith("zh");
}

interface Messages {
  extensionHome: string;
  todayVsCode: string;
  sessions: string;
  trackingToggle: string;
  disableTracking: string;
  enableTracking: string;
  detailLevel: string;
  apiKey: string;
  changeKey: string;
  configureKey: string;
  noKeyWarning: string;
  notConnected: string;
  topApp: string;
  desktopVersion: string;
  openDashboard: string;
  refresh: string;
  loading: string;
  loadFailed: string;
  retry: string;
  configureKeyPrompt: string;
  configureNow: string;
  setKeyTitle: string;
  setKeyPromptText: string;
  keySaved: string;
  keyCleared: string;
  trackingEnabled: string;
  trackingDisabled: string;
  basicDesc: string;
  basicDetail: string;
  standardDesc: string;
  standardDetail: string;
  detailedDesc: string;
  detailedDetail: string;
  selectLevelTitle: string;
  selectLevelPlaceholder: string;
  levelSet: (label: string) => string;
  statusEnabled: (pending: number) => string;
  statusDisabled: string;
  authFailedKeySet: string;
  authFailedNoKey: string;
  configureKeyBtn: string;
  showLogBtn: string;
}

const en: Messages = {
  // Sidebar webview
  extensionHome: "Extension Home",
  todayVsCode: "Today's VS Code",
  sessions: "sessions",
  trackingToggle: "Tracking",
  disableTracking: "Disable",
  enableTracking: "Enable",
  detailLevel: "Detail Level",
  apiKey: "API Key",
  changeKey: "🔑 Change Key",
  configureKey: "⚙️ Configure Key",
  noKeyWarning: "⚠ API key not configured — sync disabled",
  notConnected: "TimeLens desktop app not connected",
  topApp: "Top app today",
  desktopVersion: "Desktop version",
  openDashboard: "Open Dashboard",
  refresh: "Refresh",
  loading: "Loading...",
  loadFailed: "Failed to load, please retry.",
  retry: "Retry",
  // extension.ts
  configureKeyPrompt: "TimeLens: Configure your extension bridge key to enable syncing. Check the sidebar for details.",
  configureNow: "Configure Now",
  setKeyTitle: "TimeLens: Set Extension Bridge Key",
  setKeyPromptText: "Enter the extension bridge key from TimeLens Settings > Local API / Extension Bridge",
  keySaved: "✓ Extension bridge key saved successfully. Session data will be synced.",
  keyCleared: "⚠ Extension bridge key cleared. Session data will be queued locally.",
  trackingEnabled: "TimeLens tracking enabled",
  trackingDisabled: "TimeLens tracking disabled",
  basicDesc: "Session duration only",
  basicDetail: "No language or project information is recorded.",
  standardDesc: "Duration + language distribution (recommended)",
  standardDetail: "Records which languages you use and how long.",
  detailedDesc: "Duration + language + project path",
  detailedDetail: "Also records the project folder path for each session.",
  selectLevelTitle: "TimeLens: Select Detail Level",
  selectLevelPlaceholder: "Choose how much data to record per session",
  levelSet: (label: string): string => `TimeLens detail level set to: ${label}`,
  statusEnabled: (pending: number): string => `TimeLens tracking is enabled. Pending uploads: ${pending}.`,
  statusDisabled: "TimeLens tracking is disabled.",
  // sessionTracker.ts
  authFailedKeySet: "TimeLens: Extension bridge key authentication failed.",
  authFailedNoKey: "TimeLens: Extension bridge key not configured. Please set your API key.",
  configureKeyBtn: "Configure Key",
  showLogBtn: "Show Log",
};

const zh: Messages = {
  // Sidebar webview
  extensionHome: "扩展主页",
  todayVsCode: "今日 VS Code 时长",
  sessions: "个会话",
  trackingToggle: "记录开关",
  disableTracking: "关闭记录",
  enableTracking: "开启记录",
  detailLevel: "记录级别",
  apiKey: "API 密钥",
  changeKey: "🔑 修改密钥",
  configureKey: "⚙️ 配置密钥",
  noKeyWarning: "⚠ 未配置 API 密钥，数据无法同步",
  notConnected: "未连接到 TimeLens 桌面端",
  topApp: "今日最高应用",
  desktopVersion: "桌面端版本",
  openDashboard: "打开完整仪表盘",
  refresh: "刷新",
  loading: "加载中...",
  loadFailed: "页面加载失败，请重试。",
  retry: "重试",
  // extension.ts
  configureKeyPrompt: "TimeLens: 请配置扩展桥接密钥以启用数据同步，详情请查看侧边栏。",
  configureNow: "立即配置",
  setKeyTitle: "TimeLens: 设置扩展桥接密钥",
  setKeyPromptText: "请输入 TimeLens「设置 > 本地 API / 扩展桥接」中的桥接密钥",
  keySaved: "✓ 扩展桥接密钥已保存，会话数据将自动同步。",
  keyCleared: "⚠ 扩展桥接密钥已清除，会话数据将在本地排队等待。",
  trackingEnabled: "TimeLens 记录已启用",
  trackingDisabled: "TimeLens 记录已禁用",
  basicDesc: "仅记录会话时长",
  basicDetail: "不记录语言或项目信息。",
  standardDesc: "时长 + 语言分布（推荐）",
  standardDetail: "记录所用语言及对应时长。",
  detailedDesc: "时长 + 语言 + 项目路径",
  detailedDetail: "同时记录每个会话的项目文件夹路径。",
  selectLevelTitle: "TimeLens: 选择记录级别",
  selectLevelPlaceholder: "选择每个会话记录的数据量",
  levelSet: (label: string): string => `TimeLens 记录级别已设置为: ${label}`,
  statusEnabled: (pending: number): string => `TimeLens 记录已启用，待上传会话: ${pending}。`,
  statusDisabled: "TimeLens 记录已禁用。",
  // sessionTracker.ts
  authFailedKeySet: "TimeLens: 扩展桥接密钥认证失败。",
  authFailedNoKey: "TimeLens: 未配置扩展桥接密钥，请先设置 API 密钥。",
  configureKeyBtn: "配置密钥",
  showLogBtn: "查看日志",
};

export function t(): Messages {
  return isZh() ? zh : en;
}
