import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStatsStore } from "@/stores/statsStore";
import {
  getFocusModeActive,
  getVsCodeTrackingEnabled,
  setFocusModeActive,
  setVsCodeTrackingEnabled,
} from "@/services/tauriApi";
import { formatDuration, todayString } from "@/utils/format";

const fmt = (d: Date) => d.toISOString().slice(0, 10);

function getMonthRange(monthValue: string): { start: string; end: string } {
  const [y, m] = monthValue.split("-").map(Number);
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 0);
  return { start: fmt(start), end: fmt(end) };
}

const LEVEL_COLORS: Record<string, string> = {
  basic: "bg-surface-hover text-text-secondary",
  standard: "bg-accent/10 text-accent",
  detailed: "bg-green-500/10 text-green-400",
};

export default function VsCodeInsights() {
  const { t } = useTranslation(["dashboard", "common"]);
  const {
    periodMode,
    setPeriodMode,
    selectedDate,
    setSelectedDate,
    vscodeStats,
    vscodeLanguageStats,
    vscodeProjectStats,
    fetchVsCodeStatsForRange,
  } = useStatsStore();

  const [monthValue, setMonthValue] = useState(todayString().slice(0, 7));
  const [trackingEnabled, setTrackingEnabled] = useState(true);
  const [trackingLevel, setTrackingLevel] = useState<string>("standard");
  const [focusEnabled, setFocusEnabled] = useState(false);
  const [saving, setSaving] = useState(false);

  const range = useMemo(() => {
    if (periodMode === "month") {
      return getMonthRange(monthValue);
    }
    return { start: selectedDate, end: selectedDate };
  }, [periodMode, monthValue, selectedDate]);

  const monthOptions = useMemo(() => {
    const rows: string[] = [];
    const base = new Date();
    for (let i = 0; i < 24; i++) {
      const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
      rows.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    return rows;
  }, []);

  useEffect(() => {
    fetchVsCodeStatsForRange(range.start, range.end);
  }, [fetchVsCodeStatsForRange, range.start, range.end]);

  useEffect(() => {
    getVsCodeTrackingEnabled()
      .then((res) => {
        setTrackingEnabled(res.enabled);
        if (res.tracking_level) setTrackingLevel(res.tracking_level);
      })
      .catch(() => setTrackingEnabled(true));

    getFocusModeActive()
      .then(setFocusEnabled)
      .catch(() => setFocusEnabled(false));
  }, []);

  const onToggleTracking = async () => {
    setSaving(true);
    try {
      await setVsCodeTrackingEnabled(!trackingEnabled);
      setTrackingEnabled(!trackingEnabled);
    } finally {
      setSaving(false);
    }
  };

  const onToggleFocus = async () => {
    setSaving(true);
    try {
      await setFocusModeActive(!focusEnabled);
      setFocusEnabled(!focusEnabled);
    } finally {
      setSaving(false);
    }
  };

  // Conditional section visibility: show if data exists OR level covers it
  const showLanguage = vscodeLanguageStats.length > 0 || trackingLevel === "standard" || trackingLevel === "detailed";
  const showProject = vscodeProjectStats.length > 0 || trackingLevel === "detailed";
  const hiddenByLevel = (section: "language" | "project") =>
    section === "language"
      ? trackingLevel === "basic" && vscodeLanguageStats.length === 0
      : (trackingLevel === "basic" || trackingLevel === "standard") && vscodeProjectStats.length === 0;

  const levelLabelKey = `dashboard:trackingLevel_${trackingLevel}` as const;

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-text-primary">{t("dashboard:vscodeInsights")}</h1>
          <p className="text-text-muted text-xs mt-0.5">{t("dashboard:vscodeTitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Tracking on/off toggle in header */}
          <button
            disabled={saving}
            onClick={onToggleTracking}
            title={t("dashboard:vscodeTrackingToggle")}
            className={`ui-btn-secondary !text-xs !px-3 !py-1.5 disabled:opacity-60 ${!trackingEnabled ? "opacity-50" : ""}`}
          >
            {trackingEnabled ? t("dashboard:statusEnabled") : t("dashboard:statusDisabled")}
          </button>

          <select
            className="ui-select !w-24 !py-1.5 !text-xs"
            value={periodMode}
            onChange={(e) => setPeriodMode(e.target.value as "day" | "week" | "month")}
            title={t("dashboard:selectDate")}
            aria-label={t("dashboard:selectDate")}
          >
            <option value="day">{t("dashboard:periodDay")}</option>
            <option value="month">{t("dashboard:periodMonth")}</option>
          </select>

          {periodMode === "day" && (
            <input
              type="date"
              value={selectedDate}
              className="ui-field !w-36 !py-1.5 !text-xs"
              onChange={(e) => setSelectedDate(e.target.value)}
              title={t("dashboard:selectDate")}
              aria-label={t("dashboard:selectDate")}
            />
          )}

          {periodMode === "month" && (
            <select
              value={monthValue}
              className="ui-select !w-36 !py-1.5 !text-xs"
              onChange={(e) => setMonthValue(e.target.value)}
              title={t("dashboard:periodMonth")}
              aria-label={t("dashboard:periodMonth")}
            >
              {monthOptions.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Disabled banner */}
      {!trackingEnabled && (
        <div className="glass-card p-4 border border-yellow-500/30 bg-yellow-500/5 text-sm text-text-secondary">
          {t("dashboard:vscodeTrackingToggle")} — {t("dashboard:statusDisabled")}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="glass-card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text-primary">{t("dashboard:vscodeTitle")}</h2>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${LEVEL_COLORS[trackingLevel] ?? LEVEL_COLORS.standard}`}>
              {t(levelLabelKey, trackingLevel)}
            </span>
          </div>
          <div className="text-2xl font-bold text-gradient">{formatDuration(vscodeStats.total_seconds)}</div>
          <div className="text-xs text-text-secondary">{t("dashboard:vscodeSessions", { count: vscodeStats.session_count })}</div>
        </div>

        <div className="glass-card p-5 space-y-3">
          <h2 className="text-sm font-semibold text-text-primary">{t("dashboard:focusModeToggle")}</h2>
          <div className="flex items-center justify-between text-sm">
            <span className="text-text-secondary">{t("dashboard:focusModeToggle")}</span>
            <button
              disabled={saving}
              onClick={onToggleFocus}
              className="ui-btn-secondary !text-xs !px-3 !py-1.5 disabled:opacity-60"
            >
              {focusEnabled ? t("dashboard:statusEnabled") : t("dashboard:statusDisabled")}
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {showLanguage && (
          <div className="glass-card p-5">
            <h3 className="text-sm font-medium text-text-secondary mb-3">{t("dashboard:vscodeLangRanking")}</h3>
            {hiddenByLevel("language") ? (
              <div className="text-xs text-text-muted italic">{t("dashboard:trackingLevelHidden")}</div>
            ) : (
              <div className="space-y-2">
                {vscodeLanguageStats.slice(0, 10).map((row) => {
                  const total = vscodeLanguageStats.reduce((s, r) => s + r.total_seconds, 0);
                  const pct = total > 0 ? Math.round((row.total_seconds / total) * 100) : 0;
                  return (
                    <div key={row.language} className="space-y-0.5">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-text-primary truncate">{row.language || t("dashboard:noDataShort")}</span>
                        <span className="text-text-secondary text-xs">{formatDuration(row.total_seconds)}</span>
                      </div>
                      <div className="h-1 rounded-full bg-surface-hover overflow-hidden">
                        <div className="h-full bg-accent/60 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
                {vscodeLanguageStats.length === 0 && (
                  <div className="text-xs text-text-muted">{t("common:noData")}</div>
                )}
              </div>
            )}
          </div>
        )}

        {showProject && (
          <div className="glass-card p-5">
            <h3 className="text-sm font-medium text-text-secondary mb-3">{t("dashboard:vscodeProjectRanking")}</h3>
            {hiddenByLevel("project") ? (
              <div className="text-xs text-text-muted italic">{t("dashboard:trackingLevelHidden")}</div>
            ) : (
              <div className="space-y-2">
                {vscodeProjectStats.slice(0, 10).map((row) => {
                  const total = vscodeProjectStats.reduce((s, r) => s + r.total_seconds, 0);
                  const pct = total > 0 ? Math.round((row.total_seconds / total) * 100) : 0;
                  return (
                    <div key={`${row.project_path}-${row.project_name}`} className="space-y-0.5">
                      <div className="flex items-center justify-between text-sm gap-3">
                        <span className="text-text-primary truncate" title={row.project_path || row.project_name}>
                          {row.project_name || t("dashboard:noDataShort")}
                        </span>
                        <span className="text-text-secondary shrink-0 text-xs">{formatDuration(row.total_seconds)}</span>
                      </div>
                      <div className="h-1 rounded-full bg-surface-hover overflow-hidden">
                        <div className="h-full bg-green-400/60 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
                {vscodeProjectStats.length === 0 && (
                  <div className="text-xs text-text-muted">{t("common:noData")}</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
