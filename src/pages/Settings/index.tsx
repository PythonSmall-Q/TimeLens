import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "@/stores/settingsStore";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { Moon, Sun, Activity, Database, Info, Rocket, Keyboard, PanelsTopLeft, Puzzle } from "lucide-react";
import clsx from "clsx";
import * as api from "@/services/tauriApi";
import type { BrowserExtensionStatus, ExecutableOption, ShortcutSettings } from "@/types";
import ExePickerInput from "@/components/ExePickerInput";

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="glass-card p-5">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-accent-blue">
          <Icon size={15} />
        </span>
        <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-text-secondary flex-shrink-0">{label}</span>
      <div className="flex-1 flex justify-end">{children}</div>
    </div>
  );
}

export default function Settings() {
  const { t } = useTranslation("settings");
  const importJsonInputRef = useRef<HTMLInputElement | null>(null);
  const [launchAtStartup, setLaunchAtStartup] = useState(false);
  const [silentStartup, setSilentStartup] = useState(true);
  const [autoOpenWidgets, setAutoOpenWidgets] = useState(true);
  const [fadeOnBlur, setFadeOnBlur] = useState(true);
  const [executableOptions, setExecutableOptions] = useState<ExecutableOption[]>([]);
  const [ignoredApps, setIgnoredAppsState] = useState<string[]>([]);
  const [excludePickerValue, setExcludePickerValue] = useState("");
  const [browserExtensionEnabled, setBrowserExtensionEnabledState] = useState(true);
  const [browserExtensionStatus, setBrowserExtensionStatus] = useState<BrowserExtensionStatus | null>(null);
  const [shortcuts, setShortcutState] = useState<ShortcutSettings>({
    open_widget_center: "Alt+W",
    toggle_widget_visibility: "Alt+Shift+W",
    start_recording: "Alt+R",
    pause_recording: "Alt+P",
  });

  const {
    theme,
    setTheme,
    monitoringActive,
    setMonitoringActive,
    samplingIntervalMs,
    setSamplingInterval,
    debounceMs,
    setDebounce,
    setAutoOpenWidgets: setStoreAutoOpenWidgets,
    ignoreSystemProcesses,
    setIgnoreSystemProcesses,
    idleTimePolicy,
    setIdleTimePolicy,
    trackWindowTitles,
    setTrackWindowTitles,
    weekStartDay,
    setWeekStartDay,
    excludeTimelens,
    setExcludeTimelens,
  } = useSettingsStore();

  useEffect(() => {
    api.getAppSettings()
      .then((s) => {
        setLaunchAtStartup(s.launch_at_startup);
        setSilentStartup(s.silent_startup);
        setAutoOpenWidgets(s.auto_open_widgets);
        setIgnoreSystemProcesses(s.ignore_system_processes);
        setIdleTimePolicy(s.idle_time_policy);
        setTrackWindowTitles(s.track_window_titles);
        setBrowserExtensionEnabledState(s.browser_extension_enabled);
        setShortcutState(s.shortcuts);
      })
      .catch(() => {});

    api.getBrowserExtensionStatus()
      .then(setBrowserExtensionStatus)
      .catch(() => {});

    const mergeOptions = (incoming: ExecutableOption[]) => {
      setExecutableOptions((prev) => {
        const map = new Map<string, ExecutableOption>();
        for (const row of [...prev, ...incoming]) {
          if (!row.exe_path) continue;
          map.set(row.exe_path, row);
        }
        return Array.from(map.values());
      });
    };

    api.getRecentExecutables(300)
      .then((recent) => {
        mergeOptions(recent);

        // Auto-seed TimeLens exclusion on first run
        api.getIgnoredApps().then((ignored) => {
          setIgnoredAppsState(ignored);
          if (ignored.length === 0 && excludeTimelens) {
            const tlExes = recent
              .filter((x) => x.exe_path.toLowerCase().includes("timelens"))
              .map((x) => x.exe_path);
            if (tlExes.length > 0) {
              setIgnoredAppsState(tlExes);
              api.setIgnoredApps(tlExes).catch(() => {});
            }
          }
        }).catch(() => {});
      })
      .catch(() => {});

    // Load running executables in background to avoid blocking settings UI.
    api.getRunningExecutables()
      .then((running) => mergeOptions(running))
      .catch(() => {});

    const fade = localStorage.getItem("timelens-widget-fade-on-blur");
    setFadeOnBlur(fade !== "0");
  }, []);

  const setShortcut = (key: keyof ShortcutSettings, value: string) => {
    setShortcutState((prev) => ({ ...prev, [key]: value }));
  };

  const toggleIgnoredApp = (exePath: string) => {
    setIgnoredAppsState((prev) =>
      prev.includes(exePath)
        ? prev.filter((p) => p !== exePath)
        : [...prev, exePath]
    );
  };

  const addPickedExcludedApp = (appName: string, exePath: string) => {
    if (!exePath) return;
    const normalized = exePath.replace(/\//g, "\\");
    setIgnoredAppsState((prev) => (prev.includes(normalized) ? prev : [...prev, normalized]));
    setExecutableOptions((prev) => {
      if (prev.some((x) => x.exe_path === normalized)) return prev;
      return [{ app_name: appName, exe_path: normalized }, ...prev];
    });
    setExcludePickerValue("");
  };

  const downloadTextFile = (fileName: string, content: string, contentType: string) => {
    const blob = new Blob([content], { type: contentType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const refreshBrowserExtensionStatus = async () => {
    try {
      const status = await api.getBrowserExtensionStatus();
      setBrowserExtensionStatus(status);
    } catch {
      // keep silent to match current settings UX
    }
  };

  const browserLinkPayload = JSON.stringify(
    {
      app: "TimeLens",
      apiBaseUrl: browserExtensionStatus?.api_base_url ?? "http://127.0.0.1:49152",
      enabled: browserExtensionEnabled,
    },
    null,
    2,
  );

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-text-primary">{t("title")}</h1>
        <p className="text-text-muted text-xs mt-0.5">{t("subtitle")}</p>
      </div>

      {/* General */}
      <Section icon={Sun} title={t("general")}>
        <Row label={t("language")}>
          <LanguageSwitcher />
        </Row>
      </Section>

      {/* Appearance */}
      <Section icon={Moon} title={t("appearance")}>
        <Row label={t("theme.label")}>
          <div className="flex gap-2">
            {(["dark", "light"] as const).map((th) => (
              <button
                key={th}
                onClick={() => setTheme(th)}
                className={clsx(
                  "px-3 py-1.5 rounded-lg text-xs border transition-colors",
                  theme === th
                    ? "border-accent-blue bg-accent-blue/15 text-accent-blue"
                    : "border-surface-border text-text-muted hover:text-text-secondary"
                )}
              >
                {t(`theme.${th}`)}
              </button>
            ))}
          </div>
        </Row>
      </Section>

      {/* Tracking */}
      <Section icon={Activity} title={t("tracking.title")}>
        <Row label={t("tracking.active")}>
          <button
            onClick={() => setMonitoringActive(!monitoringActive)}
            title={t("tracking.active")}
            className={clsx(
              "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
              monitoringActive ? "bg-accent-blue" : "bg-surface-hover"
            )}
          >
            <span
              className={clsx(
                "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
                monitoringActive ? "translate-x-6" : "translate-x-1"
              )}
            />
          </button>
        </Row>
        <Row label={t("tracking.samplingInterval")}>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={500}
              max={5000}
              step={500}
              value={samplingIntervalMs}
              onChange={(e) => setSamplingInterval(Number(e.target.value))}
              className="ui-range"
              title={t("tracking.samplingInterval")}
              aria-label={t("tracking.samplingInterval")}
            />
            <span className="text-xs text-text-secondary w-16 text-right">
              {samplingIntervalMs}ms
            </span>
          </div>
        </Row>
        <Row label={t("tracking.debounce")}>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={200}
              max={2000}
              step={100}
              value={debounceMs}
              onChange={(e) => setDebounce(Number(e.target.value))}
              className="ui-range"
              title={t("tracking.debounce")}
              aria-label={t("tracking.debounce")}
            />
            <span className="text-xs text-text-secondary w-16 text-right">
              {debounceMs}ms
            </span>
          </div>
        </Row>
        <Row label={t("tracking.weekStartDay")}>
          <div className="flex gap-2">
            {([1, 0] as const).map((d) => (
              <button
                key={d}
                onClick={() => setWeekStartDay(d)}
                className={clsx(
                  "px-3 py-1.5 rounded-lg text-xs border transition-colors",
                  weekStartDay === d
                    ? "border-accent-blue bg-accent-blue/15 text-accent-blue"
                    : "border-surface-border text-text-muted hover:text-text-secondary"
                )}
              >
                {d === 1 ? t("tracking.weekStartMonday") : t("tracking.weekStartSunday")}
              </button>
            ))}
          </div>
        </Row>
        <Row label={t("tracking.excludeTimelens")}>
          <button
            onClick={() => {
              const next = !excludeTimelens;
              setExcludeTimelens(next);
              // Add/remove TimeLens exes from ignored list
              const tlExes = executableOptions
                .filter((x) => x.exe_path.toLowerCase().includes("timelens"))
                .map((x) => x.exe_path);
              if (next) {
                const merged = Array.from(new Set([...ignoredApps, ...tlExes]));
                setIgnoredAppsState(merged);
                api.setIgnoredApps(merged).catch(() => {});
              } else {
                const filtered = ignoredApps.filter(
                  (p) => !p.toLowerCase().includes("timelens")
                );
                setIgnoredAppsState(filtered);
                api.setIgnoredApps(filtered).catch(() => {});
              }
            }}
            title={t("tracking.excludeTimelens")}
            className={clsx(
              "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
              excludeTimelens ? "bg-accent-blue" : "bg-surface-hover"
            )}
          >
            <span
              className={clsx(
                "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
                excludeTimelens ? "translate-x-6" : "translate-x-1"
              )}
            />
          </button>
        </Row>
        <p className="text-xs text-text-muted text-right">{t("tracking.excludeTimelensHint")}</p>
        <Row label={t("tracking.ignoreSystemProcesses")}>
          <button
            onClick={() => {
              const next = !ignoreSystemProcesses;
              setIgnoreSystemProcesses(next);
            }}
            title={t("tracking.ignoreSystemProcesses")}
            className={clsx(
              "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
              ignoreSystemProcesses ? "bg-accent-blue" : "bg-surface-hover"
            )}
          >
            <span
              className={clsx(
                "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
                ignoreSystemProcesses ? "translate-x-6" : "translate-x-1"
              )}
            />
          </button>
        </Row>
        <p className="text-xs text-text-muted text-right">{t("tracking.ignoreSystemProcessesHint")}</p>
        <Row label={t("tracking.trackWindowTitles")}>
          <button
            onClick={() => {
              const next = !trackWindowTitles;
              setTrackWindowTitles(next);
            }}
            title={t("tracking.trackWindowTitles")}
            className={clsx(
              "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
              trackWindowTitles ? "bg-accent-blue" : "bg-surface-hover"
            )}
          >
            <span
              className={clsx(
                "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
                trackWindowTitles ? "translate-x-6" : "translate-x-1"
              )}
            />
          </button>
        </Row>
        <p className="text-xs text-text-muted text-right">{t("tracking.trackWindowTitlesHint")}</p>
        <Row label={t("tracking.idleTimePolicy")}> 
          <div className="flex gap-2">
            {([
              ["count", t("tracking.idleCount")],
              ["exclude", t("tracking.idleExclude")],
            ] as const).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setIdleTimePolicy(val)}
                className={clsx(
                  "px-3 py-1.5 rounded-lg text-xs border transition-colors",
                  idleTimePolicy === val
                    ? "border-accent-blue bg-accent-blue/15 text-accent-blue"
                    : "border-surface-border text-text-muted hover:text-text-secondary"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </Row>
        <p className="text-xs text-text-muted text-right">{t("tracking.idleTimePolicyHint")}</p>

  </Section>

  {/* Startup */}
      <Section icon={Rocket} title={t("startup.title")}>
        <Row label={t("startup.launchAtStartup")}>
          <button
            onClick={async () => {
              const next = !launchAtStartup;
              setLaunchAtStartup(next);
              await api.setLaunchAtStartup(next).catch(() => setLaunchAtStartup(!next));
            }}
            title={t("startup.launchAtStartup")}
            className={clsx(
              "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
              launchAtStartup ? "bg-accent-blue" : "bg-surface-hover"
            )}
          >
            <span
              className={clsx(
                "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
                launchAtStartup ? "translate-x-6" : "translate-x-1"
              )}
            />
          </button>
        </Row>
        <Row label={t("startup.silentStartup")}>
          <button
            onClick={async () => {
              const next = !silentStartup;
              setSilentStartup(next);
              await api.setSilentStartup(next).catch(() => setSilentStartup(!next));
            }}
            title={t("startup.silentStartup")}
            className={clsx(
              "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
              silentStartup ? "bg-accent-blue" : "bg-surface-hover"
            )}
          >
            <span
              className={clsx(
                "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
                silentStartup ? "translate-x-6" : "translate-x-1"
              )}
            />
          </button>
        </Row>
        <Row label={t("startup.autoOpenWidgets")}>
          <button
            onClick={async () => {
              const next = !autoOpenWidgets;
              setAutoOpenWidgets(next);
              setStoreAutoOpenWidgets(next);
            }}
            title={t("startup.autoOpenWidgets")}
            className={clsx(
              "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
              autoOpenWidgets ? "bg-accent-blue" : "bg-surface-hover"
            )}
          >
            <span
              className={clsx(
                "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
                autoOpenWidgets ? "translate-x-6" : "translate-x-1"
              )}
            />
          </button>
        </Row>
        <p className="text-xs text-text-muted text-right">{t("startup.silentHint")}</p>
      </Section>

      {/* Widgets */}
      <Section icon={PanelsTopLeft} title={t("widgets.title")}>
        <Row label={t("widgets.fadeOnBlur")}>
          <button
            onClick={() => {
              const next = !fadeOnBlur;
              setFadeOnBlur(next);
              localStorage.setItem("timelens-widget-fade-on-blur", next ? "1" : "0");
            }}
            title={t("widgets.fadeOnBlur")}
            className={clsx(
              "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
              fadeOnBlur ? "bg-accent-blue" : "bg-surface-hover"
            )}
          >
            <span
              className={clsx(
                "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
                fadeOnBlur ? "translate-x-6" : "translate-x-1"
              )}
            />
          </button>
        </Row>
        <p className="text-xs text-text-muted text-right">{t("widgets.fadeHint")}</p>
      </Section>

      <Section icon={Puzzle} title={t("browser.title")}> 
        <Row label={t("browser.enable")}> 
          <button
            onClick={async () => {
              const next = !browserExtensionEnabled;
              setBrowserExtensionEnabledState(next);
              await api.setBrowserExtensionEnabled(next).catch(() => setBrowserExtensionEnabledState(!next));
              await refreshBrowserExtensionStatus();
            }}
            title={t("browser.enable")}
            className={clsx(
              "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
              browserExtensionEnabled ? "bg-accent-blue" : "bg-surface-hover"
            )}
          >
            <span
              className={clsx(
                "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
                browserExtensionEnabled ? "translate-x-6" : "translate-x-1"
              )}
            />
          </button>
        </Row>
        <Row label={t("browser.status")}>
          <span className={clsx(
            "text-xs px-2.5 py-1 rounded-full border",
            browserExtensionStatus?.connected
              ? "border-accent-green/40 text-accent-green bg-accent-green/10"
              : "border-surface-border text-text-muted bg-surface-hover"
          )}>
            {browserExtensionStatus?.connected ? t("browser.connected") : t("browser.waiting")}
          </span>
        </Row>
        <Row label={t("browser.apiUrl")}>
          <div className="flex items-center gap-2 justify-end flex-wrap">
            <span className="text-xs font-mono text-text-secondary">
              {browserExtensionStatus?.api_base_url ?? "http://127.0.0.1:49152"}
            </span>
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(browserExtensionStatus?.api_base_url ?? "http://127.0.0.1:49152");
              }}
              className="text-xs px-3 py-1.5 rounded-lg border border-surface-border text-text-secondary hover:bg-surface-hover transition-colors"
            >
              {t("browser.copyApiUrl")}
            </button>
          </div>
        </Row>
        <Row label={t("browser.linkConfig")}>
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(browserLinkPayload);
            }}
            className="text-xs px-3 py-1.5 rounded-lg border border-surface-border text-text-secondary hover:bg-surface-hover transition-colors"
          >
            {t("browser.copyConfig")}
          </button>
        </Row>
        <div className="rounded-lg border border-surface-border bg-surface-hover/40 p-3 space-y-2">
          <p className="text-xs text-text-secondary">{t("browser.hint")}</p>
          <div className="flex flex-wrap gap-2 text-xs text-text-muted">
            <span className="px-2 py-1 rounded-full bg-surface-hover">Chrome</span>
            <span className="px-2 py-1 rounded-full bg-surface-hover">Edge</span>
            <span className="px-2 py-1 rounded-full bg-surface-hover">Brave</span>
          </div>
          <div className="text-xs text-text-muted space-y-1">
            <p>{t("browser.lastBrowser", { browser: browserExtensionStatus?.last_browser_name ?? t("browser.none") })}</p>
            <p>{t("browser.lastLocale", { locale: browserExtensionStatus?.last_locale ?? t("browser.none") })}</p>
            <p>{t("browser.lastSync", { time: browserExtensionStatus?.last_sync_at ?? t("browser.none") })}</p>
            <p>{t("browser.recentSessions", { count: browserExtensionStatus?.recent_session_count ?? 0 })}</p>
          </div>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {(browserExtensionStatus?.recent_sessions ?? []).map((session) => (
              <div key={`${session.started_at}-${session.tab_url}`} className="rounded-lg border border-surface-border px-3 py-2">
                <div className="text-xs text-text-primary truncate">{session.title || session.host}</div>
                <div className="text-[11px] text-text-muted truncate">{session.host || session.tab_url}</div>
                <div className="text-[11px] text-text-muted">
                  {session.browser_name} · {Math.floor(session.duration_seconds / 60)}m · {session.locale || t("browser.none")}
                </div>
              </div>
            ))}
            {(browserExtensionStatus?.recent_sessions ?? []).length === 0 && (
              <p className="text-xs text-text-muted">{t("browser.noSessions")}</p>
            )}
          </div>
          <div className="flex justify-end">
            <button
              onClick={refreshBrowserExtensionStatus}
              className="text-xs px-3 py-1.5 rounded-lg border border-accent-blue/50 text-accent-blue hover:bg-accent-blue/10 transition-colors"
            >
              {t("browser.refresh")}
            </button>
          </div>
        </div>
      </Section>

      {/* Shortcuts */}
      <Section icon={Keyboard} title={t("shortcuts.title")}>
        <Row label={t("shortcuts.openWidgetCenter")}>
          <input
            value={shortcuts.open_widget_center}
            onChange={(e) => setShortcut("open_widget_center", e.target.value)}
            className="ui-field max-w-44"
            title={t("shortcuts.openWidgetCenter")}
            aria-label={t("shortcuts.openWidgetCenter")}
          />
        </Row>
        <Row label={t("shortcuts.toggleWidgetVisibility")}>
          <input
            value={shortcuts.toggle_widget_visibility}
            onChange={(e) => setShortcut("toggle_widget_visibility", e.target.value)}
            className="ui-field max-w-44"
            title={t("shortcuts.toggleWidgetVisibility")}
            aria-label={t("shortcuts.toggleWidgetVisibility")}
          />
        </Row>
        <Row label={t("shortcuts.startRecording")}>
          <input
            value={shortcuts.start_recording}
            onChange={(e) => setShortcut("start_recording", e.target.value)}
            className="ui-field max-w-44"
            title={t("shortcuts.startRecording")}
            aria-label={t("shortcuts.startRecording")}
          />
        </Row>
        <Row label={t("shortcuts.pauseRecording")}>
          <input
            value={shortcuts.pause_recording}
            onChange={(e) => setShortcut("pause_recording", e.target.value)}
            className="ui-field max-w-44"
            title={t("shortcuts.pauseRecording")}
            aria-label={t("shortcuts.pauseRecording")}
          />
        </Row>
        <div className="flex justify-end">
          <button
            onClick={async () => {
              await api.setShortcuts(shortcuts);
              window.dispatchEvent(
                new CustomEvent("timelens-shortcuts-changed", { detail: shortcuts })
              );
            }}
            className="text-xs px-3 py-1.5 rounded-lg border border-accent-blue/50
                       text-accent-blue hover:bg-accent-blue/10 transition-colors"
            title={t("shortcuts.save")}
          >
            {t("shortcuts.save")}
          </button>
        </div>
      </Section>

      {/* Data */}
      <Section icon={Database} title={t("data.title")}>
        <div className="space-y-2">
          <div className="text-sm text-text-secondary">{t("data.excludeApps")}</div>
          <ExePickerInput
            options={executableOptions}
            placeholder={t("data.searchExe")}
            value={excludePickerValue}
            onChange={(appName, exePath) => {
              if (exePath) { addPickedExcludedApp(appName, exePath); }
              else { setExcludePickerValue(appName); }
            }}
          />
          <div className="max-h-48 overflow-y-auto rounded-lg border border-surface-border divide-y divide-surface-border">
            {executableOptions.filter((x) => ignoredApps.includes(x.exe_path)).map((row) => {
              const checked = ignoredApps.includes(row.exe_path);
              return (
                <label
                  key={row.exe_path}
                  className="flex items-start gap-2 px-3 py-2 text-xs text-text-secondary hover:bg-surface-hover cursor-pointer"
                >
                  <input
                    type="checkbox"
                    className="ui-checkbox mt-0.5"
                    checked={checked}
                    onChange={() => toggleIgnoredApp(row.exe_path)}
                  />
                  <span className="min-w-0">
                    <span className="block text-text-primary truncate">{row.app_name}</span>
                    <span className="block text-text-muted truncate" title={row.exe_path}>
                      {row.exe_path}
                    </span>
                  </span>
                </label>
              );
            })}
            
            {executableOptions.filter((x: ExecutableOption) => ignoredApps.includes(x.exe_path)).length === 0 && (
              <p className="px-3 py-3 text-xs text-text-muted">{t("data.noExcludedApps")}</p>
            )}
          </div>
          <div className="flex justify-end">
            <button
              onClick={async () => {
                await api.setIgnoredApps(ignoredApps);
              }}
              className="text-xs px-3 py-1.5 rounded-lg border border-accent-blue/50 text-accent-blue hover:bg-accent-blue/10 transition-colors"
            >
              {t("data.saveExcludedApps")}
            </button>
          </div>
        </div>

        <Row label={t("data.export")}>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <button
              onClick={async () => {
                const csv = await api.exportDataCsv();
                const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
                downloadTextFile(`timelens-export-${stamp}.csv`, csv, "text/csv;charset=utf-8");
              }}
              className="text-xs px-3 py-1.5 rounded-lg border border-accent-blue/50 text-accent-blue hover:bg-accent-blue/10 transition-colors"
            >
              {t("data.exportCsv")}
            </button>
            <button
              onClick={async () => {
                const json = await api.exportDataJson();
                const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
                downloadTextFile(`timelens-backup-${stamp}.json`, json, "application/json;charset=utf-8");
              }}
              className="text-xs px-3 py-1.5 rounded-lg border border-accent-blue/50 text-accent-blue hover:bg-accent-blue/10 transition-colors"
            >
              {t("data.exportJson")}
            </button>
            <button
              onClick={() => importJsonInputRef.current?.click()}
              className="text-xs px-3 py-1.5 rounded-lg border border-surface-border text-text-secondary hover:bg-surface-hover transition-colors"
            >
              {t("data.importJson")}
            </button>
            <input
              ref={importJsonInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              title={t("data.importJson")}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  const content = await file.text();
                  await api.importDataJson(content);
                  window.location.reload();
                } catch {
                  // Keep silent for now to match existing settings behavior.
                } finally {
                  e.target.value = "";
                }
              }}
            />
          </div>
        </Row>
      </Section>

      {/* About */}
      <Section icon={Info} title={t("about.title")}>
        <Row label={t("about.version")}>
          <span className="text-xs font-mono text-text-secondary">v1.1.0</span>
        </Row>
        <Row label="GitHub">
          <a
            href="https://github.com/PythonSmall-Q/TimeLens"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-accent-blue hover:underline"
          >
            github.com/PythonSmall-Q/TimeLens
          </a>
        </Row>
      </Section>
    </div>
  );
}
