import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Clock, List, Timer, ExternalLink, Trash2, Plus, StickyNote, Activity, Layers } from "lucide-react";
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
  const { openWidget, closeWidget, removeWidget, updateWidgetConfig } = useWidgetStore();
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
      <label className="flex items-center justify-between text-xs text-text-secondary rounded-lg border border-surface-border px-3 py-2">
        <span>{t("startOnLaunch")}</span>
        <input
          type="checkbox"
          className="ui-checkbox"
          checked={!!config.start_on_launch}
          onChange={(e) =>
            updateWidgetConfig({ ...config, start_on_launch: e.target.checked })
          }
        />
      </label>

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

// ── Self-add catalog (based on official widgets) ─────────────

type WidgetType = "clock" | "todo" | "timer" | "note" | "status";

const CATALOG: { type: WidgetType; icon: typeof Clock; descKey: string }[] = [
  { type: "clock",  icon: Clock,     descKey: "clockDesc"  },
  { type: "todo",   icon: List,      descKey: "todoDesc"   },
  { type: "timer",  icon: Timer,     descKey: "timerDesc"  },
  { type: "note",   icon: StickyNote, descKey: "noteDesc"  },
  { type: "status", icon: Activity,  descKey: "statusDesc" },
];

interface MarketplaceCardProps {
  type: WidgetType;
  icon: typeof Clock;
  descKey: string;
  installedCount: number;
  onAdd: (type: WidgetType) => void;
}

function MarketplaceCard({ type, icon: Icon, descKey, installedCount, onAdd }: MarketplaceCardProps) {
  const { t } = useTranslation("widgets");
  const TYPE_LABEL_KEY: Record<WidgetType, string> = {
    clock: "clock.title", todo: "todo.title", timer: "timer.title",
    note: "note.title", status: "status.title",
  };

  return (
    <div className="glass-card p-4 flex flex-col gap-3 hover:border-accent-blue/30 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="p-2.5 rounded-xl bg-accent-blue/10 text-accent-blue flex-shrink-0">
            <Icon size={18} />
          </span>
          <div>
            <p className="text-sm font-semibold text-text-primary">{t(TYPE_LABEL_KEY[type])}</p>
            {installedCount > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent-green/15 text-accent-green">
                {t("installed")} ×{installedCount}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={() => onAdd(type)}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent-blue/15 text-accent-blue
                     text-xs font-medium hover:bg-accent-blue/25 transition-colors flex-shrink-0"
        >
          <Plus size={12} /> {t("addFromTemplate")}
        </button>
      </div>
      <p className="text-xs text-text-muted leading-relaxed">{t(descKey)}</p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────

export default function WidgetCenter() {
  const { t } = useTranslation("widgets");
  const { widgets, loading, fetchWidgets, createWidget } = useWidgetStore();
  const loadedRef = useRef(false);
  const [tab, setTab] = useState<"mine" | "selfAdd">("mine");

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    fetchWidgets();
  }, [fetchWidgets]);

  const countByType = (type: WidgetType) =>
    widgets.filter((w) => w.widget_type === type).length;

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-text-primary">{t("widgetCenter")}</h1>
          <p className="text-text-muted text-xs mt-0.5">{t("widgetCenterDesc")}</p>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1.5 bg-surface-hover rounded-xl p-1">
          <button
            onClick={() => setTab("mine")}
            className={clsx(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
              tab === "mine" ? "bg-accent-blue text-white shadow" : "text-text-secondary hover:text-text-primary"
            )}
          >
            <List size={12} /> {t("myWidgetsTab")}
            {widgets.length > 0 && (
              <span className="ml-0.5 px-1.5 py-0.5 bg-white/20 rounded-full text-[10px]">
                {widgets.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab("selfAdd")}
            className={clsx(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
              tab === "selfAdd" ? "bg-accent-blue text-white shadow" : "text-text-secondary hover:text-text-primary"
            )}
          >
            <Plus size={12} /> {t("selfAdd")}
          </button>
        </div>
      </div>

      {/* ── My Widgets tab ── */}
      {tab === "mine" && (
        <>
          {loading && (
            <p className="text-text-muted text-sm text-center py-6">Loading…</p>
          )}
          {!loading && widgets.length === 0 && (
            <div className="glass-card p-10 text-center space-y-2">
              <Layers size={32} className="mx-auto text-text-muted opacity-40" />
              <p className="text-text-secondary text-sm font-medium">{t("noWidgets")}</p>
              <button
                onClick={() => setTab("selfAdd")}
                className="mt-2 text-xs text-accent-blue underline underline-offset-2"
              >
                {t("selfAdd")} →
              </button>
            </div>
          )}
          {!loading && widgets.length > 0 && (
            <div className="flex justify-end">
              <button
                onClick={() => setTab("selfAdd")}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-surface-border text-text-secondary hover:text-text-primary"
              >
                <Plus size={12} /> {t("selfAdd")}
              </button>
            </div>
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
        </>
      )}

      {/* ── Self-add tab ── */}
      {tab === "selfAdd" && (
        <>
          <p className="text-xs text-text-muted">{t("selfAddDesc")}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {CATALOG.map(({ type, icon, descKey }) => (
              <MarketplaceCard
                key={type}
                type={type}
                icon={icon}
                descKey={descKey}
                installedCount={countByType(type)}
                onAdd={(tp) => { createWidget(tp); setTab("mine"); }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
