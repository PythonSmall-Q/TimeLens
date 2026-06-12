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
  "settings:write": ["setFocusModeActive", "setMonitoringActive"],
  "local-api:call": ["localApiCall"],
};

function denied(method: string, perm: string): () => Promise<never> {
  return () => Promise.reject(new Error(`permission denied: ${perm} required for ${method}`));
}

function buildChannel(widgetId: string, grantedPerms: string[]) {
  const markPermissionAccess = (permission: string) => {
    void api.recordWidgetPermissionAccess(widgetId, permission).catch(() => {});
  };

  const withPermission = (
    permission: string,
    fn: (...args: unknown[]) => Promise<unknown>
  ) => {
    return (...args: unknown[]) => {
      markPermissionAccess(permission);
      return fn(...args);
    };
  };

  // Full method → api function map
  const allMethods: Record<string, (...args: unknown[]) => Promise<unknown>> = {
    // screen-time:read
    getTodayAppTotals: withPermission("screen-time:read", () => api.getTodayAppTotals() as Promise<unknown>),
    getAppTotalsInRange: withPermission("screen-time:read", (start: unknown, end: unknown) =>
      api.getAppTotalsInRange(start as string, end as string) as Promise<unknown>,
    ),
    getCategoryTotalsInRange: withPermission("screen-time:read", (start: unknown, end: unknown) =>
      api.getCategoryTotalsInRange(start as string, end as string) as Promise<unknown>,
    ),
    getHourlyForDate: withPermission("screen-time:read", (date: unknown) =>
      api.getHourlyDistributionForDate(date as string) as Promise<unknown>,
    ),
    getRecentDailyTotalsRange: withPermission("screen-time:read", (start: unknown, end: unknown) =>
      api.getRecentDailyTotalsRange(start as string, end as string) as Promise<unknown>,
    ),
    getAppCategoryMap: withPermission("screen-time:read", () => api.getAppCategoryMap() as Promise<unknown>),
    // active-window:subscribe
    onActiveWindowChanged: withPermission("active-window:subscribe", (cb: unknown) =>
      api.onActiveWindowChanged(cb as Parameters<typeof api.onActiveWindowChanged>[0]) as Promise<unknown>,
    ),
    // todo:read
    getTodos: withPermission("todo:read", () => api.getTodos() as Promise<unknown>),
    // todo:write
    addTodo: withPermission("todo:write", (content: unknown) => api.addTodo(content as string) as Promise<unknown>),
    toggleTodo: withPermission("todo:write", (id: unknown) => api.toggleTodo(id as number) as Promise<unknown>),
    deleteTodo: withPermission("todo:write", (id: unknown) => api.deleteTodo(id as number) as Promise<unknown>),
    // settings:write
    setFocusModeActive: withPermission("settings:write", (active: unknown) =>
      api.setFocusModeActive(Boolean(active)) as Promise<unknown>,
    ),
    setMonitoringActive: withPermission("settings:write", (active: unknown) =>
      api.setMonitoringActive(Boolean(active)) as Promise<unknown>,
    ),
    // local-api:call
    localApiCall: withPermission("local-api:call", async (options: unknown) => {
      const {
        method = "GET",
        path,
        body,
        scopes = [],
      } = options as {
        method?: string;
        path: string;
        body?: unknown;
        scopes?: string[];
      };
      if (!path || typeof path !== "string") {
        throw new Error("localApiCall requires a path string");
      }
      const token = await api.issueWidgetApiToken(widgetId, scopes);
      const resp = await fetch(`http://127.0.0.1:49152${path}`, {
        method: method.toUpperCase(),
        headers: {
          "Content-Type": "application/json",
          "X-Client-Id": `widget-${widgetId}`,
          "X-Api-Token": token.token,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (!resp.ok) {
        throw new Error(`local API call failed: ${resp.status}`);
      }
      if (resp.status === 204) {
        return undefined;
      }
      return (await resp.json()) as unknown;
    }),
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
    let disposed = false;

    const refreshPermissions = async () => {
      try {
        const next = await api.getWidgetPermissions(widgetId);
        if (!disposed) {
          setGrantedPerms(next);
        }
      } catch {
        if (!disposed) {
          setGrantedPerms([]);
        }
      }
    };

    void refreshPermissions();
    const timer = window.setInterval(() => {
      void refreshPermissions();
    }, 2000);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [widgetId]);

  const channel = useMemo(
    () => buildChannel(widgetId, grantedPerms),
    [widgetId, grantedPerms]
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
