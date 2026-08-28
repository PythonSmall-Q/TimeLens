import { describe, expect, it } from "vitest";
import type { WidgetConfig } from "@/types";
import { applyWidgetPreset, createWidgetPreset, getCurrentProfileId, readWidgetPresets, saveWidgetPresets, setCurrentProfileId } from "./widgetExperience";

const widget: WidgetConfig = {
  id: "clock-1", widget_type: "clock", monitor_index: 0, x: 10, y: 20, width: 320, height: 220,
  opacity: 0.8, always_on_top_mode: "focus", pinned: false, start_on_launch: true,
};

describe("widget layout presets", () => {
  it("round-trips named presets without changing widget identity", () => {
    const storage = { value: "", getItem: () => storage.value, setItem: (_key: string, value: string) => { storage.value = value; } };
    const preset = createWidgetPreset("Focus", [{ ...widget, x: 500, y: 600 }]);
    saveWidgetPresets([preset], storage);
    expect(readWidgetPresets(storage)[0].name).toBe("Focus");
    expect(applyWidgetPreset([widget], preset)[0]).toMatchObject({ id: "clock-1", x: 500, y: 600 });
  });

  it("keeps current config when a preset does not contain that widget", () => {
    const preset = createWidgetPreset("Work", []);
    expect(applyWidgetPreset([widget], preset)).toEqual([widget]);
  });

  it("isolates presets by profile", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    setCurrentProfileId("old", storage);
    saveWidgetPresets([createWidgetPreset("Old", [])], storage);
    setCurrentProfileId("new", storage);
    expect(getCurrentProfileId(storage)).toBe("new");
    expect(readWidgetPresets(storage)).toEqual([]);
    saveWidgetPresets([createWidgetPreset("New", [])], storage);
    setCurrentProfileId("old", storage);
    expect(readWidgetPresets(storage)[0].name).toBe("Old");
  });
});