import { describe, it, expect, vi, beforeEach } from "vitest";
import { WidgetClient, WidgetGatewayError, buildLegacyChannel } from "../index";
import type { WidgetGatewayResponse } from "@/types";

const mockGatewayRequest = vi.fn();
const mockListenWidgetEvent = vi.fn();
const mockRecordWidgetPermissionAccess = vi.fn();

vi.mock("@/services/tauriApi", () => ({
  widgetGatewayRequest: (...args: unknown[]) => mockGatewayRequest(...args),
  listenWidgetEvent: (...args: unknown[]) => mockListenWidgetEvent(...args),
  recordWidgetPermissionAccess: (...args: unknown[]) =>
    mockRecordWidgetPermissionAccess(...args),
  getTodayAppTotals: vi.fn(),
  getAppTotalsInRange: vi.fn(),
  getCategoryTotalsInRange: vi.fn(),
  getHourlyDistributionForDate: vi.fn(),
  getRecentDailyTotalsRange: vi.fn(),
  getAppCategoryMap: vi.fn(),
  onActiveWindowChanged: vi.fn(),
  getTodos: vi.fn(),
  addTodo: vi.fn(),
  toggleTodo: vi.fn(),
  deleteTodo: vi.fn(),
  setFocusModeActive: vi.fn(),
  setMonitoringActive: vi.fn(),
  issueWidgetApiToken: vi.fn(),
  getLocalApiBaseUrl: vi.fn(),
  getUsageGoals: vi.fn(),
  listFocusSessions: vi.fn(),
}));

function successResponse(payload: unknown): WidgetGatewayResponse {
  return {
    request_id: "r1",
    status: "success",
    payload,
  };
}

function deniedResponse(code: string, message: string): WidgetGatewayResponse {
  return {
    request_id: "r1",
    status: "denied",
    error: { code, message, recoverable: true },
  };
}

describe("WidgetClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGatewayRequest.mockReset();
    mockListenWidgetEvent.mockReset();
  });

  it("query returns payload on success", async () => {
    mockGatewayRequest.mockResolvedValue(successResponse({ total: 42 }));
    const client = new WidgetClient({ widgetId: "w1", widgetType: "test" });

    const result = await client.query("metrics");
    expect(result).toEqual({ total: 42 });
    expect(mockGatewayRequest).toHaveBeenCalledTimes(1);
    const request = mockGatewayRequest.mock.calls[0][0];
    expect(request.widget_id).toBe("w1");
    expect(request.request_type).toBe("query");
    expect(request.scope).toBe("metrics");
  });

  it("query throws WidgetGatewayError on denied", async () => {
    mockGatewayRequest.mockResolvedValue(
      deniedResponse("permission_denied", "missing permission"),
    );
    const client = new WidgetClient({ widgetId: "w1", widgetType: "test" });

    await expect(client.query("metrics")).rejects.toBeInstanceOf(WidgetGatewayError);
  });

  it("getState returns string value", async () => {
    mockGatewayRequest.mockResolvedValue(successResponse("hello"));
    const client = new WidgetClient({ widgetId: "w1", widgetType: "test" });

    const value = await client.getState("key");
    expect(value).toBe("hello");
    const request = mockGatewayRequest.mock.calls[0][0];
    expect(request.request_type).toBe("state_read");
    expect(request.scope).toBe("state");
    expect(request.payload).toEqual({ key: "key" });
  });

  it("setState sends state_write request", async () => {
    mockGatewayRequest.mockResolvedValue(successResponse(null));
    const client = new WidgetClient({ widgetId: "w1", widgetType: "test" });

    await client.setState("key", "value");
    const request = mockGatewayRequest.mock.calls[0][0];
    expect(request.request_type).toBe("state_write");
    expect(request.payload).toEqual({ key: "key", value: "value" });
  });

  it("deleteState sends state_delete request", async () => {
    mockGatewayRequest.mockResolvedValue(successResponse(null));
    const client = new WidgetClient({ widgetId: "w1", widgetType: "test" });

    await client.deleteState("key");
    const request = mockGatewayRequest.mock.calls[0][0];
    expect(request.request_type).toBe("state_delete");
    expect(request.payload).toEqual({ key: "key" });
  });

  it("subscribe registers listener and returns handle", async () => {
    const unlisten = vi.fn();
    mockGatewayRequest.mockResolvedValue(successResponse(null));
    mockListenWidgetEvent.mockResolvedValue(unlisten);
    const client = new WidgetClient({ widgetId: "w1", widgetType: "test" });

    const cb = vi.fn();
    const handle = await client.subscribe("focus-started", cb);
    expect(handle).toBe(0);
    expect(mockListenWidgetEvent).toHaveBeenCalledWith("focus-started", cb);

    client.dispose();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe removes listener", async () => {
    const unlisten = vi.fn();
    mockGatewayRequest.mockResolvedValue(successResponse(null));
    mockListenWidgetEvent.mockResolvedValue(unlisten);
    const client = new WidgetClient({ widgetId: "w1", widgetType: "test" });

    const handle = await client.subscribe("focus-started", vi.fn());
    await client.unsubscribe(handle);
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("addTodo sends todo_write add request", async () => {
    mockGatewayRequest.mockResolvedValue(successResponse({ id: 1, content: "task", done: false }));
    const client = new WidgetClient({ widgetId: "w1", widgetType: "test" });

    const item = await client.addTodo("task");
    expect(item).toEqual({ id: 1, content: "task", done: false });
    const request = mockGatewayRequest.mock.calls[0][0];
    expect(request.request_type).toBe("todo_write");
    expect(request.scope).toBe("todo:write");
    expect(request.payload).toEqual({ action: "add", content: "task" });
  });

  it("toggleTodo sends todo_write toggle request", async () => {
    mockGatewayRequest.mockResolvedValue(successResponse(null));
    const client = new WidgetClient({ widgetId: "w1", widgetType: "test" });

    await client.toggleTodo(7);
    const request = mockGatewayRequest.mock.calls[0][0];
    expect(request.request_type).toBe("todo_write");
    expect(request.payload).toEqual({ action: "toggle", id: 7 });
  });

  it("deleteTodo sends todo_write delete request", async () => {
    mockGatewayRequest.mockResolvedValue(successResponse(null));
    const client = new WidgetClient({ widgetId: "w1", widgetType: "test" });

    await client.deleteTodo(7);
    const request = mockGatewayRequest.mock.calls[0][0];
    expect(request.request_type).toBe("todo_write");
    expect(request.payload).toEqual({ action: "delete", id: 7 });
  });

  it("reorderTodos sends todo_write reorder request", async () => {
    mockGatewayRequest.mockResolvedValue(successResponse(null));
    const client = new WidgetClient({ widgetId: "w1", widgetType: "test" });

    await client.reorderTodos([3, 1, 2]);
    const request = mockGatewayRequest.mock.calls[0][0];
    expect(request.request_type).toBe("todo_write");
    expect(request.payload).toEqual({ action: "reorder", ids: [3, 1, 2] });
  });

  it("getBrowserActivity sends browser query request", async () => {
    mockGatewayRequest.mockResolvedValue(successResponse({
      domains: [{ host: "example.com", total_seconds: 60, visit_count: 2 }],
      status: { connected: true },
    }));
    const client = new WidgetClient({ widgetId: "w1", widgetType: "test" });

    const result = await client.getBrowserActivity("2024-01-01", "2024-01-01");
    expect(result.domains).toHaveLength(1);
    expect(result.status.connected).toBe(true);
    const request = mockGatewayRequest.mock.calls[0][0];
    expect(request.request_type).toBe("query");
    expect(request.scope).toBe("browser");
    expect(request.payload).toEqual({ start: "2024-01-01", end: "2024-01-01" });
  });

  it("calls onConsentRequired and retries when consent is granted", async () => {
    mockGatewayRequest
      .mockResolvedValueOnce(deniedResponse("permission_denied", "please grant"))
      .mockResolvedValueOnce(successResponse({ total: 7 }));

    const onConsentRequired = vi.fn().mockResolvedValue(true);
    const client = new WidgetClient({
      widgetId: "w1",
      widgetType: "test",
      onConsentRequired,
    });

    const result = await client.query("metrics");
    expect(result).toEqual({ total: 7 });
    expect(onConsentRequired).toHaveBeenCalledWith("metrics", "low", "please grant");
    expect(mockGatewayRequest).toHaveBeenCalledTimes(2);
  });

  it("does not retry when user denies consent", async () => {
    mockGatewayRequest.mockResolvedValue(
      deniedResponse("permission_denied", "please grant"),
    );

    const onConsentRequired = vi.fn().mockResolvedValue(false);
    const client = new WidgetClient({
      widgetId: "w1",
      widgetType: "test",
      onConsentRequired,
    });

    await expect(client.query("metrics")).rejects.toBeInstanceOf(WidgetGatewayError);
    expect(mockGatewayRequest).toHaveBeenCalledTimes(1);
  });
});

describe("buildLegacyChannel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGatewayRequest.mockReset();
    mockListenWidgetEvent.mockReset();
  });

  it("query delegates to client.query", async () => {
    mockGatewayRequest.mockResolvedValue(successResponse([{ app: "code" }]));
    const client = new WidgetClient({ widgetId: "w1", widgetType: "test" });
    const channel = buildLegacyChannel(client);

    const result = await channel.query("metrics", { start: "2024-01-01" });
    expect(result).toEqual([{ app: "code" }]);
    expect(mockGatewayRequest).toHaveBeenCalledTimes(1);
  });

  it("state methods delegate to client", async () => {
    mockGatewayRequest
      .mockResolvedValueOnce(successResponse(null))
      .mockResolvedValueOnce(successResponse(null))
      .mockResolvedValueOnce(successResponse("stored"));
    const client = new WidgetClient({ widgetId: "w1", widgetType: "test" });
    const channel = buildLegacyChannel(client);

    await channel.setState("k", "v");
    await channel.deleteState("k");
    const value = await channel.getState("k");
    expect(value).toBe("stored");
  });
});
