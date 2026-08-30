import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, resetWidgetMocks } from "./test-utils";
import TimerWidget from "../TimerWidget";

describe("TimerWidget", () => {
  beforeEach(() => {
    resetWidgetMocks();
  });

  it("renders pomodoro mode by default", async () => {
    renderWithProviders(<TimerWidget widgetId="timer-test" />);

    expect(screen.getByText("Timer")).toBeInTheDocument();
    expect(screen.getByText("Pomodoro")).toBeInTheDocument();
    expect(screen.getByText("25:00")).toBeInTheDocument();
  });

  it("switches to countdown mode", async () => {
    renderWithProviders(<TimerWidget widgetId="timer-test" />);

    await userEvent.click(screen.getByRole("button", { name: "Countdown" }));

    await waitFor(() => {
      expect(screen.getByText("Countdown")).toHaveClass("text-accent-blue");
    });
  });

  it("toggles timer running state", async () => {
    renderWithProviders(<TimerWidget widgetId="timer-test" />);

    const startButton = screen.getByRole("button", { name: "Start" });
    await userEvent.click(startButton);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    });
  });
});
