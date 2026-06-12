import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import { FolderOpen, Play, RotateCcw, Wrench } from "lucide-react";
import clsx from "clsx";

interface ThirdPartyWidgetInstance {
  mount: (container: HTMLElement, context: ThirdPartyWidgetContext) => void | Promise<void>;
  unmount?: () => void | Promise<void>;
}

interface ThirdPartyWidgetContext {
  widgetId: string;
  widgetType: string;
  channel: Record<string, (...args: unknown[]) => Promise<unknown>>;
}

interface DevManifest {
  widget_type: string;
  name?: string;
  description?: string;
  entry: string;
  default_size?: { width: number; height: number };
  capabilities?: string[];
  permissions?: string[];
  manifest_version?: number;
}

const CAPABILITY_OPTIONS = [
  { key: "read_metrics", label: "Read metrics" },
  { key: "write_data", label: "Write data" },
  { key: "automation_trigger", label: "Automation trigger" },
  { key: "local_api_call", label: "Local API call" },
];

const MOCK_TODAY_TOTALS = [
  { app_name: "Code", exe_path: "code.exe", total_seconds: 7200 },
  { app_name: "Browser", exe_path: "chrome.exe", total_seconds: 3600 },
  { app_name: "Terminal", exe_path: "wt.exe", total_seconds: 1800 },
];

function normalizeModule(moduleCandidate: unknown): ThirdPartyWidgetInstance | null {
  if (!moduleCandidate || typeof moduleCandidate !== "object") return null;
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

function expandCapabilityToPermissions(capability: string): string[] {
  switch (capability) {
    case "read_metrics":
      return ["screen-time:read", "todo:read"];
    case "write_data":
      return ["todo:write", "settings:write"];
    case "automation_trigger":
      return ["active-window:subscribe"];
    case "local_api_call":
      return ["local-api:call"];
    default:
      return [];
  }
}

function buildMockChannel(widgetId: string): Record<string, (...args: unknown[]) => Promise<unknown>> {
  return {
    getTodayAppTotals: async () => MOCK_TODAY_TOTALS,
    getAppTotalsInRange: async () => MOCK_TODAY_TOTALS,
    getCategoryTotalsInRange: async () => [
      { category: "Development", total_seconds: 7200 },
      { category: "Communication", total_seconds: 3600 },
    ],
    getHourlyForDate: async () =>
      Array.from({ length: 24 }, (_, hour) => ({ hour, seconds: hour * 300 })),
    getRecentDailyTotalsRange: async () => [
      { date: "2024-01-01", total_seconds: 28800 },
      { date: "2024-01-02", total_seconds: 25200 },
    ],
    getAppCategoryMap: async () => ({ "code.exe": "Development", "chrome.exe": "Browsing" }),
    onActiveWindowChanged: async (cb: unknown) => {
      if (typeof cb === "function") {
        (cb as (info: unknown) => void)({
          app_name: "Mock App",
          exe_path: "mock.exe",
          window_title: "Mock Window",
          timestamp: new Date().toISOString(),
        });
      }
      return () => {};
    },
    getTodos: async () => [
      { id: 1, content: "Mock todo one", done: false, created_at: new Date().toISOString(), order_index: 0 },
      { id: 2, content: "Mock todo two", done: true, created_at: new Date().toISOString(), order_index: 1 },
    ],
    addTodo: async (content: unknown) => ({
      id: 99,
      content: String(content),
      done: false,
      created_at: new Date().toISOString(),
      order_index: 0,
    }),
    toggleTodo: async () => undefined,
    deleteTodo: async () => undefined,
    setFocusModeActive: async () => undefined,
    setMonitoringActive: async () => undefined,
    getUsageGoals: async () => [],
    listFocusSessions: async () => [],
    localApiCall: async (options: unknown) => {
      const { path } = options as { path?: string };
      return {
        mock: true,
        path: path ?? "/unknown",
        widgetId,
        message: "This is a mocked localApiCall response from the dev harness.",
      };
    },
  };
}

function permissionDenied(method: string, perm: string): () => Promise<never> {
  return () => Promise.reject(new Error(`permission denied: ${perm} required for ${method}`));
}

function buildDevChannel(
  widgetId: string,
  grantedPerms: string[]
): Record<string, (...args: unknown[]) => Promise<unknown>> {
  const mock = buildMockChannel(widgetId);
  const methodToPermission: Record<string, string> = {
    getTodayAppTotals: "screen-time:read",
    getAppTotalsInRange: "screen-time:read",
    getCategoryTotalsInRange: "screen-time:read",
    getHourlyForDate: "screen-time:read",
    getRecentDailyTotalsRange: "screen-time:read",
    getAppCategoryMap: "screen-time:read",
    onActiveWindowChanged: "active-window:subscribe",
    getTodos: "todo:read",
    addTodo: "todo:write",
    toggleTodo: "todo:write",
    deleteTodo: "todo:write",
    setFocusModeActive: "settings:write",
    setMonitoringActive: "settings:write",
    localApiCall: "local-api:call",
  };

  const channel: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  for (const [method, fn] of Object.entries(mock)) {
    const required = methodToPermission[method];
    if (required && !grantedPerms.includes(required)) {
      channel[method] = permissionDenied(method, required);
    } else {
      channel[method] = fn;
    }
  }
  return channel;
}

async function fetchText(url: string): Promise<string> {
  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) throw new Error(`failed to fetch ${url}: ${resp.status}`);
  return resp.text();
}

function joinFilePath(base: string, relative: string): string {
  const normalizedBase = base.replace(/\\/g, "/").replace(/\/$/, "");
  const normalizedRelative = relative.replace(/\\/g, "/").replace(/^\//, "");
  return `${normalizedBase}/${normalizedRelative}`;
}

export default function WidgetDevHarness() {
  const { t } = useTranslation("widgets");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const unmountRef = useRef<ThirdPartyWidgetInstance["unmount"] | undefined>(undefined);
  const [folder, setFolder] = useState<string | null>(null);
  const [manifest, setManifest] = useState<DevManifest | null>(null);
  const [selectedCapabilities, setSelectedCapabilities] = useState<Set<string>>(new Set());
  const [autoReload, setAutoReload] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [entryHash, setEntryHash] = useState<string | null>(null);

  const addLog = useCallback((message: string) => {
    setLogs((prev) => [...prev.slice(-49), `[${new Date().toLocaleTimeString()}] ${message}`]);
  }, []);

  const grantedPerms = useMemo(() => {
    const perms = new Set<string>();
    selectedCapabilities.forEach((cap) => {
      expandCapabilityToPermissions(cap).forEach((p) => perms.add(p));
    });
    return Array.from(perms);
  }, [selectedCapabilities]);

  const channel = useMemo(
    () => buildDevChannel("dev-harness-widget", grantedPerms),
    [grantedPerms]
  );

  const handleSelectFolder = async () => {
    try {
      const selected = await open({ directory: true, multiple: false, title: t("devHarness.selectFolder") });
      if (!selected || typeof selected !== "string") return;
      setFolder(selected);
      setManifest(null);
      setError(null);
      setLogs([]);
      addLog(`selected folder: ${selected}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const loadWidget = useCallback(async () => {
    if (!folder) return;
    setError(null);
    try {
      const manifestUrl = convertFileSrc(`${folder}/manifest.json`);
      const manifestText = await fetchText(manifestUrl);
      const parsed = JSON.parse(manifestText) as DevManifest;
      if (!parsed.widget_type || !parsed.entry) {
        throw new Error("manifest missing widget_type or entry");
      }
      setManifest(parsed);

      const entryUrl = convertFileSrc(`${folder}/${parsed.entry}`);
      const entryText = await fetchText(entryUrl);
      const newHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(entryText))
        .then((buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join(""));
      setEntryHash(newHash);

      // Clean up previous instance.
      if (unmountRef.current) {
        await Promise.resolve(unmountRef.current()).catch(() => {});
        unmountRef.current = undefined;
      }
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }

      const module = await import(/* @vite-ignore */ entryUrl);
      const widget = normalizeModule(module);
      if (!widget) {
        throw new Error("widget module missing createWidget()/mount() export");
      }
      if (!containerRef.current) return;

      await widget.mount(containerRef.current, {
        widgetId: "dev-harness-widget",
        widgetType: parsed.widget_type,
        channel,
      });
      unmountRef.current = widget.unmount;
      addLog(`loaded widget: ${parsed.widget_type}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      addLog(`error: ${message}`);
    }
  }, [folder, channel, addLog]);

  // Initial load when folder or channel changes.
  useEffect(() => {
    if (!folder) return;
    loadWidget();
    return () => {
      Promise.resolve(unmountRef.current?.()).catch(() => {});
      unmountRef.current = undefined;
    };
  }, [folder, loadWidget]);

  // Auto-reload: poll entry file hash.
  useEffect(() => {
    if (!folder || !autoReload || !manifest) return;
    let disposed = false;
    const check = async () => {
      try {
        const entryUrl = convertFileSrc(`${folder}/${manifest.entry}`);
        const entryText = await fetchText(entryUrl);
        const newHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(entryText))
          .then((buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join(""));
        if (!disposed && entryHash && newHash !== entryHash) {
          addLog("entry file changed, reloading widget");
          await loadWidget();
        }
      } catch {
        // ignore polling errors
      }
    };
    const timer = window.setInterval(check, 2000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [folder, manifest, autoReload, entryHash, loadWidget, addLog]);

  const toggleCapability = (key: string) => {
    setSelectedCapabilities((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="h-full flex flex-col p-6 gap-4 animate-fade-in">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-text-primary flex items-center gap-2">
            <Wrench size={20} />
            {t("devHarness.title")}
          </h1>
          <p className="text-text-muted text-xs mt-0.5">{t("devHarness.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSelectFolder}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-accent-blue/15 text-accent-blue hover:bg-accent-blue/25 transition-colors"
          >
            <FolderOpen size={12} />
            {t("devHarness.selectFolder")}
          </button>
          {folder && (
            <button
              onClick={() => loadWidget()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-surface-border text-text-secondary hover:text-text-primary transition-colors"
            >
              <RotateCcw size={12} />
              {t("devHarness.reload")}
            </button>
          )}
        </div>
      </div>

      {folder && (
        <div className="text-xs text-text-muted font-mono truncate">{folder}</div>
      )}

      {error && (
        <div className="rounded-lg border border-accent-red/30 bg-accent-red/10 px-3 py-2 text-xs text-accent-red">
          {error}
        </div>
      )}

      <div className="flex gap-4 flex-1 min-h-0">
        {/* Sidebar controls */}
        <div className="w-64 flex-shrink-0 space-y-4 overflow-y-auto pr-1">
          <div className="glass-card p-3 space-y-2">
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
              {t("devHarness.capabilities")}
            </p>
            {CAPABILITY_OPTIONS.map(({ key, label }) => (
              <label
                key={key}
                className="flex items-center justify-between text-xs text-text-secondary rounded-lg border border-surface-border px-3 py-2 cursor-pointer hover:bg-surface-hover/40"
              >
                <span>{label}</span>
                <input
                  type="checkbox"
                  className="ui-checkbox"
                  checked={selectedCapabilities.has(key)}
                  onChange={() => toggleCapability(key)}
                />
              </label>
            ))}
          </div>

          <label className="flex items-center justify-between text-xs text-text-secondary rounded-lg border border-surface-border px-3 py-2 cursor-pointer hover:bg-surface-hover/40">
            <span>{t("devHarness.autoReload")}</span>
            <input
              type="checkbox"
              className="ui-checkbox"
              checked={autoReload}
              onChange={(e) => setAutoReload(e.target.checked)}
            />
          </label>

          {manifest && (
            <div className="glass-card p-3 space-y-1 text-xs text-text-muted">
              <p>
                <span className="text-text-secondary">{t("devHarness.widgetType")}:</span>{" "}
                {manifest.widget_type}
              </p>
              <p>
                <span className="text-text-secondary">{t("devHarness.manifestVersion")}:</span>{" "}
                {manifest.manifest_version ?? 1}
              </p>
              {manifest.capabilities && (
                <p>
                  <span className="text-text-secondary">{t("devHarness.capabilities")}:</span>{" "}
                  {manifest.capabilities.join(", ")}
                </p>
              )}
              {manifest.permissions && (
                <p>
                  <span className="text-text-secondary">{t("devHarness.permissions")}:</span>{" "}
                  {manifest.permissions.join(", ")}
                </p>
              )}
            </div>
          )}

          <div className="glass-card p-3 space-y-1">
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
              {t("devHarness.logs")}
            </p>
            <div className="h-40 overflow-y-auto text-[10px] font-mono text-text-muted space-y-0.5">
              {logs.length === 0 ? (
                <p>{t("devHarness.noLogs")}</p>
              ) : (
                logs.map((log, i) => <p key={i}>{log}</p>)
              )}
            </div>
          </div>
        </div>

        {/* Widget preview */}
        <div className="flex-1 min-w-0 glass-card p-1 relative overflow-hidden">
          {!folder && (
            <div className="absolute inset-0 grid place-items-center text-xs text-text-muted">
              <div className="text-center space-y-2">
                <Play size={24} className="mx-auto text-text-muted/50" />
                <p>{t("devHarness.selectFolderHint")}</p>
              </div>
            </div>
          )}
          <div
            ref={containerRef}
            className={clsx("h-full w-full overflow-auto", !folder && "invisible")}
          />
          {folder && !manifest && !error && (
            <div className="absolute inset-0 grid place-items-center text-xs text-text-muted">
              {t("devHarness.loadingManifest")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
