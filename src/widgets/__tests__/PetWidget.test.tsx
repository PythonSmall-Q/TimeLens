import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
// Import test-utils first so its vi.mock registrations apply before the widget
// imports the real Tauri API modules.
import { mockTauriApi, renderWithProviders, resetWidgetMocks, successResponse } from "./test-utils";
import PetWidget from "../PetWidget";
import { open } from "@tauri-apps/plugin-dialog";

const mockedOpen = vi.mocked(open);

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
});
