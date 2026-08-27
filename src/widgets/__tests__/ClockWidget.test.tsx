import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
// Import test-utils first so its vi.mock registrations apply before the widget
// imports the real Tauri API modules.
import { mockTauriApi, renderWithProviders } from "./test-utils";
import ClockWidget from "../ClockWidget";

function successResponse(payload: unknown) {
  return {
    request_id: "r1",
    status: "success" as const,
    payload,
  };
}

describe("ClockWidget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTauriApi.widgetGatewayRequest.mockReset();
  });

  it("renders title and current time", async () => {
    mockTauriApi.widgetGatewayRequest.mockResolvedValue(
      successResponse({ active: false, active_session: null })
    );
    renderWithProviders(<ClockWidget widgetId="clock-test" />);

    expect(screen.getByText("Clock")).toBeInTheDocument();
    await waitFor(() => {
      expect(mockTauriApi.widgetGatewayRequest).toHaveBeenCalled();
    });
  });

  it("displays focus badge when active session exists", async () => {
    mockTauriApi.widgetGatewayRequest.mockResolvedValue(
      successResponse({
        active: true,
        active_session: {
          id: 1,
          started_at: new Date().toISOString(),
          ended_at: null,
          trigger_type: "manual",
          reason: "focus",
        },
      })
    );
    renderWithProviders(<ClockWidget widgetId="clock-test" />);

    await waitFor(() => {
      expect(screen.getByText("Focus")).toBeInTheDocument();
    });
  });
});
