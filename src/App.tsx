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
  const [skin, setSkin] = useState({ app: appBackgroundImage, widget: widgetBackgroundImage });

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
    setSkin({ app: appBackgroundImage, widget: widgetBackgroundImage });
  }, [appBackgroundImage, widgetBackgroundImage]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<{ appBackgroundImage?: string; widgetBackgroundImage?: string }>("timelens-skin-changed", (event) => {
      setSkin({
        app: event.payload?.appBackgroundImage ?? "",
        widget: event.payload?.widgetBackgroundImage ?? "",
      });
    }).then((cleanup) => { unlisten = cleanup; }).catch(() => {});
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const appImage = skin.app ? convertFileSrc(skin.app) : "";
    const widgetImage = skin.widget ? convertFileSrc(skin.widget) : "";
    root.style.setProperty("--timelens-app-background-image", appImage ? `url("${appImage}")` : "none");
    root.style.setProperty("--timelens-widget-background-image", widgetImage ? `url("${widgetImage}")` : "none");
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
