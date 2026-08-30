import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, Upload, FileCheck, RotateCw, AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import clsx from "clsx";
import * as api from "@/services/tauriApi";
import { useAnnouncer } from "@/hooks/useAnnouncer";
import type { BackupPreview } from "@/types";
import { getCurrentProfileId, setCurrentProfileId, widgetPresetsStorageKey } from "@/pages/WidgetCenter/widgetExperience";

function basename(path: string) {
  if (!path) return "";
  return path.replace(/\\/g, "/").split("/").pop() ?? path;
}

export default function BackupSection() {
  const { t } = useTranslation(["settings", "common"]);
  const announce = useAnnouncer();

  const [backupPreview, setBackupPreview] = useState<BackupPreview | null>(null);
  const [backupPackagePath, setBackupPackagePath] = useState<string | null>(null);
  const [backupStrategy, setBackupStrategy] = useState<"overwrite" | "merge" | "new_profile">("overwrite");
  const [backupPassphrase, setBackupPassphrase] = useState("");
  const [encryptExport, setEncryptExport] = useState(false);
  const [backupNeedsPassphrase, setBackupNeedsPassphrase] = useState(false);
  const [backupBusy, setBackupBusy] = useState<"export" | "validate" | "apply" | null>(null);
  const [backupMessage, setBackupMessage] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);

  useEffect(() => {
    if (backupMessage?.text) {
      announce(backupMessage.text);
    }
  }, [backupMessage, announce]);

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

  const importPassphrase = (): string | undefined => {
    const pass = backupPassphrase.trim();
    return pass.length > 0 ? pass : undefined;
  };

  const handleBackupError = (error: unknown) => {
    const extractText = (err: unknown): string => {
      if (err instanceof Error) return err.message;
      if (typeof err === "string") return err;
      if (err && typeof err === "object" && "message" in err && typeof (err as { message?: unknown }).message === "string") {
        return (err as { message: string }).message;
      }
      return t("backup.failed");
    };
    const text = extractText(error);
    if (text.toLowerCase().includes("passphrase")) {
      setBackupNeedsPassphrase(true);
    }
    setBackupMessage({ type: "error", text: text || t("backup.failed") });
  };

  const clearBackupSelection = () => {
    setBackupPackagePath(null);
    setBackupPreview(null);
    setBackupMessage(null);
    setBackupNeedsPassphrase(false);
    setBackupPassphrase("");
  };

  const selectBackupFile = async () => {
    const path = await openBackupPackage();
    if (!path) return;
    clearBackupSelection();
    setBackupPackagePath(path);
    setBackupMessage({ type: "info", text: t("backup.fileSelected", { name: basename(path) }) });
  };

  const validateBackupPackage = async () => {
    if (!backupPackagePath) {
      setBackupMessage({ type: "error", text: t("backup.selectFileFirst") });
      return;
    }
    setBackupBusy("validate");
    setBackupMessage(null);
    setBackupNeedsPassphrase(false);
    try {
      const preview = await api.importBackupV2Validate(backupPackagePath, importPassphrase());
      setBackupPreview(preview);
      if (preview.manifest.encrypted) {
        setBackupNeedsPassphrase(true);
      }
      setBackupMessage({ type: "info", text: t("backup.validated") });
    } catch (error) {
      handleBackupError(error);
    } finally {
      setBackupBusy(null);
    }
  };

  const applyBackupPackage = async () => {
    if (!backupPackagePath) {
      setBackupMessage({ type: "error", text: t("backup.selectFileFirst") });
      return;
    }
    if (backupPreview?.manifest.encrypted && !backupPassphrase) {
      setBackupMessage({ type: "error", text: t("backup.passphraseRequired") });
      setBackupNeedsPassphrase(true);
      return;
    }
    const { confirm } = await import("@tauri-apps/plugin-dialog");
    if (backupStrategy === "overwrite" || backupStrategy === "merge") {
      const confirmed = await confirm(
        t(`backup.${backupStrategy}Confirm`, { file: basename(backupPackagePath) }),
        { title: t("backup.restoreTitle"), kind: "warning" }
      );
      if (!confirmed) return;
    }
    if (backupStrategy === "new_profile") {
      const confirmed = await confirm(t("backup.newProfileConfirm"), {
        title: t("backup.restoreTitle"),
        kind: "warning",
      });
      if (!confirmed) return;
    }

    setBackupBusy("apply");
    setBackupMessage(null);
    try {
      const result = await api.importBackupV2Apply(backupPackagePath, backupStrategy, importPassphrase());
      if (result.layout_presets && typeof result.layout_presets === "object") {
        if (result.new_profile_id) setCurrentProfileId(result.new_profile_id);
        localStorage.setItem(widgetPresetsStorageKey(getCurrentProfileId()), JSON.stringify(result.layout_presets));
      }
      const successText = result.new_profile_id
        ? t("backup.applySuccessProfile", { profile: result.new_profile_id })
        : t("backup.applySuccess", { count: result.imported_rows });
      setBackupMessage({ type: "success", text: successText });
      setBackupNeedsPassphrase(false);
      setBackupPreview({
        manifest: result.manifest,
        compatible: true,
        supported_strategies: ["overwrite", "merge", "new_profile"],
        warnings: result.warnings,
      });
      api.sendNativeNotification(t("backup.notification.restoreTitle"), successText).catch(() => {});
    } catch (error) {
      handleBackupError(error);
    } finally {
      setBackupBusy(null);
    }
  };

  const exportBackupPackage = async () => {
    const path = await saveBackupPackage();
    if (!path) return;
    if (encryptExport && !backupPassphrase) {
      setBackupMessage({ type: "error", text: t("backup.passphraseRequiredForExport") });
      return;
    }
    setBackupBusy("export");
    setBackupMessage(null);
    try {
      const passphrase = encryptExport ? backupPassphrase : undefined;
      let layoutPresets: unknown = undefined;
      try {
        const raw = localStorage.getItem(widgetPresetsStorageKey(getCurrentProfileId()));
        layoutPresets = raw ? JSON.parse(raw) : undefined;
      } catch {
        layoutPresets = undefined;
      }
      const manifest = await api.exportBackupV2(path, passphrase, layoutPresets);
      setBackupPackagePath(path);
      setBackupPreview({
        manifest,
        compatible: true,
        supported_strategies: ["overwrite", "merge", "new_profile"],
        warnings: [],
      });
      const successText = t("backup.exportSuccess");
      setBackupMessage({ type: "success", text: successText });
      api.sendNativeNotification(t("backup.notification.exportTitle"), successText).catch(() => {});
    } catch (error) {
      handleBackupError(error);
    } finally {
      setBackupBusy(null);
    }
  };

  const messageIcon = () => {
    if (!backupMessage) return null;
    if (backupMessage.type === "success") return <CheckCircle2 size={14} className="text-accent-green mt-0.5" />;
    if (backupMessage.type === "error") return <AlertCircle size={14} className="text-accent-red mt-0.5" />;
    return <Info size={14} className="text-accent-blue mt-0.5" />;
  };

  return (
    <div className="space-y-4">
      {/* Raw data export / import */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <button
          onClick={async () => {
            const csv = await api.exportDataCsv();
            const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
            downloadTextFile(`timelens-export-${stamp}.csv`, csv, "text/csv;charset=utf-8");
          }}
          className="text-xs px-3 py-2 rounded-lg border border-surface-border text-text-secondary hover:bg-accent-blue/10 hover:text-accent-blue transition-colors"
        >
          {t("data.exportCsv")}
        </button>
        <button
          onClick={async () => {
            const json = await api.exportDataJson();
            const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
            downloadTextFile(`timelens-backup-${stamp}.json`, json, "application/json;charset=utf-8");
          }}
          className="text-xs px-3 py-2 rounded-lg border border-surface-border text-text-secondary hover:bg-accent-blue/10 hover:text-accent-blue transition-colors"
        >
          {t("data.exportJson")}
        </button>
        <label className="text-xs px-3 py-2 rounded-lg border border-surface-border text-text-secondary hover:bg-accent-blue/10 hover:text-accent-blue transition-colors cursor-pointer text-center">
          {t("data.importJson")}
          <input
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                const content = await file.text();
                await api.importDataJson(content);
                setBackupMessage({ type: "success", text: t("backup.importJsonSuccess") });
                setTimeout(() => window.location.reload(), 1200);
              } catch {
                setBackupMessage({ type: "error", text: t("backup.importJsonFailed") });
              } finally {
                e.target.value = "";
              }
            }}
          />
        </label>
      </div>

      {/* Backup package grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Export card */}
        <div className="glass-card p-4 space-y-4">
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-lg bg-accent-blue/10 text-accent-blue">
              <Download size={16} />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-text-primary">{t("backup.exportTitle")}</h3>
              <p className="text-xs text-text-muted">{t("backup.exportDesc")}</p>
            </div>
          </div>

          <div className="rounded-lg border border-surface-border bg-surface-hover/40 p-3 space-y-3">
            <label className="flex items-center justify-between text-xs text-text-secondary">
              <span>{t("backup.encryptExport")}</span>
              <input
                type="checkbox"
                className="ui-checkbox"
                checked={encryptExport}
                onChange={(e) => setEncryptExport(e.target.checked)}
              />
            </label>
            <input
              type="password"
              value={backupPassphrase}
              onChange={(e) => setBackupPassphrase(e.target.value)}
              placeholder={t("backup.passphrase")}
              className="ui-field w-full"
              disabled={!encryptExport}
            />
            {encryptExport && !backupPassphrase && (
              <p className="text-[11px] text-yellow-600">{t("backup.passphraseRequiredForExport")}</p>
            )}
          </div>

          <button
            onClick={exportBackupPackage}
            disabled={backupBusy !== null}
            className="w-full flex items-center justify-center gap-1.5 text-xs py-2 rounded-xl bg-accent-blue/15 hover:bg-accent-blue/25 text-accent-blue transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {backupBusy === "export" ? (
              <>
                <RotateCw size={12} className="animate-spin" />
                {t("backup.exporting")}
              </>
            ) : (
              <>
                <Download size={12} />
                {t("backup.exportAction")}
              </>
            )}
          </button>
        </div>

        {/* Restore card */}
        <div className="glass-card p-4 space-y-4">
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-lg bg-accent-blue/10 text-accent-blue">
              <Upload size={16} />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-text-primary">{t("backup.restoreTitle")}</h3>
              <p className="text-xs text-text-muted">{t("backup.restoreDesc")}</p>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border border-surface-border bg-surface-hover/40 px-3 py-2">
            <span className="text-xs text-text-secondary truncate">
              {backupPackagePath ? basename(backupPackagePath) : t("backup.noFileSelected")}
            </span>
            <div className="flex items-center gap-2 flex-shrink-0">
              {backupPackagePath && (
                <button
                  onClick={clearBackupSelection}
                  className="text-text-muted hover:text-accent-red transition-colors"
                  title={t("common:close")}
                >
                  <X size={12} />
                </button>
              )}
              <button
                onClick={selectBackupFile}
                disabled={backupBusy !== null}
                className="text-xs px-2.5 py-1 rounded-lg border border-surface-border text-text-secondary hover:text-text-primary transition-colors disabled:opacity-60"
              >
                {t("backup.chooseFile")}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs text-text-secondary">{t("backup.restoreMode")}</p>
            <div className="flex gap-2 flex-wrap">
              {(["overwrite", "merge", "new_profile"] as const).map((mode) => (
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
            </div>
          </div>

          <div className="rounded-lg border border-surface-border bg-surface-hover/40 p-3 space-y-3">
            <input
              type="password"
              value={backupPassphrase}
              onChange={(e) => setBackupPassphrase(e.target.value)}
              placeholder={t("backup.passphrase")}
              className="ui-field w-full"
            />
            {backupNeedsPassphrase && (
              <p className="text-[11px] text-yellow-600">{t("backup.passphraseRequired")}</p>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={validateBackupPackage}
              disabled={!backupPackagePath || backupBusy !== null}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs py-2 rounded-xl border border-surface-border text-text-secondary hover:bg-surface-hover transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {backupBusy === "validate" ? (
                <>
                  <RotateCw size={12} className="animate-spin" />
                  {t("backup.validating")}
                </>
              ) : (
                <>
                  <FileCheck size={12} />
                  {t("backup.validateAction")}
                </>
              )}
            </button>
            <button
              onClick={applyBackupPackage}
              disabled={!backupPackagePath || backupBusy !== null}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs py-2 rounded-xl bg-accent-blue/15 hover:bg-accent-blue/25 text-accent-blue transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {backupBusy === "apply" ? (
                <>
                  <RotateCw size={12} className="animate-spin" />
                  {t("backup.restoring")}
                </>
              ) : (
                <>
                  <Upload size={12} />
                  {t("backup.applyAction")}
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Status message */}
      {backupMessage && (
        <div
          className={clsx(
            "rounded-lg border p-3 text-xs flex items-start gap-2",
            backupMessage.type === "success" && "border-accent-green/30 bg-accent-green/10 text-accent-green",
            backupMessage.type === "error" && "border-accent-red/30 bg-accent-red/10 text-accent-red",
            backupMessage.type === "info" && "border-accent-blue/30 bg-accent-blue/10 text-accent-blue"
          )}
          role="status"
        >
          {messageIcon()}
          <span className="flex-1">{backupMessage.text}</span>
        </div>
      )}

      {/* Preview panel */}
      {backupPreview && (
        <div className="rounded-lg border border-surface-border bg-surface-hover/40 p-3 space-y-3 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-text-secondary">{t("backup.currentPath")}</span>
            <span className="text-text-primary truncate max-w-xs">{backupPackagePath || t("backup.none")}</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-md border border-surface-border px-2 py-1.5">
              <p className="text-[11px] text-text-muted">{t("backup.previewVersion")}</p>
              <p className="text-text-primary font-medium">{backupPreview.manifest.version} · {backupPreview.manifest.app_version}</p>
            </div>
            <div className="rounded-md border border-surface-border px-2 py-1.5">
              <p className="text-[11px] text-text-muted">{t("backup.previewSchema")}</p>
              <p className="text-text-primary font-medium">{backupPreview.manifest.schema_version}</p>
            </div>
            <div className="rounded-md border border-surface-border px-2 py-1.5">
              <p className="text-[11px] text-text-muted">{t("backup.previewCounts")}</p>
              <p className="text-text-primary font-medium">
                {t("backup.diffBackupRows", { count: backupPreview.manifest.counts.app_usage })}
              </p>
            </div>
            <div className="rounded-md border border-surface-border px-2 py-1.5">
              <p className="text-[11px] text-text-muted">{t("backup.previewChecksum")}</p>
              <p className="text-text-primary font-medium font-mono">{backupPreview.manifest.checksum.slice(0, 12)}…</p>
            </div>
          </div>
          {backupPreview.manifest.encrypted && (
            <p className="text-yellow-600">{t("backup.encrypted")}</p>
          )}
          {backupPreview.warnings.length > 0 && (
            <div className="space-y-1">
              {backupPreview.warnings.map((warning) => (
                <p key={warning} className="text-yellow-600">{warning}</p>
              ))}
            </div>
          )}
          {backupPreview.diff && (
            <div className="space-y-2 border-t border-surface-border pt-2">
              <p className="text-text-secondary">{t("backup.diffTitle")}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {Object.entries(backupPreview.diff.table_counts).map(([table, counts]) => (
                  <div key={table} className="rounded-md border border-surface-border px-2 py-1.5">
                    <p className="text-text-primary font-medium">{table}</p>
                    <p className="text-[11px]">
                      {t("backup.diffBackupRows", { count: counts.backup_rows })} / {t("backup.diffCurrentRows", { count: counts.current_rows })}
                    </p>
                    <p className="text-[11px]">
                      {t("backup.diffToAdd", { count: counts.to_add })} · {t("backup.diffToUpdate", { count: counts.to_update })} · {t("backup.diffConflicts", { count: counts.conflicts })}
                    </p>
                  </div>
                ))}
              </div>
              {backupPreview.diff.settings_conflicts.length > 0 && (
                <div className="space-y-1">
                  <p className="text-text-secondary">{t("backup.diffSettingsConflicts")}</p>
                  {backupPreview.diff.settings_conflicts.map((conflict, idx) => (
                    <p key={idx} className="text-yellow-600">{conflict}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function downloadTextFile(fileName: string, content: string, contentType: string) {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
