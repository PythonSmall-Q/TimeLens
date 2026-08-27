import { useEffect, useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { X, Upload, Sparkles } from "lucide-react";
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
  const [importing, setImporting] = useState(false);
  const [importHint, setImportHint] = useState<string | null>(null);

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
    }, 5000);

    return () => {
      mounted = false;
      window.clearInterval(timer);
      cleanup?.();
    };
  }, [client, widgetId, fallbackManifest]);

  const stateKey: DesktopPetStateKey = focusActive
    ? "focus"
    : monitorStatus?.active === false
      ? "rest"
      : "idle";
  const state = manifest.states[stateKey] ?? fallbackManifest.states.idle;
  const accentColor = state.accent_color || "#f59e0b";

  const avatarSrc = useMemo(() => {
    if (!state.avatar_image || !packDir) return null;
    const assetPath = `${packDir.replace(/\\/g, "/")}/${state.avatar_image}`;
    return convertFileSrc(assetPath);
  }, [state.avatar_image, packDir]);

  const message = useMemo(() => {
    const tapMessages = manifest.interactions?.tap_messages?.length
      ? manifest.interactions.tap_messages
      : fallbackManifest.interactions?.tap_messages ?? [t("pet.fallbackMessage")];
    return tapIndex === 0
      ? pickMessage(state.messages, 0)
      : pickMessage(tapMessages, tapIndex);
  }, [state, manifest.interactions, fallbackManifest.interactions, tapIndex, t]);

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

  return (
    <div className="w-full h-full glass-card flex flex-col p-4 select-none overflow-hidden">
      <div data-tauri-drag-region className="flex items-center justify-between mb-2">
        <span className="text-text-muted text-xs">{manifest.character_name}</span>
        <div className="flex items-center gap-2">
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

      <button
        onClick={() => setTapIndex((i) => i + 1)}
        className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 focus:outline-none"
      >
        <div
          className={clsx(
            "relative rounded-3xl flex items-center justify-center border-2 border-white/10 shadow-lg animate-float",
            "w-28 h-28 text-5xl"
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

        <div className="w-full rounded-2xl border border-surface-border bg-surface-hover/50 px-4 py-3">
          <div className="text-sm leading-relaxed text-text-primary text-center">{message}</div>
        </div>

        <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
          <Sparkles size={11} style={{ color: accentColor }} />
          <span>{t("pet.tapHint")}</span>
        </div>
      </button>
    </div>
  );
}
