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

export const MIN_WIDGET_WIDTH = 120;
export const MIN_WIDGET_HEIGHT = 80;

export interface WidgetViewport {
  width: number;
  height: number;
}

export function sanitizeWidgetConfigForViewport(config: WidgetConfig, viewport: WidgetViewport): WidgetConfig {
  const width = Number.isFinite(config.width) && config.width > 0
    ? Math.max(MIN_WIDGET_WIDTH, config.width)
    : MIN_WIDGET_WIDTH;
  const height = Number.isFinite(config.height) && config.height > 0
    ? Math.max(MIN_WIDGET_HEIGHT, config.height)
    : MIN_WIDGET_HEIGHT;
  const maxX = Math.max(0, viewport.width - width);
  const maxY = Math.max(0, viewport.height - height);
  const x = Number.isFinite(config.x) ? Math.min(Math.max(0, config.x), maxX) : 0;
  const y = Number.isFinite(config.y) ? Math.min(Math.max(0, config.y), maxY) : 0;
  return { ...config, x, y, width, height };
}

export function applyWidgetPreset(current: WidgetConfig[], preset: WidgetLayoutPreset, viewport?: WidgetViewport): WidgetConfig[] {
  const byId = new Map(preset.widgets.map((widget) => [widget.id, widget]));
  return current.map((widget) => {
    const saved = byId.get(widget.id);
    if (!saved) return widget;
    const merged = { ...widget, ...saved };
    return viewport ? sanitizeWidgetConfigForViewport(merged, viewport) : merged;
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