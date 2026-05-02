export function createWidget() {
  let rootEl = null;
  let stopListening = null;

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

      rootEl.appendChild(title);
      rootEl.appendChild(usage);
      container.appendChild(rootEl);

      try {
        const rows = await context.channel.getTodayAppTotals();
        const total = rows.reduce((acc, row) => acc + row.total_seconds, 0);
        const hours = (total / 3600).toFixed(1);
        usage.textContent = `Today tracked: ${hours} h`;
      } catch (err) {
        usage.textContent = `Failed to load usage: ${String(err)}`;
      }

      stopListening = await context.channel.onActiveWindowChanged((info) => {
        title.textContent = `Sample Hello Widget · ${info.app_name || "Unknown"}`;
      });
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
