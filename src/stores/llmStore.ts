import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import * as api from "@/services/llmApi";
import type { LlmConfig, LlmProvider } from "@/types/llm";

interface LlmState {
  config: LlmConfig;
  loaded: boolean;
  loading: boolean;
  error: string | null;

  loadConfig: () => Promise<void>;
  saveConfig: (config: LlmConfig) => Promise<void>;
  setActiveProvider: (providerId: string) => Promise<void>;
  updateProvider: (providerId: string, patch: Partial<LlmProvider>) => Promise<void>;
  addProvider: (provider: LlmProvider) => Promise<string>;
  removeProvider: (providerId: string) => Promise<void>;
}

const defaultConfig: LlmConfig = {
  active_provider_id: "orcarouter",
  providers: {
    orcarouter: {
      name: "OrcaRouter",
      nickname: "OrcaRouter",
      base_url: "https://api.orcarouter.ai/v1",
      model: "orcarouter/auto",
      referral_url: "https://www.orcarouter.ai/ref/ref_2bd137bce0d730edcd93",
      builtin: true,
    },
    openai: {
      name: "OpenAI",
      nickname: "OpenAI",
      base_url: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      builtin: true,
    },
    groq: {
      name: "Groq",
      nickname: "Groq",
      base_url: "https://api.groq.com/openai/v1",
      model: "llama-3.1-70b-versatile",
      builtin: true,
    },
    openrouter: {
      name: "OpenRouter",
      nickname: "OpenRouter",
      base_url: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4o-mini",
      builtin: true,
    },
    custom: {
      name: "Custom",
      nickname: "Custom",
      base_url: "",
      model: "",
      builtin: false,
    },
  },
};

function generateProviderId(config: LlmConfig, preferred?: string): string {
  const base = preferred?.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase() || "custom";
  let id = base;
  let counter = 1;
  while (config.providers[id]) {
    id = `${base}-${counter}`;
    counter++;
  }
  return id;
}

export const useLlmStore = create<LlmState>((set, get) => ({
  config: defaultConfig,
  loaded: false,
  loading: false,
  error: null,

  loadConfig: async () => {
    set({ loading: true, error: null });
    try {
      const config = await api.getLlmConfig();
      set({ config, loaded: true, loading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
        loaded: true,
        loading: false,
      });
    }
  },

  saveConfig: async (config) => {
    set({ loading: true, error: null });
    try {
      await api.setLlmConfig(config);
      set({ config, loading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
        loading: false,
      });
    }
  },

  setActiveProvider: async (providerId) => {
    const { config, saveConfig } = get();
    if (config.providers[providerId]) {
      await saveConfig({ ...config, active_provider_id: providerId });
    }
  },

  updateProvider: async (providerId, patch) => {
    const { config, saveConfig } = get();
    const existing = config.providers[providerId];
    if (!existing) return;
    const updated = { ...existing, ...patch };
    await saveConfig({
      ...config,
      providers: { ...config.providers, [providerId]: updated },
    });
  },

  addProvider: async (provider) => {
    const { config, saveConfig } = get();
    const id = generateProviderId(config, provider.nickname || provider.name);
    const newConfig: LlmConfig = {
      ...config,
      providers: { ...config.providers, [id]: provider },
      active_provider_id: config.active_provider_id ?? id,
    };
    await saveConfig(newConfig);
    return id;
  },

  removeProvider: async (providerId) => {
    const { config, saveConfig } = get();
    const provider = config.providers[providerId];
    if (!provider || provider.builtin) return;

    const remaining = Object.fromEntries(
      Object.entries(config.providers).filter(([key]) => key !== providerId)
    );
    const remainingIds = Object.keys(remaining);
    const newActiveId =
      config.active_provider_id === providerId
        ? (remainingIds[0] ?? null)
        : config.active_provider_id;

    await saveConfig({
      active_provider_id: newActiveId,
      providers: remaining,
    });
  },
}));

// Listen for external TOML changes and reload the config.
let unlisten: (() => void) | undefined;
export async function initLlmConfigWatcher(): Promise<() => void> {
  if (unlisten) return unlisten;

  const store = useLlmStore.getState();
  await store.loadConfig();

  unlisten = await listen("llm-config-changed", () => {
    void store.loadConfig();
  });

  return unlisten;
}
