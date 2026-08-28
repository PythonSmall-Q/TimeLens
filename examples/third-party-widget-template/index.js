/**
 * @typedef {Object} AppUsageSummary
 * @property {string} app_name
 * @property {string} exe_path
 * @property {number} total_seconds
 */

/**
 * @typedef {Object} ActiveWindowInfo
 * @property {string} app_name
 * @property {string} exe_path
 * @property {string} window_title
 * @property {string} timestamp
 */

/**
 * @typedef {Object} LocalApiCallOptions
 * @property {string} method - HTTP method, e.g. "GET" or "POST"
 * @property {string} path - API path, e.g. "/api/screen-time/today"
 * @property {unknown} [body] - JSON-serializable request body
 * @property {string[]} [scopes] - Required token scopes, e.g. ["screen-time:read"]
 */

/**
 * @typedef {Object} WidgetChannel
 * @property {() => Promise<AppUsageSummary[]>} getTodayAppTotals
 * @property {(start: string, end: string) => Promise<AppUsageSummary[]>} getAppTotalsInRange
 * @property {(cb: (info: ActiveWindowInfo) => void) => Promise<() => void>} onActiveWindowChanged
 * @property {(options: LocalApiCallOptions) => Promise<unknown>} localApiCall
 */

/**
 * @typedef {Object} WidgetContext
 * @property {string} widgetId
 * @property {string} widgetType
 * @property {WidgetChannel} channel
 */

/**
 * Create a new widget instance.
 * @returns {{
 *   mount: (container: HTMLElement, context: WidgetContext) => Promise<void>,
 *   unmount: () => Promise<void>
 * }}
 */
export function createWidget() {
  /** @type {HTMLElement | null} */
  let rootEl = null;
  /** @type {(() => void) | null} */
  let stopListening = null;

  return {
    /**
     * Mount the widget into the provided container.
     * @param {HTMLElement} container
     * @param {WidgetContext} context
     */
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
        const rows = await context.client.query("metrics");
        const total = rows.reduce((acc, row) => acc + row.total_seconds, 0);
        const hours = (total / 3600).toFixed(1);
        usage.textContent = `Today tracked: ${hours} h`;
      } catch (err) {
        usage.textContent = `Failed to load usage: ${String(err)}`;
      }

      try {
        stopListening = await context.client.subscribe("active-window-changed", (info) => {
          title.textContent = `Sample Hello Widget · ${info.app_name || "Unknown"}`;
        });
      } catch (err) {
        title.textContent = `Sample Hello Widget · active window unavailable`;
      }

      // Example: call the local HTTP API through the widget bridge.
      try {
        const result = await context.client.localApiCall({
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
