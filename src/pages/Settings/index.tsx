import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "@/stores/settingsStore";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { Moon, Sun, Activity, Database, Info, Rocket, Keyboard, PanelsTopLeft } from "lucide-react";
import clsx from "clsx";
import * as api from "@/services/tauriApi";
import type { ExecutableOption, ShortcutSettings } from "@/types";

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
  const [launchAtStartup, setLaunchAtStartup] = useState(false);
  const [silentStartup, setSilentStartup] = useState(true);
  const [autoOpenWidgets, setAutoOpenWidgets] = useState(true);
  const [fadeOnBlur, setFadeOnBlur] = useState(true);
  const [executableOptions, setExecutableOptions] = useState<ExecutableOption[]>([]);
  const [ignoredApps, setIgnoredAppsState] = useState<string[]>([]);
  const [excludeQuery, setExcludeQuery] = useState("");
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
        setShortcutState(s.shortcuts);
      })
      .catch(() => {});

    Promise.all([api.getRecentExecutables(300), api.getRunningExecutables()])
      .then(([recent, running]) => {
        const map = new Map<string, ExecutableOption>();
        for (const row of [...running, ...recent]) {
          if (!row.exe_path) continue;
          map.set(row.exe_path, row);
        }
        const options = Array.from(map.values());
        setExecutableOptions(options);

        // Auto-seed TimeLens exclusion on first run
        api.getIgnoredApps().then((ignored) => {
          setIgnoredAppsState(ignored);
          if (ignored.length === 0 && excludeTimelens) {
            const tlExes = options
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

    const fade = localStorage.getItem("timelens-widget-fade-on-blur");
    setFadeOnBlur(fade !== "0");
  }, []);

  const setShortcut = (key: keyof ShortcutSettings, value: string) => {
    setShortcutState((prev) => ({ ...prev, [key]: value }));
  };

  const filteredExecutables = executableOptions.filter((x) => {
    const q = excludeQuery.trim().toLowerCase();
    if (!q) return true;
    return x.app_name.toLowerCase().includes(q) || x.exe_path.toLowerCase().includes(q);
  });

  const toggleIgnoredApp = (exePath: string) => {
    setIgnoredAppsState((prev) =>
      prev.includes(exePath)
        ? prev.filter((p) => p !== exePath)
        : [...prev, exePath]
    );
  };

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
          <input
            value={excludeQuery}
            onChange={(e) => setExcludeQuery(e.target.value)}
            className="ui-field"
            placeholder={t("data.searchExe")}
          />
          <div className="max-h-48 overflow-y-auto rounded-lg border border-surface-border divide-y divide-surface-border">
            {filteredExecutables.map((row) => {
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
            {filteredExecutables.length === 0 && (
              <p className="px-3 py-3 text-xs text-text-muted">{t("data.noExeFound")}</p>
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
          <button
            disabled
            className="text-xs px-3 py-1.5 rounded-lg border border-surface-border
                       text-text-muted cursor-not-allowed opacity-50"
          >
            {t("data.exportCsv")} ({t("data.comingSoon")})
          </button>
        </Row>
      </Section>

      {/* About */}
      <Section icon={Info} title={t("about.title")}>
        <Row label={t("about.version")}>
          <span className="text-xs font-mono text-text-secondary">v0.3.0</span>
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
