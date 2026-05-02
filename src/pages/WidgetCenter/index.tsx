import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Clock, List, Timer, ExternalLink, Trash2, Plus, StickyNote, Activity,
  Layers, Puzzle, FolderOpen, ShieldCheck,
} from "lucide-react";
import { useWidgetStore } from "@/stores/widgetStore";
import type { WidgetConfig, WidgetRegistryItem, WidgetRegistryLoadError } from "@/types";
import * as api from "@/services/tauriApi";
import clsx from "clsx";
import WidgetPermissionDialog from "./WidgetPermissionDialog";

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

// ── Self-add catalog (official widgets) ──────────────────────

const OFFICIAL_CATALOG: { type: string; icon: typeof Clock; descKey: string }[] = [
  { type: "clock", icon: Clock, descKey: "clockDesc" },
  { type: "todo", icon: List, descKey: "todoDesc" },
  { type: "timer", icon: Timer, descKey: "timerDesc" },
  { type: "note", icon: StickyNote, descKey: "noteDesc" },
  { type: "status", icon: Activity, descKey: "statusDesc" },
];

interface MarketplaceCardProps {
  type: string;
  title: string;
  icon: typeof Clock;
  description: string;
  source: "official" | "third-party";
  installedCount: number;
  permissions?: string[];
  onAdd: (type: string, perms: string[]) => void;
}

function MarketplaceCard({ type, title, icon: Icon, description, source, installedCount, permissions = [], onAdd }: MarketplaceCardProps) {
  const { t } = useTranslation("widgets");

  return (
    <div className="glass-card p-4 flex flex-col gap-3 hover:border-accent-blue/30 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="p-2.5 rounded-xl bg-accent-blue/10 text-accent-blue flex-shrink-0">
            <Icon size={18} />
          </span>
          <div>
            <p className="text-sm font-semibold text-text-primary">{title}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-hover text-text-secondary">
                {source === "official" ? t("official") : t("thirdParty.source")}
              </span>
              {installedCount > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent-green/15 text-accent-green">
                  {t("installed")} ×{installedCount}
                </span>
              )}
              {source === "third-party" && permissions.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-500/15 text-yellow-600 flex items-center gap-0.5">
                  <ShieldCheck size={10} /> {permissions.length}
                </span>
              )}
            </div>
          </div>
        </div>
        <button
          onClick={() => onAdd(type, permissions)}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent-blue/15 text-accent-blue
                     text-xs font-medium hover:bg-accent-blue/25 transition-colors flex-shrink-0"
        >
          <Plus size={12} /> {t("addFromTemplate")}
        </button>
      </div>
      <p className="text-xs text-text-muted leading-relaxed">{description}</p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────

export default function WidgetCenter() {
  const { t } = useTranslation("widgets");
  const { widgets, loading, fetchWidgets, createWidget } = useWidgetStore();
  const loadedRef = useRef(false);
  const [tab, setTab] = useState<"mine" | "selfAdd">("mine");
  const [registryItems, setRegistryItems] = useState<WidgetRegistryItem[]>([]);
  const [registryErrors, setRegistryErrors] = useState<WidgetRegistryLoadError[]>([]);

  // Permission dialog state
  const [permDialog, setPermDialog] = useState<{
    open: boolean;
    widgetType: string;
    permissions: string[];
  }>({ open: false, widgetType: "", permissions: [] });

  // Import feedback
  const [importMsg, setImportMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const refreshRegistry = () => {
    api.getWidgetRegistry()
      .then((res) => {
        setRegistryItems(res.items);
        setRegistryErrors(res.errors ?? []);
      })
      .catch(() => {
        setRegistryItems([]);
        setRegistryErrors([]);
      });
  };

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    fetchWidgets();
    refreshRegistry();
  }, [fetchWidgets]);

  const countByType = (type: string) =>
    widgets.filter((w) => w.widget_type === type).length;

  // Build official entries list
  const officialEntries = OFFICIAL_CATALOG.map((item) => ({
    type: item.type,
    icon: item.icon,
    source: "official" as const,
    title: t(`${item.type}.title`),
    description: t(item.descKey),
    permissions: [] as string[],
  }));

  // Build third-party entries from registry
  const thirdPartyEntries = registryItems
    .filter((item) => item.source === "third-party")
    .map((item) => ({
      type: item.widget_type,
      icon: Puzzle,
      source: "third-party" as const,
      title: item.display_name,
      description: item.description ?? t("thirdParty.noDescription"),
      permissions: item.permissions ?? [],
    }));

  const handleAdd = (type: string, perms: string[]) => {
    const isThirdParty = thirdPartyEntries.some((e) => e.type === type);
    if (isThirdParty && perms.length > 0) {
      setPermDialog({ open: true, widgetType: type, permissions: perms });
    } else {
      createWidget(type);
      setTab("mine");
    }
  };

  const handlePermConfirm = async (granted: string[]) => {
    const { widgetType } = permDialog;
    setPermDialog({ open: false, widgetType: "", permissions: [] });
    await createWidget(widgetType);
    // After creation, find the newest widget of this type and set its permissions
    const state = useWidgetStore.getState();
    const newest = [...state.widgets]
      .filter((w) => w.widget_type === widgetType)
      .sort((a, b) => b.id.localeCompare(a.id))[0];
    if (newest && granted.length > 0) {
      try {
        await api.setWidgetPermissions(newest.id, granted);
      } catch (_) { /* non-fatal */ }
    }
    setTab("mine");
  };

  const handleImportLocalWidget = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false, title: t("importLocalWidget") });
      if (!selected || typeof selected !== "string") return;
      await api.importLocalWidget(selected);
      setImportMsg({ kind: "ok", text: t("importSuccess") });
      refreshRegistry();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setImportMsg({ kind: "err", text: t("importError") + ": " + msg });
    }
    setTimeout(() => setImportMsg(null), 4000);
  };

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      {/* Permission dialog */}
      <WidgetPermissionDialog
        open={permDialog.open}
        onClose={() => setPermDialog((p) => ({ ...p, open: false }))}
        widgetType={permDialog.widgetType}
        requestedPermissions={permDialog.permissions}
        onConfirm={handlePermConfirm}
      />

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

      {/* ── Add Widget tab — split columns ── */}
      {tab === "selfAdd" && (
        <div className="flex gap-6">
          {/* Left column: official */}
          <div className="flex-1 min-w-0 space-y-3">
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
              {t("officialWidgets")}
            </p>
            <div className="space-y-3">
              {officialEntries.map(({ type, icon, description, title, source, permissions }) => (
                <MarketplaceCard
                  key={type}
                  type={type}
                  title={title}
                  icon={icon}
                  source={source}
                  description={description}
                  permissions={permissions}
                  installedCount={countByType(type)}
                  onAdd={handleAdd}
                />
              ))}
            </div>
          </div>

          {/* Right column: third-party */}
          <div className="flex-1 min-w-0 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
                {t("thirdPartyWidgets")}
              </p>
              <button
                onClick={handleImportLocalWidget}
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs border border-surface-border
                           text-text-secondary hover:text-text-primary transition-colors"
              >
                <FolderOpen size={12} /> {t("importLocalWidget")}
              </button>
            </div>

            {importMsg && (
              <p className={clsx(
                "text-xs px-3 py-2 rounded-lg",
                importMsg.kind === "ok" ? "bg-accent-green/10 text-accent-green" : "bg-accent-red/10 text-accent-red"
              )}>
                {importMsg.text}
              </p>
            )}

            {thirdPartyEntries.length === 0 && (
              <div className="glass-card p-6 text-center text-text-muted text-xs space-y-1">
                <Puzzle size={24} className="mx-auto opacity-30" />
                <p>{t("thirdParty.noWidgets")}</p>
              </div>
            )}
            <div className="space-y-3">
              {thirdPartyEntries.map(({ type, icon, description, title, source, permissions }) => (
                <MarketplaceCard
                  key={type}
                  type={type}
                  title={title}
                  icon={icon}
                  source={source}
                  description={description}
                  permissions={permissions}
                  installedCount={countByType(type)}
                  onAdd={handleAdd}
                />
              ))}
            </div>

            {/* Registry errors */}
            {registryErrors.length > 0 && (
              <div className="space-y-1.5 mt-2">
                {registryErrors.map((err, i) => (
                  <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-accent-red/10 text-accent-red text-xs">
                    <span className="font-mono opacity-70 truncate">{err.path}</span>
                    <span>{err.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
