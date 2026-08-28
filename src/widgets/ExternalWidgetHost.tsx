import { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useTranslation } from "react-i18next";
import * as api from "@/services/tauriApi";
import type { WidgetRegistryItem } from "@/types";
import { WidgetClient, buildLegacyChannel, type LegacyChannel } from "./sdk";
import WidgetConsentPrompt from "@/components/WidgetConsentPrompt";

interface Props {
  widgetId: string;
  widgetType: string;
}

interface ThirdPartyWidgetInstance {
  mount: (container: HTMLElement, context: ThirdPartyWidgetContext) => void | Promise<void>;
  unmount?: () => void | Promise<void>;
}

interface ThirdPartyWidgetContext {
  widgetId: string;
  widgetType: string;
  /** Backward-compatible channel. Legacy widgets should use this. */
  channel: LegacyChannel;
  /** New SDK client. New widgets should use this for Gateway-mediated access. */
  client: WidgetClient;
  lifecycle: {
    onMount?: () => void;
    onForeground?: () => void;
    onBackground?: () => void;
    onSuspend?: () => void;
    onResume?: () => void;
    onUninstall?: () => void;
  };
}

interface PendingConsent {
  id: string;
  scope: string;
  message: string;
  resolve: (granted: boolean) => void;
}

function normalizeModule(
  moduleCandidate: unknown
): ThirdPartyWidgetInstance | null {
  if (!moduleCandidate || typeof moduleCandidate !== "object") {
    return null;
  }

  const mod = moduleCandidate as Record<string, unknown>;
  const create = mod.createWidget;
  if (typeof create === "function") {
    const instance = (create as () => unknown)();
    if (
      instance
      && typeof instance === "object"
      && typeof (instance as ThirdPartyWidgetInstance).mount === "function"
    ) {
      return instance as ThirdPartyWidgetInstance;
    }
  }

  if (typeof mod.mount === "function") {
    return {
      mount: mod.mount as ThirdPartyWidgetInstance["mount"],
      unmount: typeof mod.unmount === "function"
        ? (mod.unmount as ThirdPartyWidgetInstance["unmount"])
        : undefined,
    };
  }

  return null;
}

export default function ExternalWidgetHost({ widgetId, widgetType }: Props) {
  const { t } = useTranslation("widgets");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const unmountRef = useRef<ThirdPartyWidgetInstance["unmount"]>(undefined);
  const [registryItem, setRegistryItem] = useState<WidgetRegistryItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [pendingConsents, setPendingConsents] = useState<PendingConsent[]>([]);
  const pendingConsentsRef = useRef<PendingConsent[]>([]);

  const client = useMemo(() => {
    return new WidgetClient({
      widgetId,
      widgetType,
      onConsentRequired: (scope, _riskLevel, message) => {
        return new Promise((resolve) => {
          const consent: PendingConsent = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            scope,
            message,
            resolve,
          };
          setPendingConsents((prev) => {
            const next = [...prev, consent];
            pendingConsentsRef.current = next;
            return next;
          });
        });
      },
    });
  }, [widgetId, widgetType]);

  const channel = useMemo(() => buildLegacyChannel(client), [client]);

  const activeConsent = pendingConsents[0] ?? null;

  const handleConsentDecision = async (granted: boolean, remember: boolean) => {
    if (!activeConsent) return;

    try {
      if (granted) {
        await api.widgetGrantConsent(widgetId, activeConsent.scope, remember, "low");
      } else {
        await api.widgetDenyConsent(widgetId, activeConsent.scope, remember, "low");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      void api.recordWidgetError(widgetId, message, t("thirdParty.loadErrorHint")).catch(() => {});
    } finally {
      activeConsent.resolve(granted);
      setPendingConsents((prev) => {
        const next = prev.slice(1);
        pendingConsentsRef.current = next;
        return next;
      });
    }
  };

  useEffect(() => {
    let disposed = false;
    const win = getCurrentWebviewWindow();

    const run = async () => {
      try {
        await api.emitWidgetLifecycle({ widget_id: widgetId, event: "mount" });

        const registry = await api.getWidgetRegistry();
        const item = registry.items.find((it) => it.widget_type === widgetType) ?? null;
        if (!item) {
          throw new Error(`widget type not found in registry: ${widgetType}`);
        }
        if (!item.entry) {
          throw new Error("widget entry is empty");
        }

        if (!disposed) {
          setRegistryItem(item);
        }

        const moduleUrl = convertFileSrc(item.entry);
        const loaded = await import(/* @vite-ignore */ moduleUrl);
        const widget = normalizeModule(loaded);
        if (!widget) {
          throw new Error("widget module missing createWidget()/mount() export");
        }

        if (!containerRef.current) {
          return;
        }

        const lifecycle: ThirdPartyWidgetContext["lifecycle"] = {
          onMount: () => {
            void api.emitWidgetLifecycle({ widget_id: widgetId, event: "foreground" });
          },
          onForeground: () => {
            void api.emitWidgetLifecycle({ widget_id: widgetId, event: "foreground" });
          },
          onBackground: () => {
            void api.emitWidgetLifecycle({ widget_id: widgetId, event: "background" });
          },
          onSuspend: () => {
            void api.emitWidgetLifecycle({ widget_id: widgetId, event: "suspend" });
          },
          onResume: () => {
            void api.emitWidgetLifecycle({ widget_id: widgetId, event: "resume" });
          },
          onUninstall: () => {
            void api.emitWidgetLifecycle({ widget_id: widgetId, event: "uninstall" });
          },
        };

        await widget.mount(containerRef.current, {
          widgetId,
          widgetType,
          channel,
          client,
          lifecycle,
        });

        unmountRef.current = widget.unmount;

        // Listen to window focus changes for foreground/background lifecycle
        const unlistenFocus = await win.onFocusChanged(({ payload: focused }) => {
          if (focused) {
            lifecycle.onForeground?.();
          } else {
            lifecycle.onBackground?.();
          }
        });

        return () => {
          unlistenFocus?.();
        };
      } catch (err) {
        if (!disposed) {
          const message = err instanceof Error ? err.message : String(err);
          setError(message);
          void api.recordWidgetError(widgetId, message, t("thirdParty.loadErrorHint")).catch(() => {});
        }
        return undefined;
      }
    };

    let cleanupFocus: (() => void) | undefined;
    run().then((cleanup) => {
      cleanupFocus = cleanup;
    });

    return () => {
      disposed = true;
      cleanupFocus?.();
      Promise.resolve(unmountRef.current?.()).catch(() => {});
      unmountRef.current = undefined;
      client.dispose();
      // Reject any pending consent prompts so awaiting widgets unblock.
      pendingConsentsRef.current.forEach((c) => c.resolve(false));
      pendingConsentsRef.current = [];
      setPendingConsents([]);
      void api.emitWidgetLifecycle({ widget_id: widgetId, event: "uninstall" }).catch(() => {});
    };
  }, [channel, client, retryNonce, t, widgetId, widgetType]);

  const retry = () => {
    setError(null);
    setRegistryItem(null);
    setRetryNonce((value) => value + 1);
  };

  if (error) {
    return (
      <div className="h-full w-full p-4 text-xs text-text-secondary flex flex-col gap-2">
        <div className="text-sm font-semibold text-text-primary">
          {t("thirdParty.title")}
        </div>
        <div className="rounded-lg border border-accent-red/30 bg-accent-red/10 px-3 py-2 text-accent-red">
          {error}
        </div>
        <div className="text-[11px] text-text-muted">
          {t("thirdParty.recoveryHint")}
        </div>
        <button
          onClick={retry}
          className="self-start rounded-lg border border-surface-border px-3 py-1.5 text-[11px] text-text-secondary hover:text-text-primary"
        >
          {t("thirdParty.retry")}
        </button>
      </div>
    );
  }

  return (
    <div className="h-full w-full relative">
      <div ref={containerRef} className="h-full w-full" />
      {!registryItem && (
        <div className="absolute inset-0 grid place-items-center text-xs text-text-muted">
          {t("thirdParty.loading")}
        </div>
      )}
      {activeConsent && (
        <WidgetConsentPrompt
          open
          widgetName={registryItem?.display_name ?? widgetType}
          scope={activeConsent.scope}
          message={activeConsent.message}
          onAccept={(remember) => void handleConsentDecision(true, remember)}
          onDeny={(remember) => void handleConsentDecision(false, remember)}
          onClose={() => void handleConsentDecision(false, false)}
        />
      )}
    </div>
  );
}
