import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { emit } from "@tauri-apps/api/event";
import MainApp from "./MainApp";
import WidgetWindow from "./widgets/WidgetWindow";
import { useSettingsStore } from "./stores/settingsStore";
import { AnnouncerProvider } from "@/components/Announcer";

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
  const reducedMotion = useSettingsStore((s) => s.reducedMotion);
  const compactWidgets = useSettingsStore((s) => s.compactWidgets);
  const [skin, setSkin] = useState({
    app: appBackgroundImage,
    widget: widgetBackgroundImage,
    appFit: appBackgroundFit,
    widgetFit: widgetBackgroundFit,
    appOverlay: appBackgroundOverlay,
    widgetOverlay: widgetBackgroundOverlay,
  });

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
    root.classList.toggle("reduce-motion", reducedMotion);
    root.classList.toggle("compact-widgets", compactWidgets);
  }, [compactWidgets, reducedMotion]);

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
    listen<Partial<typeof skin> & { appBackgroundImage?: string; widgetBackgroundImage?: string }>("timelens-skin-changed", (event) => {
      setSkin((previous) => ({
        app: event.payload?.app ?? event.payload?.appBackgroundImage ?? previous.app,
        widget: event.payload?.widget ?? event.payload?.widgetBackgroundImage ?? previous.widget,
        appFit: event.payload?.appFit ?? previous.appFit,
        widgetFit: event.payload?.widgetFit ?? previous.widgetFit,
        appOverlay: event.payload?.appOverlay ?? previous.appOverlay,
        widgetOverlay: event.payload?.widgetOverlay ?? previous.widgetOverlay,
      }));
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
  }, [skin]);

  if (windowLabel !== "main") {
    return <WidgetWindow widgetId={windowLabel} />;
  }

  return (
    <AnnouncerProvider>
      <MainApp />
    </AnnouncerProvider>
  );
}
