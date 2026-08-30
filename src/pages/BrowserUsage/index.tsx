import { useState, useEffect, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Globe, Search, EyeOff, Eye, Bell, BellOff, Trash2, Check, X, Puzzle, Settings, RefreshCw } from "lucide-react";
import * as api from "@/services/tauriApi";
import type { BrowserDomainStats, BrowserDomainLimit, BrowserExtensionStatus } from "@/types";
import { formatDuration } from "@/utils/format";
import { todayString, daysAgo } from "@/utils/format";
import clsx from "clsx";
import AsyncStateCard from "@/components/AsyncStateCard";

type DatePreset = "today" | "week" | "month" | "all" | "custom";
const SAVED_VIEWS_KEY = "timelens.browserUsage.savedViews.v1";

interface BrowserUsageSavedView {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  createdAt: string;
}

// ── Limit edit inline form ────────────────────────────────────

interface LimitFormProps {
  host: string;
  existing?: BrowserDomainLimit;
  onSave: (hours: number, minutes: number, enabled: boolean) => void;
  onCancel: () => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

function LimitForm({ host, existing, onSave, onCancel, t }: LimitFormProps) {
  const existingSecs = existing?.daily_limit_seconds ?? 3600;
  const [hours, setHours] = useState(Math.floor(existingSecs / 3600));
  const [minutes, setMinutes] = useState(Math.floor((existingSecs % 3600) / 60));
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);

  return (
    <div className="mt-2 p-3 bg-surface-light border border-accent-blue/30 rounded-xl space-y-2 text-sm">
      <p className="text-xs font-medium text-text-secondary">
        {t("browserUsage:domainLimitTitle", { host })}
      </p>
      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-1.5 text-text-secondary text-xs">
          <input
            type="number"
            min={0}
            max={23}
            value={hours}
            onChange={(e) => setHours(Math.max(0, Math.min(23, Number(e.target.value))))}
            className="w-14 bg-surface-hover border border-surface-border rounded-lg px-2 py-1 text-text-primary text-center outline-none focus:border-accent-blue"
          />
          {t("browserUsage:hours")}
        </label>
        <label className="flex items-center gap-1.5 text-text-secondary text-xs">
          <input
            type="number"
            min={0}
            max={59}
            value={minutes}
            onChange={(e) => setMinutes(Math.max(0, Math.min(59, Number(e.target.value))))}
            className="w-14 bg-surface-hover border border-surface-border rounded-lg px-2 py-1 text-text-primary text-center outline-none focus:border-accent-blue"
          />
          {t("browserUsage:minutes")}
        </label>
        <label className="flex items-center gap-1.5 text-text-secondary text-xs cursor-pointer select-none">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="accent-accent-blue"
          />
          {t("browserUsage:limitEnabled")}
        </label>
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => onSave(hours, minutes, enabled)}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent-blue/20 text-accent-blue text-xs font-medium hover:bg-accent-blue/30 transition-colors"
        >
          <Check size={12} /> {t("browserUsage:save")}
        </button>
        <button
          onClick={onCancel}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-surface-border text-text-muted text-xs hover:text-text-primary transition-colors"
        >
          <X size={12} /> {t("browserUsage:cancel")}
        </button>
      </div>
    </div>
  );
}

// ── Domain row ────────────────────────────────────────────────

interface DomainRowProps {
  stat: BrowserDomainStats;
  limit?: BrowserDomainLimit;
  isIgnored: boolean;
  editingHost: string | null;
  onIgnore: (host: string) => void;
  onUnignore: (host: string) => void;
  onEditLimit: (host: string) => void;
  onSaveLimit: (host: string, hours: number, minutes: number, enabled: boolean) => void;
  onRemoveLimit: (host: string) => void;
  onCancelEdit: () => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

function DomainRow({
  stat, limit, isIgnored, editingHost,
  onIgnore, onUnignore, onEditLimit, onSaveLimit, onRemoveLimit, onCancelEdit, t,
}: DomainRowProps) {
  const ratio = limit && limit.enabled && limit.daily_limit_seconds > 0
    ? stat.total_seconds / limit.daily_limit_seconds
    : null;

  const barColor =
    ratio === null ? "bg-accent-blue"
    : ratio >= 1 ? "bg-accent-red"
    : ratio >= 0.9 ? "bg-accent-yellow"
    : "bg-accent-blue";

  return (
    <div className={clsx(
      "px-4 py-3 transition-colors",
      isIgnored && "opacity-50"
    )}>
      <div className="flex items-center gap-3">
        {/* Favicon placeholder */}
        <div className="w-6 h-6 rounded-full bg-surface-hover flex items-center justify-center flex-shrink-0">
          <Globe size={12} className="text-text-muted" />
        </div>

        {/* Domain + meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-text-primary truncate">{stat.host}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent-blue/10 text-accent-blue">
              {stat.browser_name || t("browserUsage:unknownBrowser")}
            </span>
            {isIgnored && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-hover text-text-muted">
                {t("browserUsage:ignored")}
              </span>
            )}
            {limit?.enabled && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent-blue/15 text-accent-blue">
                {t("browserUsage:hasLimit")}: {formatDuration(limit.daily_limit_seconds)}
              </span>
            )}
          </div>

          {/* Limit progress bar */}
          {ratio !== null && (
            <div className="mt-1.5">
              <div className="flex justify-between text-[10px] text-text-muted mb-0.5">
                <span>{t("browserUsage:percentUsed", { pct: Math.round(ratio * 100) })}</span>
                <span>{formatDuration(stat.total_seconds)} / {formatDuration(limit!.daily_limit_seconds)}</span>
              </div>
              <div className="h-1 bg-surface-hover rounded-full overflow-hidden">
                <div
                  className={clsx("h-full rounded-full transition-all", barColor)}
                  style={{ width: `${Math.min(100, ratio * 100).toFixed(1)}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Right-side stats */}
        <div className="text-right flex-shrink-0">
          <p className="text-sm font-semibold text-text-primary">{formatDuration(stat.total_seconds)}</p>
          <p className="text-[10px] text-text-muted">{stat.visit_count} {t("browserUsage:visits")}</p>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => isIgnored ? onUnignore(stat.host) : onIgnore(stat.host)}
            title={isIgnored ? t("browserUsage:unignore") : t("browserUsage:ignore")}
            className="p-1.5 rounded-lg text-text-muted hover:text-accent-yellow hover:bg-accent-yellow/10 transition-colors"
          >
            {isIgnored ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
          <button
            onClick={() => editingHost === stat.host ? onCancelEdit() : onEditLimit(stat.host)}
            title={limit ? t("browserUsage:editLimit") : t("browserUsage:setLimit")}
            className={clsx(
              "p-1.5 rounded-lg transition-colors",
              editingHost === stat.host
                ? "text-accent-blue bg-accent-blue/10"
                : "text-text-muted hover:text-accent-blue hover:bg-accent-blue/10"
            )}
          >
            {limit?.enabled ? <Bell size={14} /> : <BellOff size={14} />}
          </button>
          {limit && (
            <button
              onClick={() => onRemoveLimit(stat.host)}
              title={t("browserUsage:removeLimit")}
              className="p-1.5 rounded-lg text-text-muted hover:text-accent-red hover:bg-accent-red/10 transition-colors"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Inline limit editor */}
      {editingHost === stat.host && (
        <LimitForm
          host={stat.host}
          existing={limit}
          onSave={(h, m, en) => onSaveLimit(stat.host, h, m, en)}
          onCancel={onCancelEdit}
          t={t}
        />
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────

export default function BrowserUsage() {
  const { t } = useTranslation(["browserUsage", "common", "settings"]);
  const [searchParams] = useSearchParams();

  const [preset, setPreset] = useState<DatePreset>("today");
  const [customStartDate, setCustomStartDate] = useState(daysAgo(6));
  const [customEndDate, setCustomEndDate] = useState(todayString());
  const [viewName, setViewName] = useState("");
  const [savedViews, setSavedViews] = useState<BrowserUsageSavedView[]>(() => {
    try {
      const raw = localStorage.getItem(SAVED_VIEWS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as BrowserUsageSavedView[];
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((v) => Boolean(v?.id && v?.name && v?.startDate && v?.endDate));
    } catch {
      return [];
    }
  });
  const [search, setSearch] = useState("");
  const [browserFilter, setBrowserFilter] = useState("all");
  const [showIgnored, setShowIgnored] = useState(false);

  const [stats, setStats] = useState<BrowserDomainStats[]>([]);
  const [limits, setLimits] = useState<BrowserDomainLimit[]>([]);
  const [ignoredDomains, setIgnoredDomains] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const [editingHost, setEditingHost] = useState<string | null>(null);
  const [browserExtensionEnabled, setBrowserExtensionEnabled] = useState(true);
  const [browserExtensionStatus, setBrowserExtensionStatus] = useState<BrowserExtensionStatus | null>(null);
  const [showExtensionSettings, setShowExtensionSettings] = useState(false);

  useEffect(() => {
    const q = searchParams.get("q");
    const presetFromQuery = searchParams.get("preset");
    const start = searchParams.get("start");
    const end = searchParams.get("end");

    if (q) {
      setSearch(q);
    }

    if (start || end) {
      setPreset("custom");
      setCustomStartDate(start ?? end ?? todayString());
      setCustomEndDate(end ?? start ?? todayString());
      return;
    }

    if (
      presetFromQuery
      && ["today", "week", "month", "all", "custom"].includes(presetFromQuery)
    ) {
      setPreset(presetFromQuery as DatePreset);
    }
  }, [searchParams]);

  useEffect(() => {
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(savedViews));
  }, [savedViews]);

  // Compute date range from preset/custom range
  const { startDate, endDate } = useMemo(() => {
    const today = todayString();
    if (preset === "custom") {
      const start = customStartDate || today;
      const end = customEndDate || today;
      if (start <= end) return { startDate: start, endDate: end };
      return { startDate: end, endDate: start };
    }
    if (preset === "all") return { startDate: "1970-01-01", endDate: today };
    if (preset === "today") return { startDate: today, endDate: today };
    if (preset === "week") return { startDate: daysAgo(6), endDate: today };
    return { startDate: daysAgo(29), endDate: today };
  }, [preset, customStartDate, customEndDate]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [s, l, ig] = await Promise.all([
        api.getBrowserDomainStats(startDate, endDate),
        api.getBrowserDomainLimits(),
        api.getBrowserIgnoredDomains(),
      ]);
      setStats(s);
      setLimits(l);
      setIgnoredDomains(ig);
    } catch {
      // API unavailable – keep existing state
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => { loadData(); }, [loadData]);

  // Auto-refresh when the app window regains focus
  useEffect(() => {
    const onFocus = () => { void loadData(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadData]);

  const refreshBrowserExtensionStatus = useCallback(async () => {
    try {
      const [settings, status] = await Promise.all([
        api.getAppSettings(),
        api.getBrowserExtensionStatus(),
      ]);
      setBrowserExtensionEnabled(settings.browser_extension_enabled);
      setBrowserExtensionStatus(status);
    } catch {
      // Keep current state on failure
    }
  }, []);

  useEffect(() => {
    void refreshBrowserExtensionStatus();
  }, [refreshBrowserExtensionStatus]);

  const limitsMap = useMemo(() => {
    const m = new Map<string, BrowserDomainLimit>();
    for (const l of limits) m.set(l.host, l);
    return m;
  }, [limits]);

  const ignoredSet = useMemo(() => new Set(ignoredDomains), [ignoredDomains]);

  const browserOptions = useMemo(() => {
    const names = stats
      .map((stat) => stat.browser_name || t("browserUsage:unknownBrowser"))
      .filter((name, index, all) => all.indexOf(name) === index)
      .sort((a, b) => a.localeCompare(b));
    return names;
  }, [stats, t]);

  // Active stats = not ignored (or show all when showIgnored = true)
  const filteredStats = useMemo(() => {
    let rows = showIgnored ? stats : stats.filter((s) => !ignoredSet.has(s.host));
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter((s) =>
        s.host.toLowerCase().includes(q)
        || (s.browser_name || t("browserUsage:unknownBrowser")).toLowerCase().includes(q)
      );
    }
    if (browserFilter !== "all") {
      rows = rows.filter((s) => (s.browser_name || t("browserUsage:unknownBrowser")) === browserFilter);
    }
    return rows;
  }, [stats, ignoredSet, showIgnored, search, browserFilter, t]);

  const ignoredStats = useMemo(() =>
    stats.filter((s) => ignoredSet.has(s.host)),
    [stats, ignoredSet]);

  // ── Handlers ─────────────────────────────────────────────────

  const handleIgnore = useCallback(async (host: string) => {
    const next = [...ignoredDomains, host];
    setIgnoredDomains(next);
    await api.setBrowserIgnoredDomains(next).catch(() => {});
  }, [ignoredDomains]);

  const handleUnignore = useCallback(async (host: string) => {
    const next = ignoredDomains.filter((h) => h !== host);
    setIgnoredDomains(next);
    await api.setBrowserIgnoredDomains(next).catch(() => {});
  }, [ignoredDomains]);

  const handleSaveLimit = useCallback(async (host: string, hours: number, minutes: number, enabled: boolean) => {
    const secs = hours * 3600 + minutes * 60;
    await api.saveBrowserDomainLimit(host, secs || 3600, enabled).catch(() => {});
    setEditingHost(null);
    const updated = await api.getBrowserDomainLimits().catch(() => limits);
    setLimits(updated);
  }, [limits]);

  const handleRemoveLimit = useCallback(async (host: string) => {
    await api.removeBrowserDomainLimit(host).catch(() => {});
    setLimits((prev) => prev.filter((l) => l.host !== host));
  }, []);

  const handleSaveView = useCallback(() => {
    const name = viewName.trim();
    if (!name) return;
    const next: BrowserUsageSavedView = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      startDate,
      endDate,
      createdAt: new Date().toISOString(),
    };
    setSavedViews((prev) => [next, ...prev].slice(0, 12));
    setViewName("");
  }, [viewName, startDate, endDate]);

  const handleApplySavedView = useCallback((view: BrowserUsageSavedView) => {
    setPreset("custom");
    setCustomStartDate(view.startDate);
    setCustomEndDate(view.endDate);
    setSearch("");
  }, []);

  const handleDeleteSavedView = useCallback((id: string) => {
    setSavedViews((prev) => prev.filter((v) => v.id !== id));
  }, []);

  const handlePresetChange = useCallback((next: DatePreset) => {
    setPreset(next);
    setEditingHost(null);
    if (next !== "custom") {
      setSearch("");
      setViewName("");
    }
  }, []);

  const handleSaveTodayView = useCallback(() => {
    const today = todayString();
    const next: BrowserUsageSavedView = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: `${t("browserUsage:today")} ${today}`,
      startDate: today,
      endDate: today,
      createdAt: new Date().toISOString(),
    };
    setSavedViews((prev) => [next, ...prev].slice(0, 12));
  }, [t]);

  const PRESETS: DatePreset[] = ["today", "week", "month", "all", "custom"];
  const BROWSER_EXTENSION_DOWNLOAD_URL = "https://microsoftedge.microsoft.com/addons/detail/ggpfddncgjgicapbhiifkcffbfjcdcpi";
  const browserLinkPayload = JSON.stringify(
    {
      app: "TimeLens",
      apiBaseUrl: browserExtensionStatus?.api_base_url ?? "http://127.0.0.1:49152",
      enabled: browserExtensionEnabled,
    },
    null,
    2,
  );

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-text-primary flex items-center gap-2">
            <Globe size={20} className="text-accent-blue" />
            {t("browserUsage:title")}
          </h1>
          <p className="text-text-muted text-xs mt-0.5">{t("browserUsage:subtitle")}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <button
            onClick={() => setShowExtensionSettings(true)}
            className="px-3 py-1.5 rounded-xl text-xs font-medium border border-surface-border text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors inline-flex items-center gap-1.5"
          >
            <Settings size={13} />
            {t("settings:browser.title")}
          </button>
          <button
            onClick={() => void loadData()}
            disabled={loading}
            title={t("browserUsage:refresh")}
            className="p-1.5 rounded-xl border border-surface-border text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors disabled:opacity-40"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
          <a
            href={BROWSER_EXTENSION_DOWNLOAD_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 rounded-xl text-xs font-medium border border-accent-blue/40 text-accent-blue hover:bg-accent-blue/10 transition-colors"
          >
            {t("browserUsage:downloadEdgeAddon")}
          </a>

          {/* Date preset selector */}
          <div className="flex gap-1.5 bg-surface-card border border-surface-border rounded-xl p-1 shadow-xs">
            {PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => handlePresetChange(p)}
                className={clsx(
                  "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150",
                  preset === p
                    ? "bg-accent-blue/15 text-accent-blue border border-accent-blue/30 shadow-xs"
                    : "text-text-secondary border border-transparent hover:text-accent-blue hover:bg-accent-blue/10"
                )}
              >
                {t(`browserUsage:${p}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {showExtensionSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="glass-card w-full max-w-2xl p-5 space-y-4 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Puzzle size={15} className="text-accent-blue" />
                <h2 className="text-sm font-semibold text-text-primary">{t("settings:browser.title")}</h2>
              </div>
              <button
                onClick={() => setShowExtensionSettings(false)}
                className="text-xs px-3 py-1.5 rounded-lg border border-surface-border text-text-secondary hover:bg-surface-hover transition-colors"
              >
                {t("common:close")}
              </button>
            </div>

            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-text-secondary">{t("settings:browser.enable")}</span>
              <button
                onClick={async () => {
                  const next = !browserExtensionEnabled;
                  setBrowserExtensionEnabled(next);
                  await api.setBrowserExtensionEnabled(next).catch(() => setBrowserExtensionEnabled(!next));
                  await refreshBrowserExtensionStatus();
                }}
                title={t("settings:browser.enable")}
                className={clsx(
                  "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                  browserExtensionEnabled ? "bg-accent-blue" : "bg-surface-hover"
                )}
              >
                <span
                  className={clsx(
                    "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
                    browserExtensionEnabled ? "translate-x-6" : "translate-x-1"
                  )}
                />
              </button>
            </div>

            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-text-secondary">{t("settings:browser.status")}</span>
              <span className={clsx(
                "text-xs px-2.5 py-1 rounded-full border",
                browserExtensionStatus?.connected
                  ? "border-accent-green/40 text-accent-green bg-accent-green/10"
                  : "border-surface-border text-text-muted bg-surface-hover"
              )}>
                {browserExtensionStatus?.connected ? t("settings:browser.connected") : t("settings:browser.waiting")}
              </span>
            </div>

            <div className="rounded-lg border border-surface-border bg-surface-hover/40 p-3 space-y-2">
              <p className="text-xs text-text-secondary">{t("browserUsage:localApiPort", { port: browserExtensionStatus?.api_base_url ? new URL(browserExtensionStatus.api_base_url).port || "49152" : "49152" })}</p>
              <p className="text-xs text-text-secondary">{t("settings:browser.hint")}</p>
              <div className="flex items-center gap-2 justify-between flex-wrap">
                <span className="text-xs font-mono text-text-secondary">
                  {browserExtensionStatus?.api_base_url ?? "http://127.0.0.1:49152"}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={async () => {
                      await navigator.clipboard.writeText(browserExtensionStatus?.api_base_url ?? "http://127.0.0.1:49152");
                    }}
                    className="text-xs px-3 py-1.5 rounded-lg border border-surface-border text-text-secondary hover:bg-surface-hover transition-colors"
                  >
                    {t("settings:browser.copyApiUrl")}
                  </button>
                  <button
                    onClick={async () => {
                      await navigator.clipboard.writeText(browserLinkPayload);
                    }}
                    className="text-xs px-3 py-1.5 rounded-lg border border-surface-border text-text-secondary hover:bg-surface-hover transition-colors"
                  >
                    {t("settings:browser.copyConfig")}
                  </button>
                </div>
              </div>
              <div className="text-xs text-text-muted space-y-1">
                <p>{t("settings:browser.lastBrowser", { browser: browserExtensionStatus?.last_browser_name ?? t("settings:browser.none") })}</p>
                <p>{t("settings:browser.lastLocale", { locale: browserExtensionStatus?.last_locale ?? t("settings:browser.none") })}</p>
                <p>{t("settings:browser.lastSync", { time: browserExtensionStatus?.last_sync_at ?? t("settings:browser.none") })}</p>
                <p>{t("settings:browser.recentSessions", { count: browserExtensionStatus?.recent_session_count ?? 0 })}</p>
              </div>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {(browserExtensionStatus?.recent_sessions ?? []).map((session, index) => (
                  <div key={session.id ?? `${session.started_at}-${session.tab_url}-${index}`} className="rounded-lg border border-surface-border px-3 py-2">
                    <div className="text-xs text-text-primary truncate">{session.title || session.host}</div>
                    <div className="text-[11px] text-text-muted truncate">{session.host || session.tab_url}</div>
                    <div className="text-[11px] text-text-muted">
                      {session.browser_name} · {Math.floor(session.duration_seconds / 60)}m · {session.locale || t("settings:browser.none")}
                    </div>
                  </div>
                ))}
                {(browserExtensionStatus?.recent_sessions ?? []).length === 0 && (
                  <p className="text-xs text-text-muted">{t("settings:browser.noSessions")}</p>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={refreshBrowserExtensionStatus}
                  className="text-xs px-3 py-1.5 rounded-lg border border-accent-blue/50 text-accent-blue hover:bg-accent-blue/10 transition-colors"
                >
                  {t("settings:browser.refresh")}
                </button>
                <a
                  href={BROWSER_EXTENSION_DOWNLOAD_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border border-accent-blue/40 text-accent-blue hover:bg-accent-blue/10 transition-colors"
                >
                  {t("browserUsage:downloadEdgeAddon")}
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Search + ignored toggle */}
      <div className="glass-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-semibold text-text-primary">{t("browserUsage:savedViewsTitle")}</h2>
          <p className="text-xs text-text-muted">
            {t("browserUsage:rangeHint", { startDate, endDate })}
          </p>
        </div>
        {preset === "custom" ? (
          <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1.2fr_auto] gap-2">
            <label className="text-xs text-text-secondary flex flex-col gap-1">
              {t("browserUsage:customStart")}
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => {
                  setPreset("custom");
                  setCustomStartDate(e.target.value);
                }}
                className="px-3 py-2 bg-surface-hover border border-surface-border rounded-xl text-text-primary outline-none focus:border-accent-blue"
              />
            </label>
            <label className="text-xs text-text-secondary flex flex-col gap-1">
              {t("browserUsage:customEnd")}
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => {
                  setPreset("custom");
                  setCustomEndDate(e.target.value);
                }}
                className="px-3 py-2 bg-surface-hover border border-surface-border rounded-xl text-text-primary outline-none focus:border-accent-blue"
              />
            </label>
            <label className="text-xs text-text-secondary flex flex-col gap-1">
              {t("browserUsage:savedViewName")}
              <input
                type="text"
                value={viewName}
                onChange={(e) => setViewName(e.target.value)}
                placeholder={t("browserUsage:savedViewNamePlaceholder")}
                className="px-3 py-2 bg-surface-hover border border-surface-border rounded-xl text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue"
              />
            </label>
            <div className="flex items-end">
              <button
                onClick={handleSaveView}
                disabled={!viewName.trim()}
                className="w-full px-3 py-2 rounded-xl border border-accent-blue/40 text-accent-blue text-xs font-medium hover:bg-accent-blue/10 transition-colors disabled:opacity-40"
              >
                {t("browserUsage:saveCurrentView")}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end">
            <button
              onClick={handleSaveTodayView}
              className="px-3 py-2 rounded-xl border border-accent-blue/40 text-accent-blue text-xs font-medium hover:bg-accent-blue/10 transition-colors"
            >
              {t("browserUsage:saveTodayData")}
            </button>
          </div>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          {savedViews.length === 0 && (
            <p className="text-xs text-text-muted">{t("browserUsage:noSavedViews")}</p>
          )}
          {savedViews.map((view) => (
            <div
              key={view.id}
              className={clsx(
                "inline-flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs",
                view.startDate === startDate && view.endDate === endDate
                  ? "border-accent-blue/50 text-accent-blue bg-accent-blue/10"
                  : "border-surface-border text-text-secondary bg-surface-hover/40"
              )}
            >
              <button
                onClick={() => handleApplySavedView(view)}
                className="hover:text-text-primary transition-colors"
                title={t("browserUsage:applyView")}
              >
                {view.name}
              </button>
              <button
                onClick={() => handleDeleteSavedView(view.id)}
                className="text-text-muted hover:text-accent-red transition-colors"
                title={t("browserUsage:deleteView")}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-3 items-center flex-wrap">
        <div className="relative flex-1 min-w-40">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
          <input
            type="text"
            placeholder={t("browserUsage:searchDomain")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-2 bg-surface-hover border border-surface-border rounded-xl text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue transition-colors"
          />
        </div>
        <select
          value={browserFilter}
          onChange={(e) => setBrowserFilter(e.target.value)}
          className="ui-select min-w-36 !py-2 !text-sm"
          title={t("browserUsage:filterBrowser")}
          aria-label={t("browserUsage:filterBrowser")}
        >
          <option value="all">{t("browserUsage:allBrowsers")}</option>
          {browserOptions.map((browser) => (
            <option key={browser} value={browser}>{browser}</option>
          ))}
        </select>
        {ignoredStats.length > 0 && (
          <button
            onClick={() => setShowIgnored((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-surface-border text-xs text-text-secondary hover:text-text-primary transition-colors"
          >
            {showIgnored ? <EyeOff size={13} /> : <Eye size={13} />}
            {showIgnored ? t("browserUsage:hideIgnored") : t("browserUsage:showIgnored")}
            <span className="ml-0.5 px-1.5 py-0.5 bg-surface-hover rounded-full text-[10px]">
              {ignoredStats.length}
            </span>
          </button>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <AsyncStateCard variant="loading" title={t("common:loading")} />
      ) : filteredStats.length === 0 ? (
        <AsyncStateCard
          variant="empty"
          title={search ? t("browserUsage:noResults") : t("browserUsage:noBrowserData")}
          hint={!search ? t("browserUsage:noBrowserDataHint") : undefined}
          action={!search ? (
            <a
              href={BROWSER_EXTENSION_DOWNLOAD_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-accent-blue/40 text-accent-blue hover:bg-accent-blue/10 transition-colors"
            >
              {t("browserUsage:downloadEdgeAddon")}
            </a>
          ) : undefined}
        />
      ) : (
        <div className="glass-card divide-y divide-surface-border">
          {filteredStats.map((stat) => (
            <DomainRow
              key={`${stat.browser_name || "unknown"}:${stat.host}`}
              stat={stat}
              limit={limitsMap.get(stat.host)}
              isIgnored={ignoredSet.has(stat.host)}
              editingHost={editingHost}
              onIgnore={handleIgnore}
              onUnignore={handleUnignore}
              onEditLimit={(h) => setEditingHost(h)}
              onSaveLimit={handleSaveLimit}
              onRemoveLimit={handleRemoveLimit}
              onCancelEdit={() => setEditingHost(null)}
              t={t as (key: string, opts?: Record<string, unknown>) => string}
            />
          ))}
        </div>
      )}

      {/* Summary footer */}
      {!loading && filteredStats.length > 0 && (
        <p className="text-xs text-text-muted text-right">
          {t("browserUsage:totalDomains", { count: filteredStats.length })}
        </p>
      )}
    </div>
  );
}
