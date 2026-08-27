import type {
  WidgetClient,
  WidgetInstance,
  WidgetQueryNamespace,
} from "./types";

const queryNamespaces: WidgetQueryNamespace[] = [
  "metrics", "sessions", "categories", "projects", "tags",
  "goals", "rules", "focus", "todos", "browser",
];

function write(output: HTMLElement, label: string, value: unknown): void {
  const line = document.createElement("div");
  line.textContent = `${label}: ${JSON.stringify(value)}`;
  output.appendChild(line);
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.textContent = label;
  element.style.cssText = "padding:6px 8px;border:0;border-radius:6px;cursor:pointer;";
  element.addEventListener("click", onClick);
  return element;
}

export function createWidget(): WidgetInstance {
  let root: HTMLDivElement | null = null;
  let client: WidgetClient | null = null;
  let subscription: number | null = null;

  return {
    async mount(container, context) {
      client = context.client;
      root = document.createElement("div");
      root.style.cssText = "box-sizing:border-box;height:100%;overflow:auto;padding:14px;color:#e5eaf6;background:#182033;font-family:sans-serif;font-size:12px;";

      const title = document.createElement("h3");
      title.textContent = `Widget API Showcase: ${context.widgetType}`;
      title.style.margin = "0 0 10px";

      const controls = document.createElement("div");
      controls.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;";
      const output = document.createElement("pre");
      output.style.cssText = "white-space:pre-wrap;word-break:break-word;margin:0;padding:8px;background:#0f1524;";
      root.append(title, controls, output);
      container.appendChild(root);

      const runClientReads = async () => {
        output.textContent = "Running WidgetClient query and state APIs...\n";
        for (const namespace of queryNamespaces) {
          try { write(output, `client.query(${namespace})`, await context.client.query(namespace)); }
          catch (error) { write(output, `client.query(${namespace}) error`, String(error)); }
        }
        try { write(output, "client.getBrowserActivity", await context.client.getBrowserActivity()); }
        catch (error) { write(output, "client.getBrowserActivity error", String(error)); }
        try {
          await context.client.setState("showcase", "visited");
          write(output, "client.getState", await context.client.getState("showcase"));
          await context.client.deleteState("showcase");
          write(output, "client.deleteState", "ok");
        } catch (error) { write(output, "client state error", String(error)); }
      };

      const runLegacyReads = async () => {
        output.textContent = "Running legacy channel read APIs...\n";
        const calls: Array<[string, () => Promise<unknown>]> = [
          ["channel.getTodayAppTotals", () => context.channel.getTodayAppTotals()],
          ["channel.getAppTotalsInRange", () => context.channel.getAppTotalsInRange("2026-01-01", "2026-12-31")],
          ["channel.getCategoryTotalsInRange", () => context.channel.getCategoryTotalsInRange("2026-01-01", "2026-12-31")],
          ["channel.getHourlyForDate", () => context.channel.getHourlyForDate("2026-08-27")],
          ["channel.getRecentDailyTotalsRange", () => context.channel.getRecentDailyTotalsRange("2026-08-01", "2026-08-27")],
          ["channel.getAppCategoryMap", () => context.channel.getAppCategoryMap()],
          ["channel.getTodos", () => context.channel.getTodos()],
          ["channel.getUsageGoals", () => context.channel.getUsageGoals()],
          ["channel.listFocusSessions", () => context.channel.listFocusSessions()],
        ];
        for (const [label, call] of calls) {
          try { write(output, label, await call()); }
          catch (error) { write(output, `${label} error`, String(error)); }
        }
      };

      const runTodoWrites = async () => {
        output.textContent = "Running todo write APIs...\n";
        try {
          const todo = await context.client.addTodo("TimeLens WidgetClient showcase");
          write(output, "client.addTodo", todo);
          await context.client.toggleTodo(todo.id);
          write(output, "client.toggleTodo", "ok");
          await context.client.reorderTodos([todo.id]);
          write(output, "client.reorderTodos", "ok");
          await context.client.deleteTodo(todo.id);
          write(output, "client.deleteTodo", "ok");
        } catch (error) { write(output, "client todo error", String(error)); }
      };

      controls.append(
        button("Client queries/state", () => void runClientReads()),
        button("Legacy read channel", () => void runLegacyReads()),
        button("Todo write lifecycle", () => void runTodoWrites()),
        button("Local API call", () => void context.channel.localApiCall({
          method: "GET", path: "/api/screen-time/today", scopes: ["screen-time:read"],
        }).then((value) => write(output, "channel.localApiCall", value)).catch((error: unknown) => write(output, "local API error", String(error)))),
        button("Focus/settings writes", () => void Promise.all([
          context.channel.setFocusModeActive(false),
          context.channel.setMonitoringActive(true),
        ]).then(() => write(output, "channel settings", "ok")).catch((error: unknown) => write(output, "settings error", String(error)))),
        button("Request consent", () => void context.client.requestConsent("screen-time:read").then(() => write(output, "client.requestConsent", "ok")).catch((error: unknown) => write(output, "consent error", String(error)))),
        button("Test reserved network/media", () => void Promise.allSettled([
          context.client.fetch("https://example.com"),
          context.client.loadMedia("https://example.com/image.png"),
        ]).then((results) => write(output, "client.fetch/loadMedia", results.map((result) => result.status)))),
      );

      try {
        subscription = await context.client.subscribe("active-window-changed", (payload) => {
          title.textContent = `Widget API Showcase: ${JSON.stringify(payload)}`;
        });
        write(output, "client.subscribe", `handle ${subscription}`);
      } catch (error) { write(output, "client.subscribe error", String(error)); }
    },

    async unmount() {
      if (subscription !== null && client) await client.unsubscribe(subscription);
      subscription = null;
      root?.remove();
      root = null;
      client = null;
    },
  };
}
