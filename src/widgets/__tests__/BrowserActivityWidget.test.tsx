import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { mockTauriApi, renderWithProviders, resetWidgetMocks } from "./test-utils";
import BrowserActivityWidget from "../BrowserActivityWidget";

describe("BrowserActivityWidget", () => {
  beforeEach(() => {
    resetWidgetMocks();
  });

  it("renders disconnected state", async () => {
    mockTauriApi.widgetGatewayRequest.mockResolvedValue({
      request_id: "r1",
      status: "success",
      payload: { domains: [], status: { connected: false } },
    });
    renderWithProviders(<BrowserActivityWidget widgetId="browser-test" />);

    expect(screen.getByText("Browser Activity")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("Disconnected")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText("No browser data today")).toBeInTheDocument();
    });
  });

  it("renders connected state with domains", async () => {
    mockTauriApi.widgetGatewayRequest.mockResolvedValue({
      request_id: "r1",
      status: "success",
      payload: {
        domains: [{ host: "example.com", total_seconds: 300, visit_count: 5 }],
        status: { connected: true, last_browser_name: "Chrome" },
      },
    });
    renderWithProviders(<BrowserActivityWidget widgetId="browser-test" />);

    await waitFor(() => {
      expect(screen.getByText("Connected")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText("example.com")).toBeInTheDocument();
    });
    expect(screen.getByText("Chrome")).toBeInTheDocument();
  });
});
