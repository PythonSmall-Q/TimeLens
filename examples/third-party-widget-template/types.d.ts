/**
 * TypeScript declarations for the TimeLens Widget SDK v2.
 *
 * These types describe the context object passed to a third-party widget's
 * `mount()` function. You can use them directly in TypeScript widgets or as
 * JSDoc reference for plain JavaScript widgets.
 */

export interface AppUsageSummary {
  app_name: string;
  exe_path: string;
  total_seconds: number;
}

export interface ActiveWindowInfo {
  app_name: string;
  exe_path: string;
  window_title: string;
  timestamp: string;
}

export interface LocalApiCallOptions {
  /** HTTP method, e.g. "GET" or "POST". Defaults to "GET". */
  method?: string;
  /** API path, e.g. "/api/screen-time/today". */
  path: string;
  /** JSON-serializable request body for POST/PUT requests. */
  body?: unknown;
  /** Required token scopes, e.g. ["screen-time:read"]. */
  scopes?: string[];
}

export interface WidgetChannel {
  /** Read today's per-app screen time totals. Requires screen-time:read. */
  getTodayAppTotals(): Promise<AppUsageSummary[]>;
  /** Read per-app totals for a date range. Requires screen-time:read. */
  getAppTotalsInRange(start: string, end: string): Promise<AppUsageSummary[]>;
  /** Read category totals for a date range. Requires screen-time:read. */
  getCategoryTotalsInRange(
    start: string,
    end: string
  ): Promise<{ category: string; total_seconds: number }[]>;
  /** Read hourly distribution for a date. Requires screen-time:read. */
  getHourlyForDate(date: string): Promise<{ hour: number; seconds: number }[]>;
  /** Read daily totals for a date range. Requires screen-time:read. */
  getRecentDailyTotalsRange(
    start: string,
    end: string
  ): Promise<{ date: string; total_seconds: number }[]>;
  /** Read the app-name / category mapping. Requires screen-time:read. */
  getAppCategoryMap(): Promise<Record<string, string>>;
  /** Subscribe to active window changes. Requires active-window:subscribe. */
  onActiveWindowChanged(
    callback: (info: ActiveWindowInfo) => void
  ): Promise<() => void>;
  /** Read todos. Requires todo:read. */
  getTodos(): Promise<
    {
      id: number;
      content: string;
      done: boolean;
      created_at: string;
      order_index: number;
    }[]
  >;
  /** Add a todo. Requires todo:write. */
  addTodo(content: string): Promise<{
    id: number;
    content: string;
    done: boolean;
    created_at: string;
    order_index: number;
  }>;
  /** Toggle a todo. Requires todo:write. */
  toggleTodo(id: number): Promise<void>;
  /** Delete a todo. Requires todo:write. */
  deleteTodo(id: number): Promise<void>;
  /** Enable or disable focus mode. Requires settings:write. */
  setFocusModeActive(active: boolean): Promise<void>;
  /** Enable or disable monitoring. Requires settings:write. */
  setMonitoringActive(active: boolean): Promise<void>;
  /** Read usage goals (always available). */
  getUsageGoals(): Promise<unknown[]>;
  /** List focus sessions (always available). */
  listFocusSessions(): Promise<unknown[]>;
  /** Call the TimeLens local HTTP API. Requires local-api:call. */
  localApiCall(options: LocalApiCallOptions): Promise<unknown>;
}

export interface WidgetContext {
  widgetId: string;
  widgetType: string;
  channel: WidgetChannel;
}

export interface WidgetInstance {
  mount(container: HTMLElement, context: WidgetContext): Promise<void>;
  unmount?(): Promise<void>;
}

export function createWidget(): WidgetInstance;
