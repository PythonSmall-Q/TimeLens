import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { mockTauriApi, renderWithProviders, resetWidgetMocks, successResponse } from "./test-utils";
import SessionPulseWidget from "../SessionPulseWidget";

describe("SessionPulseWidget", () => {
  beforeEach(() => {
    resetWidgetMocks();
  });

  it("renders title and empty state", async () => {
    mockTauriApi.widgetGatewayRequest.mockResolvedValue(successResponse([]));
    mockTauriApi.getTodayHourly.mockResolvedValue([]);
    mockTauriApi.getInterruptionPeriods.mockResolvedValue([]);
    renderWithProviders(<SessionPulseWidget widgetId="pulse-test" />);

    expect(screen.getByText("Session Pulse")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("No activity data yet")).toBeInTheDocument();
    });
  });

  it("displays focus time and interruptions", async () => {
    const today = new Date().toISOString().slice(0, 10);
    mockTauriApi.widgetGatewayRequest.mockResolvedValue(
      successResponse([
        {
          id: 1,
          started_at: `${today}T09:00:00`,
          ended_at: `${today}T09:30:00`,
          trigger_type: "manual",
          reason: "focus",
        },
      ])
    );
    mockTauriApi.getTodayHourly.mockResolvedValue([
      { hour: 9, seconds: 1800 },
      { hour: 10, seconds: 0 },
    ]);
    mockTauriApi.getInterruptionPeriods.mockResolvedValue([{ start_hour: 9, switch_count: 2 }]);
    renderWithProviders(<SessionPulseWidget widgetId="pulse-test" />);

    await waitFor(() => {
      expect(screen.getByText("30m")).toBeInTheDocument();
    });
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});
