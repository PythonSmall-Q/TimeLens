import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import * as api from "@/services/tauriApi";
import type { BrowserSession, FocusSession, InterruptionPeriod } from "@/types";
import { formatDuration } from "@/utils/format";

type SourceFilter = "all" | "desktop" | "browser" | "interrupt";

interface TimelineEvent {
  id: string;
  at: string;
  source: SourceFilter;
  title: string;
  detail: string;
  risk: "normal" | "warning";
  drilldownPath?: string;
}

interface Props {
  selectedDate: string;
  periodMode: "day" | "week" | "month";
  rangeStart: string;
  rangeEnd: string;
}

function toTimeLabel(isoText: string) {
  const d = new Date(isoText);
  if (Number.isNaN(d.getTime())) return isoText;
  return d.toLocaleString();
}

export default function UnifiedTimeline({ selectedDate, periodMode, rangeStart, rangeEnd }: Props) {
  const { t } = useTranslation("dashboard");
  const navigate = useNavigate();
  const [source, setSource] = useState<SourceFilter>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [focusSessions, setFocusSessions] = useState<FocusSession[]>([]);
  const [browserSessions, setBrowserSessions] = useState<BrowserSession[]>([]);
  const [interruptions, setInterruptions] = useState<InterruptionPeriod[]>([]);

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      setLoading(true);
      try {
        const [focus, browserStatus, interruptionRows] = await Promise.all([
          api.listFocusSessions(`${rangeStart}T00:00:00`, `${rangeEnd}T23:59:59`),
          api.getBrowserExtensionStatus(),
          periodMode === "day" ? api.getInterruptionPeriods(selectedDate) : Promise.resolve([]),
        ]);

        if (disposed) return;
        setFocusSessions(focus);
        setBrowserSessions(browserStatus.recent_sessions ?? []);
        setInterruptions(interruptionRows);
      } catch {
        if (disposed) return;
        setFocusSessions([]);
        setBrowserSessions([]);
        setInterruptions([]);
      } finally {
        if (!disposed) setLoading(false);
      }
    };

    void load();
    return () => {
      disposed = true;
    };
  }, [periodMode, rangeEnd, rangeStart, selectedDate]);

  const events = useMemo(() => {
    const rows: TimelineEvent[] = [];

    for (const session of focusSessions) {
      const startedAt = session.started_at;
      const endedAt = session.ended_at;
      let durationText = t("noDataShort");
      if (endedAt) {
        const startTs = new Date(startedAt).getTime();
        const endTs = new Date(endedAt).getTime();
        if (!Number.isNaN(startTs) && !Number.isNaN(endTs) && endTs > startTs) {
          durationText = formatDuration(Math.round((endTs - startTs) / 1000));
        }
      }

      rows.push({
        id: `focus-${session.id ?? startedAt}`,
        at: startedAt,
        source: "desktop",
        title: t("timeline.focusSession"),
        detail: t("timeline.focusSessionDetail", {
          trigger: session.trigger_type,
          reason: session.reason || t("noDataShort"),
          duration: durationText,
        }),
        risk: "normal",
        drilldownPath: `/focus?from=dashboard&at=${encodeURIComponent(startedAt)}`,
      });
    }

    for (const session of browserSessions) {
      rows.push({
        id: `browser-${session.id ?? `${session.started_at}-${session.tab_url}`}`,
        at: session.started_at,
        source: "browser",
        title: t("timeline.browserSession"),
        detail: t("timeline.browserSessionDetail", {
          host: session.host || session.tab_url,
          duration: formatDuration(session.duration_seconds || 0),
        }),
        risk: "normal",
        drilldownPath: `/browser?preset=custom&start=${encodeURIComponent(rangeStart)}&end=${encodeURIComponent(rangeEnd)}&q=${encodeURIComponent(session.host || "")}`,
      });
    }

    if (periodMode === "day") {
      for (const marker of interruptions) {
        const at = `${selectedDate}T${String(marker.hour).padStart(2, "0")}:00:00`;
        rows.push({
          id: `interrupt-${selectedDate}-${marker.hour}`,
          at,
          source: "interrupt",
          title: t("timeline.interruptionMarker"),
          detail: t("timeline.interruptionDetail", {
            count: marker.switch_count,
            score: marker.fragment_score.toFixed(2),
          }),
          risk: marker.switch_count >= 6 ? "warning" : "normal",
          drilldownPath: `/interruptions/detail?date=${encodeURIComponent(selectedDate)}&hour=${marker.hour}`,
        });
      }
    }

    return rows.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [browserSessions, focusSessions, interruptions, periodMode, rangeEnd, rangeStart, selectedDate, t]);

  const filtered = useMemo(() => {
    let rows = events;
    if (source !== "all") rows = rows.filter((r) => r.source === source);
    const q = query.trim().toLowerCase();
    if (q) rows = rows.filter((r) => `${r.title} ${r.detail}`.toLowerCase().includes(q));
    return rows;
  }, [events, query, source]);

  return (
    <div className="glass-card p-5 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-sm font-semibold text-text-primary">{t("timeline.title")}</h3>
        <p className="text-xs text-text-muted">{t("timeline.range", { start: rangeStart, end: rangeEnd })}</p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {(["all", "desktop", "browser", "interrupt"] as SourceFilter[]).map((item) => (
          <button
            key={item}
            onClick={() => setSource(item)}
            className={[
              "px-2.5 py-1.5 rounded-lg border text-xs transition-colors",
              source === item
                ? "border-accent-blue bg-accent-blue/15 text-accent-blue"
                : "border-surface-border text-text-muted hover:text-text-secondary",
            ].join(" ")}
          >
            {t(`timeline.filter.${item}`)}
          </button>
        ))}
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("timeline.searchPlaceholder")}
          className="ui-field !w-56 !py-1.5 !text-xs"
        />
      </div>

      {loading ? (
        <div className="text-xs text-text-muted">{t("timeline.loading")}</div>
      ) : filtered.length === 0 ? (
        <div className="text-xs text-text-muted">{t("timeline.empty")}</div>
      ) : (
        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {filtered.map((event) => (
            <div
              key={event.id}
              className={[
                "rounded-xl border px-3 py-2",
                event.risk === "warning"
                  ? "border-yellow-300/40 bg-yellow-300/10"
                  : "border-surface-border bg-surface-hover/40",
              ].join(" ")}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-text-primary">{event.title}</span>
                <span className="text-[11px] text-text-muted">{toTimeLabel(event.at)}</span>
              </div>
              <p className="text-xs text-text-secondary mt-1">{event.detail}</p>
              {event.drilldownPath && (
                <div className="mt-2 flex justify-end">
                  <button
                    onClick={() => navigate(event.drilldownPath!)}
                    className="text-[11px] px-2 py-1 rounded-md border border-surface-border text-text-muted hover:text-accent-blue"
                  >
                    {t("timeline.openDetail")}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
