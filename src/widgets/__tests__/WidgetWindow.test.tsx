import { beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { mockTauriApi, renderWithProviders, resetWidgetMocks } from "./test-utils";
import WidgetWindow from "../WidgetWindow";

vi.mock("../ExternalWidgetHost", () => ({ default: () => null }));

describe("WidgetWindow", () => {
  beforeEach(() => {
    resetWidgetMocks();
    localStorage.clear();
  });

  it("applies per-widget blur on unfocus without multiplying opacity", async () => {
    localStorage.setItem("timelens-widget-fade-on-blur", "0");
    localStorage.setItem("utility-test-auto-blur", "1");
    mockTauriApi.getCurrentWebviewWindow().isFocused.mockResolvedValue(false);

    renderWithProviders(<WidgetWindow widgetId="utility-test" />);
    const widgetRoot = document.querySelector(".widget-root");

    await waitFor(() => {
      expect(widgetRoot).toHaveClass("widget-root--auto-blurred");
      expect(widgetRoot).not.toHaveClass("widget-root--faded");
    });
  });
});
