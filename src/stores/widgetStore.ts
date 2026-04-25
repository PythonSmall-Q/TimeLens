import { create } from "zustand";
import type { WidgetConfig, WidgetType } from "@/types";
import * as api from "@/services/tauriApi";

interface WidgetStore {
  widgets: WidgetConfig[];
  loading: boolean;

  fetchWidgets: () => Promise<void>;
  createWidget: (type: WidgetType) => Promise<void>;
  openWidget: (config: WidgetConfig) => Promise<void>;
  closeWidget: (id: string) => Promise<void>;
  removeWidget: (id: string) => Promise<void>;
  updateWidgetConfig: (config: WidgetConfig) => Promise<void>;
}

export const useWidgetStore = create<WidgetStore>((set, get) => ({
  widgets: [],
  loading: false,

  fetchWidgets: async () => {
    set({ loading: true });
    try {
      const widgets = await api.getAllWidgets();
      set({ widgets });
    } catch (e) {
      console.error("fetchWidgets failed", e);
    } finally {
      set({ loading: false });
    }
  },

  createWidget: async (type: WidgetType) => {
    try {
      const config = await api.createWidget(type);
      await api.saveWidgetConfig(config);
      set((s) => ({ widgets: [...s.widgets, config] }));
    } catch (e) {
      console.error("createWidget failed", e);
    }
  },

  openWidget: async (config: WidgetConfig) => {
    await api.openWidget(config);
  },

  closeWidget: async (id: string) => {
    await api.closeWidget(id);
  },

  removeWidget: async (id: string) => {
    await api.closeWidget(id);
    await api.removeWidgetConfig(id);
    set((s) => ({ widgets: s.widgets.filter((w) => w.id !== id) }));
  },

  updateWidgetConfig: async (config: WidgetConfig) => {
    await api.saveWidgetConfig(config);
    set((s) => ({
      widgets: s.widgets.map((w) => (w.id === config.id ? config : w)),
    }));
  },
}));
