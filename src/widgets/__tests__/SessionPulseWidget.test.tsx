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
    renderWithProviders(<SessionPulseWidget widgetId="pulse-test" />);

    expect(screen.getByText("Session Pulse")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("No activity data yet")).toBeInTheDocument();
    });
  });

  it("displays focus time and interruptions", async () => {
    const today = new Date().toISOString().slice(0, 10);
    mockTauriApi.widgetGatewayRequest.mockImplementation(async (request: { scope?: string }) => {
      if (request.scope === "hourly") {
        return successResponse([
          { hour: 9, seconds: 1800 },
          { hour: 10, seconds: 0 },
        ]);
      }
      if (request.scope === "interruptions") {
        return successResponse([{ hour: 9, switch_count: 2, fragment_score: 0.5 }]);
      }
      return successResponse([
        {
          id: 1,
          started_at: `${today}T09:00:00`,
          ended_at: `${today}T09:30:00`,
          trigger_type: "manual",
          reason: "focus",
        },
      ]);
    });
    renderWithProviders(<SessionPulseWidget widgetId="pulse-test" />);

    await waitFor(() => {
      expect(screen.getByText("30m")).toBeInTheDocument();
    });
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});
