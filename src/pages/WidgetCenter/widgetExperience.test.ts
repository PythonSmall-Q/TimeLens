import { describe, expect, it } from "vitest";
import type { WidgetConfig } from "@/types";
import {
  MIN_WIDGET_HEIGHT,
  MIN_WIDGET_WIDTH,
  applyWidgetPreset,
  createWidgetPreset,
  getCurrentProfileId,
  parseWidgetPresets,
  readWidgetPresets,
  sanitizeWidgetConfigForViewport,
  saveWidgetPresets,
  serializeWidgetPresets,
  setCurrentProfileId,
} from "./widgetExperience";

const widget: WidgetConfig = {
  id: "clock-1", widget_type: "clock", monitor_index: 0, x: 10, y: 20, width: 320, height: 220,
  opacity: 0.8, always_on_top_mode: "focus", pinned: false, start_on_launch: true,
};

const makeWidget = (overrides: Partial<WidgetConfig> = {}): WidgetConfig => ({ ...widget, ...overrides });

const mapStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
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
    const storage = mapStorage();
    setCurrentProfileId("old", storage);
    saveWidgetPresets([createWidgetPreset("Old", [])], storage);
    setCurrentProfileId("new", storage);
    expect(getCurrentProfileId(storage)).toBe("new");
    expect(readWidgetPresets(storage)).toEqual([]);
    saveWidgetPresets([createWidgetPreset("New", [])], storage);
    setCurrentProfileId("old", storage);
    expect(readWidgetPresets(storage)[0].name).toBe("Old");
  });

  it("round-trips full preset payloads per profile", () => {
    const storage = mapStorage();
    const preset = createWidgetPreset("Coding", [widget, makeWidget({ id: "note-1", widget_type: "note", x: 40, y: 50 })]);

    setCurrentProfileId("profile-a", storage);
    saveWidgetPresets([preset], storage);
    expect(readWidgetPresets(storage)).toEqual([preset]);

    setCurrentProfileId("profile-b", storage);
    expect(readWidgetPresets(storage)).toEqual([]);
    saveWidgetPresets([createWidgetPreset("Break", [widget])], storage);

    setCurrentProfileId("profile-a", storage);
    expect(readWidgetPresets(storage)).toEqual([preset]);
    expect(readWidgetPresets(storage)[0].widgets).toHaveLength(2);
  });

  it("falls back to the default profile when none is stored", () => {
    const storage = mapStorage();
    expect(getCurrentProfileId(storage)).toBe("default");
    setCurrentProfileId("  ", storage);
    expect(getCurrentProfileId(storage)).toBe("default");
    setCurrentProfileId("  work  ", storage);
    expect(getCurrentProfileId(storage)).toBe("work");
  });
});

describe("parseWidgetPresets", () => {
  it("rejects malformed JSON", () => {
    expect(parseWidgetPresets("{not json")).toEqual([]);
    expect(parseWidgetPresets("")).toEqual([]);
  });

  it("rejects payloads whose presets field is not an array", () => {
    expect(parseWidgetPresets(JSON.stringify({ presets: "nope" }))).toEqual([]);
    expect(parseWidgetPresets(JSON.stringify({ presets: { id: "x" } }))).toEqual([]);
    expect(parseWidgetPresets(JSON.stringify([{ id: "x" }]))).toEqual([]);
    expect(parseWidgetPresets(JSON.stringify({ presets: [null, 42, { id: "x" }] }))).toEqual([]);
  });

  it("round-trips exported presets through serializeWidgetPresets", () => {
    const presets = [createWidgetPreset("Focus", [widget])];
    expect(parseWidgetPresets(serializeWidgetPresets(presets))).toEqual(presets);
  });
});

describe("sanitizeWidgetConfigForViewport", () => {
  const viewport = { width: 1920, height: 1080 };

  it("clamps negative positions to zero", () => {
    const sanitized = sanitizeWidgetConfigForViewport(makeWidget({ x: -50, y: -10 }), viewport);
    expect(sanitized).toMatchObject({ x: 0, y: 0 });
  });

  it("falls back to minimum size for zero, negative, or NaN dimensions", () => {
    expect(sanitizeWidgetConfigForViewport(makeWidget({ width: 0, height: 0 }), viewport)).toMatchObject({
      width: MIN_WIDGET_WIDTH,
      height: MIN_WIDGET_HEIGHT,
    });
    expect(sanitizeWidgetConfigForViewport(makeWidget({ width: -320, height: -220 }), viewport)).toMatchObject({
      width: MIN_WIDGET_WIDTH,
      height: MIN_WIDGET_HEIGHT,
    });
    expect(sanitizeWidgetConfigForViewport(makeWidget({ width: NaN, height: NaN }), viewport)).toMatchObject({
      width: MIN_WIDGET_WIDTH,
      height: MIN_WIDGET_HEIGHT,
    });
  });

  it("treats NaN positions as off-screen and recovers them to zero", () => {
    const sanitized = sanitizeWidgetConfigForViewport(makeWidget({ x: NaN, y: NaN }), viewport);
    expect(sanitized).toMatchObject({ x: 0, y: 0 });
  });

  it("leaves valid configs untouched", () => {
    const valid = makeWidget({ x: 10, y: 20, width: 320, height: 220 });
    expect(sanitizeWidgetConfigForViewport(valid, viewport)).toEqual(valid);
  });

  it("enforces sane minimums on undersized but positive dimensions", () => {
    const sanitized = sanitizeWidgetConfigForViewport(makeWidget({ width: 40, height: 30 }), viewport);
    expect(sanitized).toMatchObject({ width: MIN_WIDGET_WIDTH, height: MIN_WIDGET_HEIGHT });
  });

  it("pulls off-screen widgets back into the viewport after monitor shrink or removal", () => {
    const onSecondMonitor = makeWidget({ x: 2500, y: 1400, width: 320, height: 220 });
    const sanitized = sanitizeWidgetConfigForViewport(onSecondMonitor, { width: 1920, height: 1080 });
    expect(sanitized).toMatchObject({ x: 1920 - 320, y: 1080 - 220 });
  });

  it("anchors widgets larger than the viewport at the origin", () => {
    const oversized = makeWidget({ x: 100, y: 100, width: 4000, height: 3000 });
    expect(sanitizeWidgetConfigForViewport(oversized, { width: 1920, height: 1080 })).toMatchObject({ x: 0, y: 0 });
  });
});

describe("applyWidgetPreset layout recovery", () => {
  const viewport = { width: 1920, height: 1080 };

  it("preserves unlisted widgets and sanitizes corrupt bounds for listed ones", () => {
    const clock = makeWidget({ id: "clock-1" });
    const note = makeWidget({ id: "note-1", widget_type: "note", x: 40, y: 50, width: 300, height: 200 });
    const corrupt = createWidgetPreset("Corrupt", [
      makeWidget({ id: "clock-1", x: -500, y: NaN, width: 0, height: -20 }),
    ]);

    const result = applyWidgetPreset([clock, note], corrupt, viewport);
    expect(result[0]).toMatchObject({ id: "clock-1", x: 0, y: 0, width: MIN_WIDGET_WIDTH, height: MIN_WIDGET_HEIGHT });
    expect(result[1]).toBe(note);
  });

  it("keeps the legacy two-argument merge untouched when no viewport is given", () => {
    const preset = createWidgetPreset("Remote", [makeWidget({ id: "clock-1", x: 2500, y: 1400 })]);
    const result = applyWidgetPreset([widget], preset);
    expect(result[0]).toMatchObject({ x: 2500, y: 1400 });
  });
});
