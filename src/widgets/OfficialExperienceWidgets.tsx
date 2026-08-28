import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as api from "@/services/tauriApi";
import { getCurrentProfileId, readWidgetPresets, type WidgetLayoutPreset } from "@/pages/WidgetCenter/widgetExperience";
import type { FocusSession, WidgetRuntimeHealth } from "@/types";

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
  const [health, setHealth] = useState<WidgetRuntimeHealth | null>(null);
  useEffect(() => { void api.getWidgetRuntimeHealth(widgetId).then(setHealth).catch(() => setHealth(null)); }, [widgetId]);
  return <div className="h-full p-4 space-y-3"><h2 className="text-sm font-semibold">{t("widgetHealth.title")}</h2><p className="text-xs text-text-muted">{t("widgetHealth.status")}: {health?.status ?? t("widgetHealth.unavailable")}</p><p className="text-xs text-text-muted">{t("widgetHealth.memory")}: {health ? `${health.memory_used_mb} MB` : "-"}</p><p className="text-xs text-text-muted">{t("widgetHealth.cpu")}: {health ? `${health.cpu_used_ms} ms` : "-"}</p></div>;
}

export function FocusStreakWidget() {
  const { t } = useTranslation("widgets");
  const [sessions, setSessions] = useState<FocusSession[]>([]);
  useEffect(() => { void api.listFocusSessions().then(setSessions).catch(() => setSessions([])); }, []);
  return <div className="h-full p-4 space-y-3"><h2 className="text-sm font-semibold">{t("focusStreak.title")}</h2><p className="text-3xl font-bold text-accent-blue">{sessions.length}</p><p className="text-xs text-text-muted">{t("focusStreak.sessions")}</p></div>;
}
