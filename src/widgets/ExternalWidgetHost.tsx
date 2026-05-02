import { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import * as api from "@/services/tauriApi";
import type { WidgetRegistryItem } from "@/types";

interface Props {
  widgetId: string;
  widgetType: string;
}

interface ThirdPartyWidgetInstance {
  mount: (container: HTMLElement, context: ThirdPartyWidgetContext) => void | Promise<void>;
  unmount?: () => void | Promise<void>;
}

// Expanded channel exposed to third-party widgets
interface ThirdPartyWidgetContext {
  widgetId: string;
  widgetType: string;
  channel: Record<string, (...args: unknown[]) => Promise<unknown>>;
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

// Permission → channel method names mapping
const PERMISSION_METHODS: Record<string, string[]> = {
  "screen-time:read": [
    "getTodayAppTotals",
    "getAppTotalsInRange",
    "getCategoryTotalsInRange",
    "getHourlyForDate",
    "getRecentDailyTotalsRange",
    "getAppCategoryMap",
  ],
  "active-window:subscribe": ["onActiveWindowChanged"],
  "todo:read": ["getTodos"],
  "todo:write": ["addTodo", "toggleTodo", "deleteTodo"],
};

function denied(method: string, perm: string): () => Promise<never> {
  return () => Promise.reject(new Error(`permission denied: ${perm} required for ${method}`));
}

function buildChannel(grantedPerms: string[]) {
  // Full method → api function map
  const allMethods: Record<string, (...args: unknown[]) => Promise<unknown>> = {
    // screen-time:read
    getTodayAppTotals: () => api.getTodayAppTotals() as Promise<unknown>,
    getAppTotalsInRange: (start: unknown, end: unknown) =>
      api.getAppTotalsInRange(start as string, end as string) as Promise<unknown>,
    getCategoryTotalsInRange: (start: unknown, end: unknown) =>
      api.getCategoryTotalsInRange(start as string, end as string) as Promise<unknown>,
    getHourlyForDate: (date: unknown) =>
      api.getHourlyDistributionForDate(date as string) as Promise<unknown>,
    getRecentDailyTotalsRange: (start: unknown, end: unknown) =>
      api.getRecentDailyTotalsRange(start as string, end as string) as Promise<unknown>,
    getAppCategoryMap: () => api.getAppCategoryMap() as Promise<unknown>,
    // active-window:subscribe
    onActiveWindowChanged: (cb: unknown) =>
      api.onActiveWindowChanged(cb as Parameters<typeof api.onActiveWindowChanged>[0]) as Promise<unknown>,
    // todo:read
    getTodos: () => api.getTodos() as Promise<unknown>,
    // todo:write
    addTodo: (content: unknown) => api.addTodo(content as string) as Promise<unknown>,
    toggleTodo: (id: unknown) => api.toggleTodo(id as number) as Promise<unknown>,
    deleteTodo: (id: unknown) => api.deleteTodo(id as number) as Promise<unknown>,
    // always available
    getUsageGoals: () => api.getUsageGoals() as Promise<unknown>,
    listFocusSessions: () => api.listFocusSessions() as Promise<unknown>,
  };

  const channel: Record<string, (...args: unknown[]) => Promise<unknown>> = {};

  for (const [method, fn] of Object.entries(allMethods)) {
    // Check if method requires a permission
    const requiredPerm = Object.entries(PERMISSION_METHODS).find(([, methods]) =>
      methods.includes(method)
    )?.[0];

    if (requiredPerm && !grantedPerms.includes(requiredPerm)) {
      channel[method] = denied(method, requiredPerm);
    } else {
      channel[method] = fn;
    }
  }

  return channel;
}

export default function ExternalWidgetHost({ widgetId, widgetType }: Props) {
  const { t } = useTranslation("widgets");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const unmountRef = useRef<ThirdPartyWidgetInstance["unmount"]>();
  const [registryItem, setRegistryItem] = useState<WidgetRegistryItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [grantedPerms, setGrantedPerms] = useState<string[]>([]);

  // Load permissions once
  useEffect(() => {
    api.getWidgetPermissions(widgetId)
      .then(setGrantedPerms)
      .catch(() => setGrantedPerms([]));
  }, [widgetId]);

  const channel = useMemo(
    () => buildChannel(grantedPerms),
    [grantedPerms]
  );

  useEffect(() => {
    let disposed = false;

    const run = async () => {
      try {
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

        await widget.mount(containerRef.current, {
          widgetId,
          widgetType,
          channel,
        });

        unmountRef.current = widget.unmount;
      } catch (err) {
        if (!disposed) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    };

    run();

    return () => {
      disposed = true;
      Promise.resolve(unmountRef.current?.()).catch(() => {});
      unmountRef.current = undefined;
    };
  }, [channel, widgetId, widgetType]);

  if (error) {
    return (
      <div className="h-full w-full p-4 text-xs text-text-secondary flex flex-col gap-2">
        <div className="text-sm font-semibold text-text-primary">
          {t("thirdParty.title")}
        </div>
        <div className="rounded-lg border border-accent-red/30 bg-accent-red/10 px-3 py-2 text-accent-red">
          {error}
        </div>
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
    </div>
  );
}
