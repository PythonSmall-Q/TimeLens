import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  mockTauriApi,
  renderWithProviders,
  resetWidgetMocks,
  mockGatewayState,
  successResponse,
} from "./test-utils";
import StatusWidget from "../StatusWidget";

function mockStatusResponses(habitsState: string | null, focusActive = false) {
  const state: Record<string, string | null> = { habit_board: habitsState };
  mockTauriApi.widgetGatewayRequest.mockImplementation(async (request: { request_type?: string; scope?: string; payload?: { key?: string; value?: string } }) => {
    if (request.scope === "focus") {
      return successResponse({ active: focusActive });
    }
    if (request.scope === "state" && request.request_type === "state_read") {
      const key = request.payload?.key;
      return successResponse(key && key in state ? state[key] : null);
    }
    if (request.scope === "state" && request.request_type === "state_write") {
      const key = request.payload?.key;
      if (key) state[key] = request.payload?.value ?? null;
      return successResponse(null);
    }
    return successResponse(null);
  });
}

describe("StatusWidget", () => {
  beforeEach(() => {
    resetWidgetMocks();
  });

  it("renders title and default habits", async () => {
    mockStatusResponses(null, false);
    renderWithProviders(<StatusWidget widgetId="status-test" />);

    expect(screen.getByText("Habit Tracker")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("Habit 1")).toBeInTheDocument();
    });
  });

  it("loads habits from gateway state", async () => {
    const state = JSON.stringify({
      date: new Date().toISOString().slice(0, 10),
      habits: [{ id: "h1", title: "Read", note: "", done: false }],
      streak: 5,
      lastCompletedDate: null,
    });
    mockStatusResponses(state, false);
    renderWithProviders(<StatusWidget widgetId="status-test" />);

    await waitFor(() => {
      expect(screen.getByText("Read")).toBeInTheDocument();
    });
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("toggles a habit and saves state", async () => {
    mockStatusResponses(null, false);
    renderWithProviders(<StatusWidget widgetId="status-test" />);

    await waitFor(() => {
      expect(screen.getByText("Habit 1")).toBeInTheDocument();
    });

    const checkbox = screen.getAllByRole("checkbox")[0];
    await userEvent.click(checkbox);

    await waitFor(() => {
      const writeCalls = mockTauriApi.widgetGatewayRequest.mock.calls.filter(
        (call) => call[0].request_type === "state_write"
      );
      expect(writeCalls.length).toBeGreaterThan(0);
    });
  });

  it("shows focus badge when focus is active", async () => {
    mockStatusResponses(null, true);
    renderWithProviders(<StatusWidget widgetId="status-test" />);

    await waitFor(() => {
      expect(screen.getByText("Focus")).toBeInTheDocument();
    });
  });
});
