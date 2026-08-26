import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import * as api from "@/services/tauriApi";

const RECENT_ERROR_TTL_MS = 30_000;

function recoveryHintFor(error: string, t: (key: string) => string): string {
  const lower = error.toLowerCase();
  if (lower.includes("permission")) {
    return t("thirdParty.recoveryHints.permission");
  }
  if (lower.includes("rate limit") || lower.includes("suspended")) {
    return t("thirdParty.recoveryHints.rateLimit");
  }
  if (lower.includes("network") || lower.includes("fetch")) {
    return t("thirdParty.recoveryHints.network");
  }
  return t("thirdParty.recoveryHints.generic");
}

export function useWidgetErrorReporter(widgetId: string) {
  const { t } = useTranslation(["widgets", "common"]);
  const recentRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const record = (message: string, source?: string) => {
      const key = `${message}:${source ?? ""}`;
      const last = recentRef.current.get(key);
      const now = Date.now();
      if (last && now - last < RECENT_ERROR_TTL_MS) return;
      recentRef.current.set(key, now);

      // Clean old entries periodically.
      for (const [k, t] of recentRef.current) {
        if (now - t > RECENT_ERROR_TTL_MS) recentRef.current.delete(k);
      }

      api.recordWidgetError(widgetId, message, recoveryHintFor(message, t)).catch(() => {
        // Recording errors must never crash the widget.
      });
    };

    const onError = (event: ErrorEvent) => {
      const msg = event.error instanceof Error
        ? `${event.error.name}: ${event.error.message}`
        : event.message || t("common:unknownError");
      record(msg, event.filename);
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const msg = reason instanceof Error
        ? `${reason.name}: ${reason.message}`
        : String(reason || t("common:unhandledRejection"));
      record(msg);
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, [widgetId, t]);
}
