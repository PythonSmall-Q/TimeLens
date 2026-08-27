import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockTauriApi, renderWithProviders, resetWidgetMocks, successResponse } from "./test-utils";
import FocusCoachWidget from "../FocusCoachWidget";

describe("FocusCoachWidget", () => {
  beforeEach(() => {
    resetWidgetMocks();
  });

  it("renders inactive state", async () => {
    mockTauriApi.widgetGatewayRequest.mockResolvedValue(successResponse([]));
    renderWithProviders(<FocusCoachWidget widgetId="focus-test" />);

    expect(screen.getByText("Focus Coach")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("Ready to focus")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Start focus" })).toBeInTheDocument();
  });

  it("starts a focus session when clicking start", async () => {
    mockTauriApi.widgetGatewayRequest.mockResolvedValue(successResponse([]));
    mockTauriApi.startFocusSession.mockResolvedValue(42);
    renderWithProviders(<FocusCoachWidget widgetId="focus-test" />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Start focus" })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "Start focus" }));

    await waitFor(() => {
      expect(mockTauriApi.startFocusSession).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByText("Stop focus")).toBeInTheDocument();
    });
  });

  it("stops the active focus session", async () => {
    const today = new Date().toISOString().slice(0, 10);
    mockTauriApi.widgetGatewayRequest.mockResolvedValue(
      successResponse([
        {
          id: 7,
          started_at: `${today}T09:00:00`,
          ended_at: null,
          trigger_type: "manual",
          reason: "focus",
        },
      ])
    );
    mockTauriApi.stopFocusSession.mockResolvedValue(undefined);
    renderWithProviders(<FocusCoachWidget widgetId="focus-test" />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Stop focus" })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "Stop focus" }));

    await waitFor(() => {
      expect(mockTauriApi.stopFocusSession).toHaveBeenCalledWith(7);
    });
  });
});
