import { useEffect, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { emit } from "@tauri-apps/api/event";
import MainApp from "./MainApp";
import WidgetWindow from "./widgets/WidgetWindow";
import { useSettingsStore } from "./stores/settingsStore";

/**
 * Root component. Decides whether to render the main dashboard or a widget,
 * based on the Tauri window label.
 *
 * Main window label: main
 * Other labels are treated as widget windows.
 */
export default function App() {
  const [windowLabel, setWindowLabel] = useState<string | null>(null);
  const theme = useSettingsStore((s) => s.theme);
  const language = useSettingsStore((s) => s.language);

  useEffect(() => {
    getCurrentWebviewWindow()
      .label
      ? setWindowLabel(getCurrentWebviewWindow().label)
      : setWindowLabel("main");
    // Also handle synchronous label access
    setWindowLabel(getCurrentWebviewWindow().label);
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

  if (windowLabel === null) return null;

  if (windowLabel !== "main") {
    return <WidgetWindow widgetId={windowLabel} />;
  }

  return <MainApp />;
}
