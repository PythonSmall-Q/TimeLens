import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockTauriApi, renderWithProviders, resetWidgetMocks } from "./test-utils";
import QuickCaptureWidget from "../QuickCaptureWidget";

describe("QuickCaptureWidget", () => {
  beforeEach(() => {
    resetWidgetMocks();
  });

  it("renders in todo mode", async () => {
    renderWithProviders(<QuickCaptureWidget widgetId="capture-test" />);

    expect(screen.getByText("Quick Capture")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Add a quick task…")).toBeInTheDocument();
  });

  it("switches to note mode", async () => {
    renderWithProviders(<QuickCaptureWidget widgetId="capture-test" />);

    await userEvent.click(screen.getByRole("button", { name: "Note" }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Jot a quick note…")).toBeInTheDocument();
    });
  });

  it("adds a quick todo", async () => {
    mockTauriApi.addTodo.mockResolvedValue({ id: 1, content: "Quick task", done: false });
    renderWithProviders(<QuickCaptureWidget widgetId="capture-test" />);

    const textarea = screen.getByPlaceholderText("Add a quick task…");
    await userEvent.type(textarea, "Quick task");
    await userEvent.click(screen.getByRole("button", { name: "Add todo" }));

    await waitFor(() => {
      expect(mockTauriApi.addTodo).toHaveBeenCalledWith("Quick task");
    });
  });
});
