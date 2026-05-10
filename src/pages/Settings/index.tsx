import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "@/stores/settingsStore";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { Moon, Sun, Activity, Database, Info, Rocket, Keyboard, PanelsTopLeft, ArrowLeft, Search } from "lucide-react";
import clsx from "clsx";
import * as api from "@/services/tauriApi";
import { APP_VERSION } from "../../version";
import type {
  BackupPreview,
  DataHealthSummary,
  ExecutableOption,
  InstallChannelInfo,
  RepairAssistantResult,
  RetentionPolicyInfo,
  ShortcutSettings,
  TrackingTransparencyReport,
} from "@/types";
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
  const { t } = useTranslation(["settings", "common"]);
  const importJsonInputRef = useRef<HTMLInputElement | null>(null);
  const [launchAtStartup, setLaunchAtStartup] = useState(false);
  const [silentStartup, setSilentStartup] = useState(true);
  const [autoOpenWidgets, setAutoOpenWidgets] = useState(true);
  const [fadeOnBlur, setFadeOnBlur] = useState(true);
  const [installChannelInfo, setInstallChannelInfo] = useState<InstallChannelInfo | null>(null);
  const [dataHealth, setDataHealth] = useState<DataHealthSummary | null>(null);
  const [repairPreview, setRepairPreview] = useState<RepairAssistantResult | null>(null);
  const [backupPreview, setBackupPreview] = useState<BackupPreview | null>(null);
  const [backupPackagePath, setBackupPackagePath] = useState<string | null>(null);
  const [backupStrategy, setBackupStrategy] = useState<"overwrite" | "merge">("overwrite");
  const [retentionInfo, setRetentionInfo] = useState<RetentionPolicyInfo | null>(null);
  const [trackingTransparency, setTrackingTransparency] = useState<TrackingTransparencyReport | null>(null);
  const [repairing, setRepairing] = useState(false);
  const [repairError, setRepairError] = useState<string | null>(null);
  const [settingSearch, setSettingSearch] = useState("");
  const [activeSection, setActiveSection] = useState<
    | "general"
    | "appearance"
    | "tracking"
    | "startup"
    | "widgets"
    | "shortcuts"
    | "data"
    | "dataHealth"
    | "backup"
    | "retention"
    | "transparency"
    | "about"
    | null
  >(null);
  const [executableOptions, setExecutableOptions] = useState<ExecutableOption[]>([]);
  const [ignoredApps, setIgnoredAppsState] = useState<string[]>([]);
  const [excludePickerValue, setExcludePickerValue] = useState("");
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
        setShortcutState(s.shortcuts);
      })
      .catch(() => {});

    api.getInstallChannelInfo()
      .then(setInstallChannelInfo)
      .catch(() => {});

    api.getDataHealthSummary()
      .then(setDataHealth)
      .catch(() => {});

    api.getRetentionPolicyInfo()
      .then(setRetentionInfo)
      .catch(() => {});

    api.getTrackingTransparency()
      .then(setTrackingTransparency)
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

  const refreshReliabilityPanels = async () => {
    try {
      const [health, retention, transparency] = await Promise.all([
        api.getDataHealthSummary(),
        api.getRetentionPolicyInfo(),
        api.getTrackingTransparency(),
      ]);
      setDataHealth(health);
      setRetentionInfo(retention);
      setTrackingTransparency(transparency);
    } catch {
      // keep silent to preserve current settings behavior
    }
  };

  const previewRepairAssistant = async () => {
    setRepairError(null);
    try {
      const preview = await api.repairDataIssues(true);
      setRepairPreview(preview);
    } catch (error) {
      setRepairError(error instanceof Error ? error.message : t("dataHealth.repairFailed"));
    }
  };

  const applyRepairAssistant = async () => {
    setRepairing(true);
    setRepairError(null);
    try {
      const result = await Promise.race([
        api.repairDataIssues(false),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(t("dataHealth.repairTimeout"))), 30000);
        }),
      ]);
      setRepairPreview(result);
      await refreshReliabilityPanels();
    } catch (error) {
      setRepairError(error instanceof Error ? error.message : t("dataHealth.repairFailed"));
    } finally {
      setRepairing(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  };

  const openBackupPackage = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    try {
      const selected = await open({
        multiple: false,
        title: t("backup.openTitle"),
        filters: [{ name: t("backup.filterName"), extensions: ["timelens-backup", "timelensbackup", "zip"] }],
      });
      return typeof selected === "string" ? selected : null;
    } catch {
      const selected = await open({ multiple: false, title: t("backup.openTitle") });
      return typeof selected === "string" ? selected : null;
    }
  };

  const saveBackupPackage = async () => {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    try {
      return save({
        defaultPath: `timelens-backup-${stamp}.timelens-backup`,
        title: t("backup.saveTitle"),
        filters: [{ name: t("backup.filterName"), extensions: ["timelens-backup", "timelensbackup", "zip"] }],
      });
    } catch {
      return save({
        defaultPath: `timelens-backup-${stamp}.timelens-backup`,
        title: t("backup.saveTitle"),
      });
    }
  };

  const validateBackupPackage = async () => {
    const path = await openBackupPackage();
    if (!path) return;
    setBackupPackagePath(path);
    const preview = await api.importBackupV2Validate(path);
    setBackupPreview(preview);
  };

  const applyBackupPackage = async () => {
    const path = backupPackagePath ?? await openBackupPackage();
    if (!path) return;
    setBackupPackagePath(path);
    const result = await api.importBackupV2Apply(path, backupStrategy);
    setBackupPreview({
      manifest: result.manifest,
      compatible: true,
      supported_strategies: ["overwrite", "merge"],
      warnings: result.warnings,
    });
    await refreshReliabilityPanels();
  };

  const exportBackupPackage = async () => {
    const path = await saveBackupPackage();
    if (!path) return;
    const manifest = await api.exportBackupV2(path);
    setBackupPackagePath(path);
    setBackupPreview({
      manifest,
      compatible: true,
      supported_strategies: ["overwrite", "merge"],
      warnings: [],
    });
    await refreshReliabilityPanels();
  };

  const runRetentionArchive = async () => {
    await api.runLocalArchiveNow();
    await refreshReliabilityPanels();
  };

  const showWindowsStartupSettings = installChannelInfo?.platform === "windows";
  const sectionCards: Array<{
    key: NonNullable<typeof activeSection>;
    title: string;
    icon: React.ElementType;
    keywords: string[];
  }> = [
    { key: "general", title: t("general"), icon: Sun, keywords: [t("language")] },
    { key: "appearance", title: t("appearance"), icon: Moon, keywords: [t("theme.label")] },
    { key: "tracking", title: t("tracking.title"), icon: Activity, keywords: [t("tracking.active"), t("tracking.samplingInterval"), t("tracking.idleTimePolicy")] },
    { key: "startup", title: t("startup.title"), icon: Rocket, keywords: [t("startup.launchAtStartup"), t("startup.silentStartup"), t("startup.autoOpenWidgets")] },
    { key: "widgets", title: t("widgets.title"), icon: PanelsTopLeft, keywords: [t("widgets.fadeOnBlur")] },
    { key: "shortcuts", title: t("shortcuts.title"), icon: Keyboard, keywords: [t("shortcuts.openWidgetCenter"), t("shortcuts.toggleWidgetVisibility")] },
    { key: "data", title: t("data.title"), icon: Database, keywords: [t("data.excludeApps")] },
    { key: "dataHealth", title: t("dataHealth.title"), icon: Database, keywords: [t("dataHealth.integrity"), t("dataHealth.applyRepair")] },
    { key: "backup", title: t("backup.title"), icon: Database, keywords: [t("backup.exportAction"), t("backup.applyAction")] },
    { key: "retention", title: t("retention.title"), icon: Rocket, keywords: [t("retention.current"), t("retention.runNow")] },
    { key: "transparency", title: t("transparency.title"), icon: Info, keywords: [t("transparency.active"), t("transparency.fields")] },
    { key: "about", title: t("about.title"), icon: Info, keywords: [t("about.version"), "github"] },
  ];
  const settingSearchLower = settingSearch.trim().toLowerCase();
  const filteredSectionCards = sectionCards.filter((section) => {
    if (!settingSearchLower) return true;
    const haystacks = [section.title, ...section.keywords].map((item) => item.toLowerCase());
    return haystacks.some((item) => item.includes(settingSearchLower));
  });

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-text-primary">{t("title")}</h1>
        <p className="text-text-muted text-xs mt-0.5">
          {activeSection ? t("subtitle") : t("subtitle")}
        </p>
      </div>

      {!activeSection && (
        <>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
          <input
            type="text"
            value={settingSearch}
            onChange={(e) => setSettingSearch(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="w-full pl-8 pr-3 py-2 bg-surface-hover border border-surface-border rounded-xl text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue transition-colors"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredSectionCards.map(({ key, title, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveSection(key)}
              className="glass-card p-4 text-left border border-surface-border hover:border-accent-blue/40 hover:bg-surface-hover transition-colors"
            >
              <div className="flex items-center gap-2 text-text-primary">
                <Icon size={15} className="text-accent-blue" />
                <span className="text-sm font-medium">{title}</span>
              </div>
            </button>
          ))}
        </div>
        {filteredSectionCards.length === 0 && (
          <p className="text-xs text-text-muted text-center">{t("searchNoResult")}</p>
        )}
        </>
      )}

      {activeSection && (
        <button
          onClick={() => setActiveSection(null)}
          className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-surface-border text-text-secondary hover:bg-surface-hover transition-colors"
        >
          <ArrowLeft size={13} />
          {t("common:previous")}
        </button>
      )}

      {/* General */}
      {activeSection === "general" && (
      <Section icon={Sun} title={t("general")}>
        <Row label={t("language")}>
          <LanguageSwitcher />
        </Row>
      </Section>
      )}

      {/* Appearance */}
      {activeSection === "appearance" && (
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
      )}

      {/* Tracking */}
      {activeSection === "tracking" && (
      <Section icon={Activity} title={t("tracking.title")}>
        <Row label={t("tracking.active")}>
          <button
            onClick={async () => {
              await setMonitoringActive(!monitoringActive);
              await refreshReliabilityPanels();
            }}
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
      )}

  {/* Startup */}
      {activeSection === "startup" && (
      <Section icon={Rocket} title={t("startup.title")}>
        {showWindowsStartupSettings && (
          <>
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
          </>
        )}
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
        {showWindowsStartupSettings && (
          <p className="text-xs text-text-muted text-right">{t("startup.silentHint")}</p>
        )}
      </Section>
      )}

      {/* Widgets */}
      {activeSection === "widgets" && (
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
      )}

      {/* Shortcuts */}
      {activeSection === "shortcuts" && (
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
      )}

      {/* Data */}
      {activeSection === "data" && (
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
      </Section>
      )}

      {activeSection === "dataHealth" && (
      <Section icon={Database} title={t("dataHealth.title")}>
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-surface-border bg-surface-hover/40 p-3">
            <div className="text-[11px] text-text-muted">{t("dataHealth.integrity")}</div>
            <div className={clsx("text-sm font-semibold", dataHealth?.integrity_ok ? "text-accent-green" : "text-red-400")}>{dataHealth?.integrity_ok ? t("dataHealth.ok") : t("dataHealth.fail")}</div>
          </div>
          <div className="rounded-lg border border-surface-border bg-surface-hover/40 p-3">
            <div className="text-[11px] text-text-muted">{t("dataHealth.indexes")}</div>
            <div className={clsx("text-sm font-semibold", dataHealth?.index_ok ? "text-accent-green" : "text-yellow-400")}>{dataHealth?.index_ok ? t("dataHealth.ok") : t("dataHealth.warn")}</div>
          </div>
          <div className="rounded-lg border border-surface-border bg-surface-hover/40 p-3">
            <div className="text-[11px] text-text-muted">{t("dataHealth.timeline")}</div>
            <div className="text-sm font-semibold text-text-primary">{(dataHealth?.missing_days?.length ?? 0) + (dataHealth?.zero_usage_days?.length ?? 0)}</div>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-3 text-xs text-text-muted">
          <div className="rounded-lg border border-surface-border px-3 py-2">{t("dataHealth.schema", { version: dataHealth?.schema_version ?? t("backup.none") })}</div>
          <div className="rounded-lg border border-surface-border px-3 py-2">{t("dataHealth.appRows", { count: dataHealth?.app_usage_rows ?? 0 })}</div>
          <div className="rounded-lg border border-surface-border px-3 py-2">{t("dataHealth.archiveRows", { count: dataHealth?.archive_rows ?? 0 })}</div>
        </div>
        <div className="space-y-2">
          {(dataHealth?.issues ?? []).map((issue) => (
            <div key={issue.code} className="rounded-lg border border-surface-border bg-surface-hover/40 px-3 py-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-text-primary font-medium">{issue.title}</span>
                <span className={clsx("px-2 py-0.5 rounded-full border", issue.severity === "error" ? "border-red-400/40 text-red-300" : issue.severity === "warning" ? "border-yellow-400/40 text-yellow-300" : "border-accent-blue/40 text-accent-blue")}>{issue.severity}</span>
              </div>
              <p className="text-text-muted mt-1">{issue.detail}{issue.count ? ` (${issue.count})` : ""}</p>
            </div>
          ))}
          {(dataHealth?.issues ?? []).length === 0 && (
            <p className="text-xs text-text-muted">{t("dataHealth.noIssues")}</p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={previewRepairAssistant}
            className="text-xs px-3 py-1.5 rounded-lg border border-surface-border text-text-secondary hover:bg-surface-hover transition-colors"
          >
            {t("dataHealth.previewRepair")}
          </button>
          <button
            onClick={applyRepairAssistant}
            disabled={repairing}
            className="text-xs px-3 py-1.5 rounded-lg border border-accent-blue/50 text-accent-blue hover:bg-accent-blue/10 transition-colors"
          >
            {repairing ? t("dataHealth.repairing") : t("dataHealth.applyRepair")}
          </button>
        </div>
        {repairError && (
          <div className="rounded-lg border border-red-400/40 bg-red-500/10 p-3 text-xs text-red-200">
            {repairError}
          </div>
        )}
        {repairPreview && (
          <div className="rounded-lg border border-surface-border bg-surface-hover/40 p-3 text-xs text-text-muted space-y-1">
            <p>{t("dataHealth.repairRows", { count: repairPreview.rebuilt_daily_rows })}</p>
            {repairPreview.actions.map((action) => (
              <p key={action.code}>{action.description}</p>
            ))}
          </div>
        )}
        <div className="flex justify-end">
          <button
            onClick={refreshReliabilityPanels}
            className="text-xs px-3 py-1.5 rounded-lg border border-accent-blue/50 text-accent-blue hover:bg-accent-blue/10 transition-colors"
          >
            {t("dataHealth.refresh")}
          </button>
        </div>
      </Section>
      )}

      {activeSection === "backup" && (
      <Section icon={Database} title={t("backup.title")}>
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

        <Row label={t("backup.export")}> 
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <button
              onClick={exportBackupPackage}
              className="text-xs px-3 py-1.5 rounded-lg border border-accent-blue/50 text-accent-blue hover:bg-accent-blue/10 transition-colors"
            >
              {t("backup.exportAction")}
            </button>
            <button
              onClick={validateBackupPackage}
              className="text-xs px-3 py-1.5 rounded-lg border border-surface-border text-text-secondary hover:bg-surface-hover transition-colors"
            >
              {t("backup.validateAction")}
            </button>
          </div>
        </Row>
        <Row label={t("backup.restoreMode")}>
          <div className="flex gap-2 flex-wrap justify-end">
            {(["overwrite", "merge"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setBackupStrategy(mode)}
                className={clsx(
                  "px-3 py-1.5 rounded-lg text-xs border transition-colors",
                  backupStrategy === mode
                    ? "border-accent-blue bg-accent-blue/15 text-accent-blue"
                    : "border-surface-border text-text-muted hover:text-text-secondary"
                )}
              >
                {t(`backup.${mode}`)}
              </button>
            ))}
            <button
              onClick={applyBackupPackage}
              className="text-xs px-3 py-1.5 rounded-lg border border-accent-blue/50 text-accent-blue hover:bg-accent-blue/10 transition-colors"
            >
              {t("backup.applyAction")}
            </button>
          </div>
        </Row>
        <div className="rounded-lg border border-surface-border bg-surface-hover/40 p-3 space-y-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-text-secondary">{t("backup.currentPath")}</span>
            <span className="text-text-primary truncate max-w-80">{backupPackagePath || t("backup.none")}</span>
          </div>
          {backupPreview && (
            <div className="space-y-1 text-text-muted">
              <p>{t("backup.previewVersion", { version: backupPreview.manifest.version, appVersion: backupPreview.manifest.app_version })}</p>
              <p>{t("backup.previewSchema", { schema: backupPreview.manifest.schema_version })}</p>
              <p>{t("backup.previewCounts", { appUsage: backupPreview.manifest.counts.app_usage, todos: backupPreview.manifest.counts.todos, widgets: backupPreview.manifest.counts.widget_configs })}</p>
              <p>{t("backup.previewChecksum", { checksum: backupPreview.manifest.checksum.slice(0, 12) })}</p>
              {backupPreview.warnings.length > 0 && (
                <div className="space-y-1">
                  {backupPreview.warnings.map((warning) => (
                    <p key={warning} className="text-yellow-300">{warning}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </Section>
      )}

      {activeSection === "retention" && (
      <Section icon={Rocket} title={t("retention.title")}>
        <Row label={t("retention.current")}> 
          <div className="flex gap-2 flex-wrap justify-end">
            {(["keep_all", "3m", "6m", "12m"] as const).map((policy) => (
              <button
                key={policy}
                onClick={async () => {
                  await api.setRetentionPolicy(policy);
                  await refreshReliabilityPanels();
                }}
                className={clsx(
                  "px-3 py-1.5 rounded-lg text-xs border transition-colors",
                  retentionInfo?.policy === policy
                    ? "border-accent-blue bg-accent-blue/15 text-accent-blue"
                    : "border-surface-border text-text-muted hover:text-text-secondary"
                )}
              >
                {t(`retention.${policy}`)}
              </button>
            ))}
          </div>
        </Row>
        <div className="rounded-lg border border-surface-border bg-surface-hover/40 p-3 text-xs text-text-muted space-y-1">
          <p>{t("retention.preview", { label: retentionInfo?.label ?? t("backup.none") })}</p>
          <p>{t("retention.cutoff", { date: retentionInfo?.cutoff_date ?? t("backup.none") })}</p>
          <p>{t("retention.impact", { rows: retentionInfo?.estimated_rows ?? 0, size: formatBytes(retentionInfo?.estimated_storage_bytes ?? 0) })}</p>
        </div>
        <div className="flex justify-end">
          <button
            onClick={runRetentionArchive}
            className="text-xs px-3 py-1.5 rounded-lg border border-accent-blue/50 text-accent-blue hover:bg-accent-blue/10 transition-colors"
          >
            {t("retention.runNow")}
          </button>
        </div>
      </Section>
      )}

      {activeSection === "transparency" && (
      <Section icon={Info} title={t("transparency.title")}>
        <Row label={t("transparency.active")}>
          <button
            onClick={async () => {
              await setMonitoringActive(!monitoringActive);
              await refreshReliabilityPanels();
            }}
            title={t("transparency.active")}
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
        <div className="rounded-lg border border-surface-border bg-surface-hover/40 p-3 text-xs text-text-muted space-y-1">
          <p>{t("transparency.pausedAt", { value: trackingTransparency?.paused_at ?? t("backup.none") })}</p>
          <p>{t("transparency.pausedBy", { value: trackingTransparency?.paused_by ?? t("backup.none") })}</p>
          <p>{t("transparency.pauseReason", { value: trackingTransparency?.pause_reason ?? t("backup.none") })}</p>
          <p>{t("transparency.writeFrequency", { day: trackingTransparency?.writes_last_24h ?? 0, week: trackingTransparency?.writes_last_7d ?? 0 })}</p>
        </div>
        <div className="space-y-2">
          <div className="text-xs text-text-secondary">{t("transparency.fields")}</div>
          <div className="flex flex-wrap gap-2">
            {(trackingTransparency?.tracked_fields ?? []).map((field) => (
              <span key={field.field} className="px-2 py-1 rounded-full bg-surface-hover text-[11px] text-text-secondary border border-surface-border" title={field.description}>
                {field.field}
              </span>
            ))}
          </div>
        </div>
        <div className="space-y-2 max-h-56 overflow-y-auto">
          {(trackingTransparency?.recent_writes ?? []).map((entry, index) => (
            <div key={`${entry.first_seen_at}-${entry.exe_path}-${index}`} className="rounded-lg border border-surface-border px-3 py-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-text-primary truncate">{entry.app_name}</span>
                <span className="text-text-muted">{entry.active_seconds}s</span>
              </div>
              <div className="text-text-muted truncate">{entry.exe_path || entry.window_title || entry.date}</div>
            </div>
          ))}
          {(trackingTransparency?.recent_writes ?? []).length === 0 && (
            <p className="text-xs text-text-muted">{t("transparency.noWrites")}</p>
          )}
        </div>
      </Section>
      )}

      {/* About */}
      {activeSection === "about" && (
      <Section icon={Info} title={t("about.title")}>
        <Row label={t("about.version")}>
          <span className="text-xs font-mono text-text-secondary">v{APP_VERSION}</span>
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
      )}
    </div>
  );
}
