import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { mockTauriApi, renderWithProviders, resetWidgetMocks, successResponse } from "./test-utils";
import GoalProgressWidget from "../GoalProgressWidget";

describe("GoalProgressWidget", () => {
  beforeEach(() => {
    resetWidgetMocks();
  });

  it("renders title and empty state", async () => {
    mockTauriApi.widgetGatewayRequest.mockResolvedValue(successResponse({ goals: [], progress: [] }));
    renderWithProviders(<GoalProgressWidget widgetId="goal-test" />);

    expect(screen.getByText("Goal Progress")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("No active goals")).toBeInTheDocument();
    });
  });

  it("loads goals and progress from gateway", async () => {
    mockTauriApi.widgetGatewayRequest.mockResolvedValue(
      successResponse({
        goals: [
          {
            id: 1,
            scope_type: "app",
            scope_value: "Code",
            period: "daily",
            operator: "at_most",
            target_seconds: 3600,
            enabled: true,
          },
        ],
        progress: [
          {
            goal: { id: 1 },
            used_seconds: 1800,
            progress_ratio: 0.5,
            is_completed: false,
          },
        ],
      })
    );
    renderWithProviders(<GoalProgressWidget widgetId="goal-test" />);

    await waitFor(() => {
      expect(screen.getByText(/Code/)).toBeInTheDocument();
    });
    expect(screen.getByText("50%")).toBeInTheDocument();
  });
});
