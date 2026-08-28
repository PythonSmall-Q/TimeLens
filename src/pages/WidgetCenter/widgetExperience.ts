import type { WidgetConfig } from "@/types";

export interface WidgetLayoutPreset {
  id: string;
  name: string;
  widgets: WidgetConfig[];
  createdAt: string;
}

export const WIDGET_PRESETS_STORAGE_KEY = "timelens-widget-layout-presets.v1";
export const CURRENT_PROFILE_STORAGE_KEY = "timelens-current-profile-id";

export function getCurrentProfileId(storage: Pick<Storage, "getItem"> = localStorage): string {
  return storage.getItem(CURRENT_PROFILE_STORAGE_KEY)?.trim() || "default";
}

export function setCurrentProfileId(profileId: string, storage: Pick<Storage, "setItem"> = localStorage): void {
  storage.setItem(CURRENT_PROFILE_STORAGE_KEY, profileId.trim() || "default");
}

export function widgetPresetsStorageKey(profileId = getCurrentProfileId()): string {
  return `${WIDGET_PRESETS_STORAGE_KEY}:${profileId}`;
}

export function widgetSkinStorageKey(widgetId: string, profileId = getCurrentProfileId()): string {
  return `timelens-widget-skin:${profileId}:${widgetId}`;
}

export function readWidgetPresets(storage: Pick<Storage, "getItem"> = localStorage): WidgetLayoutPreset[] {
  try {
    const value = JSON.parse(storage.getItem(widgetPresetsStorageKey(getCurrentProfileId(storage))) ?? "[]") as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is WidgetLayoutPreset => (
      !!item && typeof item === "object" && typeof (item as WidgetLayoutPreset).id === "string"
      && typeof (item as WidgetLayoutPreset).name === "string" && Array.isArray((item as WidgetLayoutPreset).widgets)
    ));
  } catch {
    return [];
  }
}

export function saveWidgetPresets(presets: WidgetLayoutPreset[], storage: Pick<Storage, "getItem" | "setItem"> = localStorage): void {
  storage.setItem(widgetPresetsStorageKey(getCurrentProfileId(storage)), JSON.stringify(presets));
}

export function applyWidgetPreset(current: WidgetConfig[], preset: WidgetLayoutPreset): WidgetConfig[] {
  const byId = new Map(preset.widgets.map((widget) => [widget.id, widget]));
  return current.map((widget) => {
    const saved = byId.get(widget.id);
    return saved ? { ...widget, ...saved } : widget;
  });
}

export function createWidgetPreset(name: string, widgets: WidgetConfig[]): WidgetLayoutPreset {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: name.trim(),
    widgets: widgets.map((widget) => ({ ...widget })),
    createdAt: new Date().toISOString(),
  };
}

export function serializeWidgetPresets(presets: WidgetLayoutPreset[]): string {
  return JSON.stringify({ version: 1, presets }, null, 2);
}

export function parseWidgetPresets(raw: string): WidgetLayoutPreset[] {
  try {
    const parsed = JSON.parse(raw) as { presets?: unknown };
    if (!Array.isArray(parsed.presets)) return [];
    return parsed.presets.filter((item): item is WidgetLayoutPreset => (
      !!item && typeof item === "object" &&
      typeof (item as WidgetLayoutPreset).id === "string" &&
      typeof (item as WidgetLayoutPreset).name === "string" &&
      Array.isArray((item as WidgetLayoutPreset).widgets)
    ));
  } catch {
    return [];
  }
}