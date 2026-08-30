import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import i18n from "@/i18n/config";
import * as api from "@/services/tauriApi";
import type { SkinPaletteId } from "@/utils/skinPalettes";

export type AnimationMode = "full" | "reduced" | "disabled";

export interface AnimationConfig {
  pageTransitions: boolean;
  cardHover: boolean;
  modalAnimations: boolean;
  widgetAnimations: boolean;
  chartAnimations: boolean;
  pulseEffects: boolean;
}

const safeSettingsStorage = createJSONStorage(() => ({
  getItem: (name: string) => {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name: string, value: string) => {
    localStorage.setItem(name, value);
  },
  removeItem: (name: string) => {
    localStorage.removeItem(name);
  },
}));

interface SettingsState {
  language: string;
  theme: "dark" | "light" | "system";
  appBackgroundImage: string;
  widgetBackgroundImage: string;
  appBackgroundFit: "cover" | "contain" | "stretch";
  widgetBackgroundFit: "cover" | "contain" | "stretch";
  appBackgroundOverlay: number;
  widgetBackgroundOverlay: number;
  skinPalette: SkinPaletteId;
  updateMode: "off" | "notify" | "auto";
  monitoringActive: boolean;
  samplingIntervalMs: number;
  debounceMs: number;
  autoOpenWidgets: boolean;
  ignoreSystemProcesses: boolean;
  idleTimePolicy: "count" | "exclude";
  trackWindowTitles: boolean;
  weekStartDay: 0 | 1; // 0 = Sunday, 1 = Monday
  excludeTimelens: boolean;
  notificationQuietHoursEnabled: boolean;
  notificationQuietStart: string;
  notificationQuietEnd: string;
  notificationCooldownMin: number;
  reducedMotion: boolean;
  compactWidgets: boolean;
  animationMode: AnimationMode;
  animationConfig: AnimationConfig;
  setLanguage: (lang: string) => void;
  setTheme: (theme: "dark" | "light" | "system") => void;
  setAppBackgroundImage: (path: string) => void;
  setWidgetBackgroundImage: (path: string) => void;
  setAppBackgroundFit: (fit: "cover" | "contain" | "stretch") => void;
  setWidgetBackgroundFit: (fit: "cover" | "contain" | "stretch") => void;
  setAppBackgroundOverlay: (value: number) => void;
  setWidgetBackgroundOverlay: (value: number) => void;
  setSkinPalette: (palette: SkinPaletteId) => void;
  setUpdateMode: (mode: "off" | "notify" | "auto") => void;
  setMonitoringActive: (active: boolean) => Promise<void>;
  setSamplingInterval: (ms: number) => void;
  setDebounce: (ms: number) => void;
  setAutoOpenWidgets: (active: boolean) => void;
  setIgnoreSystemProcesses: (active: boolean) => void;
  setIdleTimePolicy: (policy: "count" | "exclude") => void;
  setTrackWindowTitles: (active: boolean) => void;
  setWeekStartDay: (day: 0 | 1) => void;
  setExcludeTimelens: (val: boolean) => void;
  setNotificationQuietHoursEnabled: (enabled: boolean) => void;
  setNotificationQuietStart: (value: string) => void;
  setNotificationQuietEnd: (value: string) => void;
  setNotificationCooldownMin: (minutes: number) => void;
  setReducedMotion: (enabled: boolean) => void;
  setCompactWidgets: (enabled: boolean) => void;
  setAnimationMode: (mode: AnimationMode) => void;
  setAnimationConfig: (config: Partial<AnimationConfig>) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      language: i18n.language || "en",
      theme: "dark",
      appBackgroundImage: "",
      widgetBackgroundImage: "",
      appBackgroundFit: "cover",
      widgetBackgroundFit: "cover",
      appBackgroundOverlay: 62,
      widgetBackgroundOverlay: 62,
      skinPalette: "default",
      updateMode: "notify",
      monitoringActive: true,
      samplingIntervalMs: 1000,
      debounceMs: 500,
      autoOpenWidgets: true,
      ignoreSystemProcesses: false,
      idleTimePolicy: "count",
      trackWindowTitles: true,
      weekStartDay: 1,
      excludeTimelens: true,
      notificationQuietHoursEnabled: false,
      notificationQuietStart: "22:00",
      notificationQuietEnd: "07:00",
      notificationCooldownMin: 15,
      reducedMotion: false,
      compactWidgets: false,
      animationMode: "full",
      animationConfig: {
        pageTransitions: true,
        cardHover: true,
        modalAnimations: true,
        widgetAnimations: true,
        chartAnimations: true,
        pulseEffects: true,
      },

      setLanguage: (lang) => {
        set({ language: lang });
        i18n.changeLanguage(lang);
        localStorage.setItem("timelens-language", lang);
      },

      setTheme: (theme) => set({ theme }),

      setAppBackgroundImage: (appBackgroundImage) => set({ appBackgroundImage }),

      setWidgetBackgroundImage: (widgetBackgroundImage) => set({ widgetBackgroundImage }),

      setAppBackgroundFit: (appBackgroundFit) => set({ appBackgroundFit }),

      setWidgetBackgroundFit: (widgetBackgroundFit) => set({ widgetBackgroundFit }),

      setAppBackgroundOverlay: (value) => set({ appBackgroundOverlay: Math.max(0, Math.min(90, value)) }),

      setWidgetBackgroundOverlay: (value) => set({ widgetBackgroundOverlay: Math.max(0, Math.min(90, value)) }),

      setSkinPalette: (skinPalette) => set({ skinPalette }),

      setUpdateMode: (updateMode) => set({ updateMode }),

      setMonitoringActive: (monitoringActive) => {
        set({ monitoringActive });
        return api.setMonitoringActive(monitoringActive).catch((e) => {
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

      setIdleTimePolicy: (idleTimePolicy) => {
        set({ idleTimePolicy });
        api.setIdleTimePolicy(idleTimePolicy).catch((e) => {
          console.error("setIdleTimePolicy failed", e);
        });
      },

      setTrackWindowTitles: (trackWindowTitles) => {
        set({ trackWindowTitles });
        api.setTrackWindowTitles(trackWindowTitles).catch((e) => {
          console.error("setTrackWindowTitles failed", e);
        });
      },

      setWeekStartDay: (weekStartDay) => set({ weekStartDay }),

      setExcludeTimelens: (excludeTimelens) => set({ excludeTimelens }),

      setNotificationQuietHoursEnabled: (notificationQuietHoursEnabled) => {
        set({ notificationQuietHoursEnabled });
        const { notificationQuietStart, notificationQuietEnd } = useSettingsStore.getState();
        api.setQuietHours({
          enabled: notificationQuietHoursEnabled,
          start: notificationQuietStart,
          end: notificationQuietEnd,
        }).catch((e) => {
          console.error("setQuietHours failed", e);
        });
      },

      setNotificationQuietStart: (notificationQuietStart) => {
        set({ notificationQuietStart });
        const { notificationQuietHoursEnabled, notificationQuietEnd } = useSettingsStore.getState();
        api.setQuietHours({
          enabled: notificationQuietHoursEnabled,
          start: notificationQuietStart,
          end: notificationQuietEnd,
        }).catch((e) => {
          console.error("setQuietHours failed", e);
        });
      },

      setNotificationQuietEnd: (notificationQuietEnd) => {
        set({ notificationQuietEnd });
        const { notificationQuietHoursEnabled, notificationQuietStart } = useSettingsStore.getState();
        api.setQuietHours({
          enabled: notificationQuietHoursEnabled,
          start: notificationQuietStart,
          end: notificationQuietEnd,
        }).catch((e) => {
          console.error("setQuietHours failed", e);
        });
      },

      setNotificationCooldownMin: (notificationCooldownMin) =>
        set({ notificationCooldownMin: Math.max(0, Math.min(240, notificationCooldownMin)) }),

      setReducedMotion: (reducedMotion) =>
        set({
          reducedMotion,
          animationMode: reducedMotion ? "reduced" : "full",
        }),

      setCompactWidgets: (compactWidgets) => set({ compactWidgets }),

      setAnimationMode: (animationMode) =>
        set({
          animationMode,
          reducedMotion: animationMode === "reduced" || animationMode === "disabled",
        }),

      setAnimationConfig: (config) =>
        set((state) => ({
          animationConfig: { ...state.animationConfig, ...config },
        })),
    }),
    {
      name: "timelens-settings",
      storage: safeSettingsStorage,
      migrate: (persistedState) => {
        if (!persistedState || typeof persistedState !== "object") {
          // Corrupted persisted payloads are discarded to keep app bootable.
          return undefined;
        }
        const state = persistedState as Record<string, unknown>;
        // Migrate legacy boolean autoCheckUpdates to the new updateMode enum.
        if (!("updateMode" in state) && "autoCheckUpdates" in state) {
          state.updateMode = state.autoCheckUpdates === true ? "notify" : "off";
          delete state.autoCheckUpdates;
        }
        if (!("animationMode" in state)) {
          state.animationMode = state.reducedMotion === true ? "reduced" : "full";
        }
        if (!("animationConfig" in state) || typeof state.animationConfig !== "object") {
          state.animationConfig = {
            pageTransitions: true,
            cardHover: true,
            modalAnimations: true,
            widgetAnimations: true,
            chartAnimations: true,
            pulseEffects: true,
          };
        }
        return state;
      },
      onRehydrateStorage: () => (state) => {
        if (state?.language) {
          i18n.changeLanguage(state.language);
        }
      },
    }
  )
);
