import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { CheckSquare2, Plus, RotateCcw, X } from "lucide-react";

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
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function defaultHabits(t: (key: string, params?: Record<string, unknown>) => string): HabitItem[] {
  return Array.from({ length: 4 }, (_, i) => ({
    id: `${Date.now()}-${i}`,
    title: t("status.habitPlaceholder", { index: i + 1 }),
    note: "",
    done: false,
  }));
}

function loadHabits(widgetId: string, fallback: HabitItem[]): HabitState {
  const raw = localStorage.getItem(`${widgetId}-habit-board`);
  if (!raw) {
    return {
      date: todayKey(),
      habits: fallback,
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

    // Day changed: keep content, reset checkboxes.
    if (parsed.date !== currentDate) {
      return {
        date: currentDate,
        habits: safeHabits.map((h) => ({ ...h, done: false })),
      };
    }
    return {
      date: currentDate,
      habits: safeHabits,
    };
  } catch {
    return {
      date: todayKey(),
      habits: fallback,
    };
  }
}

export default function StatusWidget({ widgetId }: Props) {
  const { t } = useTranslation(["widgets", "common"]);
  const [state, setState] = useState<HabitState>(() =>
    loadHabits(widgetId, defaultHabits((k, p) => t(k, p)))
  );
  const [selectedId, setSelectedId] = useState<string>(() => state.habits[0]?.id ?? "");

  const saveState = (next: HabitState) => {
    setState(next);
    localStorage.setItem(`${widgetId}-habit-board`, JSON.stringify(next));
  };

  const setHabitTitle = (id: string, title: string) => {
    const habits = state.habits.map((h) => (h.id === id ? { ...h, title } : h));
    saveState({ ...state, habits });
  };

  const setHabitNote = (id: string, note: string) => {
    const habits = state.habits.map((h) => (h.id === id ? { ...h, note } : h));
    saveState({ ...state, habits });
  };

  const toggleHabit = (id: string) => {
    const habits = state.habits.map((h) => (h.id === id ? { ...h, done: !h.done } : h));
    saveState({ ...state, habits });
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
    saveState({ ...state, habits });
    setSelectedId(id);
  };

  const resetDay = () => {
    const habits = state.habits.map((h) => ({ ...h, done: false }));
    saveState({ ...state, date: todayKey(), habits });
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
        <span className="text-text-muted text-xs">{t("status.title")}</span>
        <button
          onClick={() => getCurrentWebviewWindow().close()}
          className="text-text-muted hover:text-accent-red transition-colors"
          title={t("common:close")}
          aria-label={t("common:close")}
        >
          <X size={13} />
        </button>
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
            {state.habits.map((habit, idx) => {
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
            })}
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
          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border border-accent-blue/40 text-accent-blue hover:bg-accent-blue/10 transition-colors"
        >
          <Plus size={12} />
          {t("status.addHabit")}
        </button>
      </div>
    </div>
  );
}
