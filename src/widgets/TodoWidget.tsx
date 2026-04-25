import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
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
import { X, Plus, GripVertical, Trash2 } from "lucide-react";
import * as api from "@/services/tauriApi";
import type { TodoItem } from "@/types";
import clsx from "clsx";

interface SortableRowProps {
  item: TodoItem;
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
}

function SortableRow({ item, onToggle, onDelete }: SortableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

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
        title={item.content}
        aria-label={item.content}
      />
      <span
        className={clsx(
          "text-sm flex-1 leading-snug cursor-pointer",
          item.done ? "line-through text-text-muted" : "text-text-primary"
        )}
        onClick={() => onToggle(item.id)}
      >
        {item.content}
      </span>
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

export default function TodoWidget({ widgetId: _widgetId }: Props) {
  const { t } = useTranslation("widgets");
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    api.getTodos().then(setTodos).catch(console.error);
  }, []);

  const handleAdd = async () => {
    const content = input.trim();
    if (!content) return;
    const item = await api.addTodo(content);
    setTodos((prev) => [...prev, item]);
    setInput("");
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
    <div className="w-full h-full glass-card flex flex-col p-4 select-none overflow-hidden">
      {/* Header / drag region */}
      <div data-tauri-drag-region className="flex items-center justify-between mb-3">
        <span className="text-text-muted text-xs">{t("todo.title")}</span>
        <div className="flex items-center gap-2">
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
            className="text-text-muted hover:text-accent-red transition-colors"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Quick input */}
      <div className="flex items-center gap-2 mb-3">
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
