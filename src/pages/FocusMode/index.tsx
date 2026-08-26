import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Focus, Play, Square, Clock } from "lucide-react";
import * as api from "@/services/tauriApi";
import type { FocusSession, FocusRule, FocusRuleMatch } from "@/types";
import clsx from "clsx";
import AsyncStateCard from "@/components/AsyncStateCard";

type RuleType = "keyword" | "time_window" | "app";
type MatchType = "contains" | "exact" | "regex";
type RuleAction = "enter_focus" | "leave_focus";

interface KeywordCondition {
  match_type: MatchType;
  keyword: string;
}

interface TimeWindowCondition {
  start: string;
  end: string;
}

interface AppCondition {
  app_name: string;
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

function parseKeywordCondition(conditionJson: string): KeywordCondition {
  try {
    const parsed = JSON.parse(conditionJson) as Partial<KeywordCondition>;
    return {
      match_type: ["contains", "exact", "regex"].includes(parsed.match_type ?? "")
        ? (parsed.match_type as MatchType)
        : "contains",
      keyword: typeof parsed.keyword === "string" ? parsed.keyword : "",
    };
  } catch {
    return { match_type: "contains", keyword: "" };
  }
}

function parseTimeWindowCondition(conditionJson: string): TimeWindowCondition {
  try {
    const parsed = JSON.parse(conditionJson) as Partial<TimeWindowCondition>;
    return {
      start: typeof parsed.start === "string" ? parsed.start : "09:00",
      end: typeof parsed.end === "string" ? parsed.end : "11:00",
    };
  } catch {
    return { start: "09:00", end: "11:00" };
  }
}

function parseAppCondition(conditionJson: string): AppCondition {
  try {
    const parsed = JSON.parse(conditionJson) as Partial<AppCondition>;
    return { app_name: typeof parsed.app_name === "string" ? parsed.app_name : "" };
  } catch {
    return { app_name: "" };
  }
}

function ruleMetaLabel(rule: FocusRule, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (rule.rule_type === "keyword") {
    const c = parseKeywordCondition(rule.condition_json);
    return t("focus:automation.ruleMetaKeyword", { matchType: c.match_type, keyword: c.keyword || "?" });
  }
  if (rule.rule_type === "time_window") {
    const c = parseTimeWindowCondition(rule.condition_json);
    return t("focus:automation.ruleMetaTimeWindow", { start: c.start, end: c.end });
  }
  const c = parseAppCondition(rule.condition_json);
  return t("focus:automation.ruleMetaApp", { app: c.app_name || "?" });
}

export default function FocusModePage() {
  const { t } = useTranslation(["focus", "common"]);
  const [active, setActive] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [sessions, setSessions] = useState<FocusSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [tick, setTick] = useState(0);
  const [rules, setRules] = useState<FocusRule[]>([]);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [ruleError, setRuleError] = useState<string | null>(null);

  const [draftName, setDraftName] = useState("");
  const [draftRuleType, setDraftRuleType] = useState<RuleType>("time_window");
  const [draftAction, setDraftAction] = useState<RuleAction>("enter_focus");
  const [draftAutoStart, setDraftAutoStart] = useState(true);
  const [draftQuietHoursRespect, setDraftQuietHoursRespect] = useState(true);
  const [draftMatchType, setDraftMatchType] = useState<MatchType>("contains");
  const [draftKeyword, setDraftKeyword] = useState("");
  const [draftStart, setDraftStart] = useState("09:00");
  const [draftEnd, setDraftEnd] = useState("11:00");
  const [draftAppName, setDraftAppName] = useState("");

  const [simulationByRule, setSimulationByRule] = useState<Record<number, FocusRuleMatch>>({});
  const [savingRule, setSavingRule] = useState(false);
  const [ruleSuccess, setRuleSuccess] = useState<string | null>(null);

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

  const loadRules = useCallback(async () => {
    setRulesLoading(true);
    try {
      const rows = await api.getFocusRules();
      setRules(rows);
    } catch {
      setRules([]);
    } finally {
      setRulesLoading(false);
    }
  }, []);

  useEffect(() => { loadState(); }, [loadState]);
  useEffect(() => { loadRules(); }, [loadRules]);

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

  const buildDraftConditionJson = useCallback((): string => {
    if (draftRuleType === "keyword") {
      return JSON.stringify({ match_type: draftMatchType, keyword: draftKeyword.trim() });
    }
    if (draftRuleType === "time_window") {
      return JSON.stringify({ start: draftStart, end: draftEnd });
    }
    return JSON.stringify({ app_name: draftAppName.trim() });
  }, [draftRuleType, draftMatchType, draftKeyword, draftStart, draftEnd, draftAppName]);

  const resetDraft = useCallback((type: RuleType) => {
    setDraftRuleType(type);
    if (type === "keyword") {
      setDraftMatchType("contains");
      setDraftKeyword("");
    } else if (type === "time_window") {
      setDraftStart("09:00");
      setDraftEnd("11:00");
    } else {
      setDraftAppName("");
    }
  }, []);

  const addRule = async () => {
    const name = draftName.trim();
    if (!name) {
      setRuleError(t("focus:automation.nameRequired"));
      return;
    }

    const conditionJson = buildDraftConditionJson();
    if (draftRuleType === "keyword" && !draftKeyword.trim()) {
      setRuleError(t("focus:automation.keywordRequired"));
      return;
    }
    if (draftRuleType === "app" && !draftAppName.trim()) {
      setRuleError(t("focus:automation.appRequired"));
      return;
    }
    if (draftRuleType === "time_window" && (!draftStart || !draftEnd)) {
      setRuleError(t("focus:automation.timeWindowRequired"));
      return;
    }

    const rule: FocusRule = {
      name,
      enabled: true,
      rule_type: draftRuleType,
      condition_json: conditionJson,
      action: draftAction,
      auto_start: draftAutoStart,
      quiet_hours_respect: draftQuietHoursRespect,
    };

    setSavingRule(true);
    setRuleError(null);
    setRuleSuccess(null);
    try {
      await api.saveFocusRule(rule);
      await loadRules();
      setDraftName("");
      resetDraft("time_window");
      setRuleSuccess(t("focus:automation.saveSuccess"));
      setTimeout(() => setRuleSuccess(null), 3000);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRuleError(message || t("focus:automation.saveFailed"));
    } finally {
      setSavingRule(false);
    }
  };

  const toggleRule = async (rule: FocusRule) => {
    if (rule.id === undefined) return;
    try {
      await api.saveFocusRule({ ...rule, enabled: !rule.enabled });
      await loadRules();
    } catch {
      // ignore
    }
  };

  const deleteRule = async (id: number | undefined) => {
    if (id === undefined) return;
    try {
      await api.deleteFocusRule(id);
      setRules((prev) => prev.filter((r) => r.id !== id));
    } catch {
      // ignore
    }
  };

  const simulateRule = useCallback(async (rule: FocusRule): Promise<FocusRuleMatch | null> => {
    const ruleId = rule.id;
    if (ruleId === undefined) return null;
    try {
      const matches = await api.evaluateFocusRules();
      const match = matches.find((m) => m.rule_id === ruleId) ?? null;
      if (match) {
        setSimulationByRule((prev) => ({ ...prev, [ruleId]: match }));
      } else {
        const fallback: FocusRuleMatch = {
          rule_id: ruleId,
          matched: false,
          reason: t("focus:automation.noMatch"),
        };
        setSimulationByRule((prev) => ({ ...prev, [ruleId]: fallback }));
        return fallback;
      }
      return match;
    } catch {
      const fallback: FocusRuleMatch = {
        rule_id: ruleId,
        matched: false,
        reason: t("focus:automation.simulationError"),
      };
      setSimulationByRule((prev) => ({ ...prev, [ruleId]: fallback }));
      return fallback;
    }
  }, [t]);

  const applyRuleNow = useCallback(async (rule: FocusRule) => {
    if (rule.id === undefined) return;
    const match = await simulateRule(rule);

    // Apply the rule action locally as a manual override when the backend reports a match.
    const action = match?.action || rule.action;

    if (action === "enter_focus" && !active) {
      const id = await api.startFocusSession(rule.name, "rule");
      await api.setFocusModeActive(true);
      setActive(true);
      setActiveSessionId(id);
      await loadState();
    } else if (action === "leave_focus" && active && activeSessionId != null) {
      await api.stopFocusSession(activeSessionId);
      await api.setFocusModeActive(false);
      setActive(false);
      setActiveSessionId(null);
      await loadState();
    }
  }, [active, activeSessionId, loadState, simulateRule]);

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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <input
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder={t("focus:automation.ruleNamePlaceholder")}
              className="ui-field"
            />
            <select
              value={draftRuleType}
              onChange={(e) => resetDraft(e.target.value as RuleType)}
              className="ui-select"
            >
              <option value="keyword">{t("focus:automation.ruleTypeKeyword")}</option>
              <option value="time_window">{t("focus:automation.ruleTypeTimeWindow")}</option>
              <option value="app">{t("focus:automation.ruleTypeApp")}</option>
            </select>
          </div>

          {draftRuleType === "keyword" && (
            <div className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-2">
              <select
                value={draftMatchType}
                onChange={(e) => setDraftMatchType(e.target.value as MatchType)}
                className="ui-select"
              >
                <option value="contains">{t("focus:automation.matchTypeContains")}</option>
                <option value="exact">{t("focus:automation.matchTypeExact")}</option>
                <option value="regex">{t("focus:automation.matchTypeRegex")}</option>
              </select>
              <input
                type="text"
                value={draftKeyword}
                onChange={(e) => setDraftKeyword(e.target.value)}
                placeholder={t("focus:automation.keywordPlaceholder")}
                className="ui-field"
              />
            </div>
          )}

          {draftRuleType === "time_window" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <input type="time" value={draftStart} onChange={(e) => setDraftStart(e.target.value)} className="ui-field" />
              <input type="time" value={draftEnd} onChange={(e) => setDraftEnd(e.target.value)} className="ui-field" />
            </div>
          )}

          {draftRuleType === "app" && (
            <input
              type="text"
              value={draftAppName}
              onChange={(e) => setDraftAppName(e.target.value)}
              placeholder={t("focus:automation.appNamePlaceholder")}
              className="ui-field"
            />
          )}

          <div className="grid grid-cols-1 md:grid-cols-[auto_1fr_1fr] gap-2">
            <select
              value={draftAction}
              onChange={(e) => setDraftAction(e.target.value as RuleAction)}
              className="ui-select"
            >
              <option value="enter_focus">{t("focus:automation.actionEnterFocus")}</option>
              <option value="leave_focus">{t("focus:automation.actionLeaveFocus")}</option>
            </select>
            <label className="flex items-center gap-2 text-xs text-text-secondary bg-surface-hover/40 rounded-xl px-3 py-2 border border-surface-border cursor-pointer">
              <input
                type="checkbox"
                checked={draftAutoStart}
                onChange={(e) => setDraftAutoStart(e.target.checked)}
                className="accent-accent-blue"
              />
              {t("focus:automation.autoStart")}
            </label>
            <label className="flex items-center gap-2 text-xs text-text-secondary bg-surface-hover/40 rounded-xl px-3 py-2 border border-surface-border cursor-pointer">
              <input
                type="checkbox"
                checked={draftQuietHoursRespect}
                onChange={(e) => setDraftQuietHoursRespect(e.target.checked)}
                className="accent-accent-blue"
              />
              {t("focus:automation.respectQuietHours")}
            </label>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => void addRule()}
              disabled={savingRule}
              className={clsx(
                "btn-primary !px-3 flex items-center gap-1.5",
                savingRule && "opacity-70 cursor-wait"
              )}
            >
              {savingRule && (
                <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              )}
              {t("focus:automation.addRule")}
            </button>
          </div>
          {ruleError && (
            <p className="text-xs text-accent-red bg-accent-red/10 px-3 py-2 rounded-lg">
              {ruleError}
            </p>
          )}
          {ruleSuccess && (
            <p className="text-xs text-accent-green bg-accent-green/10 px-3 py-2 rounded-lg">
              {ruleSuccess}
            </p>
          )}
        </div>

        <div className="glass-card divide-y divide-surface-border">
          {rulesLoading ? (
            <AsyncStateCard variant="loading" title={t("common:loading")} compact />
          ) : rules.length === 0 ? (
            <AsyncStateCard variant="empty" title={t("focus:automation.empty")} compact />
          ) : (
            rules.map((rule) => {
              const simulation = rule.id !== undefined ? simulationByRule[rule.id] : undefined;
              return (
                <div key={rule.id ?? rule.name} className="p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      <p className="text-sm text-text-primary font-medium">{rule.name}</p>
                      <p className="text-xs text-text-muted">
                        {ruleMetaLabel(rule, t)} · {t("focus:automation.actionLabel")}: {t(`focus:automation.action${rule.action === "enter_focus" ? "EnterFocus" : "LeaveFocus"}`)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => void toggleRule(rule)}
                        className={clsx(
                          "px-2.5 py-1 rounded-lg border text-xs",
                          rule.enabled ? "border-accent-blue/40 text-accent-blue" : "border-surface-border text-text-muted"
                        )}
                      >
                        {rule.enabled ? t("focus:automation.enabled") : t("focus:automation.disabledShort")}
                      </button>
                      <button onClick={() => void simulateRule(rule)} className="px-2.5 py-1 rounded-lg border border-surface-border text-xs text-text-secondary hover:bg-surface-hover">
                        {t("focus:automation.simulate")}
                      </button>
                      <button onClick={() => void applyRuleNow(rule)} className="px-2.5 py-1 rounded-lg border border-accent-purple/50 text-xs text-accent-purple hover:bg-accent-purple/10">
                        {t("focus:automation.applyNow")}
                      </button>
                      <button onClick={() => void deleteRule(rule.id)} className="px-2.5 py-1 rounded-lg border border-surface-border text-xs text-text-muted hover:text-accent-red">
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
