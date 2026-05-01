import { create } from "zustand";
import { persist } from "zustand/middleware";
import i18n from "@/i18n/config";
import * as api from "@/services/tauriApi";

interface SettingsState {
  language: string;
  theme: "dark" | "light" | "system";
  monitoringActive: boolean;
  samplingIntervalMs: number;
  debounceMs: number;
  autoOpenWidgets: boolean;
  ignoreSystemProcesses: boolean;
  weekStartDay: 0 | 1; // 0 = Sunday, 1 = Monday
  excludeTimelens: boolean;
  setLanguage: (lang: string) => void;
  setTheme: (theme: "dark" | "light" | "system") => void;
  setMonitoringActive: (active: boolean) => void;
  setSamplingInterval: (ms: number) => void;
  setDebounce: (ms: number) => void;
  setAutoOpenWidgets: (active: boolean) => void;
  setIgnoreSystemProcesses: (active: boolean) => void;
  setWeekStartDay: (day: 0 | 1) => void;
  setExcludeTimelens: (val: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      language: i18n.language || "en",
      theme: "dark",
      monitoringActive: true,
      samplingIntervalMs: 1000,
      debounceMs: 500,
      autoOpenWidgets: true,
      ignoreSystemProcesses: false,
      weekStartDay: 1,
      excludeTimelens: true,

      setLanguage: (lang) => {
        set({ language: lang });
        i18n.changeLanguage(lang);
        localStorage.setItem("timelens-language", lang);
      },

      setTheme: (theme) => set({ theme }),

      setMonitoringActive: (monitoringActive) => {
        set({ monitoringActive });
        api.setMonitoringActive(monitoringActive).catch((e) => {
          console.error("setMonitoringActive failed", e);
        });
      },

      setSamplingInterval: (samplingIntervalMs) => set({ samplingIntervalMs }),

      setDebounce: (debounceMs) => set({ debounceMs }),

      setAutoOpenWidgets: (autoOpenWidgets) => {
        set({ autoOpenWidgets });
        api.setAutoOpenWidgets(autoOpenWidgets).catch((e) => {
          console.error("setAutoOpenWidgets failed", e);
        });
      },

      setIgnoreSystemProcesses: (ignoreSystemProcesses) => {
        set({ ignoreSystemProcesses });
        api.setIgnoreSystemProcesses(ignoreSystemProcesses).catch((e) => {
          console.error("setIgnoreSystemProcesses failed", e);
        });
      },

      setWeekStartDay: (weekStartDay) => set({ weekStartDay }),

      setExcludeTimelens: (excludeTimelens) => set({ excludeTimelens }),
    }),
    {
      name: "timelens-settings",
      onRehydrateStorage: () => (state) => {
        if (state?.language) {
          i18n.changeLanguage(state.language);
        }
      },
    }
  )
);
