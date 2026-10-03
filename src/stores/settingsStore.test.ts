import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import appSource from "@/App.tsx?raw";
import { useSettingsStore } from "./settingsStore";

const globalsCss = readFileSync("src/styles/globals.css", "utf-8");

const PERSIST_KEY = "timelens-settings";
const initialState = useSettingsStore.getState();

beforeEach(() => {
  window.localStorage.clear();
  useSettingsStore.setState(initialState, false);
});

const readPersisted = () =>
  JSON.parse(window.localStorage.getItem(PERSIST_KEY) ?? "null") as { state: Record<string, unknown>; version: number } | null;

describe("settingsStore skin persistence contract", () => {
  it("starts with skin defaults: no background, cover fit, default overlay and palette", () => {
    const state = useSettingsStore.getState();
    expect(state.appBackgroundImage).toBe("");
    expect(state.widgetBackgroundImage).toBe("");
    expect(state.appBackgroundFit).toBe("cover");
    expect(state.widgetBackgroundFit).toBe("cover");
    expect(state.appBackgroundOverlay).toBe(62);
    expect(state.widgetBackgroundOverlay).toBe(62);
    expect(state.skinPalette).toBe("default");
  });

  it("updates skin state through the setters and clamps overlay strength", () => {
    const store = useSettingsStore.getState();
    store.setAppBackgroundImage("D:\\skins\\app.png");
    store.setWidgetBackgroundImage("D:\\skins\\widget.png");
    store.setAppBackgroundFit("contain");
    store.setWidgetBackgroundFit("stretch");
    store.setSkinPalette("ocean");
    store.setAppBackgroundOverlay(95);
    store.setWidgetBackgroundOverlay(-10);

    const state = useSettingsStore.getState();
    expect(state.appBackgroundImage).toBe("D:\\skins\\app.png");
    expect(state.widgetBackgroundImage).toBe("D:\\skins\\widget.png");
    expect(state.appBackgroundFit).toBe("contain");
    expect(state.widgetBackgroundFit).toBe("stretch");
    expect(state.skinPalette).toBe("ocean");
    expect(state.appBackgroundOverlay).toBe(90);
    expect(state.widgetBackgroundOverlay).toBe(0);
  });

  it("writes skin setters through to the zustand persist storage", () => {
    useSettingsStore.getState().setWidgetBackgroundImage("D:\\skins\\widget.png");
    useSettingsStore.getState().setWidgetBackgroundFit("contain");

    const persisted = readPersisted();
    expect(persisted).not.toBeNull();
    expect(persisted?.state.widgetBackgroundImage).toBe("D:\\skins\\widget.png");
    expect(persisted?.state.widgetBackgroundFit).toBe("contain");
  });

  it("round-trips persisted skin keys back into store state on rehydrate", async () => {
    window.localStorage.setItem(PERSIST_KEY, JSON.stringify({
      version: 0,
      state: {
        appBackgroundImage: "D:\\skins\\app.png",
        widgetBackgroundFit: "contain",
        widgetBackgroundOverlay: 30,
      },
    }));

    await useSettingsStore.persist.rehydrate();

    const state = useSettingsStore.getState();
    expect(state.appBackgroundImage).toBe("D:\\skins\\app.png");
    expect(state.widgetBackgroundFit).toBe("contain");
    expect(state.widgetBackgroundOverlay).toBe(30);
    // Keys absent from the persisted payload keep their defaults.
    expect(state.appBackgroundFit).toBe("cover");
    expect(state.appBackgroundOverlay).toBe(62);
    expect(state.widgetBackgroundImage).toBe("");
  });

  it("keeps skin defaults when the persisted payload is corrupted", async () => {
    window.localStorage.setItem(PERSIST_KEY, "{corrupted");
    await useSettingsStore.persist.rehydrate();
    expect(useSettingsStore.getState().appBackgroundFit).toBe("cover");
    expect(useSettingsStore.getState().appBackgroundImage).toBe("");
  });

  it("discards non-object persisted payloads via migrate to keep the app bootable", async () => {
    window.localStorage.setItem(PERSIST_KEY, JSON.stringify({ version: 99, state: 42 }));
    await useSettingsStore.persist.rehydrate();
    const state = useSettingsStore.getState();
    expect(state.appBackgroundFit).toBe("cover");
    expect(state.widgetBackgroundOverlay).toBe(62);
    expect(state.reducedMotion).toBe(false);
  });
});

describe("settingsStore accessibility defaults and motion contract", () => {
  it("starts with full motion, expanded widgets, and all animation channels enabled", () => {
    const state = useSettingsStore.getState();
    expect(state.reducedMotion).toBe(false);
    expect(state.compactWidgets).toBe(false);
    expect(state.animationMode).toBe("full");
    expect(state.animationConfig).toEqual({
      pageTransitions: true,
      cardHover: true,
      modalAnimations: true,
      widgetAnimations: true,
      chartAnimations: true,
      pulseEffects: true,
    });
  });

  it("flips animationMode to reduced when reduced motion is enabled", () => {
    useSettingsStore.getState().setReducedMotion(true);
    expect(useSettingsStore.getState()).toMatchObject({ reducedMotion: true, animationMode: "reduced" });

    useSettingsStore.getState().setReducedMotion(false);
    expect(useSettingsStore.getState()).toMatchObject({ reducedMotion: false, animationMode: "full" });
  });

  it("keeps reducedMotion in sync when animationMode is changed directly", () => {
    useSettingsStore.getState().setAnimationMode("disabled");
    expect(useSettingsStore.getState()).toMatchObject({ reducedMotion: true, animationMode: "disabled" });

    useSettingsStore.getState().setAnimationMode("reduced");
    expect(useSettingsStore.getState()).toMatchObject({ reducedMotion: true, animationMode: "reduced" });

    useSettingsStore.getState().setAnimationMode("full");
    expect(useSettingsStore.getState()).toMatchObject({ reducedMotion: false, animationMode: "full" });
  });

  it("toggles compact widget density", () => {
    useSettingsStore.getState().setCompactWidgets(true);
    expect(useSettingsStore.getState().compactWidgets).toBe(true);
    useSettingsStore.getState().setCompactWidgets(false);
    expect(useSettingsStore.getState().compactWidgets).toBe(false);
  });
});

/**
 * App.tsx toggles these classes on <html> from store state, and globals.css
 * must style each of them for reduced-motion / compact mode to take effect.
 * The raw-source assertions keep the three files from drifting apart.
 */
const ROOT_CLASS_CONTRACT = [
  "reduce-motion",
  "animation-mode-disabled",
  "animation-mode-reduced",
  "compact-widgets",
  "no-page-transitions",
  "no-card-hover",
  "no-modal-animations",
  "no-widget-animations",
  "no-chart-animations",
  "no-pulse-effects",
] as const;

describe("App.tsx root class contract", () => {
  it("marks the full animation mode explicitly", () => {
    expect(appSource).toContain('"animation-mode-full"');
  });

  it.each(ROOT_CLASS_CONTRACT)("keeps App.tsx and globals.css in sync for root class %s", (className) => {
    expect(appSource).toContain(`"${className}"`);
    expect(globalsCss).toContain(`html.${className}`);
  });
});
