import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
// Import test-utils first so its vi.mock registrations apply before the widget
// imports the real Tauri API modules.
import {
  mockTauriApi,
  mockGatewayState,
  renderWithProviders,
  resetWidgetMocks,
  successResponse,
} from "./test-utils";
import PetWidget from "../PetWidget";
import { open } from "@tauri-apps/plugin-dialog";

const mockedOpen = vi.mocked(open);

const CUSTOM_PACK_WIDGET = [
  {
    id: "pet-test",
    data_json: JSON.stringify({
      manifest_version: "1",
      pack_id: "custom.pet",
      name: "Custom Pet",
      character_name: "Custom",
      default_avatar_emoji: "🦊",
      states: {
        idle: {
          label: "Idle",
          messages: ["Idle line one", "Idle line two"],
          accent_color: "#f59e0b",
          avatar_emoji: "🦊",
        },
        focus: {
          label: "Focus",
          messages: ["Focus"],
          accent_color: "#0ea5e9",
          avatar_emoji: "🎯",
        },
        rest: {
          label: "Rest",
          messages: ["Rest"],
          accent_color: "#14b8a6",
          avatar_emoji: "🌿",
        },
      },
      interactions: { tap_messages: ["Tap one"] },
    }),
  },
];

function favoriteWrites() {
  return mockTauriApi.widgetGatewayRequest.mock.calls
    .map(
      (call) =>
        call[0] as {
          scope?: string;
          request_type?: string;
          payload?: { key?: string; value?: string };
        }
    )
    .filter(
      (req) =>
        req.scope === "state" &&
        req.request_type === "state_write" &&
        req.payload?.key === "pet_favorites"
    );
}

function formatHHMM(totalMinutes: number) {
  const minutes = ((totalMinutes % 1440) + 1440) % 1440;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

describe("PetWidget", () => {
  beforeEach(() => {
    resetWidgetMocks();
    mockedOpen.mockReset();
  });

  it("renders fallback pet", async () => {
    mockTauriApi.getAllWidgets.mockResolvedValue([]);
    mockTauriApi.getWidgetState.mockResolvedValue(null);
    mockTauriApi.getMonitorStatus.mockResolvedValue({ active: true, current_app: "Test" });
    mockTauriApi.widgetGatewayRequest.mockResolvedValue(successResponse({ active: false }));
    renderWithProviders(<PetWidget widgetId="pet-test" />);

    await waitFor(() => {
      expect(screen.getByText("Buddy")).toBeInTheDocument();
    });
  });

  it("switches to focus state when focus is active", async () => {
    mockTauriApi.getAllWidgets.mockResolvedValue([]);
    mockTauriApi.getWidgetState.mockResolvedValue(null);
    mockTauriApi.getMonitorStatus.mockResolvedValue({ active: true, current_app: "Test" });
    mockTauriApi.widgetGatewayRequest.mockResolvedValue(successResponse({ active: true }));
    renderWithProviders(<PetWidget widgetId="pet-test" />);

    await waitFor(() => {
      expect(screen.getByText("Focus mode")).toBeInTheDocument();
    });
  });

  it("imports a pet pack from disk", async () => {
    mockTauriApi.getAllWidgets.mockResolvedValue([]);
    mockTauriApi.getWidgetState.mockResolvedValue(null);
    mockTauriApi.getMonitorStatus.mockResolvedValue({ active: true, current_app: "Test" });
    mockTauriApi.widgetGatewayRequest.mockResolvedValue(successResponse({ active: false }));
    mockTauriApi.importPetPack.mockResolvedValue({
      data_json: JSON.stringify({
        manifest_version: "1",
        pack_id: "custom.pet",
        name: "Custom Pet",
        character_name: "Custom",
        default_avatar_emoji: "🦊",
        states: {
          idle: { label: "Idle", messages: ["Hi"], accent_color: "#f59e0b", avatar_emoji: "🦊" },
          focus: { label: "Focus", messages: ["Go"], accent_color: "#0ea5e9", avatar_emoji: "🎯" },
          rest: { label: "Rest", messages: ["Rest"], accent_color: "#14b8a6", avatar_emoji: "🌿" },
        },
      }),
    });
    mockedOpen.mockResolvedValue("/path/to/pet");

    renderWithProviders(<PetWidget widgetId="pet-test" />);
    await waitFor(() => {
      expect(screen.getByText("Buddy")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "Import Pet Pack" }));

    await waitFor(() => {
      expect(mockedOpen).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(mockTauriApi.importPetPack).toHaveBeenCalledWith("pet-test", "/path/to/pet");
    });
  });

  it("persists favorite messages via gateway state", async () => {
    mockTauriApi.getAllWidgets.mockResolvedValue([]);
    mockTauriApi.getMonitorStatus.mockResolvedValue({ active: true, current_app: "Test" });
    mockGatewayState({});
    renderWithProviders(<PetWidget widgetId="pet-test" />);

    await waitFor(() => {
      expect(screen.getByText("Buddy")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("I am here to keep your rhythm steady."));
    await waitFor(() => {
      expect(screen.getByText("Hydrate, breathe, then continue.")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "Favorite message" }));
    await waitFor(() => {
      const writes = favoriteWrites();
      expect(writes[writes.length - 1]?.payload?.value).toBe(
        JSON.stringify(["Hydrate, breathe, then continue."])
      );
    });

    await userEvent.click(screen.getByRole("button", { name: "Favorite message" }));
    await waitFor(() => {
      const writes = favoriteWrites();
      expect(writes[writes.length - 1]?.payload?.value).toBe("[]");
    });
  });

  it("quiet mode suppresses auto-rotating messages", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mockTauriApi.getAllWidgets.mockResolvedValue(CUSTOM_PACK_WIDGET);
      mockTauriApi.getMonitorStatus.mockResolvedValue({ active: true, current_app: "Test" });
      mockGatewayState({ pet_quiet: "1" });
      renderWithProviders(<PetWidget widgetId="pet-test" />);

      await waitFor(() => {
        expect(screen.getByText("Idle line one")).toBeInTheDocument();
      });

      await act(async () => {
        vi.advanceTimersByTime(16000);
      });

      expect(screen.getByText("Idle line one")).toBeInTheDocument();
      expect(screen.queryByText("Idle line two")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rotates messages automatically when quiet mode is off", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mockTauriApi.getAllWidgets.mockResolvedValue(CUSTOM_PACK_WIDGET);
      mockTauriApi.getMonitorStatus.mockResolvedValue({ active: true, current_app: "Test" });
      mockGatewayState({});
      renderWithProviders(<PetWidget widgetId="pet-test" />);

      await waitFor(() => {
        expect(screen.getByText("Idle line one")).toBeInTheDocument();
      });

      await act(async () => {
        vi.advanceTimersByTime(16000);
      });

      await waitFor(() => {
        expect(screen.getByText("Idle line two")).toBeInTheDocument();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies the compact layout when compact mode is stored", async () => {
    mockTauriApi.getAllWidgets.mockResolvedValue([]);
    mockTauriApi.getMonitorStatus.mockResolvedValue({ active: true, current_app: "Test" });
    mockGatewayState({ pet_compact: "1" });
    const { container } = renderWithProviders(<PetWidget widgetId="pet-test" />);

    await waitFor(() => {
      expect(screen.getByText("Buddy")).toBeInTheDocument();
    });

    expect(container.querySelector(".pet-compact")).not.toBeNull();
    expect(screen.queryByText("Preview")).not.toBeInTheDocument();
  });

  it("shows the rest state without messages outside the scheduled window", async () => {
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const schedule = {
      enabled: true,
      start: formatHHMM(nowMinutes + 180),
      end: formatHHMM(nowMinutes + 240),
    };
    mockTauriApi.getAllWidgets.mockResolvedValue([]);
    mockTauriApi.getMonitorStatus.mockResolvedValue({ active: true, current_app: "Test" });
    mockGatewayState({ pet_schedule: JSON.stringify(schedule) });
    const { container } = renderWithProviders(<PetWidget widgetId="pet-test" />);

    await waitFor(() => {
      expect(screen.getByText("Buddy")).toBeInTheDocument();
    });

    const avatar = container.querySelector(".animate-float");
    expect(avatar?.textContent).toContain("🌿");
    expect(avatar?.textContent).toContain("Resting");
    expect(screen.queryByText("I am here to keep your rhythm steady.")).not.toBeInTheDocument();
    expect(screen.queryByText("Tap the pet for another line")).not.toBeInTheDocument();
  });
});
