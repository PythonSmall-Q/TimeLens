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
    const today = new Date().toISOString().slice(0, 10);
    let started = false;
    mockTauriApi.widgetGatewayRequest.mockImplementation(async (request: { request_type?: string }) => {
      if (request.request_type === "focus_session_write") {
        started = true;
        return successResponse(null);
      }
      if (started) {
        return successResponse([
          {
            id: 42,
            started_at: `${today}T09:00:00`,
            ended_at: null,
            trigger_type: "manual",
            reason: "focus",
          },
        ]);
      }
      return successResponse([]);
    });
    renderWithProviders(<FocusCoachWidget widgetId="focus-test" />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Start focus" })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "Start focus" }));

    await waitFor(() => {
      expect(mockTauriApi.widgetGatewayRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          request_type: "focus_session_write",
          payload: expect.objectContaining({ action: "start", trigger_type: "manual" }),
        })
      );
    });
    await waitFor(() => {
      expect(screen.getByText("Stop focus")).toBeInTheDocument();
    });
  });

  it("stops the active focus session", async () => {
    const today = new Date().toISOString().slice(0, 10);
    mockTauriApi.widgetGatewayRequest.mockImplementation(async (request: { request_type?: string }) => {
      if (request.request_type === "focus_session_write") {
        return successResponse(null);
      }
      return successResponse([
        {
          id: 7,
          started_at: `${today}T09:00:00`,
          ended_at: null,
          trigger_type: "manual",
          reason: "focus",
        },
      ]);
    });
    renderWithProviders(<FocusCoachWidget widgetId="focus-test" />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Stop focus" })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "Stop focus" }));

    await waitFor(() => {
      const writes = mockTauriApi.widgetGatewayRequest.mock.calls
        .map(([request]) => request as { request_type?: string; payload?: unknown })
        .filter((request) => request.request_type === "focus_session_write");
      expect(writes.length).toBeGreaterThan(0);
      expect(writes[0].payload).toMatchObject({ action: "stop", id: 7 });
    });
  });
});
