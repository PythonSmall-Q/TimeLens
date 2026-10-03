import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WidgetConfig } from "@/types";
import { useWidgetStore } from "./widgetStore";

const mockGetAllWidgets = vi.fn();
const mockCreateWidgetApi = vi.fn();
const mockSaveWidgetConfig = vi.fn();
const mockOpenWidgetApi = vi.fn();
const mockCloseWidgetApi = vi.fn();
const mockRemoveWidgetConfig = vi.fn();

vi.mock("@/services/tauriApi", () => ({
  getAllWidgets: (...args: unknown[]) => mockGetAllWidgets(...args),
  createWidget: (...args: unknown[]) => mockCreateWidgetApi(...args),
  saveWidgetConfig: (...args: unknown[]) => mockSaveWidgetConfig(...args),
  openWidget: (...args: unknown[]) => mockOpenWidgetApi(...args),
  closeWidget: (...args: unknown[]) => mockCloseWidgetApi(...args),
  removeWidgetConfig: (...args: unknown[]) => mockRemoveWidgetConfig(...args),
}));

const makeWidget = (overrides: Partial<WidgetConfig> = {}): WidgetConfig => ({
  id: "clock-1",
  widget_type: "clock",
  monitor_index: 0,
  x: 10,
  y: 20,
  width: 320,
  height: 220,
  opacity: 0.8,
  always_on_top_mode: "focus",
  pinned: false,
  start_on_launch: true,
  ...overrides,
});

const initialState = useWidgetStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  useWidgetStore.setState(initialState, false);
});

describe("widgetStore fetchWidgets", () => {
  it("populates widgets from the backend and clears loading", async () => {
    const widgets = [makeWidget(), makeWidget({ id: "note-1", widget_type: "note" })];
    mockGetAllWidgets.mockResolvedValue(widgets);

    await useWidgetStore.getState().fetchWidgets();

    expect(mockGetAllWidgets).toHaveBeenCalledTimes(1);
    const state = useWidgetStore.getState();
    expect(state.widgets).toEqual(widgets);
    expect(state.loading).toBe(false);
  });

  it("keeps widgets empty and still clears loading when the backend call fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetAllWidgets.mockRejectedValue(new Error("db locked"));

    await useWidgetStore.getState().fetchWidgets();

    expect(errorSpy).toHaveBeenCalledWith("fetchWidgets failed", expect.any(Error));
    const state = useWidgetStore.getState();
    expect(state.widgets).toEqual([]);
    expect(state.loading).toBe(false);
  });
});

describe("widgetStore createWidget", () => {
  it("creates, saves, and appends the new widget", async () => {
    const config = makeWidget({ id: "todo-1", widget_type: "todo" });
    mockCreateWidgetApi.mockResolvedValue(config);
    mockSaveWidgetConfig.mockResolvedValue(undefined);

    await useWidgetStore.getState().createWidget("todo");

    expect(mockCreateWidgetApi).toHaveBeenCalledWith("todo");
    expect(mockSaveWidgetConfig).toHaveBeenCalledWith(config);
    expect(useWidgetStore.getState().widgets).toEqual([config]);
  });

  it("does not save or mutate state when creation fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockCreateWidgetApi.mockRejectedValue(new Error("unknown type"));

    await useWidgetStore.getState().createWidget("nope");

    expect(errorSpy).toHaveBeenCalledWith("createWidget failed", expect.any(Error));
    expect(mockSaveWidgetConfig).not.toHaveBeenCalled();
    expect(useWidgetStore.getState().widgets).toEqual([]);
  });
});

describe("widgetStore window lifecycle actions", () => {
  it("openWidget forwards the config to the backend", async () => {
    const config = makeWidget();
    mockOpenWidgetApi.mockResolvedValue(undefined);

    await useWidgetStore.getState().openWidget(config);

    expect(mockOpenWidgetApi).toHaveBeenCalledWith(config);
  });

  it("closeWidget forwards the widget id to the backend", async () => {
    mockCloseWidgetApi.mockResolvedValue(undefined);

    await useWidgetStore.getState().closeWidget("clock-1");

    expect(mockCloseWidgetApi).toHaveBeenCalledWith("clock-1");
  });

  it("removeWidget closes and removes the config, then drops it from state", async () => {
    const keep = makeWidget({ id: "note-1", widget_type: "note" });
    useWidgetStore.setState({ widgets: [makeWidget(), keep] });
    mockCloseWidgetApi.mockResolvedValue(undefined);
    mockRemoveWidgetConfig.mockResolvedValue(undefined);

    await useWidgetStore.getState().removeWidget("clock-1");

    expect(mockCloseWidgetApi).toHaveBeenCalledWith("clock-1");
    expect(mockRemoveWidgetConfig).toHaveBeenCalledWith("clock-1");
    expect(useWidgetStore.getState().widgets).toEqual([keep]);
  });
});

describe("widgetStore updateWidgetConfig", () => {
  it("persists the config and replaces the widget with the same id", async () => {
    const other = makeWidget({ id: "note-1", widget_type: "note" });
    useWidgetStore.setState({ widgets: [makeWidget(), other] });
    mockSaveWidgetConfig.mockResolvedValue(undefined);
    const updated = makeWidget({ paused: true });

    await useWidgetStore.getState().updateWidgetConfig(updated);

    expect(mockSaveWidgetConfig).toHaveBeenCalledWith(updated);
    expect(useWidgetStore.getState().widgets).toEqual([updated, other]);
  });

  it("resumes a paused widget through the same update path", async () => {
    const paused = makeWidget({ paused: true });
    useWidgetStore.setState({ widgets: [paused] });
    mockSaveWidgetConfig.mockResolvedValue(undefined);
    const resumed = makeWidget({ paused: false });

    await useWidgetStore.getState().updateWidgetConfig(resumed);

    expect(mockSaveWidgetConfig).toHaveBeenCalledWith(resumed);
    expect(useWidgetStore.getState().widgets).toEqual([resumed]);
  });

  it("leaves state untouched when saving fails", async () => {
    const config = makeWidget();
    useWidgetStore.setState({ widgets: [config] });
    mockSaveWidgetConfig.mockRejectedValue(new Error("disk full"));

    await expect(useWidgetStore.getState().updateWidgetConfig(config)).rejects.toThrow("disk full");

    expect(useWidgetStore.getState().widgets).toEqual([config]);
  });
});
