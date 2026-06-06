import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import * as api from "@/services/tauriApi";
import type { AppUsageRow, BrowserHourDomainStats, InterruptionPeriod } from "@/types";
import AsyncStateCard from "@/components/AsyncStateCard";
import { formatDuration } from "@/utils/format";

interface HourlyAppSummary {
  app_name: string;
  exe_path: string;
  total_seconds: number;
}

export default function InterruptionDetail() {
  const { t } = useTranslation("dashboard");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const date = searchParams.get("date") || "";
  const hour = Number(searchParams.get("hour") || "0");

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<InterruptionPeriod[]>([]);
  const [topApps, setTopApps] = useState<HourlyAppSummary[]>([]);
  const [topDomains, setTopDomains] = useState<BrowserHourDomainStats[]>([]);

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      if (!date) {
        setRows([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const [periods, appPage, domainRows] = await Promise.all([
          api.getInterruptionPeriods(date),
          api.getAppUsagePage(date, date, 3000, 0),
          api.getBrowserDomainStatsForHour(date, hour, 6),
        ]);
        if (!disposed) {
          setRows(periods);
          setTopDomains(domainRows);

          const hourlyRows = appPage.rows.filter((row: AppUsageRow) => {
            const d = new Date(row.first_seen_at);
            return !Number.isNaN(d.getTime()) && d.getHours() === hour;
          });
          const appMap = new Map<string, HourlyAppSummary>();
          for (const row of hourlyRows) {
            const key = `${row.app_name}@@${row.exe_path}`;
            const prev = appMap.get(key);
            if (prev) {
              prev.total_seconds += row.active_seconds;
            } else {
              appMap.set(key, {
                app_name: row.app_name,
                exe_path: row.exe_path,
                total_seconds: row.active_seconds,
              });
            }
          }
          setTopApps(
            Array.from(appMap.values())
              .sort((a, b) => b.total_seconds - a.total_seconds)
              .slice(0, 6)
          );
        }
      } catch {
        if (!disposed) {
          setRows([]);
          setTopApps([]);
          setTopDomains([]);
        }
      } finally {
        if (!disposed) setLoading(false);
      }
    };

    void load();
    return () => {
      disposed = true;
    };
  }, [date, hour]);

  const current = useMemo(() => rows.find((item) => item.hour === hour) || null, [rows, hour]);

  const hourLabel = `${String(hour).padStart(2, "0")}:00 - ${String(hour).padStart(2, "0")}:59`;

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary">{t("timeline.interruptionMarker")}</h1>
          <p className="text-text-muted text-xs mt-0.5">{date ? `${date} ${hourLabel}` : t("noDataShort")}</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="ui-btn-secondary !text-xs !px-3 !py-2" onClick={() => navigate(-1)}>
            {t("backToDashboard")}
          </button>
          {date && (
            <button
              className="ui-btn-secondary !text-xs !px-3 !py-2"
              onClick={() => navigate(`/browser?preset=custom&start=${encodeURIComponent(date)}&end=${encodeURIComponent(date)}`)}
            >
              {t("openRangeInBrowser")}
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <AsyncStateCard variant="loading" title={t("timeline.loading")} compact />
      ) : !current ? (
        <AsyncStateCard variant="empty" title={t("timeline.empty")} compact />
      ) : (
        <div className="glass-card p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <div className="rounded-xl border border-surface-border bg-surface-hover/40 p-3">
              <p className="text-xs text-text-muted">{t("timelineDetail.timeWindow")}</p>
              <p className="text-text-primary font-medium mt-1">{hourLabel}</p>
            </div>
            <div className="rounded-xl border border-surface-border bg-surface-hover/40 p-3">
              <p className="text-xs text-text-muted">{t("switchCount")}</p>
              <p className="text-text-primary font-medium mt-1">{current.switch_count}</p>
            </div>
            <div className="rounded-xl border border-surface-border bg-surface-hover/40 p-3">
              <p className="text-xs text-text-muted">{t("timelineDetail.fragmentScore")}</p>
              <p className="text-text-primary font-medium mt-1">{current.fragment_score.toFixed(2)}</p>
            </div>
          </div>

          <div className="rounded-xl border border-surface-border bg-surface-hover/40 p-3">
            <p className="text-xs text-text-muted mb-2">{t("timelineDetail.sameDayHours")}</p>
            <div className="max-h-64 overflow-y-auto pr-1 space-y-1.5">
              {rows
                .slice()
                .sort((a, b) => b.hour - a.hour)
                .map((item) => (
                  <button
                    key={item.hour}
                    onClick={() => navigate(`/interruptions/detail?date=${encodeURIComponent(date)}&hour=${item.hour}`)}
                    className={[
                      "w-full text-left rounded-lg border px-2.5 py-2 text-xs transition-colors",
                      item.hour === hour
                        ? "border-accent-blue bg-accent-blue/10 text-text-primary"
                        : "border-surface-border bg-surface-card text-text-secondary hover:text-text-primary",
                    ].join(" ")}
                  >
                    {String(item.hour).padStart(2, "0")}:00 - {String(item.hour).padStart(2, "0")}:59 | {t("timeline.interruptionDetail", {
                      count: item.switch_count,
                      score: item.fragment_score.toFixed(2),
                    })}
                  </button>
                ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="rounded-xl border border-surface-border bg-surface-hover/40 p-3">
              <p className="text-xs text-text-muted mb-2">{t("timelineDetail.topAppsInHour")}</p>
              {topApps.length === 0 ? (
                <p className="text-xs text-text-muted">{t("timelineDetail.noAppDataInHour")}</p>
              ) : (
                <div className="space-y-1.5">
                  {topApps.map((app) => (
                    <div key={`${app.app_name}-${app.exe_path}`} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-text-secondary truncate" title={app.exe_path || app.app_name}>{app.app_name}</span>
                      <span className="text-text-primary font-medium">{formatDuration(app.total_seconds)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-surface-border bg-surface-hover/40 p-3">
              <p className="text-xs text-text-muted mb-2">{t("timelineDetail.topDomainsInHour")}</p>
              {topDomains.length === 0 ? (
                <p className="text-xs text-text-muted">{t("timelineDetail.noDomainDataInHour")}</p>
              ) : (
                <div className="space-y-1.5">
                  {topDomains.map((domain) => (
                    <div key={domain.host} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-text-secondary truncate" title={domain.host}>{domain.host}</span>
                      <span className="text-text-primary font-medium">
                        {formatDuration(domain.total_seconds)} · {domain.visit_count}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
