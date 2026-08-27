import { useMemo, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { CheckSquare2, Plus, RotateCcw, X, Zap, Flame } from "lucide-react";
import { useWidgetClient } from "@/hooks/useWidgetClient";

interface Props {
  widgetId: string;
}

interface HabitItem {
  id: string;
  title: string;
  note: string;
  done: boolean;
}

interface HabitState {
  date: string;
  habits: HabitItem[];
  streak: number;
  lastCompletedDate: string | null;
}

const STATE_KEY = "habit_board";

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayKey(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function defaultHabits(t: (key: string, params?: Record<string, unknown>) => string): HabitItem[] {
  return Array.from({ length: 4 }, (_, i) => ({
    id: `${Date.now()}-${i}`,
    title: t("status.habitPlaceholder", { index: i + 1 }),
    note: "",
    done: false,
  }));
}

function parseHabitState(raw: string | null, fallback: HabitItem[]): HabitState {
  if (!raw) {
    return {
      date: todayKey(),
      habits: fallback,
      streak: 0,
      lastCompletedDate: null,
    };
  }
  try {
    const parsed = JSON.parse(raw) as HabitState;
    const currentDate = todayKey();
    const safeHabits = Array.isArray(parsed.habits)
      ? parsed.habits.slice(0, 8).map((h) => ({
          id: typeof h?.id === "string" ? h.id : `${Date.now()}-${Math.random()}`,
          title: typeof h?.title === "string" ? h.title : "",
          note: typeof (h as HabitItem | undefined)?.note === "string" ? (h as HabitItem).note : "",
          done: typeof h?.done === "boolean" ? h.done : false,
        }))
      : fallback;

    const streak = typeof parsed.streak === "number" ? parsed.streak : 0;
    const lastCompletedDate = typeof parsed.lastCompletedDate === "string" ? parsed.lastCompletedDate : null;

    // Day changed: keep content, reset checkboxes.
    if (parsed.date !== currentDate) {
      return {
        date: currentDate,
        habits: safeHabits.map((h) => ({ ...h, done: false })),
        streak,
        lastCompletedDate,
      };
    }
    return {
      date: currentDate,
      habits: safeHabits,
      streak,
      lastCompletedDate,
    };
  } catch {
    return {
      date: todayKey(),
      habits: fallback,
      streak: 0,
      lastCompletedDate: null,
    };
  }
}

function serializeHabitState(state: HabitState): string {
  return JSON.stringify(state);
}

export default function StatusWidget({ widgetId }: Props) {
  const { t } = useTranslation(["widgets", "common"]);
  const client = useWidgetClient({ widgetId, widgetType: "status" });
  const [state, setState] = useState<HabitState>(() =>
    parseHabitState(null, defaultHabits((k, p) => t(k, p)))
  );
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string>("");
  const [focusActive, setFocusActive] = useState(false);

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      try {
        const [raw, focusResult] = await Promise.all([
          client.getState(STATE_KEY),
          client.query<{ active: boolean }>("focus"),
        ]);
        let parsed = parseHabitState(raw, defaultHabits((k, p) => t(k, p)));
        // Migrate legacy localStorage once.
        if (parsed.habits.length === 0 || parsed.habits.every((h) => h.title === "")) {
          const legacy = localStorage.getItem(`${widgetId}-habit-board`);
          if (legacy) {
            parsed = parseHabitState(legacy, defaultHabits((k, p) => t(k, p)));
            await client.setState(STATE_KEY, serializeHabitState(parsed));
            localStorage.removeItem(`${widgetId}-habit-board`);
          }
        }
        if (!disposed) {
          setState(parsed);
          setSelectedId(parsed.habits[0]?.id ?? "");
          setFocusActive(focusResult.active);
          setLoaded(true);
        }
      } catch {
        if (!disposed) setLoaded(true);
      }
    };
    void load();

    const timer = window.setInterval(() => {
      client
        .query<{ active: boolean }>("focus")
        .then((r) => {
          if (!disposed) setFocusActive(r.active);
        })
        .catch(() => {});
    }, 10000);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [client, t, widgetId]);

  const saveState = async (next: HabitState) => {
    setState(next);
    try {
      await client.setState(STATE_KEY, serializeHabitState(next));
    } catch {
      // Keep local state even if gateway write fails.
    }
  };

  const computeStreak = (habits: HabitItem[], currentStreak: number, lastCompletedDate: string | null): { streak: number; lastCompletedDate: string | null } => {
    const allDone = habits.length > 0 && habits.every((h) => h.done);
    if (!allDone) return { streak: currentStreak, lastCompletedDate };

    const today = todayKey();
    if (lastCompletedDate === today) return { streak: currentStreak, lastCompletedDate };

    const yesterday = yesterdayKey();
    const newStreak = lastCompletedDate === yesterday || lastCompletedDate === today ? currentStreak + 1 : 1;
    return { streak: newStreak, lastCompletedDate: today };
  };

  const updateHabits = (habits: HabitItem[]) => {
    const { streak, lastCompletedDate } = computeStreak(habits, state.streak, state.lastCompletedDate);
    void saveState({ ...state, habits, streak, lastCompletedDate });
  };

  const setHabitTitle = (id: string, title: string) => {
    const habits = state.habits.map((h) => (h.id === id ? { ...h, title } : h));
    updateHabits(habits);
  };

  const setHabitNote = (id: string, note: string) => {
    const habits = state.habits.map((h) => (h.id === id ? { ...h, note } : h));
    updateHabits(habits);
  };

  const toggleHabit = (id: string) => {
    const habits = state.habits.map((h) => (h.id === id ? { ...h, done: !h.done } : h));
    updateHabits(habits);
  };

  const addHabit = () => {
    if (state.habits.length >= 8) return;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const habits = [
      ...state.habits,
      {
        id,
        title: "",
        note: "",
        done: false,
      },
    ];
    void saveState({ ...state, habits });
    setSelectedId(id);
  };

  const resetDay = () => {
    const habits = state.habits.map((h) => ({ ...h, done: false }));
    void saveState({ ...state, date: todayKey(), habits });
  };

  const doneCount = useMemo(() => state.habits.filter((h) => h.done).length, [state.habits]);
  const totalCount = state.habits.length;
  const percent = useMemo(
    () => (totalCount === 0 ? 0 : Math.round((doneCount / totalCount) * 100)),
    [doneCount, totalCount]
  );
  const selectedHabit = state.habits.find((h) => h.id === selectedId) ?? state.habits[0] ?? null;

  return (
    <div className="w-full h-full glass-card flex flex-col p-4 select-none overflow-hidden">
      <div data-tauri-drag-region className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-text-muted text-xs">{t("status.title")}</span>
          {focusActive && (
            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-accent-blue/15 text-accent-blue">
              <Zap size={10} />
              {t("status.focusBadge")}
            </span>
          )}
        </div>
        <button
          onClick={() => getCurrentWebviewWindow().close()}
          className="text-text-muted hover:text-accent-red transition-colors"
          title={t("common:close")}
          aria-label={t("common:close")}
        >
          <X size={13} />
        </button>
      </div>

      <div className="flex items-center gap-3 mb-3">
        <div className="flex-1 rounded-xl border border-surface-border bg-surface-hover/40 p-2.5 flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-accent-orange/10 text-accent-orange">
            <Flame size={14} />
          </div>
          <div>
            <div className="text-[11px] text-text-muted uppercase tracking-wider">{t("status.streak")}</div>
            <div className="text-base font-semibold text-text-primary">{state.streak}</div>
          </div>
        </div>
        <div className="flex-1 rounded-xl border border-surface-border bg-surface-hover/40 p-2.5">
          <div className="text-[11px] text-text-muted uppercase tracking-wider">{t("status.completion")}</div>
          <div className="text-base font-semibold text-text-primary">{percent}%</div>
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-[0.95fr_1.35fr] gap-3">
        <div className="rounded-xl border border-surface-border bg-surface-hover/40 p-3 min-h-0 flex flex-col">
          <div className="text-xs text-text-muted flex items-center gap-1.5 mb-1">
            <CheckSquare2 size={12} />
            {t("status.habitTitle")}
          </div>
          <div className="text-xs text-text-secondary mb-2">
            {t("status.completed", { done: doneCount, total: totalCount })} ({percent}%)
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-1">
            {!loaded ? (
              <div className="text-xs text-text-muted text-center py-4">{t("loading")}</div>
            ) : (
              state.habits.map((habit, idx) => {
                const active = selectedHabit?.id === habit.id;
                return (
                  <button
                    key={habit.id}
                    onClick={() => setSelectedId(habit.id)}
                    className={`w-full text-left px-2.5 py-2 rounded-lg border transition-colors ${
                      active
                        ? "border-accent-blue/60 bg-accent-blue/10"
                        : "border-surface-border hover:border-accent-blue/30"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={habit.done}
                        onChange={(e) => {
                          e.stopPropagation();
                          toggleHabit(habit.id);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="ui-checkbox"
                        title={habit.title || t("status.habitPlaceholder", { index: idx + 1 })}
                        aria-label={habit.title || t("status.habitPlaceholder", { index: idx + 1 })}
                      />
                      <div className="text-sm text-text-primary truncate">
                        {habit.title || t("status.habitPlaceholder", { index: idx + 1 })}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="rounded-xl border border-surface-border bg-surface-hover/40 p-3 min-h-0 flex flex-col gap-2">
          {selectedHabit ? (
            <>
              <div className="text-xs text-text-muted">{t("status.detailTitle")}</div>
              <input
                value={selectedHabit.title}
                onChange={(e) => setHabitTitle(selectedHabit.id, e.target.value)}
                placeholder={t("status.habitPlaceholder", { index: 1 })}
                className="ui-field text-sm"
              />
              <textarea
                value={selectedHabit.note}
                onChange={(e) => setHabitNote(selectedHabit.id, e.target.value)}
                placeholder={t("status.notePlaceholder")}
                className="ui-field flex-1 min-h-0 resize-none text-sm leading-relaxed"
              />
              <label className="inline-flex items-center gap-2 text-xs text-text-secondary">
                <input
                  type="checkbox"
                  checked={selectedHabit.done}
                  onChange={() => toggleHabit(selectedHabit.id)}
                  className="ui-checkbox"
                />
                {t("status.markDone")}
              </label>
            </>
          ) : (
            <div className="flex-1 min-h-0 flex items-center justify-center text-xs text-text-muted">
              {t("status.empty")}
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 flex justify-between items-center">
        <button
          onClick={resetDay}
          className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text-secondary transition-colors"
        >
          <RotateCcw size={12} />
          {t("status.reset")}
        </button>
        <button
          onClick={addHabit}
          disabled={state.habits.length >= 8}
          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border border-accent-blue/40 text-accent-blue hover:bg-accent-blue/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus size={12} />
          {t("status.addHabit")}
        </button>
      </div>
    </div>
  );
}
