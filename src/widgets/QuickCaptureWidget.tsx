import { useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { emit } from "@tauri-apps/api/event";
import { X, Check, StickyNote, ListTodo } from "lucide-react";
import * as api from "@/services/tauriApi";
import { useWidgetErrorReporter } from "@/hooks/useWidgetErrorReporter";
import clsx from "clsx";

interface Props {
  widgetId: string;
}

type CaptureMode = "todo" | "note";

function saveQuickCaptureNote(widgetId: string, text: string) {
  const key = `${widgetId}-quick-notes`;
  const raw = localStorage.getItem(key);
  const items = raw ? JSON.parse(raw) as string[] : [];
  items.unshift(text);
  localStorage.setItem(key, JSON.stringify(items.slice(0, 50)));
}

export default function QuickCaptureWidget({ widgetId }: Props) {
  const { t } = useTranslation(["widgets", "common"]);
  useWidgetErrorReporter(widgetId);
  const [mode, setMode] = useState<CaptureMode>("todo");
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resetSaved = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashSaved = useCallback(() => {
    setSaved(true);
    if (resetSaved.current) clearTimeout(resetSaved.current);
    resetSaved.current = setTimeout(() => setSaved(false), 1500);
  }, []);

  const submit = useCallback(async () => {
    const content = text.trim();
    if (!content) return;
    try {
      if (mode === "todo") {
        await api.addTodo(content);
        window.dispatchEvent(new CustomEvent("timelens-todos-changed"));
        await emit("timelens-todos-changed", { source: widgetId });
      } else {
        saveQuickCaptureNote(widgetId, content);
        window.dispatchEvent(new CustomEvent("timelens-notes-changed", { detail: { content } }));
        await emit("timelens-notes-changed", { source: widgetId, content });
      }
      setText("");
      flashSaved();
      textareaRef.current?.focus();
    } catch (err) {
      console.error(err);
    }
  }, [mode, text, widgetId, flashSaved]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <div className="w-full h-full glass-card flex flex-col p-4 select-none overflow-hidden">
      <div data-tauri-drag-region className="flex items-center justify-between mb-3">
        <span className="text-text-muted text-xs">{t("quickCapture.title")}</span>
        <button
          onClick={() => getCurrentWebviewWindow().close()}
          className="text-text-muted hover:text-accent-red transition-colors"
          title={t("common:close")}
          aria-label={t("common:close")}
        >
          <X size={13} />
        </button>
      </div>

      <div className="flex gap-1 mb-2 bg-surface-hover rounded-lg p-1">
        <button
          onClick={() => setMode("todo")}
          className={clsx(
            "flex-1 flex items-center justify-center gap-1.5 text-xs py-1 rounded-md transition-colors",
            mode === "todo"
              ? "bg-accent-blue text-white font-medium"
              : "text-text-muted hover:text-text-secondary"
          )}
        >
          <ListTodo size={12} />
          {t("quickCapture.todo")}
        </button>
        <button
          onClick={() => setMode("note")}
          className={clsx(
            "flex-1 flex items-center justify-center gap-1.5 text-xs py-1 rounded-md transition-colors",
            mode === "note"
              ? "bg-accent-green text-white font-medium"
              : "text-text-muted hover:text-text-secondary"
          )}
        >
          <StickyNote size={12} />
          {t("quickCapture.note")}
        </button>
      </div>

      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={mode === "todo" ? t("quickCapture.todoPlaceholder") : t("quickCapture.notePlaceholder")}
        className="ui-field flex-1 min-h-0 resize-none leading-relaxed"
      />

      <div className="mt-3 flex items-center justify-between">
        <span className="text-[11px] text-text-muted">
          {saved ? (
            <span className="text-accent-green flex items-center gap-1">
              <Check size={11} />
              {t("quickCapture.saved")}
            </span>
          ) : (
            t("quickCapture.hint")
          )}
        </span>
        <button
          onClick={() => void submit()}
          disabled={!text.trim()}
          className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-accent-blue/15 text-accent-blue hover:bg-accent-blue/25 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {mode === "todo" ? <ListTodo size={12} /> : <StickyNote size={12} />}
          {mode === "todo" ? t("quickCapture.addTodo") : t("quickCapture.addNote")}
        </button>
      </div>
    </div>
  );
}
