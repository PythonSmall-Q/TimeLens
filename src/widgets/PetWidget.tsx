import { useEffect, useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { X, Upload, Sparkles, Settings2, Star } from "lucide-react";
import * as api from "@/services/tauriApi";
import { useWidgetErrorReporter } from "@/hooks/useWidgetErrorReporter";
import { useWidgetClient } from "@/hooks/useWidgetClient";
import type {
  DesktopPetPackManifest,
  DesktopPetPackState,
  DesktopPetStateKey,
  MonitorStatus,
} from "@/types";
import clsx from "clsx";

interface Props {
  widgetId: string;
}

interface PetSchedule {
  enabled: boolean;
  start: string;
  end: string;
}

const DEFAULT_SCHEDULE: PetSchedule = { enabled: false, start: "09:00", end: "18:00" };

const MESSAGE_ROTATE_MS = 15000;

function getStringArray(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    const strings = value.filter(
      (item): item is string => typeof item === "string" && item.trim().length > 0
    );
    return strings.length > 0 ? strings : fallback;
  }
  return fallback;
}

function sanitizeState(input: unknown, fallback: DesktopPetPackState): DesktopPetPackState {
  const candidate = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const messages = Array.isArray(candidate.messages)
    ? candidate.messages.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : fallback.messages;

  return {
    label:
      typeof candidate.label === "string" && candidate.label.trim().length > 0
        ? candidate.label
        : fallback.label,
    messages: messages.length > 0 ? messages : fallback.messages,
    accent_color:
      typeof candidate.accent_color === "string" && candidate.accent_color.trim().length > 0
        ? candidate.accent_color
        : fallback.accent_color,
    avatar_emoji:
      typeof candidate.avatar_emoji === "string" && candidate.avatar_emoji.trim().length > 0
        ? candidate.avatar_emoji
        : fallback.avatar_emoji,
    avatar_image:
      typeof candidate.avatar_image === "string" && candidate.avatar_image.trim().length > 0
        ? candidate.avatar_image
        : undefined,
  };
}

function parsePetManifest(
  raw: string | null | undefined,
  fallback: DesktopPetPackManifest
): DesktopPetPackManifest {
  if (!raw) return fallback;

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const states = parsed.states && typeof parsed.states === "object"
      ? (parsed.states as Record<string, unknown>)
      : {};
    const interactions = parsed.interactions && typeof parsed.interactions === "object"
      ? (parsed.interactions as Record<string, unknown>)
      : {};
    const tapMessages = Array.isArray(interactions.tap_messages)
      ? interactions.tap_messages.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : undefined;

    return {
      manifest_version:
        typeof parsed.manifest_version === "string" && parsed.manifest_version.trim().length > 0
          ? parsed.manifest_version
          : fallback.manifest_version,
      pack_id:
        typeof parsed.pack_id === "string" && parsed.pack_id.trim().length > 0
          ? parsed.pack_id
          : fallback.pack_id,
      name:
        typeof parsed.name === "string" && parsed.name.trim().length > 0
          ? parsed.name
          : fallback.name,
      description: typeof parsed.description === "string" ? parsed.description : fallback.description,
      character_name:
        typeof parsed.character_name === "string" && parsed.character_name.trim().length > 0
          ? parsed.character_name
          : fallback.character_name,
      default_avatar_emoji:
        typeof parsed.default_avatar_emoji === "string" && parsed.default_avatar_emoji.trim().length > 0
          ? parsed.default_avatar_emoji
          : fallback.default_avatar_emoji,
      states: {
        idle: sanitizeState(states.idle, fallback.states.idle),
        focus: sanitizeState(states.focus, fallback.states.focus),
        rest: sanitizeState(states.rest, fallback.states.rest),
      },
      interactions:
        tapMessages && tapMessages.length > 0
          ? { tap_messages: tapMessages }
          : fallback.interactions,
    };
  } catch {
    return fallback;
  }
}

function pickMessage(messages: string[], index: number): string {
  return messages[index % messages.length] ?? messages[0] ?? "";
}

function parseStoredStringArray(raw: unknown): string[] {
  if (!raw || typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  } catch {
    return [];
  }
}

function parseStoredSchedule(raw: unknown): PetSchedule | null {
  if (!raw || typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.start !== "string" || typeof parsed.end !== "string") return null;
    return {
      enabled: parsed.enabled === true,
      start: parsed.start,
      end: parsed.end,
    };
  } catch {
    return null;
  }
}

function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map((part) => Number.parseInt(part, 10));
  const h = Number.isFinite(hours) ? hours : 0;
  const m = Number.isFinite(minutes) ? minutes : 0;
  return h * 60 + m;
}

function isWithinScheduleWindow(now: Date, start: string, end: string): boolean {
  const startMin = timeToMinutes(start);
  const endMin = timeToMinutes(end);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (startMin === endMin) return true;
  return startMin < endMin
    ? nowMin >= startMin && nowMin < endMin
    : nowMin >= startMin || nowMin < endMin;
}

export default function PetWidget({ widgetId }: Props) {
  const { t } = useTranslation(["widgets", "common"]);
  useWidgetErrorReporter(widgetId);
  const client = useWidgetClient({ widgetId, widgetType: "pet" });

  const fallbackManifest = useMemo<DesktopPetPackManifest>(() => {
    const makeState = (key: string, color: string, emoji: string): DesktopPetPackState => ({
      label: t(`pet.fallback.states.${key}.label`),
      messages: getStringArray(
        t(`pet.fallback.states.${key}.messages`, { returnObjects: true }),
        [t("pet.fallbackMessage")]
      ),
      accent_color: color,
      avatar_emoji: emoji,
    });

    return {
      manifest_version: "1",
      pack_id: "timelens.fallback-pet",
      name: t("pet.fallback.name"),
      description: t("pet.fallback.description"),
      character_name: t("pet.fallback.characterName"),
      default_avatar_emoji: "🐾",
      states: {
        idle: makeState("idle", "#f59e0b", "🐾"),
        focus: makeState("focus", "#0ea5e9", "🎯"),
        rest: makeState("rest", "#14b8a6", "🌿"),
      },
      interactions: {
        tap_messages: getStringArray(
          t("pet.fallback.interactions.tap_messages", { returnObjects: true }),
          [t("pet.fallbackMessage")]
        ),
      },
    };
  }, [t]);

  const [manifest, setManifest] = useState<DesktopPetPackManifest>(fallbackManifest);
  const [packDir, setPackDir] = useState<string | null>(null);
  const [monitorStatus, setMonitorStatus] = useState<MonitorStatus | null>(null);
  const [focusActive, setFocusActive] = useState(false);
  const [tapIndex, setTapIndex] = useState(0);
  const [rotateIndex, setRotateIndex] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const [importing, setImporting] = useState(false);
  const [importHint, setImportHint] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [quiet, setQuiet] = useState(false);
  const [compact, setCompact] = useState(false);
  const [schedule, setSchedule] = useState<PetSchedule>(DEFAULT_SCHEDULE);

  // Load manifest and persisted pack directory.
  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const [widgets, savedPackDir] = await Promise.all([
          api.getAllWidgets(),
          api.getWidgetState(widgetId, "pack_dir"),
        ]);
        const widget = widgets.find((item) => item.id === widgetId);
        if (mounted) {
          setManifest(parsePetManifest(widget?.data_json, fallbackManifest));
          setPackDir(savedPackDir);
        }
      } catch {
        if (mounted) {
          setManifest(fallbackManifest);
        }
      }

      try {
        const [monitor, focusResult] = await Promise.all([
          api.getMonitorStatus(),
          client.query<{ active: boolean }>("focus"),
        ]);
        if (mounted) {
          setMonitorStatus(monitor);
          setFocusActive(focusResult.active);
        }
      } catch {
        // Keep fallback display state.
      }

      try {
        const stop = await api.onActiveWindowChanged((info) => {
          setMonitorStatus((prev) => ({
            active: prev?.active ?? true,
            current_app: info.app_name,
            current_exe_path: info.exe_path,
            current_title: info.window_title,
          }));
        });
        return stop;
      } catch {
        return undefined;
      }
    };

    let cleanup: (() => void) | undefined;
    load().then((fn) => {
      cleanup = fn;
    });

    const timer = window.setInterval(() => {
      client
        .query<{ active: boolean }>("focus")
        .then((r) => setFocusActive(r.active))
        .catch(() => {});
      api.getMonitorStatus().then(setMonitorStatus).catch(() => {});
      setNow(new Date());
    }, 5000);

    return () => {
      mounted = false;
      window.clearInterval(timer);
      cleanup?.();
    };
  }, [client, widgetId, fallbackManifest]);

  // Load persisted pet preferences (favorites, quiet, compact, schedule).
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [favRaw, quietRaw, compactRaw, scheduleRaw] = await Promise.all([
          client.getState("pet_favorites"),
          client.getState("pet_quiet"),
          client.getState("pet_compact"),
          client.getState("pet_schedule"),
        ]);
        if (!mounted) return;
        setFavorites(parseStoredStringArray(favRaw));
        setQuiet(quietRaw === "1");
        setCompact(compactRaw === "1");
        const parsedSchedule = parseStoredSchedule(scheduleRaw);
        if (parsedSchedule) setSchedule(parsedSchedule);
      } catch {
        // Keep defaults when preference state is unavailable.
      }
    })();
    return () => {
      mounted = false;
    };
  }, [client]);

  // Gently rotate the greeting message unless quiet mode is on.
  useEffect(() => {
    if (quiet) return;
    const timer = window.setInterval(() => {
      setRotateIndex((index) => index + 1);
    }, MESSAGE_ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [quiet]);

  const scheduleAway =
    schedule.enabled && !isWithinScheduleWindow(now, schedule.start, schedule.end);

  const stateKey: DesktopPetStateKey = scheduleAway
    ? "rest"
    : focusActive
      ? "focus"
      : monitorStatus?.active === false
        ? "rest"
        : "idle";

  // A new state starts from its greeting, not the previous tap position.
  useEffect(() => {
    setRotateIndex(0);
    setTapIndex(0);
  }, [stateKey]);

  const state = manifest.states[stateKey] ?? fallbackManifest.states.idle;
  const accentColor = state.accent_color || "#f59e0b";

  const getAvatarSrc = (petState: DesktopPetPackState): string | null => {
    if (!petState.avatar_image || !packDir) return null;
    const assetPath = `${packDir.replace(/\\/g, "/")}/${petState.avatar_image}`;
    return convertFileSrc(assetPath);
  };

  const avatarSrc = getAvatarSrc(state);

  const tapPool = useMemo(() => {
    const tapMessages = manifest.interactions?.tap_messages?.length
      ? manifest.interactions.tap_messages
      : fallbackManifest.interactions?.tap_messages ?? [];
    return favorites.length > 0 ? [...favorites, ...tapMessages] : tapMessages;
  }, [favorites, manifest.interactions, fallbackManifest.interactions]);

  const message = useMemo(() => {
    if (tapIndex > 0) {
      return pickMessage(tapPool, tapIndex - 1);
    }
    if (quiet) {
      return state.messages[0] ?? "";
    }
    return pickMessage(state.messages, rotateIndex);
  }, [tapIndex, tapPool, quiet, state.messages, rotateIndex]);

  const isFavorite = message.length > 0 && favorites.includes(message);

  const persistQuiet = (next: boolean) => {
    setQuiet(next);
    const op = next ? client.setState("pet_quiet", "1") : client.deleteState("pet_quiet");
    op.catch(() => {});
  };

  const persistCompact = (next: boolean) => {
    setCompact(next);
    const op = next ? client.setState("pet_compact", "1") : client.deleteState("pet_compact");
    op.catch(() => {});
  };

  const updateSchedule = (patch: Partial<PetSchedule>) => {
    const next = { ...schedule, ...patch };
    setSchedule(next);
    client.setState("pet_schedule", JSON.stringify(next)).catch(() => {});
  };

  const toggleFavorite = () => {
    if (!message) return;
    const next = favorites.includes(message)
      ? favorites.filter((item) => item !== message)
      : [...favorites, message];
    setFavorites(next);
    client.setState("pet_favorites", JSON.stringify(next)).catch(() => {});
  };

  const handleImport = async () => {
    if (importing) return;
    setImporting(true);
    setImportHint(null);
    try {
      const selected = await open({ directory: true, multiple: false, title: t("petStudio.importPack") });
      if (!selected || typeof selected !== "string") return;
      const updated = await api.importPetPack(widgetId, selected);
      setManifest(parsePetManifest(updated.data_json, fallbackManifest));
      setPackDir(selected);
      setImportHint(t("pet.importSuccess"));
      setTimeout(() => setImportHint(null), 3000);
    } catch (err) {
      console.error("Failed to import pet pack", err);
      setImportHint(t("pet.importError"));
      setTimeout(() => setImportHint(null), 4000);
    } finally {
      setImporting(false);
    }
  };

  const previewStates: DesktopPetStateKey[] = ["idle", "focus", "rest"];

  return (
    <div
      className={clsx(
        "w-full h-full glass-card flex flex-col p-4 select-none overflow-hidden",
        compact && "pet-compact"
      )}
    >
      <div data-tauri-drag-region className="flex items-center justify-between mb-2">
        <span className="text-text-muted text-xs">{manifest.character_name}</span>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              onClick={() => setSettingsOpen((open) => !open)}
              className="text-text-muted hover:text-text-secondary transition-colors"
              title={t("pet.settings")}
              aria-label={t("pet.settings")}
              aria-expanded={settingsOpen}
            >
              <Settings2 size={13} />
            </button>
            {settingsOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setSettingsOpen(false)}
                  aria-hidden="true"
                />
                <div className="absolute right-0 top-5 z-50 w-64 rounded-xl border border-surface-border bg-surface/95 backdrop-blur p-3 shadow-xl flex flex-col gap-2.5">
                  <label className="flex items-center gap-2 text-xs text-text-primary cursor-pointer">
                    <input
                      type="checkbox"
                      className="ui-checkbox flex-shrink-0"
                      checked={quiet}
                      onChange={(event) => persistQuiet(event.target.checked)}
                      aria-label={t("pet.quietMode")}
                    />
                    <span className="flex-1">{t("pet.quietMode")}</span>
                  </label>
                  <p className="text-[10px] text-text-muted -mt-1 pl-6">{t("pet.quietModeHint")}</p>
                  <label className="flex items-center gap-2 text-xs text-text-primary cursor-pointer">
                    <input
                      type="checkbox"
                      className="ui-checkbox flex-shrink-0"
                      checked={compact}
                      onChange={(event) => persistCompact(event.target.checked)}
                      aria-label={t("pet.compactMode")}
                    />
                    <span className="flex-1">{t("pet.compactMode")}</span>
                  </label>
                  <div className="border-t border-surface-border pt-2 flex flex-col gap-2">
                    <label className="flex items-center gap-2 text-xs text-text-primary cursor-pointer">
                      <input
                        type="checkbox"
                        className="ui-checkbox flex-shrink-0"
                        checked={schedule.enabled}
                        onChange={(event) => updateSchedule({ enabled: event.target.checked })}
                        aria-label={t("pet.schedule")}
                      />
                      <span className="flex-1">{t("pet.schedule")}</span>
                    </label>
                    <div className="flex items-center gap-1.5 pl-6">
                      <input
                        type="time"
                        value={schedule.start}
                        onChange={(event) => updateSchedule({ start: event.target.value })}
                        disabled={!schedule.enabled}
                        className="ui-field flex-1 text-xs"
                        aria-label={t("pet.scheduleStart")}
                      />
                      <span className="text-text-muted text-xs">–</span>
                      <input
                        type="time"
                        value={schedule.end}
                        onChange={(event) => updateSchedule({ end: event.target.value })}
                        disabled={!schedule.enabled}
                        className="ui-field flex-1 text-xs"
                        aria-label={t("pet.scheduleEnd")}
                      />
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
          <button
            onClick={() => void handleImport()}
            disabled={importing}
            className="text-text-muted hover:text-text-secondary disabled:opacity-50 transition-colors"
            title={t("petStudio.importPack")}
            aria-label={t("petStudio.importPack")}
          >
            <Upload size={13} />
          </button>
          <button
            onClick={() => getCurrentWebviewWindow().close()}
            className="text-text-muted hover:text-accent-red transition-colors"
            title={t("common:close")}
            aria-label={t("common:close")}
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {importHint && (
        <div className={clsx(
          "mb-2 text-[11px] px-2.5 py-1.5 rounded-lg flex items-center gap-1.5",
          importHint === t("pet.importSuccess")
            ? "bg-accent-green/10 text-accent-green"
            : "bg-accent-red/10 text-accent-red"
        )}>
          {importHint}
        </div>
      )}

      {!compact && (
        <div className="mb-2 flex items-center justify-center gap-1.5 flex-wrap">
          <span className="text-[10px] uppercase tracking-wide text-text-muted">
            {t("pet.preview")}
          </span>
          {previewStates.map((key) => {
            const previewState = manifest.states[key] ?? fallbackManifest.states[key];
            const src = getAvatarSrc(previewState);
            return (
              <div
                key={key}
                title={`${t("pet.preview")}: ${previewState.label}`}
                className="flex items-center gap-1 rounded-full border border-surface-border bg-surface-hover/40 pl-1 pr-2 py-0.5"
              >
                <span className="w-4 h-4 flex items-center justify-center text-xs">
                  {src ? (
                    <img src={src} alt="" className="w-4 h-4 object-contain" />
                  ) : (
                    <span aria-hidden="true">
                      {previewState.avatar_emoji || manifest.default_avatar_emoji}
                    </span>
                  )}
                </span>
                <span className="text-[10px] text-text-secondary">{previewState.label}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex-1 min-h-0 w-full flex flex-col items-center justify-center gap-3">
        <button
          onClick={() => setTapIndex((i) => i + 1)}
          className="flex flex-col items-center gap-3 focus:outline-none"
        >
          <div
            className={clsx(
              "relative rounded-3xl flex items-center justify-center border-2 border-white/10 shadow-lg animate-float",
              compact ? "w-12 h-12 text-2xl" : "w-28 h-28 text-5xl"
            )}
            style={{ backgroundColor: `${accentColor}22`, borderColor: `${accentColor}33` }}
          >
            {avatarSrc ? (
              <img
                src={avatarSrc}
                alt={manifest.character_name}
                className="w-full h-full object-contain p-2"
              />
            ) : (
              <span aria-hidden="true">{state.avatar_emoji || manifest.default_avatar_emoji}</span>
            )}
            <span
              className="absolute -top-1 -right-1 px-2 py-0.5 rounded-full text-[10px] text-white/95 shadow"
              style={{ backgroundColor: accentColor }}
            >
              {state.label}
            </span>
          </div>
        </button>

        {!scheduleAway && (
          <div className="relative w-full">
            <button
              onClick={() => setTapIndex((i) => i + 1)}
              className={clsx(
                "w-full rounded-2xl border border-surface-border bg-surface-hover/50 text-left",
                compact ? "px-3 py-1.5" : "px-4 py-3"
              )}
            >
              <div
                className={clsx(
                  "text-sm text-text-primary",
                  compact ? "truncate leading-snug" : "leading-relaxed text-center"
                )}
              >
                {message}
              </div>
            </button>
            <button
              onClick={toggleFavorite}
              title={t("pet.favorite")}
              aria-label={t("pet.favorite")}
              className="absolute -top-1.5 -right-1.5 p-1 rounded-full bg-surface border border-surface-border shadow-sm transition-colors"
            >
              <Star
                size={11}
                className={isFavorite ? "text-amber-400" : "text-text-muted"}
                fill={isFavorite ? "currentColor" : "none"}
              />
            </button>
          </div>
        )}

        {!scheduleAway && (
          <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
            <Sparkles size={11} style={{ color: accentColor }} />
            <span>{t("pet.tapHint")}</span>
          </div>
        )}
      </div>
    </div>
  );
}
