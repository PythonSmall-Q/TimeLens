import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Clock, List, Timer, ExternalLink, Trash2, Plus, StickyNote, Activity } from "lucide-react";
import { useWidgetStore } from "@/stores/widgetStore";
import type { WidgetConfig } from "@/types";
import clsx from "clsx";

const ICONS = {
  clock: Clock,
  todo: List,
  timer: Timer,
  note: StickyNote,
  status: Activity,
};

const TYPE_LABELS: Record<string, string> = {
  clock: "widgets:clock.title",
  todo: "widgets:todo.title",
  timer: "widgets:timer.title",
  note: "widgets:note.title",
  status: "widgets:status.title",
};

function WidgetCard({ config }: { config: WidgetConfig }) {
  const { t } = useTranslation("widgets");
  const { openWidget, closeWidget, removeWidget } = useWidgetStore();
  const Icon = ICONS[config.widget_type as keyof typeof ICONS] ?? Clock;

  return (
    <div className="glass-card p-4 flex flex-col gap-3">
      {/* Top row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="p-2 rounded-lg bg-accent-blue/10 text-accent-blue">
            <Icon size={15} />
          </span>
          <div>
            <p className="text-sm font-medium text-text-primary">
              {t(TYPE_LABELS[config.widget_type] ?? "widgets:clock.title")}
            </p>
            <p className="text-xs text-text-muted font-mono">{config.id}</p>
          </div>
        </div>
        <button
          onClick={() => removeWidget(config.id)}
          aria-label={t("deleteWidget")}
          title={t("deleteWidget")}
          className="text-text-muted hover:text-accent-red transition-colors p-1"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Open / Close */}
      <button
        onClick={() => openWidget(config)}
        className="w-full flex items-center justify-center gap-1.5 text-xs py-2 rounded-xl
                   bg-accent-blue/15 hover:bg-accent-blue/25 text-accent-blue transition-colors"
      >
        <ExternalLink size={12} />
        {t("openWidget")}
      </button>
    </div>
  );
}

export default function WidgetCenter() {
  const { t } = useTranslation("widgets");
  const { widgets, loading, fetchWidgets, createWidget } = useWidgetStore();
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    fetchWidgets();
  }, [fetchWidgets]);

  const ADD_BUTTONS: { type: "clock" | "todo" | "timer" | "note" | "status"; labelKey: string; icon: typeof Clock }[] = [
    { type: "clock", labelKey: "clock.title", icon: Clock },
    { type: "todo",  labelKey: "todo.title",  icon: List  },
    { type: "timer", labelKey: "timer.title", icon: Timer },
    { type: "note", labelKey: "note.title", icon: StickyNote },
    { type: "status", labelKey: "status.title", icon: Activity },
  ];

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-text-primary">{t("widgetCenter")}</h1>
        <p className="text-text-muted text-xs mt-0.5">{t("widgetCenterDesc")}</p>
      </div>

      {/* Quick-add */}
      <div className="glass-card p-4">
        <p className="text-sm text-text-secondary mb-3">{t("addWidget")}</p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {ADD_BUTTONS.map(({ type, labelKey, icon: Icon }) => (
            <button
              key={type}
              onClick={() => createWidget(type)}
              className="flex flex-col items-center gap-2 py-4 rounded-xl
                         border border-surface-border hover:border-accent-blue/40
                         hover:bg-accent-blue/5 transition-all group"
            >
              <span className="p-2.5 rounded-full bg-surface-hover group-hover:bg-accent-blue/15
                               text-text-secondary group-hover:text-accent-blue transition-colors">
                <Icon size={18} />
              </span>
              <span className="text-xs text-text-secondary group-hover:text-text-primary transition-colors">
                {t(labelKey)}
              </span>
              <Plus size={11} className="text-text-muted group-hover:text-accent-blue transition-colors" />
            </button>
          ))}
        </div>
      </div>

      {/* Existing widgets */}
      <div>
        <h2 className="text-sm font-semibold text-text-secondary mb-3">{t("myWidgets")}</h2>
        {loading && (
          <p className="text-text-muted text-sm text-center py-6">Loading…</p>
        )}
        {!loading && widgets.length === 0 && (
          <p className="text-text-muted text-sm text-center py-8">{t("noWidgets")}</p>
        )}
        {!loading && widgets.length > 0 && (
          <div className={clsx(
            "grid gap-3",
            widgets.length === 1 ? "grid-cols-1" : "grid-cols-2"
          )}>
            {widgets.map((w) => (
              <WidgetCard key={w.id} config={w} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
