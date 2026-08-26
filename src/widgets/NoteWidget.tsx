import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen } from "@tauri-apps/api/event";
import { Plus, Save, Trash2, X, Check, RotateCcw, Droplet } from "lucide-react";
import clsx from "clsx";
import { useWidgetErrorReporter } from "@/hooks/useWidgetErrorReporter";

interface Props {
  widgetId: string;
}

interface NoteItem {
  id: string;
  content: string;
  updatedAt: string;
}

function makeNote(content = ""): NoteItem {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    content,
    updatedAt: new Date().toISOString(),
  };
}

function parseNotes(raw: string | null): NoteItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as NoteItem[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((n) => typeof n?.id === "string").map((n) => ({
      id: n.id,
      content: typeof n.content === "string" ? n.content : "",
      updatedAt: typeof n.updatedAt === "string" ? n.updatedAt : new Date().toISOString(),
    }));
  } catch {
    return [];
  }
}

export default function NoteWidget({ widgetId }: Props) {
  const { t } = useTranslation(["widgets", "common"]);
  useWidgetErrorReporter(widgetId);
  const storageKey = `${widgetId}-notes`;
  const backupKey = `${widgetId}-notes-backup`;

  const [notes, setNotes] = useState<NoteItem[]>(() => {
    const existing = parseNotes(localStorage.getItem(storageKey));
    if (existing.length > 0) return existing;

    const backup = parseNotes(localStorage.getItem(backupKey));
    if (backup.length > 0) {
      localStorage.setItem(storageKey, JSON.stringify(backup));
      return backup;
    }

    // Backward-compat: migrate old single-note storage.
    const legacy = localStorage.getItem(`${widgetId}-note`) ?? "";
    if (legacy.trim()) {
      const migrated = [makeNote(legacy)];
      localStorage.setItem(storageKey, JSON.stringify(migrated));
      localStorage.setItem(backupKey, JSON.stringify(migrated));
      localStorage.removeItem(`${widgetId}-note`);
      return migrated;
    }
    return [];
  });

  const [selectedId, setSelectedId] = useState<string>(() => notes[0]?.id ?? "");
  const [draft, setDraft] = useState<string>(() => notes[0]?.content ?? "");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [showRecovered, setShowRecovered] = useState(false);
  const [autoBlur, setAutoBlur] = useState(() => {
    try {
      return localStorage.getItem(`${widgetId}-auto-blur`) === "1";
    } catch {
      return false;
    }
  });
  const [isFocused, setIsFocused] = useState(true);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const toggleAutoBlur = () => {
    const next = !autoBlur;
    setAutoBlur(next);
    try {
      localStorage.setItem(`${widgetId}-auto-blur`, next ? "1" : "0");
    } catch {
      // ignore
    }
  };

  const selectedNote = useMemo(
    () => notes.find((n) => n.id === selectedId) ?? null,
    [notes, selectedId]
  );

  const persist = useCallback((nextNotes: NoteItem[]) => {
    setNotes(nextNotes);
    localStorage.setItem(storageKey, JSON.stringify(nextNotes));
    localStorage.setItem(backupKey, JSON.stringify(nextNotes));
    setLastSavedAt(new Date());
  }, [storageKey, backupKey]);

  useEffect(() => {
    const onNoteCaptured = (e: Event | { content?: string }) => {
      const content = "detail" in e
        ? (e as CustomEvent<{ content?: string }>).detail?.content
        : (e as { content?: string }).content;
      if (!content) return;
      const next = [makeNote(content), ...notes];
      persist(next);
      setSelectedId(next[0].id);
      setDraft(content);
    };
    window.addEventListener("timelens-notes-changed", onNoteCaptured as EventListener);

    let unlisten: (() => void) | undefined;
    const setup = async () => {
      try {
        unlisten = await listen<{ content?: string }>("timelens-notes-changed", (event) => {
          onNoteCaptured(event.payload);
        });
      } catch {
        // ignore
      }
    };
    void setup();

    return () => {
      window.removeEventListener("timelens-notes-changed", onNoteCaptured as EventListener);
      unlisten?.();
    };
  }, [notes, persist]);

  // Auto-save draft after debounce.
  useEffect(() => {
    if (!selectedNote || draft === selectedNote.content) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      const next = notes.map((n) =>
        n.id === selectedNote.id
          ? { ...n, content: draft, updatedAt: new Date().toISOString() }
          : n
      );
      persist(next);
    }, 800);
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, [draft, selectedNote, notes, persist]);

  useEffect(() => {
    const backup = parseNotes(localStorage.getItem(backupKey));
    if (backup.length > 0 && notes.length === 0) {
      setShowRecovered(true);
      const hideTimer = setTimeout(() => setShowRecovered(false), 4000);
      return () => clearTimeout(hideTimer);
    }
  }, [backupKey, notes.length]);

  const addNote = () => {
    const next = [makeNote(""), ...notes];
    persist(next);
    setSelectedId(next[0].id);
    setDraft("");
  };

  const openNote = (id: string) => {
    const note = notes.find((n) => n.id === id);
    if (!note) return;
    setSelectedId(id);
    setDraft(note.content);
  };

  const saveCurrent = () => {
    if (!selectedNote) return;
    const next = notes.map((n) =>
      n.id === selectedNote.id
        ? { ...n, content: draft, updatedAt: new Date().toISOString() }
        : n
    );
    persist(next);
  };

  const deleteCurrent = () => {
    if (!selectedNote) return;
    const next = notes.filter((n) => n.id !== selectedNote.id);
    persist(next);
    const fallback = next[0] ?? null;
    setSelectedId(fallback?.id ?? "");
    setDraft(fallback?.content ?? "");
  };

  const restoreFromBackup = () => {
    const backup = parseNotes(localStorage.getItem(backupKey));
    if (backup.length > 0) {
      persist(backup);
      setSelectedId(backup[0]?.id ?? "");
      setDraft(backup[0]?.content ?? "");
      setShowRecovered(true);
      setTimeout(() => setShowRecovered(false), 3000);
    }
  };

  const summarize = (content: string) => {
    const line = content.split("\n").find((l) => l.trim()) ?? "";
    return line.slice(0, 28) || t("note.untitled");
  };

  return (
    <div className={clsx(
      "w-full h-full glass-card flex flex-col p-4 select-none overflow-hidden transition-all duration-200",
      autoBlur && !isFocused && "blur-[2px] opacity-90"
    )}>
      <div data-tauri-drag-region className="flex items-center justify-between mb-3">
        <span className="text-text-muted text-xs">{t("note.title")}</span>
        <div className="flex items-center gap-2">
          {notes.length === 0 && localStorage.getItem(backupKey) && (
            <button
              onClick={restoreFromBackup}
              className="text-text-muted hover:text-accent-blue transition-colors"
              title={t("note.restore")}
              aria-label={t("note.restore")}
            >
              <RotateCcw size={13} />
            </button>
          )}
          <button
            onClick={addNote}
            className="text-text-muted hover:text-accent-blue transition-colors"
            title={t("note.add")}
            aria-label={t("note.add")}
          >
            <Plus size={13} />
          </button>
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
          <button
            onClick={deleteCurrent}
            className="text-text-muted hover:text-accent-red transition-colors"
            title={t("note.delete")}
            aria-label={t("note.delete")}
            disabled={!selectedNote}
          >
            <Trash2 size={13} />
          </button>
          <button
            onClick={() => getCurrentWebviewWindow().close()}
            className="text-text-muted hover:text-accent-red transition-colors"
            title={t("common:close")}
            aria-label={t("common:close")}
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {showRecovered && (
        <div className="mb-2 text-xs text-accent-green bg-accent-green/10 px-2 py-1 rounded-lg flex items-center gap-1.5">
          <Check size={12} />
          {t("note.recovered")}
        </div>
      )}

      <div className="flex-1 min-h-0 grid grid-cols-[0.95fr_1.35fr] gap-3">
        <div className="min-h-0 rounded-xl border border-surface-border bg-surface-hover/40 p-2.5 flex flex-col">
          <div className="text-xs text-text-muted px-1 pb-2">{t("note.titleList")}</div>
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-1.5 pr-1">
            {notes.length === 0 && (
              <div className="text-xs text-text-muted text-center py-4">{t("note.empty")}</div>
            )}
            {notes.map((note) => (
              <button
                key={note.id}
                onClick={() => openNote(note.id)}
                className={`w-full text-left px-2.5 py-2 rounded-lg border transition-colors ${
                  note.id === selectedId
                    ? "border-accent-blue/60 bg-accent-blue/10"
                    : "border-surface-border hover:border-accent-blue/30"
                }`}
              >
                <div className="text-sm text-text-primary truncate">{summarize(note.content)}</div>
                <div className="text-[11px] text-text-muted mt-0.5">
                  {t("note.lastEdited")}: {new Date(note.updatedAt).toLocaleTimeString()}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 rounded-xl border border-surface-border bg-surface-hover/40 p-3 flex flex-col gap-2">
          <div className="text-xs text-text-muted">{t("note.detailTitle")}</div>
          {selectedNote ? (
            <>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={t("note.placeholder")}
                className="ui-field flex-1 min-h-0 resize-none leading-relaxed"
              />
              <div className="flex justify-between items-center">
                <span className={clsx("text-[11px] transition-colors", lastSavedAt ? "text-accent-green" : "text-text-muted")}>
                  {lastSavedAt
                    ? `${t("note.savedAt")} ${lastSavedAt.toLocaleTimeString()}`
                    : t("note.unsaved")}
                </span>
                <button
                  onClick={saveCurrent}
                  className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-accent-blue/50 text-accent-blue hover:bg-accent-blue/10 transition-colors"
                >
                  <Save size={12} />
                  {t("note.save")}
                </button>
              </div>
            </>
          ) : (
            <div className="flex-1 min-h-0 rounded-lg border border-surface-border flex items-center justify-center text-xs text-text-muted">
              {t("note.selectHint")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
