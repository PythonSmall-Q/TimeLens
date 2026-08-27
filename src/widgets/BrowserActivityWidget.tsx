import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { X, Globe, Wifi, WifiOff } from "lucide-react";
import type { BrowserDomainStats, BrowserExtensionStatus } from "@/types";
import { formatDuration, todayString } from "@/utils/format";
import { useWidgetClient } from "@/hooks/useWidgetClient";
import { useWidgetErrorReporter } from "@/hooks/useWidgetErrorReporter";
import clsx from "clsx";

interface Props {
  widgetId: string;
}

export default function BrowserActivityWidget({ widgetId }: Props) {
  const { t } = useTranslation(["widgets", "common"]);
  useWidgetErrorReporter(widgetId);
  const client = useWidgetClient({ widgetId, widgetType: "browser-activity" });
  const today = todayString();
  const [domains, setDomains] = useState<BrowserDomainStats[]>([]);
  const [status, setStatus] = useState<BrowserExtensionStatus | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const { domains: d, status: s } = await client.getBrowserActivity(today, today);
        setDomains(d.slice(0, 8));
        setStatus(s);
      } catch {
        // Keep current state on error.
      }
    };
    void load();
    const timer = setInterval(() => void load(), 30000);
    return () => clearInterval(timer);
  }, [today, client]);

  const connected = status?.connected ?? false;

  return (
    <div className="w-full h-full glass-card flex flex-col p-4 select-none overflow-hidden">
      <div data-tauri-drag-region className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-text-muted text-xs">
          <Globe size={13} />
          <span>{t("browserActivity.title")}</span>
        </div>
        <button
          onClick={() => getCurrentWebviewWindow().close()}
          className="text-text-muted hover:text-accent-red transition-colors"
          title={t("common:close")}
          aria-label={t("common:close")}
        >
          <X size={13} />
        </button>
      </div>

      <div className="flex items-center gap-2 mb-3 text-[11px]">
        <span
          className={clsx(
            "inline-flex items-center gap-1 px-2 py-0.5 rounded-full",
            connected
              ? "bg-accent-green/15 text-accent-green"
              : "bg-accent-red/15 text-accent-red"
          )}
        >
          {connected ? <Wifi size={10} /> : <WifiOff size={10} />}
          {connected ? t("browserActivity.connected") : t("browserActivity.disconnected")}
        </span>
        {status?.last_browser_name && (
          <span className="text-text-muted">{status.last_browser_name}</span>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-1.5">
        {domains.length === 0 ? (
          <p className="text-xs text-text-muted text-center py-6">{t("browserActivity.empty")}</p>
        ) : (
          domains.map((d) => (
            <div
              key={d.host}
              className="flex items-center justify-between gap-3 px-2.5 py-2 rounded-lg border border-surface-border hover:border-accent-blue/30 transition-colors"
            >
              <div className="min-w-0">
                <div className="text-sm text-text-primary truncate">{d.host}</div>
                <div className="text-[10px] text-text-muted">
                  {d.visit_count} {t("browserActivity.visits")}
                </div>
              </div>
              <div className="text-xs font-medium text-text-secondary whitespace-nowrap">
                {formatDuration(d.total_seconds)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
