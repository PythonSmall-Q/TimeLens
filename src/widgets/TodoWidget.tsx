import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen } from "@tauri-apps/api/event";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { X, Plus, GripVertical, Trash2, Target, Droplet } from "lucide-react";
import * as api from "@/services/tauriApi";
import type { GoalProgress, TodoItem, UsageGoal } from "@/types";
import { formatDuration } from "@/utils/format";
import { useWidgetErrorReporter } from "@/hooks/useWidgetErrorReporter";
import clsx from "clsx";

const GOAL_PREFIX_RE = /^\[goal:([^\]]+)\]\s*/;

function goalKey(goal: UsageGoal): string {
  return `${goal.scope_type}:${goal.scope_value}:${goal.period}`;
}

function parseGoalLink(content: string): { key: string | null; text: string } {
  const match = GOAL_PREFIX_RE.exec(content);
  if (!match) return { key: null, text: content };
  return { key: match[1], text: content.slice(match[0].length) };
}

function buildGoalLink(goal: UsageGoal, text: string): string {
  return `[goal:${goalKey(goal)}] ${text}`;
}

interface SortableRowProps {
  item: TodoItem;
  progress: GoalProgress | null;
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
}

function SortableRow({ item, progress, onToggle, onDelete }: SortableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const { key: goalKeyVal, text } = parseGoalLink(item.content);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 group py-1.5 px-1 rounded-lg hover:bg-white/5"
    >
      <span
        {...attributes}
        {...listeners}
        className="text-text-muted opacity-0 group-hover:opacity-100 transition-opacity cursor-grab"
      >
        <GripVertical size={13} />
      </span>
      <input
        type="checkbox"
        checked={item.done}
        onChange={() => onToggle(item.id)}
        className="ui-checkbox cursor-pointer flex-shrink-0"
        title={text}
        aria-label={text}
      />
      <div className="flex-1 min-w-0">
        <span
          className={clsx(
            "text-sm leading-snug cursor-pointer block truncate",
            item.done ? "line-through text-text-muted" : "text-text-primary"
          )}
          onClick={() => onToggle(item.id)}
        >
          {text}
        </span>
        {goalKeyVal && progress && (
          <div className="flex items-center gap-1.5 mt-0.5">
            <Target size={10} className="text-accent-blue" />
            <div className="flex-1 h-1 rounded-full bg-surface-border overflow-hidden">
              <div
                className={clsx(
                  "h-full rounded-full transition-all",
                  progress.is_completed ? "bg-accent-green" : "bg-accent-blue"
                )}
                style={{ width: `${Math.min(100, Math.round(progress.progress_ratio * 100))}%` }}
              />
            </div>
            <span className="text-[10px] text-text-muted">
              {formatDuration(progress.used_seconds)} / {formatDuration(progress.goal.target_seconds)}
            </span>
          </div>
        )}
      </div>
      <button
        onClick={() => onDelete(item.id)}
        className="text-text-muted hover:text-accent-red opacity-0 group-hover:opacity-100
                   transition-all flex-shrink-0"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}

interface Props {
  widgetId: string;
}

export default function TodoWidget({ widgetId }: Props) {
  const { t } = useTranslation("widgets");
  useWidgetErrorReporter(widgetId);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [input, setInput] = useState("");
  const [goals, setGoals] = useState<UsageGoal[]>([]);
  const [progress, setProgress] = useState<GoalProgress[]>([]);
  const [selectedGoalKey, setSelectedGoalKey] = useState<string>("");
  const [autoBlur, setAutoBlur] = useState(() => {
    try {
      return localStorage.getItem(`${widgetId}-auto-blur`) === "1";
    } catch {
      return false;
    }
  });
  const [isFocused, setIsFocused] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const win = getCurrentWebviewWindow();
    win.isFocused()
      .then(setIsFocused)
      .catch(() => {});
    win.onFocusChanged(({ payload: focused }) => {
      setIsFocused(focused);
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const onChanged = () => {
      api.getTodos().then(setTodos).catch(console.error);
    };
    window.addEventListener("timelens-todos-changed", onChanged);

    // Also listen for cross-window capture events from the Quick Capture widget.
    let unlisten: (() => void) | undefined;
    const setup = async () => {
      try {
        unlisten = await listen("timelens-todos-changed", onChanged);
      } catch {
        // ignore
      }
    };
    void setup();

    return () => {
      window.removeEventListener("timelens-todos-changed", onChanged);
      unlisten?.();
    };
  }, []);

  const toggleAutoBlur = () => {
    const next = !autoBlur;
    setAutoBlur(next);
    try {
      localStorage.setItem(`${widgetId}-auto-blur`, next ? "1" : "0");
    } catch {
      // ignore
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    api.getTodos().then(setTodos).catch(console.error);
    const loadGoals = async () => {
      try {
        const [g, p] = await Promise.all([api.getUsageGoals(), api.getGoalProgress(1)]);
        setGoals(g.filter((goal) => goal.enabled));
        setProgress(p);
      } catch {
        // Ignore goal load errors.
      }
    };
    void loadGoals();
  }, []);

  const progressByKey = new Map<string, GoalProgress>();
  progress.forEach((p) => {
    progressByKey.set(goalKey(p.goal), p);
  });

  const handleAdd = async () => {
    const content = input.trim();
    if (!content) return;
    const goal = goals.find((g) => goalKey(g) === selectedGoalKey);
    const finalContent = goal ? buildGoalLink(goal, content) : content;
    const item = await api.addTodo(finalContent);
    setTodos((prev) => [...prev, item]);
    setInput("");
    setSelectedGoalKey("");
    inputRef.current?.focus();
  };

  const handleToggle = async (id: number) => {
    await api.toggleTodo(id);
    setTodos((prev) =>
      prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t))
    );
  };

  const handleDelete = async (id: number) => {
    await api.deleteTodo(id);
    setTodos((prev) => prev.filter((t) => t.id !== id));
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = todos.findIndex((t) => t.id === active.id);
    const newIndex = todos.findIndex((t) => t.id === over.id);
    const reordered = arrayMove(todos, oldIndex, newIndex);
    setTodos(reordered);
    await api.reorderTodos(reordered.map((t) => t.id));
  };

  const clearCompleted = async () => {
    const completed = todos.filter((t) => t.done);
    await Promise.all(completed.map((t) => api.deleteTodo(t.id)));
    setTodos((prev) => prev.filter((t) => !t.done));
  };

  const remaining = todos.filter((t) => !t.done).length;

  return (
    <div className={clsx(
      "w-full h-full glass-card flex flex-col p-4 select-none overflow-hidden transition-all duration-200",
      autoBlur && !isFocused && "blur-[2px] opacity-90"
    )}>
      {/* Header / drag region */}
      <div data-tauri-drag-region className="flex items-center justify-between mb-3">
        <span className="text-text-muted text-xs">{t("todo.title")}</span>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleAutoBlur}
            className={clsx(
              "text-text-muted hover:text-text-secondary transition-colors",
              autoBlur && "text-accent-blue"
            )}
            title={t("autoBlur")}
            aria-label={t("autoBlur")}
          >
            <Droplet size={13} />
          </button>
          {todos.some((t) => t.done) && (
            <button
              onClick={clearCompleted}
              className="text-xs text-text-muted hover:text-text-secondary transition-colors"
            >
              {t("todo.clearCompleted")}
            </button>
          )}
          <button
            onClick={() => getCurrentWebviewWindow().close()}
            aria-label={t("common:close")}
            title={t("common:close")}
            className="text-text-muted hover:text-accent-red transition-colors"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Quick input */}
      <div className="flex flex-col gap-2 mb-3">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder={t("todo.addPlaceholder")}
            className="ui-field flex-1"
          />
          <button
            onClick={handleAdd}
            className="bg-accent-blue/20 hover:bg-accent-blue/30 text-accent-blue rounded-lg
                       p-2 transition-colors flex-shrink-0"
          >
            <Plus size={14} />
          </button>
        </div>
        {goals.length > 0 && (
          <div className="flex items-center gap-2">
            <Target size={12} className="text-text-muted" />
            <select
              value={selectedGoalKey}
              onChange={(e) => setSelectedGoalKey(e.target.value)}
              className="ui-field text-xs flex-1 py-1"
            >
              <option value="">{t("todo.noGoal")}</option>
              {goals.map((goal) => (
                <option key={goalKey(goal)} value={goalKey(goal)}>
                  {goal.scope_value} · {goal.period}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {todos.length === 0 ? (
          <p className="text-text-muted text-xs text-center py-6">{t("todo.emptyState")}</p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={todos.map((t) => t.id)}
              strategy={verticalListSortingStrategy}
            >
              {todos.map((item) => (
                <SortableRow
                  key={item.id}
                  item={item}
                  progress={progressByKey.get(parseGoalLink(item.content).key ?? "") ?? null}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* Footer */}
      {todos.length > 0 && (
        <div className="mt-2 pt-2 border-t border-surface-border text-xs text-text-muted text-right">
          {remaining} remaining
        </div>
      )}
    </div>
  );
}
