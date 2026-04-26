import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Bell, Plus, Trash2, AlertTriangle } from "lucide-react";
import * as api from "@/services/tauriApi";
import type { AppLimit, ExecutableOption } from "@/types";
import { formatDuration } from "@/utils/format";
import clsx from "clsx";

const STORAGE_KEY = "timelens-app-limits";

function loadLimits(): AppLimit[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveLimits(limits: AppLimit[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(limits));
}

export default function Limits() {
  const { t } = useTranslation(["limits", "common"]);
  const [limits, setLimits] = useState<AppLimit[]>(loadLimits);
  const [executableOptions, setExecutableOptions] = useState<ExecutableOption[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [manualExePath, setManualExePath] = useState("");
  const [selectedExe, setSelectedExe] = useState("");
  const [selectedName, setSelectedName] = useState("");
  const [limitHours, setLimitHours] = useState(2);
  const [limitMinutes, setLimitMinutes] = useState(0);
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
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

    api.getRecentExecutables(200)
      .then((recent) => mergeOptions(recent))
      .catch(() => {});

    // Load currently running executables in background to avoid blocking initial UI.
    api.getRunningExecutables()
      .then((running) => mergeOptions(running))
      .catch(() => {});
  }, []);

  const alreadyLimitedPaths = new Set(limits.map((l) => l.exePath));

  const filteredOptions = executableOptions.filter((x) => {
    if (alreadyLimitedPaths.has(x.exe_path)) return false;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      x.app_name.toLowerCase().includes(q) || x.exe_path.toLowerCase().includes(q)
    );
  });

  const addLimit = () => {
    const manual = manualExePath.trim();
    const exePath = selectedExe || manual;
    if (!exePath) return;

    const dailyLimitSeconds = limitHours * 3600 + limitMinutes * 60;
    if (dailyLimitSeconds <= 0) return;

    const appName = selectedName || (exePath.split(/[\\/]/).pop() || exePath);

    const newLimit: AppLimit = {
      exePath,
      appName,
      dailyLimitSeconds,
      enabled: true,
    };
    const updated = [...limits, newLimit];
    setLimits(updated);
    saveLimits(updated);
    setSelectedExe("");
    setSelectedName("");
    setManualExePath("");
    setSearchQuery("");
    setLimitHours(2);
    setLimitMinutes(0);
    setShowDropdown(false);
  };

  const removeLimit = (exePath: string) => {
    const updated = limits.filter((l) => l.exePath !== exePath);
    setLimits(updated);
    saveLimits(updated);
  };

  const toggleLimit = (exePath: string) => {
    const updated = limits.map((l) =>
      l.exePath === exePath ? { ...l, enabled: !l.enabled } : l
    );
    setLimits(updated);
    saveLimits(updated);
  };

  const updateLimitSeconds = (exePath: string, seconds: number) => {
    const updated = limits.map((l) =>
      l.exePath === exePath ? { ...l, dailyLimitSeconds: Math.max(60, seconds) } : l
    );
    setLimits(updated);
    saveLimits(updated);
  };

  return (
    <div className="p-6 space-y-5 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-text-primary">{t("limits:title")}</h1>
        <p className="text-text-muted text-xs mt-0.5">{t("limits:subtitle")}</p>
      </div>

      {/* How it works */}
      <div className="glass-card p-4 flex gap-3 items-start">
        <Bell size={16} className="text-accent-blue mt-0.5 flex-shrink-0" />
        <div className="space-y-1">
          <p className="text-sm text-text-secondary">{t("limits:howItWorks")}</p>
          <ul className="text-xs text-text-muted space-y-0.5 list-disc list-inside">
            <li>{t("limits:rule80")}</li>
            <li>{t("limits:rule90")}</li>
            <li>{t("limits:rule100")}</li>
          </ul>
        </div>
      </div>

      {/* Add new limit */}
      <div className="glass-card p-5 space-y-3 relative z-20">
        <h2 className="text-sm font-semibold text-text-primary">{t("limits:addLimit")}</h2>
        <div className="relative">
          <input
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setSelectedExe("");
              setSelectedName("");
              setShowDropdown(true);
            }}
            onFocus={() => setShowDropdown(true)}
            onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
            className="ui-field"
            placeholder={t("limits:searchApp")}
          />
          {showDropdown && searchQuery && filteredOptions.length > 0 && (
            <div className="absolute z-30 left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-xl border border-surface-border bg-surface-card shadow-lg divide-y divide-surface-border">
              {filteredOptions.slice(0, 25).map((row) => (
                <button
                  key={row.exe_path}
                  onMouseDown={() => {
                    setSelectedExe(row.exe_path);
                    setSelectedName(row.app_name);
                    setSearchQuery(row.app_name);
                    setShowDropdown(false);
                  }}
                  className={clsx(
                    "w-full flex flex-col items-start px-3 py-2 text-xs hover:bg-surface-hover transition-colors text-left",
                    selectedExe === row.exe_path && "bg-surface-hover"
                  )}
                >
                  <span className="text-text-primary font-medium">{row.app_name}</span>
                  <span className="text-text-muted truncate max-w-full" title={row.exe_path}>
                    {row.exe_path}
                  </span>
                </button>
              ))}
            </div>
          )}
          {showDropdown && searchQuery && filteredOptions.length === 0 && (
            <div className="absolute z-30 left-0 right-0 mt-1 rounded-xl border border-surface-border bg-surface-card shadow-lg">
              <p className="px-3 py-3 text-xs text-text-muted">{t("limits:noAppsFound")}</p>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            value={manualExePath}
            onChange={(e) => {
              setManualExePath(e.target.value);
              setSelectedExe("");
              setSelectedName("");
            }}
            className="ui-field"
            placeholder={t("limits:manualExePlaceholder")}
          />
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm text-text-secondary flex-shrink-0">{t("limits:dailyLimit")}</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={23}
              value={limitHours}
              onChange={(e) =>
                setLimitHours(Math.max(0, Math.min(23, Number(e.target.value))))
              }
              className="ui-field !w-16 text-center"
              aria-label="hours"
            />
            <span className="text-text-muted text-sm">{t("common:hours")}</span>
            <input
              type="number"
              min={0}
              max={59}
              value={limitMinutes}
              onChange={(e) =>
                setLimitMinutes(Math.max(0, Math.min(59, Number(e.target.value))))
              }
              className="ui-field !w-16 text-center"
              aria-label="minutes"
            />
            <span className="text-text-muted text-sm">{t("common:minutes")}</span>
          </div>
          <button
            onClick={addLimit}
            disabled={(!(selectedExe || manualExePath.trim())) || (limitHours === 0 && limitMinutes === 0)}
            className={clsx(
              "ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs",
              "border border-accent-blue/50 text-accent-blue hover:bg-accent-blue/10 transition-colors",
              "disabled:opacity-40 disabled:cursor-not-allowed"
            )}
          >
            <Plus size={13} />
            {t("limits:addBtn")}
          </button>
        </div>
      </div>

      {/* Limit list */}
      {limits.length > 0 ? (
        <div className="glass-card p-5 space-y-3">
          <h2 className="text-sm font-semibold text-text-primary">
            {t("limits:configuredLimits")}
          </h2>
          <div className="space-y-2">
            {limits.map((limit) => {
              const h = Math.floor(limit.dailyLimitSeconds / 3600);
              const m = Math.floor((limit.dailyLimitSeconds % 3600) / 60);
              return (
                <div
                  key={limit.exePath}
                  className={clsx(
                    "flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors",
                    limit.enabled
                      ? "border-surface-border bg-surface-card"
                      : "border-surface-border bg-surface-light opacity-60"
                  )}
                >
                  {/* Enable toggle */}
                  <button
                    onClick={() => toggleLimit(limit.exePath)}
                    title={limit.enabled ? t("limits:disable") : t("limits:enable")}
                    className={clsx(
                      "relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors",
                      limit.enabled ? "bg-accent-blue" : "bg-surface-hover"
                    )}
                  >
                    <span
                      className={clsx(
                        "inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform",
                        limit.enabled ? "translate-x-4" : "translate-x-0.5"
                      )}
                    />
                  </button>

                  {/* App name + path */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-text-primary font-medium truncate">
                      {limit.appName}
                    </div>
                    <div
                      className="text-xs text-text-muted truncate"
                      title={limit.exePath}
                    >
                      {limit.exePath}
                    </div>
                  </div>

                  {/* Limit time edit */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <input
                      type="number"
                      min={0}
                      max={23}
                      value={h}
                      onChange={(e) => {
                        const newH = Math.max(0, Math.min(23, Number(e.target.value)));
                        updateLimitSeconds(limit.exePath, newH * 3600 + m * 60);
                      }}
                      className="ui-field !w-12 !py-1 !px-1.5 text-center !text-xs"
                      aria-label="hours"
                    />
                    <span className="text-text-muted text-xs">h</span>
                    <input
                      type="number"
                      min={0}
                      max={59}
                      value={m}
                      onChange={(e) => {
                        const newM = Math.max(0, Math.min(59, Number(e.target.value)));
                        updateLimitSeconds(limit.exePath, h * 3600 + newM * 60);
                      }}
                      className="ui-field !w-12 !py-1 !px-1.5 text-center !text-xs"
                      aria-label="minutes"
                    />
                    <span className="text-text-muted text-xs">m</span>
                  </div>

                  {/* Usage bar */}
                  <div className="hidden sm:block w-20 text-right text-xs text-text-muted flex-shrink-0">
                    {formatDuration(limit.dailyLimitSeconds)}
                  </div>

                  {/* Delete */}
                  <button
                    onClick={() => removeLimit(limit.exePath)}
                    className="text-text-muted hover:text-accent-red transition-colors p-1 flex-shrink-0"
                    title={t("common:delete")}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="glass-card p-8 text-center">
          <AlertTriangle size={28} className="text-text-muted mx-auto mb-3" />
          <p className="text-sm text-text-muted">{t("limits:noLimits")}</p>
        </div>
      )}
    </div>
  );
}
