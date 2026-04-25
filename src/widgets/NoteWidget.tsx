import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Plus, Save, Trash2, X } from "lucide-react";

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
  const storageKey = `${widgetId}-notes`;

  const [notes, setNotes] = useState<NoteItem[]>(() => {
    const existing = parseNotes(localStorage.getItem(storageKey));
    if (existing.length > 0) return existing;

    // Backward-compat: migrate old single-note storage.
    const legacy = localStorage.getItem(`${widgetId}-note`) ?? "";
    if (legacy.trim()) {
      const migrated = [makeNote(legacy)];
      localStorage.setItem(storageKey, JSON.stringify(migrated));
      localStorage.removeItem(`${widgetId}-note`);
      return migrated;
    }
    return [];
  });

  const [selectedId, setSelectedId] = useState<string>(() => notes[0]?.id ?? "");
  const [draft, setDraft] = useState<string>(() => notes[0]?.content ?? "");

  const selectedNote = useMemo(
    () => notes.find((n) => n.id === selectedId) ?? null,
    [notes, selectedId]
  );

  const persist = (nextNotes: NoteItem[]) => {
    setNotes(nextNotes);
    localStorage.setItem(storageKey, JSON.stringify(nextNotes));
  };

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

  const summarize = (content: string) => {
    const line = content.split("\n").find((l) => l.trim()) ?? "";
    return line.slice(0, 28) || t("note.untitled");
  };

  return (
    <div className="w-full h-full glass-card flex flex-col p-4 select-none overflow-hidden">
      <div data-tauri-drag-region className="flex items-center justify-between mb-3">
        <span className="text-text-muted text-xs">{t("note.title")}</span>
        <div className="flex items-center gap-2">
          <button
            onClick={addNote}
            className="text-text-muted hover:text-accent-blue transition-colors"
            title={t("note.add")}
            aria-label={t("note.add")}
          >
            <Plus size={13} />
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
              <div className="flex justify-end">
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
