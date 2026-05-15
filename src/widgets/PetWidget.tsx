import { useEffect, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useTranslation } from "react-i18next";
import { PawPrint, Sparkles, X } from "lucide-react";
import * as api from "@/services/tauriApi";
import type {
  DesktopPetPackManifest,
  DesktopPetPackState,
  DesktopPetStateKey,
  MonitorStatus,
} from "@/types";

interface Props {
  widgetId: string;
}

const FALLBACK_MANIFEST: DesktopPetPackManifest = {
  manifest_version: "1",
  pack_id: "timelens.fallback-pet",
  name: "Fallback Companion",
  description: "Fallback desktop pet pack used when manifest data is missing.",
  character_name: "Buddy",
  default_avatar_emoji: "🐾",
  states: {
    idle: {
      label: "Companion",
      messages: ["I am here to keep your rhythm steady."],
      accent_color: "#f59e0b",
      avatar_emoji: "🐾",
    },
    focus: {
      label: "Focus mode",
      messages: ["Protect this block. You do not need to switch context yet."],
      accent_color: "#0ea5e9",
      avatar_emoji: "🎯",
    },
    rest: {
      label: "Resting",
      messages: ["A short reset is part of the work, not a failure."],
      accent_color: "#14b8a6",
      avatar_emoji: "🌿",
    },
  },
  interactions: {
    tap_messages: ["Hydrate, breathe, then continue."],
  },
};

function sanitizeState(input: unknown, fallback: DesktopPetPackState): DesktopPetPackState {
  const candidate = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const messages = Array.isArray(candidate.messages)
    ? candidate.messages.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : fallback.messages;

  return {
    label: typeof candidate.label === "string" && candidate.label.trim().length > 0
      ? candidate.label
      : fallback.label,
    messages: messages.length > 0 ? messages : fallback.messages,
    accent_color: typeof candidate.accent_color === "string" && candidate.accent_color.trim().length > 0
      ? candidate.accent_color
      : fallback.accent_color,
    avatar_emoji: typeof candidate.avatar_emoji === "string" && candidate.avatar_emoji.trim().length > 0
      ? candidate.avatar_emoji
      : fallback.avatar_emoji,
  };
}

function parsePetManifest(raw: string | null | undefined): DesktopPetPackManifest {
  if (!raw) {
    return FALLBACK_MANIFEST;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const states = parsed.states && typeof parsed.states === "object"
      ? parsed.states as Record<string, unknown>
      : {};
    const interactions = parsed.interactions && typeof parsed.interactions === "object"
      ? parsed.interactions as Record<string, unknown>
      : {};
    const tapMessages = Array.isArray(interactions.tap_messages)
      ? interactions.tap_messages.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : undefined;

    return {
      manifest_version: typeof parsed.manifest_version === "string" && parsed.manifest_version.trim().length > 0
        ? parsed.manifest_version
        : FALLBACK_MANIFEST.manifest_version,
      pack_id: typeof parsed.pack_id === "string" && parsed.pack_id.trim().length > 0
        ? parsed.pack_id
        : FALLBACK_MANIFEST.pack_id,
      name: typeof parsed.name === "string" && parsed.name.trim().length > 0
        ? parsed.name
        : FALLBACK_MANIFEST.name,
      description: typeof parsed.description === "string" ? parsed.description : FALLBACK_MANIFEST.description,
      character_name: typeof parsed.character_name === "string" && parsed.character_name.trim().length > 0
        ? parsed.character_name
        : FALLBACK_MANIFEST.character_name,
      default_avatar_emoji: typeof parsed.default_avatar_emoji === "string" && parsed.default_avatar_emoji.trim().length > 0
        ? parsed.default_avatar_emoji
        : FALLBACK_MANIFEST.default_avatar_emoji,
      states: {
        idle: sanitizeState(states.idle, FALLBACK_MANIFEST.states.idle),
        focus: sanitizeState(states.focus, FALLBACK_MANIFEST.states.focus),
        rest: sanitizeState(states.rest, FALLBACK_MANIFEST.states.rest),
      },
      interactions: tapMessages && tapMessages.length > 0 ? { tap_messages: tapMessages } : FALLBACK_MANIFEST.interactions,
    };
  } catch {
    return FALLBACK_MANIFEST;
  }
}

function fillTemplate(template: string, appName: string) {
  return template.split("{{app}}").join(appName);
}

export default function PetWidget({ widgetId }: Props) {
  const { t } = useTranslation(["widgets", "common"]);
  const [manifest, setManifest] = useState<DesktopPetPackManifest>(FALLBACK_MANIFEST);
  const [monitorStatus, setMonitorStatus] = useState<MonitorStatus | null>(null);
  const [focusActive, setFocusActive] = useState(false);
  const [tapIndex, setTapIndex] = useState(0);

  useEffect(() => {
    let mounted = true;
    let unlistenActiveWindow: (() => void) | undefined;

    const load = async () => {
      try {
        const widgets = await api.getAllWidgets();
        const widget = widgets.find((item) => item.id === widgetId);
        if (mounted) {
          setManifest(parsePetManifest(widget?.data_json));
        }
      } catch {
        if (mounted) {
          setManifest(FALLBACK_MANIFEST);
        }
      }

      try {
        const [monitor, focus] = await Promise.all([
          api.getMonitorStatus(),
          api.getFocusModeActive(),
        ]);
        if (mounted) {
          setMonitorStatus(monitor);
          setFocusActive(focus);
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
        unlistenActiveWindow = stop;
      } catch {
        // Event bridge may be unavailable during startup.
      }
    };

    load();

    const timer = window.setInterval(() => {
      void api.getFocusModeActive().then(setFocusActive).catch(() => {});
      void api.getMonitorStatus().then(setMonitorStatus).catch(() => {});
    }, 5000);

    return () => {
      mounted = false;
      window.clearInterval(timer);
      unlistenActiveWindow?.();
    };
  }, [widgetId]);

  const stateKey: DesktopPetStateKey = focusActive
    ? "focus"
    : monitorStatus?.active === false
      ? "rest"
      : "idle";
  const state = manifest.states[stateKey] ?? FALLBACK_MANIFEST.states.idle;
  const activeApp = monitorStatus?.current_app?.trim() || t("pet.defaultApp");
  const stateMessages = state.messages.length > 0 ? state.messages : [t("pet.fallbackMessage")];
  const manifestTapMessages = manifest.interactions?.tap_messages?.length
    ? manifest.interactions.tap_messages
    : [t("pet.fallbackMessage")];
  const allMessages = tapIndex === 0 ? stateMessages : manifestTapMessages;
  const message = fillTemplate(allMessages[tapIndex % allMessages.length] ?? t("pet.fallbackMessage"), activeApp);
  const avatar = state.avatar_emoji || manifest.default_avatar_emoji;
  const accentColor = state.accent_color || "#f59e0b";

  return (
    <div className="w-full h-full glass-card p-4 flex flex-col select-none overflow-hidden">
      <div data-tauri-drag-region className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-text-muted text-xs">
          <PawPrint size={13} />
          <span>{t("pet.title")}</span>
        </div>
        <button
          onClick={() => getCurrentWebviewWindow().close()}
          className="text-text-muted hover:text-accent-red transition-colors"
          title={t("common:close")}
          aria-label={t("common:close")}
        >
          <X size={13} />
        </button>
      </div>

      <button
        onClick={() => setTapIndex((value) => value + 1)}
        className="flex-1 rounded-2xl border border-surface-border p-4 text-left transition-transform hover:scale-[1.01]"
        style={{
          background: `linear-gradient(160deg, ${accentColor}22, rgba(255,255,255,0.03))`,
          boxShadow: `inset 0 0 0 1px ${accentColor}22`,
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-text-muted/80">
              {t("pet.manifestBadge")}
            </div>
            <div className="mt-1 text-lg font-semibold text-text-primary">
              {manifest.character_name}
            </div>
            <div className="text-xs text-text-secondary mt-1">
              {manifest.name} · {t("pet.pack")} {manifest.pack_id}
            </div>
          </div>
          <div
            className="h-16 w-16 rounded-2xl flex items-center justify-center text-4xl border border-white/10"
            style={{ backgroundColor: `${accentColor}22` }}
          >
            <span aria-hidden="true">{avatar}</span>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2 text-xs">
          <span
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-white/95"
            style={{ backgroundColor: accentColor }}
          >
            <Sparkles size={11} />
            {state.label}
          </span>
          <span className="rounded-full bg-surface-hover px-2.5 py-1 text-text-secondary">
            {t("pet.activeApp")}: {activeApp}
          </span>
        </div>

        <div className="mt-4 rounded-2xl bg-surface-hover/60 border border-surface-border px-3 py-3">
          <div className="text-sm leading-6 text-text-primary">
            {message}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between text-xs text-text-muted">
          <span>{t("pet.tapHint")}</span>
          <span>{t("pet.clickAction")} #{tapIndex + 1}</span>
        </div>
      </button>
    </div>
  );
}