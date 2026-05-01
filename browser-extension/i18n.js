const TRANSLATIONS = {
  en: {
    connection: "Desktop connection",
    checking: "Checking",
    connected: "Connected",
    offline: "Offline",
    today: "Today in TimeLens",
    refresh: "Refresh",
    recentSessions: "Recent tab sessions",
    noActiveTab: "No active tab",
    noData: "No data yet",
    noUsage: "No app usage returned by the local API",
    noSessions: "No tracked browser sessions yet",
    browserCompanion: "Browser Companion",
    subtitle: "See local app status and your latest browser sessions without opening the desktop app.",
    reachable: "Desktop app reachable on localhost. {{version}}, {{focus}}.",
    unreachable: "TimeLens desktop app is not reachable on 127.0.0.1:49152.",
    focusOn: "Focus mode on",
    focusOff: "Focus mode off",
    unknownVersion: "unknown version",
    untitledTab: "Untitled tab",
    activeTab: "Active tab",
    unknownSite: "Unknown site",
    extensionDisabled: "Desktop app has browser sync disabled.",
  },
  "zh-CN": {
    connection: "桌面端连接",
    checking: "检查中",
    connected: "已连接",
    offline: "离线",
    today: "TimeLens 今日数据",
    refresh: "刷新",
    recentSessions: "最近标签页会话",
    noActiveTab: "当前没有活动标签页",
    noData: "暂无数据",
    noUsage: "本地 API 还没有返回应用使用数据",
    noSessions: "还没有浏览器会话记录",
    browserCompanion: "浏览器伴侣",
    subtitle: "无需打开桌面端，也能查看本地状态和最近的浏览器会话。",
    reachable: "桌面端已在 localhost 可访问。{{version}}，{{focus}}。",
    unreachable: "当前无法连接 127.0.0.1:49152 上的 TimeLens 桌面端。",
    focusOn: "专注模式开启",
    focusOff: "专注模式关闭",
    unknownVersion: "未知版本",
    untitledTab: "未命名标签页",
    activeTab: "活动标签页",
    unknownSite: "未知站点",
    extensionDisabled: "桌面端已关闭浏览器同步。",
  },
};

export function getLocale() {
  const raw = (globalThis.chrome?.i18n?.getUILanguage?.() || navigator.language || "en").toLowerCase();
  if (raw.startsWith("zh")) {
    return "zh-CN";
  }
  return "en";
}

export function t(key, vars = {}, locale = getLocale()) {
  const table = TRANSLATIONS[locale] ?? TRANSLATIONS.en;
  const template = table[key] ?? TRANSLATIONS.en[key] ?? key;
  return Object.entries(vars).reduce(
    (acc, [name, value]) => acc.replaceAll(`{{${name}}}`, String(value)),
    template,
  );
}