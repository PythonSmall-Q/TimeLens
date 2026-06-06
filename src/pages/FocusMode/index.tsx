import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Focus, Play, Square, Clock } from "lucide-react";
import * as api from "@/services/tauriApi";
import type { FocusSession } from "@/types";
import clsx from "clsx";
import AsyncStateCard from "@/components/AsyncStateCard";

const FOCUS_RULES_KEY = "timelens.focus.rules.v1";

interface FocusAutomationRule {
  id: string;
  name: string;
  start: string;
  end: string;
  minRecentFocusMinutes: number;
  enabled: boolean;
}

interface SimulationResult {
  matched: boolean;
  reason: string;
  suggestedAction: "start" | "keep" | "none";
}

function hmToMinutes(value: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

function inWindow(nowMinutes: number, start: string, end: string): boolean {
  const s = hmToMinutes(start);
  const e = hmToMinutes(end);
  if (s === null || e === null) return false;
  if (s === e) return true;
  if (s < e) return nowMinutes >= s && nowMinutes < e;
  return nowMinutes >= s || nowMinutes < e;
}

function recentFocusMinutes(sessions: FocusSession[], days: number): number {
  const now = Date.now();
  const threshold = now - days * 24 * 3600 * 1000;
  let secs = 0;
  for (const s of sessions) {
    const started = new Date(s.started_at).getTime();
    if (Number.isNaN(started) || started < threshold) continue;
    const ended = s.ended_at ? new Date(s.ended_at).getTime() : now;
    if (Number.isNaN(ended) || ended <= started) continue;
    secs += Math.round((ended - started) / 1000);
  }
  return Math.floor(secs / 60);
}

function durationLabel(started: string, ended: string | null): string {
  const s = new Date(started).getTime();
  const e = ended ? new Date(ended).getTime() : Date.now();
  const secs = Math.max(0, Math.floor((e - s) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function FocusModePage() {
  const { t } = useTranslation(["focus", "common"]);
  const [active, setActive] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [sessions, setSessions] = useState<FocusSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [tick, setTick] = useState(0);
  const [rules, setRules] = useState<FocusAutomationRule[]>(() => {
    try {
      const raw = localStorage.getItem(FOCUS_RULES_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as FocusAutomationRule[];
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((r) => Boolean(r?.id && r?.name && r?.start && r?.end));
    } catch {
      return [];
    }
  });
  const [draftName, setDraftName] = useState("");
  const [draftStart, setDraftStart] = useState("09:00");
  const [draftEnd, setDraftEnd] = useState("11:00");
  const [draftMinFocus, setDraftMinFocus] = useState(30);
  const [simulationByRule, setSimulationByRule] = useState<Record<string, SimulationResult>>({});

  const loadState = useCallback(async () => {
    setLoading(true);
    try {
      const [isActive, history] = await Promise.all([
        api.getFocusModeActive(),
        api.listFocusSessions(),
      ]);
      setActive(isActive);
      setSessions(history);
      const open = history.find((s) => s.ended_at == null);
      setActiveSessionId(open?.id ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadState(); }, [loadState]);

  useEffect(() => {
    localStorage.setItem(FOCUS_RULES_KEY, JSON.stringify(rules));
  }, [rules]);

  // Live timer tick every second while active
  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, [active]);

  const handleToggle = async () => {
    setToggling(true);
    try {
      if (!active) {
        const id = await api.startFocusSession(undefined, "manual");
        await api.setFocusModeActive(true);
        setActive(true);
        setActiveSessionId(id);
      } else {
        if (activeSessionId != null) {
          await api.stopFocusSession(activeSessionId);
        }
        await api.setFocusModeActive(false);
        setActive(false);
        setActiveSessionId(null);
        await loadState();
      }
    } finally {
      setToggling(false);
    }
  };

  const simulateRule = useCallback((rule: FocusAutomationRule): SimulationResult => {
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    if (!rule.enabled) {
      return {
        matched: false,
        reason: t("focus:automation.disabled"),
        suggestedAction: "none",
      };
    }
    if (!inWindow(nowMinutes, rule.start, rule.end)) {
      return {
        matched: false,
        reason: t("focus:automation.outOfWindow", { start: rule.start, end: rule.end }),
        suggestedAction: "none",
      };
    }

    const recent = recentFocusMinutes(sessions, 7);
    if (recent < rule.minRecentFocusMinutes) {
      return {
        matched: false,
        reason: t("focus:automation.notEnoughFocus", { recent, required: rule.minRecentFocusMinutes }),
        suggestedAction: "none",
      };
    }

    if (active) {
      return {
        matched: true,
        reason: t("focus:automation.alreadyActive"),
        suggestedAction: "keep",
      };
    }

    return {
      matched: true,
      reason: t("focus:automation.readyToStart"),
      suggestedAction: "start",
    };
  }, [active, sessions, t]);

  const runRuleSimulation = useCallback((rule: FocusAutomationRule) => {
    setSimulationByRule((prev) => ({ ...prev, [rule.id]: simulateRule(rule) }));
  }, [simulateRule]);

  const applyRuleNow = useCallback(async (rule: FocusAutomationRule) => {
    const result = simulateRule(rule);
    setSimulationByRule((prev) => ({ ...prev, [rule.id]: result }));
    if (result.suggestedAction !== "start") return;

    const id = await api.startFocusSession(rule.name, "rule");
    await api.setFocusModeActive(true);
    setActive(true);
    setActiveSessionId(id);
    await loadState();
  }, [loadState, simulateRule]);

  const addRule = () => {
    const name = draftName.trim();
    if (!name) return;
    const row: FocusAutomationRule = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      start: draftStart,
      end: draftEnd,
      minRecentFocusMinutes: Math.max(0, draftMinFocus),
      enabled: true,
    };
    setRules((prev) => [row, ...prev].slice(0, 20));
    setDraftName("");
  };

  const activeSession = sessions.find((s) => s.ended_at == null);
  const pastSessions = sessions.filter((s) => s.ended_at != null);

  return (
    <div className="p-6 space-y-6 w-full">
      <div>
        <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
          <Focus size={22} className="text-accent-purple" />
          {t("focus:title")}
        </h1>
        <p className="text-text-secondary text-sm mt-1">{t("focus:subtitle")}</p>
      </div>

      {/* Toggle card */}
      <div className={clsx(
        "glass-card p-6 flex items-center gap-5 transition-all",
        active && "ring-2 ring-accent-purple/40"
      )}>
        <div className={clsx(
          "w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg transition-colors",
          active ? "bg-accent-purple" : "bg-surface-hover"
        )}>
          <Focus size={26} className={active ? "text-white" : "text-text-muted"} />
        </div>
        <div className="flex-1">
          <p className="text-base font-semibold text-text-primary">
            {active ? t("focus:activeTitle") : t("focus:inactiveTitle")}
          </p>
          {active && activeSession ? (
            <p className="text-sm text-text-secondary mt-0.5">
              <Clock size={12} className="inline mr-1" />
              {/* tick used to force re-render */}
              {durationLabel(activeSession.started_at, null)}
              {/* eslint-disable-next-line @typescript-eslint/no-unused-expressions */}
              {void tick}
            </p>
          ) : (
            <p className="text-sm text-text-secondary mt-0.5">{t("focus:hint")}</p>
          )}
        </div>
        <button
          className={clsx(
            "flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium text-sm transition-colors",
            active
              ? "bg-accent-red/20 text-accent-red hover:bg-accent-red/30"
              : "btn-primary"
          )}
          onClick={handleToggle}
          disabled={toggling || loading}
        >
          {active ? <Square size={14} /> : <Play size={14} />}
          {active ? t("focus:stop") : t("focus:start")}
        </button>
      </div>

      {/* Session history */}
      <div>
        <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3">
          {t("focus:history")}
        </h2>
        <div className="glass-card divide-y divide-surface-border">
          {loading ? (
            <AsyncStateCard variant="loading" title={t("common:loading")} compact />
          ) : pastSessions.length === 0 ? (
            <AsyncStateCard variant="empty" title={t("focus:noHistory")} compact />
          ) : (
            pastSessions.slice(0, 20).map((s, i) => (
              <div key={s.id ?? i} className="flex items-center gap-3 px-4 py-3">
                <div className="w-8 h-8 rounded-lg bg-accent-purple/10 flex items-center justify-center flex-shrink-0">
                  <Focus size={14} className="text-accent-purple" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary">
                    {new Date(s.started_at).toLocaleString()}
                  </p>
                  <p className="text-xs text-text-muted">
                    {s.trigger_type === "manual" ? t("focus:triggerManual") : t("focus:triggerAuto")}
                    {s.reason ? ` · ${s.reason}` : ""}
                  </p>
                </div>
                <span className="text-sm text-text-secondary font-mono">
                  {durationLabel(s.started_at, s.ended_at)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Rule automation */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">
          {t("focus:automation.title")}
        </h2>

        <div className="glass-card p-4 space-y-3">
          <p className="text-xs text-text-muted">{t("focus:automation.hint")}</p>
          <div className="grid grid-cols-1 md:grid-cols-[1.2fr_auto_auto_auto_auto] gap-2">
            <input
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder={t("focus:automation.ruleNamePlaceholder")}
              className="ui-field"
            />
            <input type="time" value={draftStart} onChange={(e) => setDraftStart(e.target.value)} className="ui-field !w-28" />
            <input type="time" value={draftEnd} onChange={(e) => setDraftEnd(e.target.value)} className="ui-field !w-28" />
            <input
              type="number"
              min={0}
              max={600}
              value={draftMinFocus}
              onChange={(e) => setDraftMinFocus(Number(e.target.value || "0"))}
              className="ui-field !w-28"
              title={t("focus:automation.minRecentFocus")}
            />
            <button onClick={addRule} className="btn-primary !px-3">{t("focus:automation.addRule")}</button>
          </div>
        </div>

        <div className="glass-card divide-y divide-surface-border">
          {rules.length === 0 ? (
            <AsyncStateCard variant="empty" title={t("focus:automation.empty")} compact />
          ) : (
            rules.map((rule) => {
              const simulation = simulationByRule[rule.id];
              return (
                <div key={rule.id} className="p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      <p className="text-sm text-text-primary font-medium">{rule.name}</p>
                      <p className="text-xs text-text-muted">
                        {t("focus:automation.ruleMeta", {
                          start: rule.start,
                          end: rule.end,
                          min: rule.minRecentFocusMinutes,
                        })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r)))}
                        className={clsx(
                          "px-2.5 py-1 rounded-lg border text-xs",
                          rule.enabled ? "border-accent-blue/40 text-accent-blue" : "border-surface-border text-text-muted"
                        )}
                      >
                        {rule.enabled ? t("focus:automation.enabled") : t("focus:automation.disabledShort")}
                      </button>
                      <button onClick={() => runRuleSimulation(rule)} className="px-2.5 py-1 rounded-lg border border-surface-border text-xs text-text-secondary hover:bg-surface-hover">
                        {t("focus:automation.simulate")}
                      </button>
                      <button onClick={() => void applyRuleNow(rule)} className="px-2.5 py-1 rounded-lg border border-accent-purple/50 text-xs text-accent-purple hover:bg-accent-purple/10">
                        {t("focus:automation.applyNow")}
                      </button>
                      <button onClick={() => setRules((prev) => prev.filter((r) => r.id !== rule.id))} className="px-2.5 py-1 rounded-lg border border-surface-border text-xs text-text-muted hover:text-accent-red">
                        {t("common:delete")}
                      </button>
                    </div>
                  </div>

                  {simulation && (
                    <p className={clsx("text-xs", simulation.matched ? "text-accent-green" : "text-text-muted")}>
                      {simulation.reason}
                    </p>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
