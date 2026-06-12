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
  method: string;
  path: string;
  body?: unknown;
  scopes?: string[];
}

export interface WidgetChannel {
  getTodayAppTotals(): Promise<AppUsageSummary[]>;
  getAppTotalsInRange(start: string, end: string): Promise<AppUsageSummary[]>;
  onActiveWindowChanged(cb: (info: ActiveWindowInfo) => void): Promise<() => void>;
  localApiCall(options: LocalApiCallOptions): Promise<unknown>;
}

export interface WidgetContext {
  widgetId: string;
  widgetType: string;
  channel: WidgetChannel;
}

export interface WidgetInstance {
  mount(container: HTMLElement, context: WidgetContext): Promise<void>;
  unmount(): Promise<void>;
}

export function createWidget(): WidgetInstance {
  let rootEl: HTMLElement | null = null;
  let stopListening: (() => void) | null = null;

  return {
    async mount(container, context) {
      rootEl = document.createElement("div");
      rootEl.style.height = "100%";
      rootEl.style.padding = "14px";
      rootEl.style.display = "flex";
      rootEl.style.flexDirection = "column";
      rootEl.style.gap = "10px";
      rootEl.style.color = "#E5EAF6";
      rootEl.style.fontFamily = "Segoe UI, sans-serif";
      rootEl.style.background = "linear-gradient(145deg, rgba(25,33,52,0.88), rgba(14,18,30,0.9))";

      const title = document.createElement("div");
      title.textContent = "Sample Hello Widget";
      title.style.fontWeight = "700";
      title.style.fontSize = "14px";

      const usage = document.createElement("div");
      usage.style.fontSize = "12px";
      usage.textContent = "Loading today's usage...";

      const apiStatus = document.createElement("div");
      apiStatus.style.fontSize = "11px";
      apiStatus.style.opacity = "0.7";
      apiStatus.textContent = "localApiCall not started";

      rootEl.appendChild(title);
      rootEl.appendChild(usage);
      rootEl.appendChild(apiStatus);
      container.appendChild(rootEl);

      try {
        const rows = await context.channel.getTodayAppTotals();
        const total = rows.reduce((acc, row) => acc + row.total_seconds, 0);
        const hours = (total / 3600).toFixed(1);
        usage.textContent = `Today tracked: ${hours} h`;
      } catch (err) {
        usage.textContent = `Failed to load usage: ${String(err)}`;
      }

      try {
        stopListening = await context.channel.onActiveWindowChanged((info) => {
          title.textContent = `Sample Hello Widget · ${info.app_name || "Unknown"}`;
        });
      } catch {
        title.textContent = "Sample Hello Widget · active window unavailable";
      }

      try {
        const result = await context.channel.localApiCall({
          method: "GET",
          path: "/api/screen-time/today",
          scopes: ["screen-time:read"],
        });
        const data = Array.isArray(result) ? result : [];
        const total = data.reduce((acc, row) => acc + (row.total_seconds || 0), 0);
        apiStatus.textContent = `localApiCall OK · ${data.length} apps · ${(total / 3600).toFixed(1)} h`;
      } catch (err) {
        apiStatus.textContent = `localApiCall: ${String(err)}`;
      }
    },

    async unmount() {
      if (typeof stopListening === "function") {
        stopListening();
      }
      stopListening = null;
      if (rootEl) {
        rootEl.remove();
      }
      rootEl = null;
    }
  };
}
