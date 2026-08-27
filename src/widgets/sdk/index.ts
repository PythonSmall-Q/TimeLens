import { type UnlistenFn } from "@tauri-apps/api/event";
import * as api from "@/services/tauriApi";
import type {
  BrowserDomainStats,
  BrowserExtensionStatus,
  TodoItem,
  WidgetGatewayRequest,
  WidgetGatewayRequestType,
  WidgetGatewayResponse,
  WidgetQueryNamespace,
} from "@/types";

export interface WidgetClientOptions {
  widgetId: string;
  widgetType: string;
  /**
   * Called when the gateway returns a consent_required error.
   * Return true to grant consent (the SDK will retry the request once),
   * false to leave it denied.
   */
  onConsentRequired?: (
    scope: string,
    riskLevel: "low" | "medium" | "high",
    message: string,
  ) => Promise<boolean>;
}

export interface LegacyChannel {
  getTodayAppTotals: () => Promise<unknown>;
  getAppTotalsInRange: (start: string, end: string) => Promise<unknown>;
  getCategoryTotalsInRange: (start: string, end: string) => Promise<unknown>;
  getHourlyForDate: (date: string) => Promise<unknown>;
  getRecentDailyTotalsRange: (start: string, end: string) => Promise<unknown>;
  getAppCategoryMap: () => Promise<unknown>;
  onActiveWindowChanged: (cb: (info: unknown) => void) => Promise<unknown>;
  getTodos: () => Promise<unknown>;
  addTodo: (content: string) => Promise<unknown>;
  toggleTodo: (id: number) => Promise<unknown>;
  deleteTodo: (id: number) => Promise<unknown>;
  setFocusModeActive: (active: boolean) => Promise<unknown>;
  setMonitoringActive: (active: boolean) => Promise<unknown>;
  localApiCall: (options: {
    method?: string;
    path: string;
    body?: unknown;
    scopes?: string[];
  }) => Promise<unknown>;
  query: <T = unknown>(namespace: WidgetQueryNamespace, payload?: Record<string, unknown>) => Promise<T>;
  subscribe: (event: string, cb: (payload: unknown) => void) => Promise<number>;
  unsubscribe: (handle: number) => Promise<void>;
  getState: (key: string) => Promise<string | null>;
  setState: (key: string, value: string) => Promise<void>;
  deleteState: (key: string) => Promise<void>;
  getUsageGoals: () => Promise<unknown>;
  listFocusSessions: () => Promise<unknown>;
}

export class WidgetClient {
  readonly widgetId: string;
  readonly widgetType: string;

  private options: WidgetClientOptions;
  private subscriptions: Array<{ event: string; callback: (payload: unknown) => void; unlisten?: UnlistenFn }> = [];

  constructor(options: WidgetClientOptions) {
    this.options = options;
    this.widgetId = options.widgetId;
    this.widgetType = options.widgetType;
  }

  private makeRequest(
    requestType: WidgetGatewayRequestType,
    scope: string,
    payload?: unknown,
    resourceHint?: string,
  ): WidgetGatewayRequest {
    return {
      widget_id: this.widgetId,
      request_id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      scope,
      request_type: requestType,
      payload: payload === undefined ? undefined : (payload as Record<string, unknown>),
      resource_hint: resourceHint,
      occurred_at: new Date().toISOString(),
    };
  }

  private consentRetrying = false;

  async gatewayRequest(request: WidgetGatewayRequest): Promise<WidgetGatewayResponse> {
    const response = await api.widgetGatewayRequest(request);

    if (
      response.status === "denied" &&
      (response.error?.code === "consent_required" || response.error?.code === "permission_denied") &&
      this.options.onConsentRequired &&
      !this.consentRetrying
    ) {
      this.consentRetrying = true;
      try {
        const granted = await this.options.onConsentRequired(
          request.scope,
          "low",
          response.error.message,
        );
        if (granted) {
          return api.widgetGatewayRequest(request);
        }
      } finally {
        this.consentRetrying = false;
      }
    }

    return response;
  }

  async query<T = unknown>(
    namespace: WidgetQueryNamespace,
    payload?: Record<string, unknown>,
  ): Promise<T> {
    const response = await this.gatewayRequest(
      this.makeRequest("query", namespace, payload),
    );
    if (response.status === "success") {
      return (response.payload ?? null) as T;
    }
    throw new WidgetGatewayError(response.error ?? { code: "unknown", message: "query failed" });
  }

  async getState(key: string): Promise<string | null> {
    const response = await this.gatewayRequest(
      this.makeRequest("state_read", "state", { key }),
    );
    if (response.status === "success") {
      return (response.payload as string | null) ?? null;
    }
    throw new WidgetGatewayError(response.error ?? { code: "unknown", message: "getState failed" });
  }

  async setState(key: string, value: string): Promise<void> {
    const response = await this.gatewayRequest(
      this.makeRequest("state_write", "state", { key, value }),
    );
    if (response.status !== "success") {
      throw new WidgetGatewayError(response.error ?? { code: "unknown", message: "setState failed" });
    }
  }

  async deleteState(key: string): Promise<void> {
    const response = await this.gatewayRequest(
      this.makeRequest("state_delete", "state", { key }),
    );
    if (response.status !== "success") {
      throw new WidgetGatewayError(response.error ?? { code: "unknown", message: "deleteState failed" });
    }
  }

  async addTodo(content: string): Promise<TodoItem> {
    const response = await this.gatewayRequest(
      this.makeRequest("todo_write", "todo:write", { action: "add", content }),
    );
    if (response.status === "success") {
      return response.payload as TodoItem;
    }
    throw new WidgetGatewayError(response.error ?? { code: "unknown", message: "addTodo failed" });
  }

  async toggleTodo(id: number): Promise<void> {
    const response = await this.gatewayRequest(
      this.makeRequest("todo_write", "todo:write", { action: "toggle", id }),
    );
    if (response.status !== "success") {
      throw new WidgetGatewayError(response.error ?? { code: "unknown", message: "toggleTodo failed" });
    }
  }

  async deleteTodo(id: number): Promise<void> {
    const response = await this.gatewayRequest(
      this.makeRequest("todo_write", "todo:write", { action: "delete", id }),
    );
    if (response.status !== "success") {
      throw new WidgetGatewayError(response.error ?? { code: "unknown", message: "deleteTodo failed" });
    }
  }

  async reorderTodos(ids: number[]): Promise<void> {
    const response = await this.gatewayRequest(
      this.makeRequest("todo_write", "todo:write", { action: "reorder", ids }),
    );
    if (response.status !== "success") {
      throw new WidgetGatewayError(response.error ?? { code: "unknown", message: "reorderTodos failed" });
    }
  }

  async getBrowserActivity(start?: string, end?: string): Promise<{
    domains: BrowserDomainStats[];
    status: BrowserExtensionStatus;
  }> {
    const response = await this.gatewayRequest(
      this.makeRequest("query", "browser", { start, end }),
    );
    if (response.status === "success") {
      return response.payload as { domains: BrowserDomainStats[]; status: BrowserExtensionStatus };
    }
    throw new WidgetGatewayError(response.error ?? { code: "unknown", message: "getBrowserActivity failed" });
  }

  async subscribe(event: string, callback: (payload: unknown) => void): Promise<number> {
    const response = await this.gatewayRequest(
      this.makeRequest("subscribe", "subscribe", [event]),
    );
    if (response.status !== "success") {
      throw new WidgetGatewayError(response.error ?? { code: "unknown", message: "subscribe failed" });
    }
    const unlisten = await api.listenWidgetEvent<unknown>(event, callback);
    const index = this.subscriptions.length;
    this.subscriptions.push({ event, callback, unlisten });
    return index;
  }

  async unsubscribe(handle: number): Promise<void> {
    const record = this.subscriptions[handle];
    if (record) {
      await record.unlisten?.();
      this.subscriptions[handle] = { event: "", callback: () => {}, unlisten: undefined };
    }
  }

  async fetch(url: string, _options?: RequestInit): Promise<Response> {
    const response = await this.gatewayRequest(
      this.makeRequest("network_fetch", "network_fetch", undefined, url),
    );
    if (response.status !== "success") {
      throw new WidgetGatewayError(response.error ?? { code: "unknown", message: "fetch failed" });
    }
    // Phase D: gateway will return a proxied response body.
    throw new Error("gateway-mediated fetch is not yet implemented");
  }

  async loadMedia(url: string): Promise<unknown> {
    const response = await this.gatewayRequest(
      this.makeRequest("media_load", "media_load", undefined, url),
    );
    if (response.status !== "success") {
      throw new WidgetGatewayError(response.error ?? { code: "unknown", message: "media load failed" });
    }
    // Phase D: gateway will return a safe media reference.
    throw new Error("gateway-mediated media load is not yet implemented");
  }

  async requestConsent(scope: string, riskLevel: "low" | "medium" | "high" = "low"): Promise<void> {
    await api.widgetGrantConsent(this.widgetId, scope, false, riskLevel);
  }

  dispose(): void {
    this.subscriptions.forEach((s) => s.unlisten?.());
    this.subscriptions = [];
  }
}

export class WidgetGatewayError extends Error {
  code: string;
  scope?: string;
  recoverable?: boolean;

  constructor(error: { code: string; message: string; scope?: string; recoverable?: boolean }) {
    super(error.message);
    this.name = "WidgetGatewayError";
    this.code = error.code;
    this.scope = error.scope;
    this.recoverable = error.recoverable;
  }

  isConsentRequired(): boolean {
    return this.code === "permission_denied" || this.code === "consent_required";
  }
}

/**
 * Build a backward-compatible channel object for legacy third-party widgets.
 * New widgets should use WidgetClient directly.
 */
export function buildLegacyChannel(client: WidgetClient): LegacyChannel {
  const withPermissionAccess =
    (permission: string, fn: (...args: unknown[]) => Promise<unknown>) =>
    (...args: unknown[]) => {
      void api.recordWidgetPermissionAccess(client.widgetId, permission).catch(() => {});
      return fn(...args);
    };

  return {
    getTodayAppTotals: withPermissionAccess("screen-time:read", () =>
      api.getTodayAppTotals() as Promise<unknown>,
    ),
    getAppTotalsInRange: withPermissionAccess("screen-time:read", (start, end) =>
      api.getAppTotalsInRange(start as string, end as string) as Promise<unknown>,
    ),
    getCategoryTotalsInRange: withPermissionAccess("screen-time:read", (start, end) =>
      api.getCategoryTotalsInRange(start as string, end as string) as Promise<unknown>,
    ),
    getHourlyForDate: withPermissionAccess("screen-time:read", (date) =>
      api.getHourlyDistributionForDate(date as string) as Promise<unknown>,
    ),
    getRecentDailyTotalsRange: withPermissionAccess("screen-time:read", (start, end) =>
      api.getRecentDailyTotalsRange(start as string, end as string) as Promise<unknown>,
    ),
    getAppCategoryMap: withPermissionAccess("screen-time:read", () =>
      api.getAppCategoryMap() as Promise<unknown>,
    ),
    onActiveWindowChanged: withPermissionAccess("active-window:subscribe", (cb) =>
      api.onActiveWindowChanged(cb as Parameters<typeof api.onActiveWindowChanged>[0]) as Promise<unknown>,
    ),
    getTodos: withPermissionAccess("todo:read", () => api.getTodos() as Promise<unknown>),
    addTodo: withPermissionAccess("todo:write", (content) =>
      api.addTodo(content as string) as Promise<unknown>,
    ),
    toggleTodo: withPermissionAccess("todo:write", (id) =>
      api.toggleTodo(id as number) as Promise<unknown>,
    ),
    deleteTodo: withPermissionAccess("todo:write", (id) =>
      api.deleteTodo(id as number) as Promise<unknown>,
    ),
    setFocusModeActive: withPermissionAccess("settings:write", (active) =>
      api.setFocusModeActive(Boolean(active)) as Promise<unknown>,
    ),
    setMonitoringActive: withPermissionAccess("settings:write", (active) =>
      api.setMonitoringActive(Boolean(active)) as Promise<unknown>,
    ),
    localApiCall: withPermissionAccess("local-api:call", async (options) => {
      const {
        method = "GET",
        path,
        body,
        scopes = [],
      } = options as {
        method?: string;
        path: string;
        body?: unknown;
        scopes?: string[];
      };
      if (!path || typeof path !== "string") {
        throw new Error("localApiCall requires a path string");
      }
      const token = await api.issueWidgetApiToken(client.widgetId, scopes);
      const baseUrl = await api.getLocalApiBaseUrl();
      const resp = await fetch(`${baseUrl}${path}`, {
        method: method.toUpperCase(),
        headers: {
          "Content-Type": "application/json",
          "X-Client-Id": `widget-${client.widgetId}`,
          "X-Api-Token": token.token,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (!resp.ok) {
        throw new Error(`local API call failed: ${resp.status}`);
      }
      if (resp.status === 204) {
        return undefined;
      }
      return (await resp.json()) as unknown;
    }),
    query: (namespace, payload) => client.query(namespace, payload),
    subscribe: (event, cb) => client.subscribe(event, cb),
    unsubscribe: (handle) => client.unsubscribe(handle),
    getState: (key) => client.getState(key),
    setState: (key, value) => client.setState(key, value),
    deleteState: (key) => client.deleteState(key),
    getUsageGoals: () => api.getUsageGoals() as Promise<unknown>,
    listFocusSessions: () => api.listFocusSessions() as Promise<unknown>,
  };
}
