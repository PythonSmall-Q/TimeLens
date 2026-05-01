import { getLocale, t } from "./i18n.js";

const API_BASE = "http://127.0.0.1:49152";
const STORAGE_KEYS = {
  activeSession: "timelens.activeSession",
  recentSessions: "timelens.recentSessions",
  apiStatus: "timelens.apiStatus",
  pendingSessions: "timelens.pendingSessions",
  lastSyncError: "timelens.lastSyncError",
};

const statusBadge = document.querySelector("#status-badge");
const statusText = document.querySelector("#status-text");
const todayList = document.querySelector("#today-list");
const recentList = document.querySelector("#recent-list");
const activeTabPill = document.querySelector("#active-tab-pill");
const refreshButton = document.querySelector("#refresh-button");
const locale = getLocale();

applyStaticTranslations();

refreshButton.addEventListener("click", () => {
  loadAll();
});

document.addEventListener("DOMContentLoaded", loadAll);

async function loadAll() {
  await Promise.all([
    loadApiStatus(),
    loadTodayUsage(),
    loadSessions(),
  ]);
}

async function loadApiStatus() {
  const {
    [STORAGE_KEYS.apiStatus]: cachedStatus,
    [STORAGE_KEYS.pendingSessions]: pendingSessions = [],
    [STORAGE_KEYS.lastSyncError]: lastSyncError,
  } = await chrome.storage.local.get([
    STORAGE_KEYS.apiStatus,
    STORAGE_KEYS.pendingSessions,
    STORAGE_KEYS.lastSyncError,
  ]);

  try {
    const response = await fetch(`${API_BASE}/api/status`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    renderStatus({ ok: true, data, checkedAt: Date.now(), pendingCount: pendingSessions.length, lastSyncError });
  } catch (error) {
    renderStatus(cachedStatus ?? {
      ok: false,
      checkedAt: Date.now(),
      error: String(error),
      pendingCount: pendingSessions.length,
      lastSyncError,
    });
  }
}

async function loadTodayUsage() {
  try {
    const response = await fetch(`${API_BASE}/api/screen-time/today`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const rows = await response.json();
    renderTodayUsage(Array.isArray(rows) ? rows.slice(0, 5) : []);
  } catch {
    renderTodayUsage([]);
  }
}

async function loadSessions() {
  const {
    [STORAGE_KEYS.activeSession]: activeSession,
    [STORAGE_KEYS.recentSessions]: recentSessions = [],
  } = await chrome.storage.local.get([
    STORAGE_KEYS.activeSession,
    STORAGE_KEYS.recentSessions,
  ]);

  renderActiveSession(activeSession);
  renderRecentSessions(recentSessions.slice(0, 6));
}

function renderStatus(status) {
  statusBadge.textContent = status.ok ? t("connected", {}, locale) : t("offline", {}, locale);
  statusBadge.className = `badge ${status.ok ? "ok" : "error"}`;

  if (status.ok) {
    if (status.data?.browser_extension_enabled === false) {
      statusText.textContent = `${t("extensionDisabled", {}, locale)} · pending: ${status.pendingCount ?? 0}`;
      return;
    }
    const version = status.data?.version ? `v${status.data.version}` : t("unknownVersion", {}, locale);
    const focus = status.data?.focus_active ? t("focusOn", {}, locale) : t("focusOff", {}, locale);
    const pending = status.pendingCount ?? 0;
    const err = status.lastSyncError?.error ? ` · last: ${status.lastSyncError.error}` : "";
    statusText.textContent = `${t("reachable", { version, focus }, locale)} · pending: ${pending}${err}`;
    return;
  }

  const pending = status.pendingCount ?? 0;
  statusText.textContent = `${t("unreachable", {}, locale)} · pending: ${pending}`;
}

function renderTodayUsage(rows) {
  if (!rows.length) {
    todayList.innerHTML = `<li class="empty">${t("noUsage", {}, locale)}</li>`;
    return;
  }

  // The desktop API returns tuples: [app_name, exe_path, total_seconds]
  todayList.innerHTML = rows.map((row) => {
    const appName = Array.isArray(row) ? row[0] : (row.app_name ?? "");
    const exePath = Array.isArray(row) ? row[1] : (row.exe_path ?? "");
    const seconds = Array.isArray(row) ? (row[2] ?? 0) : (row.total_seconds ?? 0);
    const label = escapeHtml(appName || exePath || t("noData", {}, locale));
    const value = formatDuration(seconds);
    return `
      <li class="metric-item">
        <span class="metric-name">${label}</span>
        <span class="metric-value">${value}</span>
      </li>
    `;
  }).join("");
}

function renderActiveSession(session) {
  if (!session) {
    activeTabPill.textContent = t("noActiveTab", {}, locale);
    return;
  }

  activeTabPill.textContent = session.host || session.title || t("activeTab", {}, locale);
}

function renderRecentSessions(sessions) {
  if (!sessions.length) {
    recentList.innerHTML = `<li class="empty">${t("noSessions", {}, locale)}</li>`;
    return;
  }

  recentList.innerHTML = sessions.map((session) => {
    const title = escapeHtml(session.title || session.host || session.url || t("untitledTab", {}, locale));
    const host = escapeHtml(session.host || t("unknownSite", {}, locale));
    const duration = formatDuration(Math.round((session.durationMs || 0) / 1000));
    const endedAt = session.endedAt ? new Date(session.endedAt).toLocaleTimeString() : "active";
    return `
      <li class="session-item">
        <span class="session-title">${title}</span>
        <span class="session-host">${host}</span>
        <span class="session-meta">${duration} · ${endedAt}</span>
      </li>
    `;
  }).join("");
}

function applyStaticTranslations() {
  document.documentElement.lang = locale;
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    const key = element.getAttribute("data-i18n");
    if (!key) return;
    element.textContent = t(key, {}, locale);
  });
}

function formatDuration(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${Math.max(0, totalSeconds)}s`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
