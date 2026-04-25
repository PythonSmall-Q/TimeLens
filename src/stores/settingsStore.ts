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
  setLanguage: (lang: string) => void;
  setTheme: (theme: "dark" | "light" | "system") => void;
  setMonitoringActive: (active: boolean) => void;
  setSamplingInterval: (ms: number) => void;
  setDebounce: (ms: number) => void;
  setAutoOpenWidgets: (active: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      language: "en",
      theme: "dark",
      monitoringActive: true,
      samplingIntervalMs: 1000,
      debounceMs: 500,
      autoOpenWidgets: true,

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
