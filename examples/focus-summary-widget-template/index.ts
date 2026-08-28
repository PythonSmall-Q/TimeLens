interface WidgetClient {
  query<T>(namespace: string, payload?: Record<string, unknown>): Promise<T>;
}

interface WidgetContext {
  client: WidgetClient;
}

interface MetricsRow {
  app_name: string;
  total_seconds: number;
}

export function createWidget() {
  let timer: number | undefined;

  return {
    async mount(container: HTMLElement, context: WidgetContext) {
      const title = document.createElement("strong");
      const value = document.createElement("div");
      title.textContent = "Focus Summary";
      container.replaceChildren(title, value);

      const refresh = async () => {
        const rows = await context.client.query<MetricsRow[]>("metrics");
        const total = rows.reduce((sum, row) => sum + row.total_seconds, 0);
        value.textContent = `${Math.round(total / 60)} minutes tracked today`;
      };

      await refresh();
      timer = window.setInterval(() => void refresh(), 30000);
    },

    unmount() {
      if (timer !== undefined) window.clearInterval(timer);
    },
  };
}
