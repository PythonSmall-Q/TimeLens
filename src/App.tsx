import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { emit } from "@tauri-apps/api/event";
import MainApp from "./MainApp";
import WidgetWindow from "./widgets/WidgetWindow";
import { useSettingsStore } from "./stores/settingsStore";
import { AnnouncerProvider } from "@/components/Announcer";
import { getSkinPalette } from "@/utils/skinPalettes";
import { getNeutralTexture } from "@/utils/skinTextures";

/**
 * Root component. Decides whether to render the main dashboard or a widget,
 * based on the Tauri window label.
 *
 * Main window label: main
 * Other labels are treated as widget windows.
 */
export default function App() {
  const [windowLabel, setWindowLabel] = useState<string>("main");
  const theme = useSettingsStore((s) => s.theme);
  const language = useSettingsStore((s) => s.language);
  const appBackgroundImage = useSettingsStore((s) => s.appBackgroundImage);
  const widgetBackgroundImage = useSettingsStore((s) => s.widgetBackgroundImage);
  const appBackgroundFit = useSettingsStore((s) => s.appBackgroundFit);
  const widgetBackgroundFit = useSettingsStore((s) => s.widgetBackgroundFit);
  const appBackgroundOverlay = useSettingsStore((s) => s.appBackgroundOverlay);
  const widgetBackgroundOverlay = useSettingsStore((s) => s.widgetBackgroundOverlay);
  const skinPalette = useSettingsStore((s) => s.skinPalette);
  const [activePalette, setActivePalette] = useState(skinPalette);
  const reducedMotion = useSettingsStore((s) => s.reducedMotion);
  const compactWidgets = useSettingsStore((s) => s.compactWidgets);
  const animationMode = useSettingsStore((s) => s.animationMode) || (reducedMotion ? "reduced" : "full");

  const pageTransitions = useSettingsStore((s) => s.animationConfig?.pageTransitions ?? true);
  const cardHover = useSettingsStore((s) => s.animationConfig?.cardHover ?? true);
  const modalAnimations = useSettingsStore((s) => s.animationConfig?.modalAnimations ?? true);
  const widgetAnimations = useSettingsStore((s) => s.animationConfig?.widgetAnimations ?? true);
  const chartAnimations = useSettingsStore((s) => s.animationConfig?.chartAnimations ?? true);
  const pulseEffects = useSettingsStore((s) => s.animationConfig?.pulseEffects ?? true);

  const [skin, setSkin] = useState({
    app: appBackgroundImage,
    widget: widgetBackgroundImage,
    appFit: appBackgroundFit,
    widgetFit: widgetBackgroundFit,
    appOverlay: appBackgroundOverlay,
    widgetOverlay: widgetBackgroundOverlay,
  });

  useEffect(() => {
    setActivePalette(skinPalette);
  }, [skinPalette]);

  useEffect(() => {
    try {
      const label = getCurrentWebviewWindow().label;
      setWindowLabel(label || "main");
    } catch {
      // Fall back to main window rendering if webview window metadata is unavailable at boot.
      setWindowLabel("main");
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const isReduced = animationMode === "reduced" || reducedMotion;
    const isDisabled = animationMode === "disabled";

    root.classList.toggle("reduce-motion", isReduced || isDisabled);
    root.classList.toggle("animation-mode-disabled", isDisabled);
    root.classList.toggle("animation-mode-reduced", animationMode === "reduced");
    root.classList.toggle("animation-mode-full", animationMode === "full");
    root.classList.toggle("compact-widgets", compactWidgets);

    root.classList.toggle("no-page-transitions", isDisabled || !pageTransitions);
    root.classList.toggle("no-card-hover", isDisabled || !cardHover);
    root.classList.toggle("no-modal-animations", isDisabled || !modalAnimations);
    root.classList.toggle("no-widget-animations", isDisabled || !widgetAnimations);
    root.classList.toggle("no-chart-animations", isDisabled || !chartAnimations);
    root.classList.toggle("no-pulse-effects", isDisabled || !pulseEffects);
  }, [animationMode, cardHover, chartAnimations, compactWidgets, modalAnimations, pageTransitions, pulseEffects, reducedMotion, widgetAnimations]);

  useEffect(() => {
    const root = document.documentElement;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const applyTheme = () => {
      const useDark =
        theme === "dark" || (theme === "system" && mediaQuery.matches);
      root.classList.toggle("theme-dark", useDark);
      root.classList.toggle("theme-light", !useDark);
    };

    applyTheme();

    if (theme !== "system") {
      return;
    }

    const handleChange = () => applyTheme();
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [theme]);

  useEffect(() => {
    emit("language-changed", language).catch(() => {
      // Ignore when backend is not ready; next emit will sync menu labels.
    });
  }, [language]);

  useEffect(() => {
    setSkin({
      app: appBackgroundImage,
      widget: widgetBackgroundImage,
      appFit: appBackgroundFit,
      widgetFit: widgetBackgroundFit,
      appOverlay: appBackgroundOverlay,
      widgetOverlay: widgetBackgroundOverlay,
    });
  }, [appBackgroundFit, appBackgroundImage, appBackgroundOverlay, widgetBackgroundFit, widgetBackgroundImage, widgetBackgroundOverlay]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<Partial<typeof skin> & { appBackgroundImage?: string; widgetBackgroundImage?: string; skinPalette?: typeof skinPalette }>("timelens-skin-changed", (event) => {
      setSkin((previous) => ({
        app: event.payload?.app ?? event.payload?.appBackgroundImage ?? previous.app,
        widget: event.payload?.widget ?? event.payload?.widgetBackgroundImage ?? previous.widget,
        appFit: event.payload?.appFit ?? previous.appFit,
        widgetFit: event.payload?.widgetFit ?? previous.widgetFit,
        appOverlay: event.payload?.appOverlay ?? previous.appOverlay,
        widgetOverlay: event.payload?.widgetOverlay ?? previous.widgetOverlay,
      }));
      if (event.payload?.skinPalette) {
        setActivePalette(event.payload.skinPalette);
      }
    }).then((cleanup) => { unlisten = cleanup; }).catch(() => {});
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const appImage = skin.app ? convertFileSrc(skin.app) : "";
    const widgetImage = skin.widget ? convertFileSrc(skin.widget) : "";
    root.style.setProperty("--timelens-app-background-image", appImage ? `url("${appImage}")` : "none");
    root.style.setProperty("--timelens-widget-background-image", widgetImage ? `url("${widgetImage}")` : "none");
    root.style.setProperty("--timelens-app-background-fit", skin.appFit === "stretch" ? "100% 100%" : skin.appFit);
    root.style.setProperty("--timelens-widget-background-fit", skin.widgetFit === "stretch" ? "100% 100%" : skin.widgetFit);
    root.style.setProperty("--timelens-app-overlay", skin.app ? String(skin.appOverlay / 100) : "0");
    root.style.setProperty("--timelens-widget-overlay", skin.widget ? String(skin.widgetOverlay / 100) : "0");
    root.style.setProperty("--timelens-skin-pattern", activePalette === "neutral-texture"
      ? getNeutralTexture("aurora").css
      : "none");
    const palette = getSkinPalette(activePalette);
    const paletteVars: Record<string, string> = {
      "--app-bg": palette.appBg, "--surface": palette.surface, "--surface-light": palette.surfaceLight,
      "--surface-card": palette.surfaceCard, "--surface-hover": palette.surfaceHover, "--surface-border": palette.surfaceBorder,
      "--text-primary": palette.textPrimary, "--text-secondary": palette.textSecondary, "--text-muted": palette.textMuted,
      "--glass-bg": palette.glassBg, "--glass-light-bg": palette.glassLightBg,
      "--field-hover-border": palette.fieldHoverBorder, "--field-focus-ring": palette.fieldFocusRing,
      "--slider-border": palette.sliderBorder, "--scrollbar-thumb": palette.scrollbarThumb,
      "--scrollbar-thumb-hover": palette.scrollbarThumbHover,
      "--accent-blue": palette.accentBlue, "--accent-purple": palette.accentPurple, "--accent-teal": palette.accentTeal,
      "--accent-green": palette.accentGreen, "--accent-red": palette.accentRed, "--accent-orange": palette.accentOrange,
    };
    Object.entries(paletteVars).forEach(([name, value]) => {
      if (activePalette === "default") root.style.removeProperty(name);
      else root.style.setProperty(name, value);
    });
  }, [activePalette, skin]);

  if (windowLabel !== "main") {
    return <WidgetWindow widgetId={windowLabel} />;
  }

  return (
    <AnnouncerProvider>
      <MainApp />
    </AnnouncerProvider>
  );
}
