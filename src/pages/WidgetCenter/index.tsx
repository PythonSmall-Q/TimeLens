import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { emit } from "@tauri-apps/api/event";
import {
  Clock, List, Timer, ExternalLink, Trash2, Plus, StickyNote, Activity,
  Puzzle, FolderOpen, ShieldCheck, PawPrint, Ruler, Upload, Wrench,
  Target, Lightbulb, BarChart3, TrendingUp, Globe, Pause, Play, RefreshCw,
  Terminal, ChevronDown, ChevronUp, X, Save, HeartPulse, RotateCcw,
  Palette, LayoutDashboard, Flame,
} from "lucide-react";
import { useWidgetStore } from "@/stores/widgetStore";
import type {
  DesktopPetPackManifest,
  WidgetConfig,
  WidgetErrorLogEntry,
  WidgetPermissionEntry,
  WidgetPermissionAuditEntry,
  WidgetRegistryItem,
  WidgetRegistryLoadError,
} from "@/types";
import * as api from "@/services/tauriApi";
import clsx from "clsx";
import AsyncStateCard from "@/components/AsyncStateCard";
import WidgetPermissionDialog from "./WidgetPermissionDialog";
import {
  applyWidgetPreset,
  createWidgetPreset,
  parseWidgetPresets,
  readWidgetPresets,
  saveWidgetPresets,
  serializeWidgetPresets,
  widgetSkinStorageKey,
  type WidgetLayoutPreset,
} from "./widgetExperience";

type InlineMessage = { kind: "ok" | "err"; text: string };
type WidgetGroup = "utility" | "focus" | "insight" | "reflection";

const ICONS = {
  clock: Clock,
  todo: List,
  timer: Timer,
  note: StickyNote,
  status: Activity,
  pet: PawPrint,
  "focus-coach": Target,
  "quick-capture": Lightbulb,
  "session-pulse": BarChart3,
  "goal-progress": TrendingUp,
  "browser-activity": Globe,
};

const TYPE_LABELS: Record<string, string> = {
  clock: "widgets:clock.title",
  todo: "widgets:todo.title",
  timer: "widgets:timer.title",
  note: "widgets:note.title",
  status: "widgets:status.title",
  pet: "widgets:pet.title",
  "focus-coach": "widgets:focusCoach.title",
  "quick-capture": "widgets:quickCapture.title",
  "session-pulse": "widgets:sessionPulse.title",
  "goal-progress": "widgets:goalProgress.title",
  "browser-activity": "widgets:browserActivity.title",
};

function WidgetCard({
  config,
  permissionEntries,
  permissionAuditEntries,
  onPermissionsChanged,
  onNotify,
}: {
  config: WidgetConfig;
  permissionEntries: WidgetPermissionEntry[];
  permissionAuditEntries: WidgetPermissionAuditEntry[];
  onPermissionsChanged: () => void;
  onNotify: (message: InlineMessage) => void;
}) {
  const { t } = useTranslation("widgets");
  const { openWidget, removeWidget, updateWidgetConfig } = useWidgetStore();
  const Icon = ICONS[config.widget_type as keyof typeof ICONS] ?? Clock;
  const petPackInputRef = useRef<HTMLInputElement | null>(null);
  const skinInputRef = useRef<HTMLInputElement | null>(null);
  const [petWidth, setPetWidth] = useState(String(Math.round(config.width)));
  const [petHeight, setPetHeight] = useState(String(Math.round(config.height)));
  const [revokingPermissions, setRevokingPermissions] = useState(false);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const [paused, setPaused] = useState(config.paused ?? false);
  const [errorLogOpen, setErrorLogOpen] = useState(false);
  const [errorLogs, setErrorLogs] = useState<WidgetErrorLogEntry[]>([]);
  const [errorFilter, setErrorFilter] = useState("");
  const [widgetSkin, setWidgetSkin] = useState(() => localStorage.getItem(widgetSkinStorageKey(config.id)) ?? "");

  useEffect(() => {
    setPetWidth(String(Math.round(config.width)));
    setPetHeight(String(Math.round(config.height)));
  }, [config.width, config.height, config.data_json]);

  useEffect(() => {
    if (!errorLogOpen) return;
    api.getWidgetErrorLog(config.id, 20)
      .then(setErrorLogs)
      .catch(() => setErrorLogs([]));
  }, [errorLogOpen, config.id]);

  const applyPetWindowSize = async () => {
    const width = Number(petWidth);
    const height = Number(petHeight);
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      return;
    }

    const normalizedWidth = Math.max(260, Math.min(900, Math.round(width)));
    const normalizedHeight = Math.max(180, Math.min(700, Math.round(height)));
    await updateWidgetConfig({
      ...config,
      width: normalizedWidth,
      height: normalizedHeight,
    });
    setPetWidth(String(normalizedWidth));
    setPetHeight(String(normalizedHeight));
  };

  const handleImportPetPack = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw);
      if (!isPetManifest(parsed)) {
        return;
      }

      await updateWidgetConfig({
        ...config,
        data_json: JSON.stringify(parsed),
      });
    } catch {
      // Keep silent in the card itself; Widget Center already has visible import flow.
    } finally {
      event.target.value = "";
    }
  };

  const handleWidgetSkin = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !file.type.startsWith("image/")) return;
    if (file.size > 4 * 1024 * 1024) {
      onNotify({ kind: "err", text: t("skin.tooLarge") });
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    if (!dataUrl) return;
    localStorage.setItem(widgetSkinStorageKey(config.id), dataUrl);
    setWidgetSkin(dataUrl);
    void emit("timelens-widget-skin-changed", { widgetId: config.id, image: dataUrl });
  };

  const clearWidgetSkin = () => {
    localStorage.removeItem(widgetSkinStorageKey(config.id));
    setWidgetSkin("");
    void emit("timelens-widget-skin-changed", { widgetId: config.id, image: "" });
  };

  const handleRevokePermissions = async () => {
    if (revokingPermissions) return;
    const revokeCount = permissionEntries.length;
    if (revokeCount <= 0) return;
    setRevokingPermissions(true);
    try {
      await api.revokeAllWidgetPermissions(config.id, "widget-center");
      onPermissionsChanged();
      onNotify({ kind: "ok", text: t("permissionMatrix.revokeSuccess", { count: revokeCount }) });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      onNotify({ kind: "err", text: t("permissionMatrix.revokeError", { message }) });
    } finally {
      setRevokingPermissions(false);
      setConfirmingRevoke(false);
    }
  };

  const handleRevokeSinglePermission = async (permission: string) => {
    if (revokingPermissions) return;
    setRevokingPermissions(true);
    try {
      const remaining = permissionEntries
        .map((e) => e.permission)
        .filter((p) => p !== permission);
      await api.setWidgetPermissions(config.id, remaining, "widget-center");
      onPermissionsChanged();
      onNotify({ kind: "ok", text: t("permissionMatrix.revokeOneSuccess", { permission }) });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      onNotify({ kind: "err", text: t("permissionMatrix.revokeError", { message }) });
    } finally {
      setRevokingPermissions(false);
    }
  };

  const handleTogglePaused = async () => {
    const next = !paused;
    setPaused(next);
    try {
      await api.setWidgetPaused(config.id, next);
    } catch {
      // Backend command will be wired separately; local state is authoritative for the UI.
    }
  };

  const handleRefresh = () => {
    void emit("timelens-widget-refresh", { widgetId: config.id });
    onPermissionsChanged();
  };

  return (
    <div className="glass-card p-4 flex flex-col gap-3">
      {/* Top row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="p-2 rounded-lg bg-accent-blue/10 text-accent-blue">
            <Icon size={15} />
          </span>
          <div>
            <p className="text-sm font-medium text-text-primary">
              {t(TYPE_LABELS[config.widget_type] ?? "widgets:clock.title")}
            </p>
            <p className="text-xs text-text-muted font-mono">{config.id}</p>
          </div>
        </div>
        <button
          onClick={() => removeWidget(config.id)}
          aria-label={t("deleteWidget")}
          title={t("deleteWidget")}
          className="text-text-muted hover:text-accent-red transition-colors p-1"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Open / Close */}
      <label className="flex items-center justify-between text-xs text-text-secondary rounded-lg border border-surface-border px-3 py-2">
        <span>{t("startOnLaunch")}</span>
        <input
          type="checkbox"
          className="ui-checkbox"
          checked={!!config.start_on_launch}
          onChange={(e) =>
            updateWidgetConfig({ ...config, start_on_launch: e.target.checked })
          }
        />
      </label>

      <button
        onClick={() => openWidget(config)}
        className="w-full flex items-center justify-center gap-1.5 text-xs py-2 rounded-xl
                   bg-accent-blue/15 hover:bg-accent-blue/25 text-accent-blue transition-colors"
      >
        <ExternalLink size={12} />
        {t("openWidget")}
      </button>

      {/* Per-widget controls */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={handleTogglePaused}
          className={clsx(
            "flex items-center justify-center gap-1.5 text-xs py-1.5 rounded-lg border transition-colors",
            paused
              ? "border-accent-green/30 text-accent-green hover:bg-accent-green/10"
              : "border-surface-border text-text-secondary hover:text-text-primary"
          )}
        >
          {paused ? <Play size={12} /> : <Pause size={12} />}
          {paused ? t("resumeUpdates") : t("pauseUpdates")}
        </button>
        <button
          onClick={handleRefresh}
          className="flex items-center justify-center gap-1.5 text-xs py-1.5 rounded-lg border border-surface-border
                     text-text-secondary hover:text-text-primary transition-colors"
        >
          <RefreshCw size={12} />
          {t("refreshNow")}
        </button>
      </div>

      <div className="flex items-center justify-between gap-2 rounded-lg border border-surface-border px-3 py-2 text-xs text-text-secondary">
        <span>{t("skin.perWidget")}</span>
        <div className="flex items-center gap-2">
          <input ref={skinInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={handleWidgetSkin} />
          <button onClick={() => skinInputRef.current?.click()} className="text-accent-blue hover:underline">{t("skin.choose")}</button>
          {widgetSkin && <button onClick={clearWidgetSkin} className="text-accent-red hover:underline">{t("skin.clear")}</button>}
        </div>
      </div>

      {config.widget_type === "pet" && (
        <div className="mt-1 rounded-xl border border-accent-blue/20 bg-accent-blue/5 p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider flex items-center gap-1.5">
              <PawPrint size={12} /> {t("petStudio.title")}
            </p>
            <button
              onClick={() => petPackInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs border border-surface-border text-text-secondary hover:text-text-primary transition-colors"
            >
              <Upload size={12} /> {t("petStudio.importPack")}
            </button>
            <input
              ref={petPackInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={handleImportPetPack}
            />
          </div>
          <p className="text-xs text-text-muted">{t("petStudio.petCardDesc")}</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-text-secondary space-y-1">
              <span>{t("petStudio.width")}</span>
              <input
                type="number"
                min={260}
                max={900}
                step={10}
                value={petWidth}
                onChange={(e) => setPetWidth(e.target.value)}
                className="ui-field w-full"
              />
            </label>
            <label className="text-xs text-text-secondary space-y-1">
              <span>{t("petStudio.height")}</span>
              <input
                type="number"
                min={180}
                max={700}
                step={10}
                value={petHeight}
                onChange={(e) => setPetHeight(e.target.value)}
                className="ui-field w-full"
              />
            </label>
          </div>
          <div className="flex justify-end">
            <button
              onClick={applyPetWindowSize}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-surface-border text-text-secondary hover:text-text-primary transition-colors"
            >
              <Ruler size={12} /> {t("petStudio.applySize")}
            </button>
          </div>
        </div>
      )}

      {permissionEntries.length > 0 && (
        <div className="mt-1 rounded-xl border border-surface-border bg-surface-hover/40 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider">{t("permissionMatrix.title")}</p>
            {!confirmingRevoke ? (
              <button
                onClick={() => setConfirmingRevoke(true)}
                disabled={revokingPermissions}
                className="text-[10px] px-2 py-1 rounded-md border border-surface-border text-text-muted hover:text-accent-red disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {revokingPermissions ? t("permissionMatrix.revoking") : t("permissionMatrix.revokeAll")}
              </button>
            ) : (
              <div className="flex items-center gap-1">
                <button
                  onClick={handleRevokePermissions}
                  disabled={revokingPermissions}
                  className="text-[10px] px-2 py-1 rounded-md border border-accent-red/30 text-accent-red hover:bg-accent-red/10 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {t("permissionMatrix.confirm")}
                </button>
                <button
                  onClick={() => setConfirmingRevoke(false)}
                  disabled={revokingPermissions}
                  className="text-[10px] px-2 py-1 rounded-md border border-surface-border text-text-muted hover:text-text-primary disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {t("permissionMatrix.cancel")}
                </button>
              </div>
            )}
          </div>
          {confirmingRevoke && (
            <p className="text-[11px] text-yellow-600">{t("permissionMatrix.confirmRevokeHint")}</p>
          )}
          {permissionEntries.map((entry) => (
            <div key={entry.permission} className="rounded-lg border border-surface-border px-2 py-1.5 text-[11px] text-text-muted">
              <div className="flex items-center justify-between gap-2">
                <span className="text-text-primary truncate">{entry.permission}</span>
                <div className="flex items-center gap-1.5">
                  <span className={clsx(
                    "px-1.5 py-0.5 rounded-full border",
                    entry.risk_label === "high" ? "border-red-300/40 text-red-300" : entry.risk_label === "medium" ? "border-yellow-300/40 text-yellow-300" : "border-accent-green/40 text-accent-green"
                  )}>
                    {entry.risk_label}
                  </span>
                  <button
                    onClick={() => handleRevokeSinglePermission(entry.permission)}
                    disabled={revokingPermissions}
                    title={t("permissionMatrix.revokeOne")}
                    aria-label={t("permissionMatrix.revokeOneAria", { permission: entry.permission })}
                    className="text-text-muted hover:text-accent-red disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
                  <p>{t("permissionMatrix.capability", { value: entry.capability })}</p>
                  <p>{t("permissionMatrix.grantedAt", { value: new Date(entry.granted_at).toLocaleString() })}</p>
                  <p>{t("permissionMatrix.lastAccessAt", { value: entry.last_access_at ? new Date(entry.last_access_at).toLocaleString() : t("permissionMatrix.never") })}</p>
            </div>
          ))}

          <div className="pt-1">
            <p className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider mb-1.5">
              {t("permissionMatrix.timelineTitle")}
            </p>
            {permissionAuditEntries.length === 0 ? (
              <p className="text-[11px] text-text-muted">{t("permissionMatrix.noAudit")}</p>
            ) : (
              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                {permissionAuditEntries.slice(0, 20).map((entry) => (
                  <div key={entry.id} className="rounded-lg border border-surface-border px-2 py-1.5 text-[11px] text-text-muted">
                    <div className="flex items-center justify-between gap-2">
                      <span className={entry.action === "grant" ? "text-accent-green" : "text-accent-red"}>
                        {entry.action === "grant" ? t("permissionMatrix.actionGrant") : t("permissionMatrix.actionRevoke")}
                      </span>
                      <span>{new Date(entry.occurred_at).toLocaleString()}</span>
                    </div>
                    <p className="text-text-primary truncate" title={entry.permission}>{entry.permission}</p>
                    <p>{t("permissionMatrix.actor", { value: entry.actor || "system" })}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Error log */}
      <div className="rounded-xl border border-surface-border bg-surface-hover/40 overflow-hidden">
        <button
          onClick={() => setErrorLogOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-2 px-3 py-2 text-[11px] font-semibold text-text-secondary uppercase tracking-wider hover:bg-surface-hover/60 transition-colors"
        >
          <span className="flex items-center gap-1.5">
            <Terminal size={12} />
            {t("errorLog.title")}
            {errorLogs.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-accent-red/15 text-accent-red text-[10px]">
                {errorLogs.length}
              </span>
            )}
          </span>
          {errorLogOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
        {errorLogOpen && (
          <div className="px-3 pb-3 pt-1 space-y-2">
            {errorLogs.length === 0 ? (
              <p className="text-[11px] text-text-muted">{t("errorLog.noErrors")}</p>
            ) : (
              <>
                <input
                  type="text"
                  value={errorFilter}
                  onChange={(e) => setErrorFilter(e.target.value)}
                  placeholder={t("errorLog.filterPlaceholder")}
                  className="w-full text-[11px] px-2 py-1.5 rounded-lg bg-surface-card border border-surface-border outline-none focus:border-accent-blue"
                />
                <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                  {errorLogs
                    .filter((entry) => {
                      const q = errorFilter.trim().toLowerCase();
                      if (!q) return true;
                      return (
                        entry.error.toLowerCase().includes(q) ||
                        (entry.recovery_hint?.toLowerCase().includes(q) ?? false)
                      );
                    })
                    .map((entry) => (
                      <div
                        key={entry.id}
                        className="rounded-lg border border-surface-border px-2 py-1.5 text-[11px]"
                      >
                        <div className="text-text-muted">{new Date(entry.occurred_at).toLocaleString()}</div>
                        <div className="text-accent-red mt-0.5">{entry.error}</div>
                        {entry.recovery_hint && (
                          <div className="text-text-secondary mt-0.5">{entry.recovery_hint}</div>
                        )}
                      </div>
                    ))}
                </div>
                <button
                  onClick={() => {
                    api.clearWidgetErrorLog(config.id)
                      .then(() => { setErrorLogs([]); setErrorFilter(""); })
                      .catch(() => {});
                  }}
                  className="text-[10px] px-2 py-1 rounded-md border border-surface-border text-text-muted hover:text-accent-red transition-colors"
                >
                  {t("errorLog.clear")}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Self-add catalog (official widgets) ──────────────────────

const OFFICIAL_CATALOG: { type: string; icon: typeof Clock; descKey: string; comingSoon?: boolean; group: WidgetGroup }[] = [
  { type: "clock", icon: Clock, descKey: "clockDesc", group: "utility" },
  { type: "todo", icon: List, descKey: "todoDesc", group: "utility" },
  { type: "note", icon: StickyNote, descKey: "noteDesc", group: "utility" },
  { type: "timer", icon: Timer, descKey: "timerDesc", group: "focus" },
  { type: "pet", icon: PawPrint, descKey: "petDesc", group: "focus" },
  { type: "focus-coach", icon: Target, descKey: "focusCoachDesc", group: "focus", comingSoon: false },
  { type: "quick-capture", icon: Lightbulb, descKey: "quickCaptureDesc", group: "focus", comingSoon: false },
  { type: "status", icon: Activity, descKey: "statusDesc", group: "insight" },
  { type: "session-pulse", icon: BarChart3, descKey: "sessionPulseDesc", group: "insight", comingSoon: false },
  { type: "goal-progress", icon: TrendingUp, descKey: "goalProgressDesc", group: "insight", comingSoon: false },
  { type: "browser-activity", icon: Globe, descKey: "browserActivityDesc", group: "insight", comingSoon: false },
  { type: "skin-preview", icon: Palette, descKey: "skinPreviewDesc", group: "utility" },
  { type: "layout-switcher", icon: LayoutDashboard, descKey: "layoutSwitcherDesc", group: "utility" },
  { type: "widget-health", icon: HeartPulse, descKey: "widgetHealthDesc", group: "insight" },
  { type: "focus-streak", icon: Flame, descKey: "focusStreakDesc", group: "reflection" },
];

const GROUP_ORDER: WidgetGroup[] = ["utility", "focus", "insight", "reflection"];

function isPetManifest(input: unknown): input is DesktopPetPackManifest {
  if (!input || typeof input !== "object") return false;
  const m = input as Record<string, unknown>;
  const states = m.states && typeof m.states === "object" ? m.states as Record<string, unknown> : null;
  if (!states) return false;
  const hasState = (key: "idle" | "focus" | "rest") => {
    const state = states[key];
    if (!state || typeof state !== "object") return false;
    const s = state as Record<string, unknown>;
    return typeof s.label === "string" && Array.isArray(s.messages);
  };

  return (
    typeof m.manifest_version === "string"
    && typeof m.pack_id === "string"
    && typeof m.name === "string"
    && typeof m.character_name === "string"
    && typeof m.default_avatar_emoji === "string"
    && hasState("idle")
    && hasState("focus")
    && hasState("rest")
  );
}

interface MarketplaceCardProps {
  type: string;
  title: string;
  icon: typeof Clock;
  description: string;
  source: "official" | "third-party";
  installedCount: number;
  permissions?: string[];
  comingSoon?: boolean;
  onAdd: (type: string, perms: string[], comingSoon: boolean) => void;
}

function MarketplaceCard({ type, title, icon: Icon, description, source, installedCount, permissions = [], comingSoon = false, onAdd }: MarketplaceCardProps) {
  const { t } = useTranslation("widgets");

  return (
    <div className="glass-card p-4 flex flex-col gap-3 hover:border-accent-blue/30 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="p-2.5 rounded-xl bg-accent-blue/10 text-accent-blue flex-shrink-0">
            <Icon size={18} />
          </span>
          <div>
            <p className="text-sm font-semibold text-text-primary">{title}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-hover text-text-secondary">
                {source === "official" ? t("official") : t("thirdParty.source")}
              </span>
              {comingSoon && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-500/15 text-yellow-600">
                  {t("comingSoon")}
                </span>
              )}
              {installedCount > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent-green/15 text-accent-green">
                  {t("installed")} ×{installedCount}
                </span>
              )}
              {source === "third-party" && permissions.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-500/15 text-yellow-600 flex items-center gap-0.5">
                  <ShieldCheck size={10} /> {permissions.length}
                </span>
              )}
            </div>
          </div>
        </div>
        <button
          onClick={comingSoon ? undefined : () => onAdd(type, permissions, comingSoon)}
          disabled={comingSoon}
          className={clsx(
            "flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex-shrink-0",
            comingSoon
              ? "bg-surface-hover text-text-muted cursor-not-allowed disabled:opacity-60"
              : "bg-accent-blue/15 text-accent-blue hover:bg-accent-blue/25"
          )}
        >
          <Plus size={12} />
          {comingSoon ? t("comingSoon") : t("addFromTemplate")}
        </button>
      </div>
      <p className="text-xs text-text-muted leading-relaxed">{description}</p>
    </div>
  );
}

function OfficialWidgetGroup({
  group,
  entries,
  installedCount,
  onAdd,
}: {
  group: WidgetGroup;
  entries: ReturnType<typeof buildOfficialEntries>;
  installedCount: (type: string) => number;
  onAdd: (type: string, perms: string[], comingSoon: boolean) => void;
}) {
  const { t } = useTranslation("widgets");
  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
        {t(`group.${group}`)}
      </p>
      <div className="space-y-3">
        {entries.map(({ type, icon, description, title, source, permissions, comingSoon }) => (
          <MarketplaceCard
            key={type}
            type={type}
            title={title}
            icon={icon}
            source={source}
            description={description}
            permissions={permissions}
            installedCount={installedCount(type)}
            comingSoon={comingSoon}
            onAdd={onAdd}
          />
        ))}
      </div>
    </div>
  );
}

function buildOfficialEntries(t: (key: string) => string) {
  return OFFICIAL_CATALOG.map((item) => ({
    type: item.type,
    icon: item.icon,
    source: "official" as const,
    title: t(TYPE_LABELS[item.type] ?? `widgets:${item.type}.title`),
    description: t(item.descKey),
    permissions: [] as string[],
    comingSoon: item.comingSoon ?? false,
    group: item.group,
  }));
}

// ── Main component ────────────────────────────────────────────

export default function WidgetCenter() {
  const { t } = useTranslation("widgets");
  const navigate = useNavigate();
  const { widgets, loading, fetchWidgets, createWidget } = useWidgetStore();
  const loadedRef = useRef(false);
  const showDevHarness =
    import.meta.env.DEV ||
    (typeof window !== "undefined" && localStorage.getItem("timelens:widget-dev-harness-enabled") === "1");
  const [tab, setTab] = useState<"mine" | "selfAdd">("mine");
  const [registryItems, setRegistryItems] = useState<WidgetRegistryItem[]>([]);
  const [registryErrors, setRegistryErrors] = useState<WidgetRegistryLoadError[]>([]);
  const [permissionMatrixByWidget, setPermissionMatrixByWidget] = useState<Record<string, WidgetPermissionEntry[]>>({});
  const [permissionAuditByWidget, setPermissionAuditByWidget] = useState<Record<string, WidgetPermissionAuditEntry[]>>({});
  const [presets, setPresets] = useState<WidgetLayoutPreset[]>([]);
  const [presetName, setPresetName] = useState("");
  const [presetSchedule, setPresetSchedule] = useState<"off" | "time" | "focus">(() => (localStorage.getItem("timelens-widget-preset-schedule") as "off" | "time" | "focus") ?? "off");
  const [healthRefresh, setHealthRefresh] = useState(0);
  const [errorLogsByWidget, setErrorLogsByWidget] = useState<Record<string, WidgetErrorLogEntry[]>>({});
  const [runtimeHealthByWidget, setRuntimeHealthByWidget] = useState<Record<string, Awaited<ReturnType<typeof api.getWidgetRuntimeHealth>>>>({});
  const presetImportRef = useRef<HTMLInputElement | null>(null);
  const scheduledPresetRef = useRef("");

  // Collapsible cards state (collapsed by default to preserve list space)
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [healthOpen, setHealthOpen] = useState(false);

  // Permission dialog state
  const [permDialog, setPermDialog] = useState<{
    open: boolean;
    widgetType: string;
    permissions: string[];
  }>({ open: false, widgetType: "", permissions: [] });

  // Import feedback
  const [importMsg, setImportMsg] = useState<InlineMessage | null>(null);

  const refreshPermissionData = useCallback(async () => {
    const rows = await Promise.all(
      widgets.map(async (w) => {
        try {
          const [entries, audits] = await Promise.all([
            api.getWidgetPermissionMatrix(w.id),
            api.getWidgetPermissionAuditLog(w.id, 50),
          ]);
          return [w.id, entries, audits] as [string, WidgetPermissionEntry[], WidgetPermissionAuditEntry[]];
        } catch {
          return [w.id, [], []] as [string, WidgetPermissionEntry[], WidgetPermissionAuditEntry[]];
        }
      })
    );
    setPermissionMatrixByWidget(Object.fromEntries(rows.map(([id, entries]) => [id, entries])));
    setPermissionAuditByWidget(Object.fromEntries(rows.map(([id, , audits]) => [id, audits])));
  }, [widgets]);

  const refreshRegistry = () => {
    api.getWidgetRegistry()
      .then((res) => {
        setRegistryItems(res.items);
        setRegistryErrors(res.errors ?? []);
      })
      .catch(() => {
        setRegistryItems([]);
        setRegistryErrors([]);
      });
  };

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    fetchWidgets();
    refreshRegistry();
  }, [fetchWidgets]);

  useEffect(() => {
    let disposed = false;
    if (widgets.length === 0) {
      setPermissionMatrixByWidget({});
      setPermissionAuditByWidget({});
      return;
    }
    void refreshPermissionData();
    const timer = window.setInterval(() => {
      if (!disposed) {
        void refreshPermissionData();
      }
    }, 4000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [widgets, refreshPermissionData]);

  useEffect(() => {
    setPresets(readWidgetPresets());
  }, []);

  useEffect(() => {
    if (widgets.length === 0 || presets.length > 0) return;
    const defaults = ["work", "focus", "break", "coding", "review"].map((mode) =>
      createWidgetPreset(t(`presetDefaults.${mode}`), widgets)
    );
    persistPresets(defaults);
  }, [presets.length, t, widgets]);

  useEffect(() => {
    if (presetSchedule === "off" || presets.length === 0 || widgets.length === 0) {
      scheduledPresetRef.current = "";
      return;
    }
    let disposed = false;
    const applyScheduledPreset = async () => {
      const focusActive = presetSchedule === "focus" ? await api.getFocusModeActive().catch(() => false) : false;
      const targetIndex = presetSchedule === "focus"
        ? (focusActive ? 1 : 2)
        : (new Date().getHours() >= 9 && new Date().getHours() < 18 ? 0 : 2);
      const target = presets[targetIndex] ?? presets[0];
      if (!disposed && target && scheduledPresetRef.current !== target.id) {
        scheduledPresetRef.current = target.id;
        const next = applyWidgetPreset(widgets, target);
        await Promise.all(next.map((widget) => api.saveWidgetConfig(widget)));
        await fetchWidgets();
      }
    };
    void applyScheduledPreset();
    const timer = window.setInterval(() => { void applyScheduledPreset(); }, 15000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [fetchWidgets, presetSchedule, presets, widgets]);

  useEffect(() => {
    let disposed = false;
    const loadHealth = async () => {
      const rows = await Promise.all(widgets.map(async (widget) => {
        try { return [widget.id, await api.getWidgetErrorLog(widget.id, 5)] as const; }
        catch { return [widget.id, []] as const; }
      }));
      if (!disposed) setErrorLogsByWidget(Object.fromEntries(rows));
    };
    void loadHealth();
    const timer = window.setInterval(() => { void loadHealth(); }, 5000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [healthRefresh, widgets]);

  useEffect(() => {
    let disposed = false;
    const loadRuntimeHealth = async () => {
      const rows = await Promise.all(widgets.map(async (widget) => {
        try { return [widget.id, await api.getWidgetRuntimeHealth(widget.id)] as const; }
        catch { return [widget.id, null] as const; }
      }));
      if (!disposed) setRuntimeHealthByWidget(Object.fromEntries(rows));
    };
    void loadRuntimeHealth();
    const timer = window.setInterval(() => { void loadRuntimeHealth(); }, 5000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [healthRefresh, widgets]);

  const persistPresets = (next: WidgetLayoutPreset[]) => {
    setPresets(next);
    saveWidgetPresets(next);
  };

  const handleSavePreset = () => {
    const name = presetName.trim();
    if (!name || widgets.length === 0) return;
    const existing = presets.filter((preset) => preset.name.toLocaleLowerCase() !== name.toLocaleLowerCase());
    persistPresets([...existing, createWidgetPreset(name, widgets)]);
    setPresetName("");
  };

  const handleExportPresets = () => {
    const blob = new Blob([serializeWidgetPresets(presets)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "timelens-widget-layout-presets.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImportPresets = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const imported = parseWidgetPresets(await file.text());
    if (imported.length > 0) persistPresets(imported);
  };

  const handleApplyPreset = async (preset: WidgetLayoutPreset) => {
    const next = applyWidgetPreset(widgets, preset);
    await Promise.all(next.map((widget) => api.saveWidgetConfig(widget)));
    await fetchWidgets();
    void emit("timelens-widget-refresh");
    setHealthRefresh((value) => value + 1);
  };

  const healthFor = (widget: WidgetConfig) => {
    let heartbeat: { at?: string; event?: string } = {};
    try {
      heartbeat = JSON.parse(localStorage.getItem(`timelens-widget-heartbeat:${widget.id}`) ?? "{}") as typeof heartbeat;
    } catch { /* use unavailable state */ }
    const lastError = errorLogsByWidget[widget.id]?.[0];
    return { heartbeat, lastError };
  };

  const countByType = (type: string) =>
    widgets.filter((w) => w.widget_type === type).length;

  // Build official entries list
  const officialEntries = buildOfficialEntries(t);

  // Group official entries by category.
  const officialEntriesByGroup = GROUP_ORDER.reduce((acc, group) => {
    acc[group] = officialEntries.filter((e) => e.group === group);
    return acc;
  }, {} as Record<WidgetGroup, typeof officialEntries>);

  // Build third-party entries from registry
  const thirdPartyEntries = registryItems
    .filter((item) => item.source === "third-party")
    .map((item) => ({
      type: item.widget_type,
      icon: Puzzle,
      source: "third-party" as const,
      title: item.display_name,
      description: item.description ?? t("thirdParty.noDescription"),
      permissions: item.permissions ?? [],
    }));

  const handleAdd = (type: string, perms: string[], comingSoon = false) => {
    if (comingSoon) {
      const message = t("pet.comingSoon");
      api.sendNativeNotification(t("pet.title"), message).catch(() => {});
      setImportMsg({ kind: "err", text: message });
      setTimeout(() => setImportMsg(null), 4000);
      return;
    }
    const isThirdParty = thirdPartyEntries.some((e) => e.type === type);
    if (isThirdParty && perms.length > 0) {
      setPermDialog({ open: true, widgetType: type, permissions: perms });
    } else {
      createWidget(type);
      setTab("mine");
    }
  };

  const handlePermConfirm = async (granted: string[]) => {
    const { widgetType } = permDialog;
    setPermDialog({ open: false, widgetType: "", permissions: [] });

    const beforeIds = new Set(
      useWidgetStore
        .getState()
        .widgets
        .filter((w) => w.widget_type === widgetType)
        .map((w) => w.id)
    );

    await createWidget(widgetType);

    // Only bind permissions to the newly created widget instance.
    const created = useWidgetStore
      .getState()
      .widgets
      .find((w) => w.widget_type === widgetType && !beforeIds.has(w.id));

    if (created && granted.length > 0) {
      try {
        await api.setWidgetPermissions(created.id, granted, "widget-center");
      } catch { /* non-fatal */ }
    }
    void refreshPermissionData();
    setTab("mine");
  };

  const handleImportLocalWidget = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ directory: true, multiple: false, title: t("importLocalWidget") });
      if (!selected || typeof selected !== "string") return;
      await api.importLocalWidget(selected);
      setImportMsg({ kind: "ok", text: t("importSuccess") });
      refreshRegistry();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setImportMsg({ kind: "err", text: t("importError") + ": " + msg });
    }
    setTimeout(() => setImportMsg(null), 4000);
  };

  return (
    <div className="p-6 space-y-5 animate-fade-in h-full flex flex-col">
      {/* Permission dialog */}
      <WidgetPermissionDialog
        open={permDialog.open}
        onClose={() => setPermDialog((p) => ({ ...p, open: false }))}
        widgetType={permDialog.widgetType}
        requestedPermissions={permDialog.permissions}
        onConfirm={handlePermConfirm}
      />

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-text-primary">{t("widgetCenter")}</h1>
          <p className="text-text-muted text-xs mt-0.5">{t("widgetCenterDesc")}</p>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1.5 bg-surface-card border border-surface-border rounded-xl p-1 shadow-xs">
          <button
            onClick={() => setTab("mine")}
            className={clsx(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150",
              tab === "mine"
                ? "bg-accent-blue/15 text-accent-blue border border-accent-blue/30 shadow-xs"
                : "text-text-secondary border border-transparent hover:text-accent-blue hover:bg-accent-blue/10"
            )}
          >
            <List size={12} /> {t("myWidgetsTab")}
            {widgets.length > 0 && (
              <span className={clsx(
                "ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold",
                tab === "mine" ? "bg-accent-blue/20 text-accent-blue" : "bg-surface-hover text-text-muted"
              )}>
                {widgets.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab("selfAdd")}
            className={clsx(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150",
              tab === "selfAdd"
                ? "bg-accent-blue/15 text-accent-blue border border-accent-blue/30 shadow-xs"
                : "text-text-secondary border border-transparent hover:text-accent-blue hover:bg-accent-blue/10"
            )}
          >
            <Plus size={12} /> {t("selfAdd")}
          </button>
        </div>
      </div>

      <section aria-labelledby="widget-presets-title" className="glass-card p-3 space-y-2">
        <div
          className="flex items-center justify-between gap-3 cursor-pointer select-none"
          onClick={() => setPresetsOpen((v) => !v)}
        >
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-accent-blue/10 text-accent-blue">
              <Save size={14} />
            </span>
            <div>
              <h2 id="widget-presets-title" className="text-xs font-semibold text-text-primary flex items-center gap-2">
                {t("presets.title")}
                {presets.length > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full bg-surface-hover text-text-muted text-[10px]">
                    {presets.length}
                  </span>
                )}
              </h2>
              <p className="text-[11px] text-text-muted">{t("presets.description")}</p>
            </div>
          </div>
          <button
            type="button"
            className="text-text-muted hover:text-text-primary p-1"
            aria-label={presetsOpen ? t("common:collapse") : t("common:expand")}
          >
            {presetsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>

        {presetsOpen && (
          <div className="pt-2 border-t border-surface-border/50 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  value={presetName}
                  onChange={(event) => setPresetName(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter") handleSavePreset(); }}
                  placeholder={t("presets.namePlaceholder")}
                  aria-label={t("presets.nameLabel")}
                  className="ui-field w-40 text-xs"
                />
                <button onClick={handleSavePreset} disabled={!presetName.trim() || widgets.length === 0} className="btn-primary text-xs py-1.5 px-3">
                  <Save size={12} /> {t("presets.save")}
                </button>
                <button onClick={handleExportPresets} disabled={presets.length === 0} className="text-xs border border-surface-border rounded-lg px-2 py-1.5 disabled:opacity-50">{t("presets.export")}</button>
                <button onClick={() => presetImportRef.current?.click()} className="text-xs border border-surface-border rounded-lg px-2 py-1.5">{t("presets.import")}</button>
                <input ref={presetImportRef} type="file" accept="application/json,.json" className="hidden" onChange={handleImportPresets} />
              </div>
            </div>
            <label className="flex items-center justify-between gap-3 text-xs text-text-secondary">
              <span>{t("presets.schedule")}</span>
              <select value={presetSchedule} onChange={(event) => { const value = event.target.value as typeof presetSchedule; setPresetSchedule(value); localStorage.setItem("timelens-widget-preset-schedule", value); }} className="ui-select text-xs">
                <option value="off">{t("presets.scheduleOff")}</option>
                <option value="time">{t("presets.scheduleTime")}</option>
                <option value="focus">{t("presets.scheduleFocus")}</option>
              </select>
            </label>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {presets.map((preset) => (
                <div key={preset.id} className="flex items-center gap-1.5 shrink-0 rounded-lg border border-surface-border px-2 py-1.5">
                  <button onClick={() => void handleApplyPreset(preset)} className="text-xs text-text-primary hover:text-accent-blue" title={t("presets.apply")}>
                    {preset.name}
                  </button>
                  <button onClick={() => persistPresets(presets.filter((item) => item.id !== preset.id))} aria-label={t("presets.delete", { name: preset.name })} title={t("presets.delete", { name: preset.name })} className="text-text-muted hover:text-accent-red">
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section aria-labelledby="widget-health-title" className="glass-card p-3 space-y-2">
        <div
          className="flex items-center justify-between gap-3 cursor-pointer select-none"
          onClick={() => setHealthOpen((v) => !v)}
        >
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-accent-blue/10 text-accent-blue">
              <HeartPulse size={14} />
            </span>
            <div>
              <h2 id="widget-health-title" className="text-xs font-semibold text-text-primary flex items-center gap-2">
                {t("health.title")}
              </h2>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {healthOpen && (
              <button
                onClick={(e) => { e.stopPropagation(); setHealthRefresh((value) => value + 1); }}
                className="text-xs text-accent-blue flex items-center gap-1"
                title={t("health.refresh")}
              >
                <RotateCcw size={12} /> {t("health.refresh")}
              </button>
            )}
            <button
              type="button"
              className="text-text-muted hover:text-text-primary p-1"
              aria-label={healthOpen ? t("common:collapse") : t("common:expand")}
            >
              {healthOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>
        </div>

        {healthOpen && (
          <div className="pt-2 border-t border-surface-border/50">
            <div className="grid gap-2 md:grid-cols-2">
              {widgets.map((widget) => {
                const { heartbeat, lastError } = healthFor(widget);
                const runtimeHealth = runtimeHealthByWidget[widget.id];
                const suspended = !!widget.suspended_until && new Date(widget.suspended_until).getTime() > Date.now();
                return <div key={widget.id} className="rounded-lg border border-surface-border px-3 py-2 text-xs space-y-1">
                  <div className="flex items-center justify-between gap-2"><span className="font-medium text-text-primary">{t(TYPE_LABELS[widget.widget_type] ?? "clock.title")}</span><span className={suspended || widget.paused ? "text-yellow-600" : "text-accent-green"}>{suspended ? t("health.suspended") : widget.paused ? t("health.paused") : t("health.running")}</span></div>
                  <p className="text-text-muted">{t("health.lastRefresh", { value: runtimeHealth?.last_heartbeat_at ? new Date(runtimeHealth.last_heartbeat_at).toLocaleString() : heartbeat.at ? new Date(heartbeat.at).toLocaleString() : t("health.unavailable") })}</p>
                  <p className="text-text-muted">{t("health.memory")}: {runtimeHealth ? `${runtimeHealth.memory_used_mb} MB` : t("health.unavailable")} · {t("health.cpu")}: {runtimeHealth ? `${runtimeHealth.cpu_used_ms} ms` : t("health.unavailable")}</p>
                  <p className="text-text-muted">{t("health.failures")}: {widget.consecutive_failures ?? 0} · {t("health.pausedState")}: {widget.paused ? t("health.yes") : t("health.no")}</p>
                  {suspended && <p className="text-yellow-600">{t("health.suspendedUntil", { value: new Date(widget.suspended_until as string).toLocaleString() })}</p>}
                  {lastError && <p className="text-accent-red truncate" title={lastError.error}>{t("health.lastError", { value: lastError.error })}</p>}
                  {suspended && <button onClick={() => { void api.recoverWidget(widget.id).then(() => emit("timelens-widget-refresh", { widgetId: widget.id })); setHealthRefresh((value) => value + 1); }} className="text-accent-blue hover:underline">{t("health.recover")}</button>}
                </div>;
              })}
            </div>
          </div>
        )}
      </section>

      {/* ── My Widgets tab ── */}
      {tab === "mine" && (
        <div className="flex-1 min-h-0 overflow-y-auto pr-1">
          <div className="space-y-4">
            {loading && (
              <AsyncStateCard variant="loading" title={t("loading")} compact />
            )}
            {!loading && widgets.length === 0 && (
              <AsyncStateCard
                variant="empty"
                title={t("noWidgets")}
                action={(
                  <button
                    onClick={() => setTab("selfAdd")}
                    className="text-xs text-accent-blue underline underline-offset-2"
                  >
                    {t("selfAdd")} →
                  </button>
                )}
              />
            )}
            {!loading && widgets.length > 0 && (
              <div className="flex justify-end">
                <button
                  onClick={() => setTab("selfAdd")}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-surface-border text-text-secondary hover:text-text-primary"
                >
                  <Plus size={12} /> {t("selfAdd")}
                </button>
              </div>
            )}
            {!loading && widgets.length > 0 && (
              <div className={clsx(
                "grid gap-3",
                widgets.length === 1 ? "grid-cols-1" : "grid-cols-2"
              )}>
                {widgets.map((w) => (
                  <WidgetCard
                    key={w.id}
                    config={w}
                    permissionEntries={permissionMatrixByWidget[w.id] ?? []}
                    permissionAuditEntries={permissionAuditByWidget[w.id] ?? []}
                    onPermissionsChanged={() => {
                      void refreshPermissionData();
                    }}
                    onNotify={(message) => {
                      setImportMsg(message);
                      setTimeout(() => setImportMsg(null), 4000);
                    }}
                  />
                ))}
              </div>
            )}
            {importMsg && (
              <p className={clsx(
                "text-xs px-3 py-2 rounded-lg",
                importMsg.kind === "ok" ? "bg-accent-green/10 text-accent-green" : "bg-accent-red/10 text-accent-red"
              )}>
                {importMsg.text}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Add Widget tab — split columns ── */}
      {tab === "selfAdd" && (
        <div className="flex-1 min-h-0 flex gap-5">
          {/* Left column: official */}
          <div className="flex-1 min-w-0 h-full overflow-y-auto overflow-x-hidden py-1 pr-1">
            <div className="space-y-5">
              {GROUP_ORDER.map((group) => {
                const groupEntries = officialEntriesByGroup[group];
                if (!groupEntries || groupEntries.length === 0) return null;
                return (
                  <OfficialWidgetGroup
                    key={group}
                    group={group}
                    entries={groupEntries}
                    installedCount={countByType}
                    onAdd={handleAdd}
                  />
                );
              })}
            </div>
          </div>

          {/* Right column: third-party */}
          <div className="flex-1 min-w-0 h-full overflow-y-auto overflow-x-hidden py-1 pl-1">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
                  {t("thirdPartyWidgets")}
                </p>
                <div className="flex items-center gap-2">
                  {showDevHarness && (
                    <button
                      onClick={() => navigate("/widget-dev-harness")}
                      className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs border border-surface-border
                                 text-text-secondary hover:text-text-primary transition-colors"
                    >
                      <Wrench size={12} /> {t("devHarness.open")}
                    </button>
                  )}
                  <button
                    onClick={handleImportLocalWidget}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs border border-surface-border
                               text-text-secondary hover:text-text-primary transition-colors"
                  >
                    <FolderOpen size={12} /> {t("importLocalWidget")}
                  </button>
                </div>
              </div>

              {thirdPartyEntries.length === 0 && (
                <AsyncStateCard variant="empty" title={t("thirdParty.noWidgets")} compact />
              )}
              <div className="space-y-3">
                {thirdPartyEntries.map(({ type, icon, description, title, source, permissions }) => (
                  <MarketplaceCard
                    key={type}
                    type={type}
                    title={title}
                    icon={icon}
                    source={source}
                    description={description}
                    permissions={permissions}
                    installedCount={countByType(type)}
                    onAdd={handleAdd}
                  />
                ))}
              </div>

              {/* Registry errors */}
              {registryErrors.length > 0 && (
                <div className="space-y-1.5 mt-2">
                  {registryErrors.map((err, i) => (
                    <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-accent-red/10 text-accent-red text-xs">
                      <span className="font-mono opacity-70 truncate">{err.path}</span>
                      <span>{err.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
