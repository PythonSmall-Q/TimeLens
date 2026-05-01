import { useState, useEffect, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Globe, Search, EyeOff, Eye, Bell, BellOff, Trash2, Check, X } from "lucide-react";
import * as api from "@/services/tauriApi";
import type { BrowserDomainStats, BrowserDomainLimit } from "@/types";
import { formatDuration } from "@/utils/format";
import { todayString, daysAgo } from "@/utils/format";
import clsx from "clsx";

type DatePreset = "today" | "week" | "month";

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
                {/* eslint-disable-next-line react/forbid-dom-props */}
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
  const { t } = useTranslation(["browserUsage", "common"]);

  const [preset, setPreset] = useState<DatePreset>("today");
  const [search, setSearch] = useState("");
  const [showIgnored, setShowIgnored] = useState(false);

  const [stats, setStats] = useState<BrowserDomainStats[]>([]);
  const [limits, setLimits] = useState<BrowserDomainLimit[]>([]);
  const [ignoredDomains, setIgnoredDomains] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const [editingHost, setEditingHost] = useState<string | null>(null);

  // Compute date range from preset
  const { startDate, endDate } = useMemo(() => {
    const today = todayString();
    if (preset === "today") return { startDate: today, endDate: today };
    if (preset === "week") return { startDate: daysAgo(6), endDate: today };
    return { startDate: daysAgo(29), endDate: today };
  }, [preset]);

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

  const limitsMap = useMemo(() => {
    const m = new Map<string, BrowserDomainLimit>();
    for (const l of limits) m.set(l.host, l);
    return m;
  }, [limits]);

  const ignoredSet = useMemo(() => new Set(ignoredDomains), [ignoredDomains]);

  // Active stats = not ignored (or show all when showIgnored = true)
  const filteredStats = useMemo(() => {
    let rows = showIgnored ? stats : stats.filter((s) => !ignoredSet.has(s.host));
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter((s) => s.host.toLowerCase().includes(q));
    }
    return rows;
  }, [stats, ignoredSet, showIgnored, search]);

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

  const PRESETS: DatePreset[] = ["today", "week", "month"];

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

        {/* Date preset selector */}
        <div className="flex gap-1.5 bg-surface-hover rounded-xl p-1">
          {PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => setPreset(p)}
              className={clsx(
                "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                preset === p
                  ? "bg-accent-blue text-white shadow"
                  : "text-text-secondary hover:text-text-primary"
              )}
            >
              {t(`browserUsage:${p}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Search + ignored toggle */}
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
        <div className="glass-card p-8 text-center text-text-muted text-sm">
          {t("common:loading")}
        </div>
      ) : filteredStats.length === 0 ? (
        <div className="glass-card p-10 text-center space-y-2">
          <Globe size={32} className="mx-auto text-text-muted opacity-40" />
          <p className="text-text-secondary text-sm font-medium">
            {search ? t("browserUsage:noResults") : t("browserUsage:noBrowserData")}
          </p>
          {!search && (
            <p className="text-text-muted text-xs">{t("browserUsage:noBrowserDataHint")}</p>
          )}
        </div>
      ) : (
        <div className="glass-card divide-y divide-surface-border">
          {filteredStats.map((stat) => (
            <DomainRow
              key={stat.host}
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
