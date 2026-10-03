import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentProfileId, readWidgetPresets, type WidgetLayoutPreset } from "@/pages/WidgetCenter/widgetExperience";
import type { FocusSession, WidgetRuntimeHealth } from "@/types";
import { useWidgetClient } from "@/hooks/useWidgetClient";

export function SkinPreviewWidget() {
  const { t } = useTranslation("widgets");
  const [palette, setPalette] = useState("default");
  useEffect(() => {
    const update = () => setPalette(localStorage.getItem("timelens-settings")?.includes("skinPalette") ? "custom" : "default");
    update();
    window.addEventListener("storage", update);
    return () => window.removeEventListener("storage", update);
  }, []);
  return <div className="h-full p-4 space-y-3"><h2 className="text-sm font-semibold">{t("skinPreview.title")}</h2><div className="rounded-lg border border-surface-border p-4" style={{ background: "var(--surface-raised)" }}><p className="text-xs text-text-muted">{t("skinPreview.palette")}</p><p className="text-lg font-semibold">{palette}</p></div></div>;
}

export function LayoutSwitcherWidget() {
  const { t } = useTranslation("widgets");
  const [presets, setPresets] = useState<WidgetLayoutPreset[]>([]);
  useEffect(() => setPresets(readWidgetPresets()), []);
  return <div className="h-full p-4 space-y-3"><h2 className="text-sm font-semibold">{t("layoutSwitcher.title")}</h2><p className="text-xs text-text-muted">{t("layoutSwitcher.profile", { profile: getCurrentProfileId() })}</p>{presets.length === 0 ? <p className="text-xs text-text-muted">{t("layoutSwitcher.empty")}</p> : <ul className="space-y-2">{presets.map((preset) => <li key={preset.id} className="rounded border border-surface-border px-3 py-2 text-sm">{preset.name}<span className="ml-2 text-xs text-text-muted">{preset.widgets.length}</span></li>)}</ul>}</div>;
}

export function WidgetHealthWidget({ widgetId }: { widgetId: string }) {
  const { t } = useTranslation("widgets");
  const client = useWidgetClient({ widgetId, widgetType: "widget-health" });
  const [health, setHealth] = useState<WidgetRuntimeHealth | null>(null);
  useEffect(() => { void client.query<WidgetRuntimeHealth | null>("health").then(setHealth).catch(() => setHealth(null)); }, [client, widgetId]);
  return <div className="h-full p-4 space-y-3"><h2 className="text-sm font-semibold">{t("widgetHealth.title")}</h2><p className="text-xs text-text-muted">{t("widgetHealth.status")}: {health?.status ?? t("widgetHealth.unavailable")}</p><p className="text-xs text-text-muted">{t("widgetHealth.memory")}: {health ? `${health.memory_used_mb} MB` : "-"}</p><p className="text-xs text-text-muted">{t("widgetHealth.cpu")}: {health ? `${health.cpu_used_ms} ms` : "-"}</p></div>;
}

export function FocusStreakWidget({ widgetId }: { widgetId: string }) {
  const { t } = useTranslation("widgets");
  const client = useWidgetClient({ widgetId, widgetType: "focus-streak" });
  const [sessions, setSessions] = useState<FocusSession[]>([]);
  // The previous unbounded listFocusSessions() returned every session; use a full-range window to keep that behavior.
  useEffect(() => { void client.query<FocusSession[]>("sessions", { start_at: "1970-01-01T00:00:00", end_at: "9999-12-31T23:59:59" }).then(setSessions).catch(() => setSessions([])); }, [client, widgetId]);
  return <div className="h-full p-4 space-y-3"><h2 className="text-sm font-semibold">{t("focusStreak.title")}</h2><p className="text-3xl font-bold text-accent-blue">{sessions.length}</p><p className="text-xs text-text-muted">{t("focusStreak.sessions")}</p></div>;
}
