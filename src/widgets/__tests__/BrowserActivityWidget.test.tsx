import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { mockTauriApi, renderWithProviders, resetWidgetMocks } from "./test-utils";
import BrowserActivityWidget from "../BrowserActivityWidget";

describe("BrowserActivityWidget", () => {
  beforeEach(() => {
    resetWidgetMocks();
  });

  it("renders disconnected state", async () => {
    mockTauriApi.getBrowserDomainStats.mockResolvedValue([]);
    mockTauriApi.getBrowserExtensionStatus.mockResolvedValue({ connected: false });
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
    mockTauriApi.getBrowserDomainStats.mockResolvedValue([
      { host: "example.com", total_seconds: 300, visit_count: 5 },
    ]);
    mockTauriApi.getBrowserExtensionStatus.mockResolvedValue({ connected: true, last_browser_name: "Chrome" });
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
