import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmConfig, LlmDataSharing, LlmProvider } from "@/types/llm";

const mockGetLlmConfig = vi.fn();
const mockSetLlmConfig = vi.fn();
const mockListen = vi.fn();

vi.mock("@/services/llmApi", () => ({
  getLlmConfig: (...args: unknown[]) => mockGetLlmConfig(...args),
  setLlmConfig: (...args: unknown[]) => mockSetLlmConfig(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

import { useLlmStore } from "./llmStore";

const initialState = useLlmStore.getState();

const makeProvider = (overrides: Partial<LlmProvider> = {}): LlmProvider => ({
  name: "TestProvider",
  nickname: "TestProvider",
  base_url: "https://example.com/v1",
  model: "test-model",
  builtin: false,
  ...overrides,
});

const makeDataSharing = (overrides: Partial<LlmDataSharing> = {}): LlmDataSharing => ({
  total_time: true,
  top_apps: true,
  categories: true,
  focus_time: true,
  goals: true,
  interruptions: true,
  ...overrides,
});

const makeConfig = (overrides: Partial<LlmConfig> = {}): LlmConfig => ({
  active_provider_id: "p1",
  providers: {
    p1: makeProvider({ name: "Primary" }),
    p2: makeProvider({ name: "Secondary" }),
  },
  data_sharing: makeDataSharing(),
  default_range: "today",
  ...overrides,
});

beforeEach(() => {
  useLlmStore.setState({ ...initialState, config: makeConfig() }, false);
  vi.clearAllMocks();
  mockSetLlmConfig.mockResolvedValue(undefined);
  mockGetLlmConfig.mockResolvedValue(makeConfig());
});

describe("loadConfig", () => {
  it("populates config state from the backend", async () => {
    const config = makeConfig({ default_range: "last_7_days" });
    mockGetLlmConfig.mockResolvedValue(config);

    await useLlmStore.getState().loadConfig();

    const state = useLlmStore.getState();
    expect(state.config).toEqual(config);
    expect(state.loaded).toBe(true);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it("records the error message when the backend call fails", async () => {
    mockGetLlmConfig.mockRejectedValue(new Error("disk unreadable"));

    await useLlmStore.getState().loadConfig();

    const state = useLlmStore.getState();
    expect(state.error).toBe("disk unreadable");
    expect(state.loaded).toBe(true);
    expect(state.loading).toBe(false);
  });
});

describe("saveConfig", () => {
  it("writes the config through to the backend and updates state", async () => {
    const config = makeConfig({ active_provider_id: "p2" });

    await useLlmStore.getState().saveConfig(config);

    expect(mockSetLlmConfig).toHaveBeenCalledTimes(1);
    expect(mockSetLlmConfig).toHaveBeenCalledWith(config);
    const state = useLlmStore.getState();
    expect(state.config).toEqual(config);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it("keeps the previous config and reports the error when the write fails", async () => {
    const previous = useLlmStore.getState().config;
    mockSetLlmConfig.mockRejectedValue(new Error("read-only"));

    await useLlmStore.getState().saveConfig(makeConfig({ active_provider_id: "p2" }));

    const state = useLlmStore.getState();
    expect(state.config).toEqual(previous);
    expect(state.error).toBe("read-only");
    expect(state.loading).toBe(false);
  });
});

describe("addProvider", () => {
  it("generates a slug id from the nickname and persists the new provider", async () => {
    const id = await useLlmStore.getState().addProvider(makeProvider({ nickname: "My Provider" }));

    expect(id).toBe("my-provider");
    const state = useLlmStore.getState();
    expect(state.config.providers["my-provider"]).toEqual(makeProvider({ nickname: "My Provider" }));
    expect(mockSetLlmConfig).toHaveBeenCalledWith(state.config);
  });

  it("generates a unique id when the slug is already taken instead of rejecting duplicates", async () => {
    const store = useLlmStore.getState();
    const first = await store.addProvider(makeProvider({ nickname: "My Provider" }));
    const second = await store.addProvider(makeProvider({ nickname: "My Provider" }));

    expect(first).toBe("my-provider");
    expect(second).toBe("my-provider-1");
    const providers = useLlmStore.getState().config.providers;
    // Duplicate nicknames are accepted; only the id is deduplicated.
    expect(providers["my-provider"].nickname).toBe("My Provider");
    expect(providers["my-provider-1"].nickname).toBe("My Provider");
  });

  it("falls back to the provider name when the nickname is blank", async () => {
    const id = await useLlmStore.getState().addProvider(makeProvider({ name: "Named", nickname: "" }));

    expect(id).toBe("named");
  });

  it("becomes the active provider only when none is set", async () => {
    useLlmStore.setState({ config: makeConfig({ active_provider_id: null }) });

    const id = await useLlmStore.getState().addProvider(makeProvider({ nickname: "Solo" }));

    expect(useLlmStore.getState().config.active_provider_id).toBe(id);
  });

  it("does not change the active provider when one is already set", async () => {
    await useLlmStore.getState().addProvider(makeProvider({ nickname: "Extra" }));

    expect(useLlmStore.getState().config.active_provider_id).toBe("p1");
  });
});

describe("removeProvider", () => {
  it("removes the provider and clears the active id to the first remaining provider", async () => {
    await useLlmStore.getState().removeProvider("p1");

    const state = useLlmStore.getState();
    expect(state.config.providers).not.toHaveProperty("p1");
    expect(state.config.active_provider_id).toBe("p2");
    expect(mockSetLlmConfig).toHaveBeenCalledWith(state.config);
  });

  it("sets the active id to null when the removed provider was the last one", async () => {
    useLlmStore.setState({ config: makeConfig({ providers: { only: makeProvider() }, active_provider_id: "only" }) });

    await useLlmStore.getState().removeProvider("only");

    const state = useLlmStore.getState();
    expect(state.config.providers).toEqual({});
    expect(state.config.active_provider_id).toBeNull();
  });

  it("leaves the active id untouched when a non-active provider is removed", async () => {
    await useLlmStore.getState().removeProvider("p2");

    expect(useLlmStore.getState().config.active_provider_id).toBe("p1");
  });

  it("refuses to remove builtin providers", async () => {
    useLlmStore.setState({
      config: makeConfig({
        providers: {
          builtin1: makeProvider({ name: "Builtin", builtin: true }),
          p2: makeProvider({ name: "Secondary" }),
        },
        active_provider_id: "builtin1",
      }),
    });

    await useLlmStore.getState().removeProvider("builtin1");

    const state = useLlmStore.getState();
    expect(state.config.providers).toHaveProperty("builtin1");
    expect(state.config.active_provider_id).toBe("builtin1");
    expect(mockSetLlmConfig).not.toHaveBeenCalled();
  });

  it("ignores unknown provider ids", async () => {
    await useLlmStore.getState().removeProvider("missing");

    expect(mockSetLlmConfig).not.toHaveBeenCalled();
  });
});

describe("setActiveProvider", () => {
  it("persists the new active provider id", async () => {
    await useLlmStore.getState().setActiveProvider("p2");

    const state = useLlmStore.getState();
    expect(state.config.active_provider_id).toBe("p2");
    expect(mockSetLlmConfig).toHaveBeenCalledWith(state.config);
  });

  it("ignores ids that do not exist", async () => {
    await useLlmStore.getState().setActiveProvider("missing");

    expect(useLlmStore.getState().config.active_provider_id).toBe("p1");
    expect(mockSetLlmConfig).not.toHaveBeenCalled();
  });
});

describe("setDataSharing and setDefaultRange", () => {
  it("persists data sharing flags", async () => {
    const dataSharing = makeDataSharing({ goals: false, interruptions: false });

    await useLlmStore.getState().setDataSharing(dataSharing);

    const state = useLlmStore.getState();
    expect(state.config.data_sharing).toEqual(dataSharing);
    expect(mockSetLlmConfig).toHaveBeenCalledWith(state.config);
  });

  it("persists the default analysis range", async () => {
    await useLlmStore.getState().setDefaultRange("last_30_days");

    const state = useLlmStore.getState();
    expect(state.config.default_range).toBe("last_30_days");
    expect(mockSetLlmConfig).toHaveBeenCalledWith(state.config);
  });
});

describe("updateProvider", () => {
  it("merges the patch and persists the provider", async () => {
    await useLlmStore.getState().updateProvider("p1", { model: "new-model", api_key: "key" });

    const state = useLlmStore.getState();
    expect(state.config.providers.p1).toEqual(
      expect.objectContaining({ name: "Primary", model: "new-model", api_key: "key" })
    );
    expect(mockSetLlmConfig).toHaveBeenCalledWith(state.config);
  });

  it("ignores unknown provider ids", async () => {
    await useLlmStore.getState().updateProvider("missing", { model: "new-model" });

    expect(mockSetLlmConfig).not.toHaveBeenCalled();
  });
});

describe("initLlmConfigWatcher", () => {
  it("loads the config, subscribes to llm-config-changed, and reloads on the event", async () => {
    vi.resetModules();
    const fresh = await import("./llmStore");
    const unlistenFn = vi.fn();
    mockListen.mockResolvedValue(unlistenFn);
    const config = makeConfig({ default_range: "last_week" });
    mockGetLlmConfig.mockResolvedValue(config);

    const unlisten = await fresh.initLlmConfigWatcher();

    expect(mockListen).toHaveBeenCalledTimes(1);
    expect(mockListen).toHaveBeenCalledWith("llm-config-changed", expect.any(Function));
    expect(mockGetLlmConfig).toHaveBeenCalledTimes(1);
    expect(fresh.useLlmStore.getState().config).toEqual(config);
    expect(unlisten).toBe(unlistenFn);

    const onEvent = mockListen.mock.calls[0][1] as () => void;
    onEvent();
    expect(mockGetLlmConfig).toHaveBeenCalledTimes(2);
  });

  it("returns the cached unlisten on repeated init without subscribing again", async () => {
    vi.resetModules();
    const fresh = await import("./llmStore");
    mockListen.mockResolvedValue(vi.fn());

    const first = await fresh.initLlmConfigWatcher();
    const second = await fresh.initLlmConfigWatcher();

    expect(second).toBe(first);
    expect(mockListen).toHaveBeenCalledTimes(1);
    expect(mockGetLlmConfig).toHaveBeenCalledTimes(1);
  });
});
