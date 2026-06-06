import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "@/stores/settingsStore";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { Moon, Sun, Activity, Database, Info, Rocket, Keyboard, PanelsTopLeft, ArrowLeft, Search, Lock, Copy, RotateCw } from "lucide-react";
import clsx from "clsx";
import * as api from "@/services/tauriApi";
import { APP_VERSION } from "../../version";
import type {
  ApiAuditLogEntry,
  ApiTokenMetadata,
  BackupPreview,
  DataHealthSummary,
  ExecutableOption,
  InstallChannelInfo,
  LocalApiSecuritySettings,
  RepairAssistantResult,
  RetentionPolicyInfo,
  RetentionRunResult,
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
  const [repairRunMode, setRepairRunMode] = useState<"preview" | "apply" | null>(null);
  const [settingSearch, setSettingSearch] = useState("");
  const [activeSection, setActiveSection] = useState<
    | "general"
    | "appearance"
    | "trayIcon"
    | "privacyCenter"
    | "tracking"
    | "startup"
    | "widgets"
    | "shortcuts"
    | "data"
    | "dataHealth"
    | "backup"
    | "retention"
    | "transparency"
    | "extensionBridge"
    | "about"
    | null
  >(null);
  const [executableOptions, setExecutableOptions] = useState<ExecutableOption[]>([]);
  const [ignoredApps, setIgnoredAppsState] = useState<string[]>([]);
  const [excludePickerValue, setExcludePickerValue] = useState("");
  const [extensionBridgeKey, setExtensionBridgeKey] = useState<string>("");
  const [extensionBridgeLoading, setExtensionBridgeLoading] = useState(false);
  const [extensionBridgeKeyRotatedAt, setExtensionBridgeKeyRotatedAt] = useState<string>("");
  const [localApiSecurity, setLocalApiSecurity] = useState<LocalApiSecuritySettings>({
    token_required: false,
    allowlist_enforced: false,
    rate_limit_per_min: 240,
  });
  const [apiAllowlistText, setApiAllowlistText] = useState("");
  const [apiTokens, setApiTokens] = useState<ApiTokenMetadata[]>([]);
  const [apiAuditLogs, setApiAuditLogs] = useState<ApiAuditLogEntry[]>([]);
  const [newTokenLabel, setNewTokenLabel] = useState("vscode-local-client");
  const [newTokenScopes, setNewTokenScopes] = useState("session:write,usage:read");
  const [lastIssuedToken, setLastIssuedToken] = useState<string | null>(null);
  const [apiGovernanceBusy, setApiGovernanceBusy] = useState<
    null | "issue" | "refresh" | "allowlist" | "settings"
  >(null);
  const [apiGovernanceMessage, setApiGovernanceMessage] = useState<string | null>(null);
  const [trayIconStyle, setTrayIconStyleState] = useState<"auto" | "color" | "black" | "white">("auto");
  const [backupBusy, setBackupBusy] = useState<"export" | "validate" | "apply" | "import" | null>(null);
  const [backupMessage, setBackupMessage] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);
  const [retentionRunning, setRetentionRunning] = useState(false);
  const [retentionRunResult, setRetentionRunResult] = useState<RetentionRunResult | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateCheckResult, setUpdateCheckResult] = useState<{ status: "upToDate" | "available" | "error"; version?: string; url?: string; message?: string } | null>(null);
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
    notificationQuietHoursEnabled,
    notificationQuietStart,
    notificationQuietEnd,
    notificationCooldownMin,
    setNotificationQuietHoursEnabled,
    setNotificationQuietStart,
    setNotificationQuietEnd,
    setNotificationCooldownMin,
    autoCheckUpdates,
    setAutoCheckUpdates,
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

    api.getExtensionBridgeKey()
      .then(setExtensionBridgeKey)
      .catch(() => {});

    api.getLocalApiSecuritySettings()
      .then(setLocalApiSecurity)
      .catch(() => {});

    api.getApiClientAllowlist()
      .then((list) => setApiAllowlistText(list.join("\n")))
      .catch(() => {});

    api.listApiTokens()
      .then(setApiTokens)
      .catch(() => {});

    api.getApiAuditLog(40, 0)
      .then(setApiAuditLogs)
      .catch(() => {});

    api.getTrayIconStyle()
      .then((s) => setTrayIconStyleState(s as "auto" | "color" | "black" | "white"))
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

  const compareVersions = (a: string, b: string) => {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < 3; i += 1) {
      const na = pa[i] ?? 0;
      const nb = pb[i] ?? 0;
      if (na > nb) return 1;
      if (na < nb) return -1;
    }
    return 0;
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

  const refreshApiGovernancePanels = async () => {
    setApiGovernanceBusy("refresh");
    try {
      const [settings, allowlist, tokens, logs] = await Promise.all([
        api.getLocalApiSecuritySettings(),
        api.getApiClientAllowlist(),
        api.listApiTokens(),
        api.getApiAuditLog(40, 0),
      ]);
      setLocalApiSecurity(settings);
      setApiAllowlistText(allowlist.join("\n"));
      setApiTokens(tokens);
      setApiAuditLogs(logs);
      setApiGovernanceMessage(t("apiSecurity.msgRefreshed"));
    } catch (error) {
      setApiGovernanceMessage(error instanceof Error ? error.message : t("apiSecurity.msgRefreshFailed"));
    } finally {
      setApiGovernanceBusy(null);
    }
  };

  const saveApiSecuritySettings = async (patch: Partial<LocalApiSecuritySettings>) => {
    setApiGovernanceBusy("settings");
    setApiGovernanceMessage(null);
    try {
      await api.setLocalApiSecuritySettings(patch);
      const next = { ...localApiSecurity, ...patch };
      setLocalApiSecurity(next);
      setApiGovernanceMessage(t("apiSecurity.msgSettingsUpdated"));
    } catch (error) {
      setApiGovernanceMessage(error instanceof Error ? error.message : t("apiSecurity.msgSettingsFailed"));
    } finally {
      setApiGovernanceBusy(null);
    }
  };

  const issueScopedToken = async () => {
    setApiGovernanceBusy("issue");
    setApiGovernanceMessage(null);
    try {
      const scopes = newTokenScopes
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const issued = await api.issueApiToken(newTokenLabel.trim(), scopes);
      setLastIssuedToken(issued.token);
      const tokens = await api.listApiTokens();
      setApiTokens(tokens);
      setApiGovernanceMessage(t("apiSecurity.msgTokenIssued"));
    } catch (error) {
      setApiGovernanceMessage(error instanceof Error ? error.message : t("apiSecurity.msgTokenIssueFailed"));
    } finally {
      setApiGovernanceBusy(null);
    }
  };

  const persistAllowlist = async () => {
    setApiGovernanceBusy("allowlist");
    setApiGovernanceMessage(null);
    try {
      const list = apiAllowlistText
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      await api.setApiClientAllowlist(list);
      setApiGovernanceMessage(t("apiSecurity.msgAllowlistSaved", { count: list.length }));
    } catch (error) {
      setApiGovernanceMessage(error instanceof Error ? error.message : t("apiSecurity.msgAllowlistFailed"));
    } finally {
      setApiGovernanceBusy(null);
    }
  };

  const previewRepairAssistant = async () => {
    setRepairError(null);
    try {
      const preview = await api.repairDataIssues(true);
      setRepairPreview(preview);
      setRepairRunMode("preview");
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
      setRepairRunMode("apply");
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
    setBackupBusy("validate");
    setBackupMessage(null);
    try {
      setBackupPackagePath(path);
      const preview = await api.importBackupV2Validate(path);
      setBackupPreview(preview);
      setBackupMessage({ type: "info", text: t("backup.validated") });
    } catch (error) {
      setBackupMessage({
        type: "error",
        text: error instanceof Error ? error.message : t("backup.failed"),
      });
    } finally {
      setBackupBusy(null);
    }
  };

  const applyBackupPackage = async () => {
    const path = backupPackagePath ?? await openBackupPackage();
    if (!path) return;
    setBackupBusy("apply");
    setBackupMessage(null);
    try {
      setBackupPackagePath(path);
      const result = await api.importBackupV2Apply(path, backupStrategy);
      setBackupPreview({
        manifest: result.manifest,
        compatible: true,
        supported_strategies: ["overwrite", "merge"],
        warnings: result.warnings,
      });
      setBackupMessage({
        type: "success",
        text: t("backup.applySuccess", { count: result.imported_rows }),
      });
      await refreshReliabilityPanels();
    } catch (error) {
      setBackupMessage({
        type: "error",
        text: error instanceof Error ? error.message : t("backup.failed"),
      });
    } finally {
      setBackupBusy(null);
    }
  };

  const importAndApplyBackupPackage = async () => {
    const path = await openBackupPackage();
    if (!path) return;
    setBackupPackagePath(path);
    setBackupBusy("import");
    setBackupMessage(null);
    try {
      const preview = await api.importBackupV2Validate(path);
      setBackupPreview(preview);
      const result = await api.importBackupV2Apply(path, backupStrategy);
      setBackupPreview({
        manifest: result.manifest,
        compatible: true,
        supported_strategies: ["overwrite", "merge"],
        warnings: result.warnings,
      });
      setBackupMessage({
        type: "success",
        text: t("backup.applySuccess", { count: result.imported_rows }),
      });
      await refreshReliabilityPanels();
    } catch (error) {
      setBackupMessage({
        type: "error",
        text: error instanceof Error ? error.message : t("backup.failed"),
      });
    } finally {
      setBackupBusy(null);
    }
  };

  const exportBackupPackage = async () => {
    const path = await saveBackupPackage();
    if (!path) return;
    setBackupBusy("export");
    setBackupMessage(null);
    try {
      const manifest = await api.exportBackupV2(path);
      setBackupPackagePath(path);
      setBackupPreview({
        manifest,
        compatible: true,
        supported_strategies: ["overwrite", "merge"],
        warnings: [],
      });
      setBackupMessage({ type: "success", text: t("backup.exportSuccess") });
      await refreshReliabilityPanels();
    } catch (error) {
      setBackupMessage({
        type: "error",
        text: error instanceof Error ? error.message : t("backup.failed"),
      });
    } finally {
      setBackupBusy(null);
    }
  };

  const runRetentionArchive = async () => {
    setRetentionRunning(true);
    try {
      const result = await api.runLocalArchiveNow();
      setRetentionRunResult(result);
      await refreshReliabilityPanels();
    } finally {
      setRetentionRunning(false);
    }
  };

  const checkForUpdatesNow = async () => {
    setCheckingUpdate(true);
    setUpdateCheckResult(null);
    try {
      const res = await fetch("https://api.github.com/repos/PythonSmall-Q/TimeLens/releases/latest");
      if (!res.ok) {
        throw new Error(`GitHub API: ${res.status}`);
      }
      const data = (await res.json()) as { tag_name?: string; html_url?: string };
      const latest = (data.tag_name ?? "").replace(/^v/, "");
      if (latest && compareVersions(latest, APP_VERSION) > 0) {
        setUpdateCheckResult({ status: "available", version: latest, url: data.html_url });
      } else {
        setUpdateCheckResult({ status: "upToDate" });
      }
    } catch (error) {
      setUpdateCheckResult({
        status: "error",
        message: error instanceof Error ? error.message : t("about.checkFailed"),
      });
    } finally {
      setCheckingUpdate(false);
    }
  };

  const showWindowsStartupSettings = installChannelInfo?.platform === "windows";
  const showStartupSettings =
    installChannelInfo?.platform === "windows" || installChannelInfo?.platform === "macos";
  const activeApiTokenCount = apiTokens.filter((token) => !token.revoked_at).length;
  const sectionCards: Array<{
    key: NonNullable<typeof activeSection>;
    title: string;
    icon: React.ElementType;
    keywords: string[];
  }> = [
    { key: "general", title: t("general"), icon: Sun, keywords: [t("language")] },
    { key: "appearance", title: t("appearance"), icon: Moon, keywords: [t("theme.label")] },
    { key: "trayIcon", title: t("trayIconStyle.label"), icon: PanelsTopLeft, keywords: [t("trayIconStyle.auto"), t("trayIconStyle.color"), t("trayIconStyle.black"), t("trayIconStyle.white")] },
    { key: "privacyCenter", title: t("privacyCenter.title"), icon: Lock, keywords: [t("privacyCenter.subtitle"), t("apiSecurity.title"), t("backup.title"), t("transparency.title")] },
    { key: "tracking", title: t("tracking.title"), icon: Activity, keywords: [t("tracking.active"), t("tracking.samplingInterval"), t("tracking.idleTimePolicy")] },
    { key: "startup", title: t("startup.title"), icon: Rocket, keywords: [t("startup.launchAtStartup"), t("startup.silentStartup"), t("startup.autoOpenWidgets")] },
    { key: "widgets", title: t("widgets.title"), icon: PanelsTopLeft, keywords: [t("widgets.fadeOnBlur")] },
    { key: "shortcuts", title: t("shortcuts.title"), icon: Keyboard, keywords: [t("shortcuts.openWidgetCenter"), t("shortcuts.toggleWidgetVisibility")] },
    { key: "data", title: t("data.title"), icon: Database, keywords: [t("data.excludeApps")] },
    { key: "dataHealth", title: t("dataHealth.title"), icon: Database, keywords: [t("dataHealth.integrity"), t("dataHealth.applyRepair")] },
    { key: "backup", title: t("backup.title"), icon: Database, keywords: [t("backup.exportAction"), t("backup.applyAction")] },
    { key: "retention", title: t("retention.title"), icon: Rocket, keywords: [t("retention.current"), t("retention.runNow")] },
    { key: "transparency", title: t("transparency.title"), icon: Info, keywords: [t("transparency.active"), t("transparency.fields")] },
    { key: "extensionBridge", title: t("extensionBridge.title"), icon: Lock, keywords: [t("extensionBridge.key"), "bridge", "extension"] },
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

      {/* Tray Icon */}
      {activeSection === "trayIcon" && (
      <Section icon={PanelsTopLeft} title={t("trayIconStyle.label")}>
        <Row label={t("trayIconStyle.label")}>
          <div className="flex gap-2">
            {(["auto", "color", "black", "white"] as const).map((style) => (
              <button
                key={style}
                onClick={async () => {
                  const prev = trayIconStyle;
                  setTrayIconStyleState(style);
                  await api.setTrayIconStyle(style).catch(() => setTrayIconStyleState(prev));
                }}
                className={clsx(
                  "px-3 py-1.5 rounded-lg text-xs border transition-colors",
                  trayIconStyle === style
                    ? "border-accent-blue bg-accent-blue/15 text-accent-blue"
                    : "border-surface-border text-text-muted hover:text-text-secondary"
                )}
              >
                {t(`trayIconStyle.${style}`)}
              </button>
            ))}
          </div>
        </Row>
      </Section>
      )}

      {/* Tracking */}
      {activeSection === "privacyCenter" && (
      <Section icon={Lock} title={t("privacyCenter.title")}>
        <p className="text-xs text-text-muted">{t("privacyCenter.subtitle")}</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-lg border border-surface-border bg-surface-hover/40 p-3">
            <p className="text-[11px] text-text-muted">{t("privacyCenter.localOnlyLabel")}</p>
            <p className="text-sm font-semibold text-accent-green">{t("privacyCenter.localOnlyValue")}</p>
          </div>
          <div className="rounded-lg border border-surface-border bg-surface-hover/40 p-3">
            <p className="text-[11px] text-text-muted">{t("privacyCenter.monitoringLabel")}</p>
            <p className={clsx("text-sm font-semibold", monitoringActive ? "text-accent-green" : "text-yellow-300")}>
              {monitoringActive ? t("privacyCenter.monitoringOn") : t("privacyCenter.monitoringOff")}
            </p>
          </div>
          <div className="rounded-lg border border-surface-border bg-surface-hover/40 p-3">
            <p className="text-[11px] text-text-muted">{t("privacyCenter.quietHoursLabel")}</p>
            <p className="text-sm font-semibold text-text-primary">
              {notificationQuietHoursEnabled
                ? t("privacyCenter.quietHoursOnRange", { start: notificationQuietStart, end: notificationQuietEnd })
                : t("privacyCenter.quietHoursOff")}
            </p>
          </div>
          <div className="rounded-lg border border-surface-border bg-surface-hover/40 p-3">
            <p className="text-[11px] text-text-muted">{t("privacyCenter.apiTokenLabel")}</p>
            <p className={clsx("text-sm font-semibold", localApiSecurity.token_required ? "text-accent-green" : "text-yellow-300")}>
              {localApiSecurity.token_required ? t("privacyCenter.enabled") : t("privacyCenter.disabled")}
            </p>
          </div>
          <div className="rounded-lg border border-surface-border bg-surface-hover/40 p-3">
            <p className="text-[11px] text-text-muted">{t("privacyCenter.allowlistLabel")}</p>
            <p className={clsx("text-sm font-semibold", localApiSecurity.allowlist_enforced ? "text-accent-green" : "text-yellow-300")}>
              {localApiSecurity.allowlist_enforced ? t("privacyCenter.enabled") : t("privacyCenter.disabled")}
            </p>
          </div>
          <div className="rounded-lg border border-surface-border bg-surface-hover/40 p-3">
            <p className="text-[11px] text-text-muted">{t("privacyCenter.activeTokensLabel")}</p>
            <p className="text-sm font-semibold text-text-primary">{activeApiTokenCount}</p>
          </div>
          <div className="rounded-lg border border-surface-border bg-surface-hover/40 p-3">
            <p className="text-[11px] text-text-muted">{t("privacyCenter.auditLogLabel")}</p>
            <p className="text-sm font-semibold text-text-primary">{apiAuditLogs.length}</p>
          </div>
          <div className="rounded-lg border border-surface-border bg-surface-hover/40 p-3">
            <p className="text-[11px] text-text-muted">{t("privacyCenter.dataHealthLabel")}</p>
            <p className={clsx("text-sm font-semibold", dataHealth?.integrity_ok ? "text-accent-green" : "text-yellow-300")}>
              {dataHealth?.integrity_ok ? t("privacyCenter.healthy") : t("privacyCenter.risk")}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs text-text-secondary">{t("privacyCenter.quickActions")}</p>
          <div className="flex flex-wrap gap-2 justify-end">
            <button
              onClick={() => setActiveSection("tracking")}
              className="text-xs px-3 py-1.5 rounded-lg border border-surface-border text-text-secondary hover:bg-surface-hover transition-colors"
            >
              {t("privacyCenter.openTracking")}
            </button>
            <button
              onClick={() => setActiveSection("extensionBridge")}
              className="text-xs px-3 py-1.5 rounded-lg border border-surface-border text-text-secondary hover:bg-surface-hover transition-colors"
            >
              {t("privacyCenter.openApiSecurity")}
            </button>
            <button
              onClick={() => setActiveSection("backup")}
              className="text-xs px-3 py-1.5 rounded-lg border border-surface-border text-text-secondary hover:bg-surface-hover transition-colors"
            >
              {t("privacyCenter.openBackup")}
            </button>
            <button
              onClick={() => setActiveSection("dataHealth")}
              className="text-xs px-3 py-1.5 rounded-lg border border-surface-border text-text-secondary hover:bg-surface-hover transition-colors"
            >
              {t("privacyCenter.openDataHealth")}
            </button>
            <button
              onClick={() => {
                void refreshReliabilityPanels();
                void refreshApiGovernancePanels();
              }}
              className="text-xs px-3 py-1.5 rounded-lg border border-accent-blue/50 text-accent-blue hover:bg-accent-blue/10 transition-colors"
            >
              {t("privacyCenter.refresh")}
            </button>
          </div>
        </div>
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

        <Row label={t("tracking.quietHoursEnabled")}>
          <button
            onClick={() => setNotificationQuietHoursEnabled(!notificationQuietHoursEnabled)}
            title={t("tracking.quietHoursEnabled")}
            className={clsx(
              "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
              notificationQuietHoursEnabled ? "bg-accent-blue" : "bg-surface-hover"
            )}
          >
            <span
              className={clsx(
                "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
                notificationQuietHoursEnabled ? "translate-x-6" : "translate-x-1"
              )}
            />
          </button>
        </Row>

        {notificationQuietHoursEnabled && (
          <Row label={t("tracking.quietHoursRange")}>
            <div className="flex items-center gap-2">
              <input
                type="time"
                value={notificationQuietStart}
                onChange={(e) => setNotificationQuietStart(e.target.value)}
                className="ui-field !w-28"
              />
              <span className="text-xs text-text-muted">-</span>
              <input
                type="time"
                value={notificationQuietEnd}
                onChange={(e) => setNotificationQuietEnd(e.target.value)}
                className="ui-field !w-28"
              />
            </div>
          </Row>
        )}
        <p className="text-xs text-text-muted text-right">{t("tracking.quietHoursHint")}</p>

        <Row label={t("tracking.notificationCooldown")}>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={120}
              step={5}
              value={notificationCooldownMin}
              onChange={(e) => setNotificationCooldownMin(Number(e.target.value))}
              className="ui-range"
              title={t("tracking.notificationCooldown")}
              aria-label={t("tracking.notificationCooldown")}
            />
            <span className="text-xs text-text-secondary w-16 text-right">
              {notificationCooldownMin}{t("tracking.minuteUnit")}
            </span>
          </div>
        </Row>
        <p className="text-xs text-text-muted text-right">{t("tracking.notificationCooldownHint")}</p>

    </Section>
      )}

  {/* Startup */}
      {activeSection === "startup" && (
      <Section icon={Rocket} title={t("startup.title")}>
        {showStartupSettings && (
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
        {showStartupSettings && (
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
            disabled={repairing}
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
          <div className="rounded-lg border border-surface-border bg-surface-hover/40 p-3 text-xs text-text-muted space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="rounded-md border border-surface-border px-2 py-1.5">
                <p className="text-[11px] text-text-muted">{t("dataHealth.lastAction")}</p>
                <p className="text-text-primary font-medium">{repairRunMode === "apply" ? t("dataHealth.applyRepair") : t("dataHealth.previewRepair")}</p>
              </div>
              <div className="rounded-md border border-surface-border px-2 py-1.5">
                <p className="text-[11px] text-text-muted">{t("dataHealth.repairedRows")}</p>
                <p className="text-text-primary font-medium">{repairPreview.rebuilt_daily_rows}</p>
              </div>
              <div className="rounded-md border border-surface-border px-2 py-1.5">
                <p className="text-[11px] text-text-muted">{t("dataHealth.actionCount")}</p>
                <p className="text-text-primary font-medium">{repairPreview.actions.length}</p>
              </div>
            </div>
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
              disabled={backupBusy !== null}
              className="text-xs px-3 py-1.5 rounded-lg border border-accent-blue/50 text-accent-blue hover:bg-accent-blue/10 transition-colors"
            >
              {backupBusy === "export" ? t("backup.working") : t("backup.exportAction")}
            </button>
            <button
              onClick={validateBackupPackage}
              disabled={backupBusy !== null}
              className="text-xs px-3 py-1.5 rounded-lg border border-surface-border text-text-secondary hover:bg-surface-hover transition-colors"
            >
              {backupBusy === "validate" ? t("backup.working") : t("backup.validateAction")}
            </button>
            <button
              onClick={importAndApplyBackupPackage}
              disabled={backupBusy !== null}
              className="text-xs px-3 py-1.5 rounded-lg border border-accent-blue/50 text-accent-blue hover:bg-accent-blue/10 transition-colors"
            >
              {backupBusy === "import" ? t("backup.working") : t("backup.importRestoreAction")}
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
              disabled={backupBusy !== null}
              className="text-xs px-3 py-1.5 rounded-lg border border-accent-blue/50 text-accent-blue hover:bg-accent-blue/10 transition-colors"
            >
              {backupBusy === "apply" ? t("backup.working") : t("backup.applyAction")}
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
          {backupMessage && (
            <p
              className={clsx(
                "text-xs",
                backupMessage.type === "success" && "text-accent-green",
                backupMessage.type === "error" && "text-red-300",
                backupMessage.type === "info" && "text-accent-blue",
              )}
            >
              {backupMessage.text}
            </p>
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
            disabled={retentionRunning}
            className="text-xs px-3 py-1.5 rounded-lg border border-accent-blue/50 text-accent-blue hover:bg-accent-blue/10 transition-colors"
          >
            {retentionRunning ? t("retention.running") : t("retention.runNow")}
          </button>
        </div>
        {retentionRunResult && (
          <div className="rounded-lg border border-surface-border bg-surface-hover/40 p-3 text-xs text-text-muted space-y-1">
            <p>{t("retention.lastRunPolicy", { policy: retentionRunResult.policy })}</p>
            <p>{t("retention.lastRunAppRows", { count: retentionRunResult.archived_app_usage_rows })}</p>
            <p>{t("retention.lastRunDailyRows", { count: retentionRunResult.archived_daily_rows })}</p>
          </div>
        )}
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

      {/* Extension Bridge */}
      {activeSection === "extensionBridge" && (
      <Section icon={Lock} title={t("extensionBridge.title")}>
        <Row label={t("extensionBridge.key")}>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-text-secondary break-all whitespace-normal">{extensionBridgeKey || t("extensionBridge.none")}</span>
            {extensionBridgeKey && (
              <>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(extensionBridgeKey);
                    window.dispatchEvent(new CustomEvent("timelens-copy-success"));
                  }}
                  className="p-1.5 hover:bg-surface-hover rounded-lg transition-colors"
                  title={t("extensionBridge.copyKey")}
                >
                  <Copy size={13} className="text-accent-blue" />
                </button>
                <button
                  onClick={async () => {
                    setExtensionBridgeLoading(true);
                    try {
                      const newKey = await api.rotateExtensionBridgeKey();
                      setExtensionBridgeKey(newKey);
                      setExtensionBridgeKeyRotatedAt(new Date().toISOString());
                      window.dispatchEvent(new CustomEvent("timelens-key-rotated"));
                    } catch (err) {
                      console.error("Failed to rotate key:", err);
                    } finally {
                      setExtensionBridgeLoading(false);
                    }
                  }}
                  disabled={extensionBridgeLoading}
                  className="p-1.5 hover:bg-surface-hover rounded-lg transition-colors disabled:opacity-50"
                  title={t("extensionBridge.rotateKey")}
                >
                  <RotateCw size={13} className="text-accent-blue" />
                </button>
              </>
            )}
          </div>
        </Row>
        <p className="text-xs text-text-muted text-right">{t("extensionBridge.hint")}</p>
        <div className="rounded-lg border border-surface-border bg-surface-hover/40 p-3 text-xs text-text-muted space-y-1">
          <p>{t("extensionBridge.description")}</p>
          {extensionBridgeKeyRotatedAt && (
            <p>{t("extensionBridge.lastRotated", { time: new Date(extensionBridgeKeyRotatedAt).toLocaleString() })}</p>
          )}
        </div>

        <div className="rounded-lg border border-surface-border bg-surface-hover/40 p-3 space-y-3">
          <div className="text-xs font-semibold text-text-primary">{t("apiSecurity.title")}</div>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="text-xs text-text-secondary rounded-lg border border-surface-border px-3 py-2 flex items-center justify-between">
              <span>{t("apiSecurity.requireToken")}</span>
              <input
                type="checkbox"
                className="ui-checkbox"
                checked={localApiSecurity.token_required}
                onChange={(e) => {
                  const next = e.target.checked;
                  setLocalApiSecurity((prev) => ({ ...prev, token_required: next }));
                  void saveApiSecuritySettings({ token_required: next });
                }}
              />
            </label>
            <label className="text-xs text-text-secondary rounded-lg border border-surface-border px-3 py-2 flex items-center justify-between">
              <span>{t("apiSecurity.enforceAllowlist")}</span>
              <input
                type="checkbox"
                className="ui-checkbox"
                checked={localApiSecurity.allowlist_enforced}
                onChange={(e) => {
                  const next = e.target.checked;
                  setLocalApiSecurity((prev) => ({ ...prev, allowlist_enforced: next }));
                  void saveApiSecuritySettings({ allowlist_enforced: next });
                }}
              />
            </label>
            <label className="text-xs text-text-secondary rounded-lg border border-surface-border px-3 py-2 space-y-1">
              <span className="block">{t("apiSecurity.rateLimitPerMin")}</span>
              <input
                type="number"
                min={10}
                max={10000}
                value={localApiSecurity.rate_limit_per_min}
                onChange={(e) => {
                  const next = Number(e.target.value || "0");
                  setLocalApiSecurity((prev) => ({ ...prev, rate_limit_per_min: next }));
                }}
                onBlur={() => {
                  void saveApiSecuritySettings({ rate_limit_per_min: localApiSecurity.rate_limit_per_min });
                }}
                className="ui-field w-full"
              />
            </label>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs text-text-secondary space-y-1">
              <span>{t("apiSecurity.newTokenLabel")}</span>
              <input
                value={newTokenLabel}
                onChange={(e) => setNewTokenLabel(e.target.value)}
                className="ui-field w-full"
                placeholder="vscode-local-client"
              />
            </label>
            <label className="text-xs text-text-secondary space-y-1">
              <span>{t("apiSecurity.scopes")}</span>
              <input
                value={newTokenScopes}
                onChange={(e) => setNewTokenScopes(e.target.value)}
                className="ui-field w-full"
                placeholder={t("apiSecurity.scopesPlaceholder")}
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2 justify-end">
            <button
              onClick={() => void issueScopedToken()}
              disabled={apiGovernanceBusy !== null}
              className="text-xs px-3 py-1.5 rounded-lg border border-accent-blue/50 text-accent-blue hover:bg-accent-blue/10 transition-colors"
            >
              {apiGovernanceBusy === "issue" ? t("apiSecurity.issuing") : t("apiSecurity.issueToken")}
            </button>
            <button
              onClick={() => void refreshApiGovernancePanels()}
              disabled={apiGovernanceBusy !== null}
              className="text-xs px-3 py-1.5 rounded-lg border border-surface-border text-text-secondary hover:bg-surface-hover transition-colors"
            >
              {apiGovernanceBusy === "refresh" ? t("apiSecurity.refreshing") : t("apiSecurity.refreshGovernance")}
            </button>
          </div>

          {lastIssuedToken && (
            <div className="rounded-lg border border-accent-blue/30 bg-accent-blue/10 px-3 py-2 text-xs text-text-secondary">
              <div className="flex items-center justify-between gap-2">
                <span className="text-text-primary">{t("apiSecurity.lastIssuedToken")}</span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(lastIssuedToken);
                    setApiGovernanceMessage(t("apiSecurity.msgTokenCopied"));
                  }}
                  className="p-1 rounded hover:bg-surface-hover"
                  title={t("apiSecurity.copyToken")}
                >
                  <Copy size={12} className="text-accent-blue" />
                </button>
              </div>
              <p className="font-mono break-all mt-1">{lastIssuedToken}</p>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-xs text-text-secondary">{t("apiSecurity.allowlistHint")}</p>
            <textarea
              value={apiAllowlistText}
              onChange={(e) => setApiAllowlistText(e.target.value)}
              className="ui-field w-full min-h-20"
                placeholder={t("apiSecurity.allowlistPlaceholder")}
            />
            <div className="flex justify-end">
              <button
                onClick={() => void persistAllowlist()}
                disabled={apiGovernanceBusy !== null}
                className="text-xs px-3 py-1.5 rounded-lg border border-accent-blue/50 text-accent-blue hover:bg-accent-blue/10 transition-colors"
              >
                {apiGovernanceBusy === "allowlist" ? t("apiSecurity.saving") : t("apiSecurity.saveAllowlist")}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs text-text-secondary">{t("apiSecurity.issuedTokens")}</p>
            <div className="max-h-44 overflow-y-auto space-y-1">
              {apiTokens.map((token) => (
                <div key={token.id} className="rounded-lg border border-surface-border px-3 py-2 text-xs text-text-muted">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-text-primary truncate">{token.label}</span>
                    <div className="flex items-center gap-2">
                      <span className={clsx("px-1.5 py-0.5 rounded-full border", token.revoked_at ? "border-red-300/40 text-red-300" : "border-accent-green/40 text-accent-green")}>
                        {token.revoked_at ? t("apiSecurity.revoked") : t("apiSecurity.active")}
                      </span>
                      {!token.revoked_at && (
                        <button
                          onClick={async () => {
                            await api.revokeApiToken(token.id);
                            await refreshApiGovernancePanels();
                          }}
                          className="text-xs px-2 py-0.5 rounded border border-surface-border hover:bg-surface-hover"
                        >
                          {t("apiSecurity.revoke")}
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="mt-1">{t("apiSecurity.scopesLabel", { scopes: token.scopes.join(", ") || t("apiSecurity.none") })}</p>
                  <p>{t("apiSecurity.createdAt", { value: new Date(token.created_at).toLocaleString() })}</p>
                  {token.last_used_at && <p>{t("apiSecurity.lastUsedAt", { value: new Date(token.last_used_at).toLocaleString() })}</p>}
                </div>
              ))}
              {apiTokens.length === 0 && <p className="text-xs text-text-muted">{t("apiSecurity.noTokens")}</p>}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs text-text-secondary">{t("apiSecurity.auditLog")}</p>
            <div className="max-h-48 overflow-y-auto space-y-1">
              {apiAuditLogs.map((entry) => (
                <div key={entry.id} className="rounded-lg border border-surface-border px-3 py-2 text-xs text-text-muted">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-text-primary">{entry.method} {entry.endpoint}</span>
                    <span className={clsx(
                      "px-1.5 py-0.5 rounded-full border",
                      entry.status_code >= 400 ? "border-red-300/40 text-red-300" : "border-accent-green/40 text-accent-green"
                    )}>
                      {entry.status_code}
                    </span>
                  </div>
                  <p>{t("apiSecurity.client", { value: entry.client_id || t("apiSecurity.none") })}</p>
                  <p>{t("apiSecurity.time", { value: new Date(entry.occurred_at).toLocaleString() })}</p>
                  <p>{t("apiSecurity.detail", { value: entry.detail })}</p>
                </div>
              ))}
              {apiAuditLogs.length === 0 && <p className="text-xs text-text-muted">{t("apiSecurity.noAuditLogs")}</p>}
            </div>
          </div>

          {apiGovernanceMessage && (
            <p className="text-xs text-accent-blue">{apiGovernanceMessage}</p>
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
        <Row label={t("about.logs")}>
          <button
            onClick={async () => {
              await api.openLogDirectory().catch((err) => {
                console.error("Failed to open log directory:", err);
              });
            }}
            className="text-xs px-3 py-1.5 rounded-lg border border-accent-blue/50 text-accent-blue hover:bg-accent-blue/10 transition-colors"
          >
            {t("about.openLogFolder")}
          </button>
        </Row>
        <Row label={t("about.autoCheckUpdates")}> 
          <button
            onClick={() => setAutoCheckUpdates(!autoCheckUpdates)}
            title={t("about.autoCheckUpdates")}
            className={clsx(
              "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
              autoCheckUpdates ? "bg-accent-blue" : "bg-surface-hover"
            )}
          >
            <span
              className={clsx(
                "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
                autoCheckUpdates ? "translate-x-6" : "translate-x-1"
              )}
            />
          </button>
        </Row>
        <Row label={t("about.checkUpdate")}>
          <div className="flex items-center gap-2">
            <button
              onClick={checkForUpdatesNow}
              disabled={checkingUpdate}
              className="text-xs px-3 py-1.5 rounded-lg border border-accent-blue/50 text-accent-blue hover:bg-accent-blue/10 transition-colors"
            >
              {checkingUpdate ? t("about.checking") : t("about.checkUpdate")}
            </button>
            {updateCheckResult?.status === "available" && updateCheckResult.url && (
              <a
                href={updateCheckResult.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs px-3 py-1.5 rounded-lg border border-surface-border text-text-secondary hover:bg-surface-hover transition-colors"
              >
                {t("about.viewRelease")}
              </a>
            )}
          </div>
        </Row>
        {updateCheckResult?.status === "upToDate" && (
          <p className="text-xs text-accent-green text-right">{t("about.upToDate")}</p>
        )}
        {updateCheckResult?.status === "available" && (
          <p className="text-xs text-accent-blue text-right">{t("about.updateAvailable", { version: updateCheckResult.version })}</p>
        )}
        {updateCheckResult?.status === "error" && (
          <p className="text-xs text-red-300 text-right">{updateCheckResult.message || t("about.checkFailed")}</p>
        )}
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
