import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  mockTauriApi,
  renderWithProviders,
  resetWidgetMocks,
  mockGatewayState,
} from "./test-utils";
import NoteWidget from "../NoteWidget";

describe("NoteWidget", () => {
  beforeEach(() => {
    resetWidgetMocks();
  });

  it("renders title and empty state", async () => {
    mockGatewayState({ notes: null, notes_backup: null });
    renderWithProviders(<NoteWidget widgetId="note-test" />);

    expect(screen.getByText("Note")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("No notes yet. Create your first one.")).toBeInTheDocument();
    });
  });

  it("loads notes from gateway state", async () => {
    const notes = JSON.stringify([
      { id: "n1", content: "First note", updatedAt: new Date().toISOString() },
    ]);
    mockGatewayState({ notes, notes_backup: notes });
    renderWithProviders(<NoteWidget widgetId="note-test" />);

    await waitFor(() => {
      expect(screen.getAllByText("First note").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("adds a new note", async () => {
    mockGatewayState({ notes: null, notes_backup: null });
    renderWithProviders(<NoteWidget widgetId="note-test" />);

    await waitFor(() => {
      expect(screen.getByText("No notes yet. Create your first one.")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "Add note" }));

    await waitFor(() => {
      expect(mockTauriApi.widgetGatewayRequest).toHaveBeenCalled();
    });
    const writeCalls = mockTauriApi.widgetGatewayRequest.mock.calls.filter(
      (call) => call[0].request_type === "state_write"
    );
    expect(writeCalls.length).toBeGreaterThan(0);
  });

  it("enables auto blur for the current widget", async () => {
    const onAutoBlurChanged = vi.fn();
    window.addEventListener("timelens-widget-auto-blur-changed", onAutoBlurChanged);
    mockGatewayState({ notes: null, notes_backup: null });
    renderWithProviders(<NoteWidget widgetId="note-test" />);

    await screen.findByText("No notes yet. Create your first one.");
    await userEvent.click(screen.getByRole("button", { name: "Auto-blur when unfocused" }));

    expect(localStorage.getItem("note-test-auto-blur")).toBe("1");
    expect(onAutoBlurChanged).toHaveBeenCalledWith(expect.objectContaining({
      detail: { widgetId: "note-test", enabled: true },
    }));
    window.removeEventListener("timelens-widget-auto-blur-changed", onAutoBlurChanged);
  });

  it("saves edited note content when Save is clicked", async () => {
    const notes = JSON.stringify([
      { id: "n1", content: "First note", updatedAt: new Date().toISOString() },
    ]);
    mockGatewayState({ notes, notes_backup: notes });
    renderWithProviders(<NoteWidget widgetId="note-test" />);

    const editor = await screen.findByRole("textbox");
    await userEvent.type(editor, " updated");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const writeCalls = mockTauriApi.widgetGatewayRequest.mock.calls.filter(
        (call) => call[0].request_type === "state_write"
      );
      expect(writeCalls).toHaveLength(2);
    });
    expect(screen.getByText(/^Saved at/)).toBeInTheDocument();
  });

  it("deletes the current note", async () => {
    const notes = JSON.stringify([
      { id: "n1", content: "First note", updatedAt: new Date().toISOString() },
    ]);
    mockGatewayState({ notes, notes_backup: notes });
    renderWithProviders(<NoteWidget widgetId="note-test" />);

    await waitFor(() => {
      expect(screen.getAllByText("First note").length).toBeGreaterThanOrEqual(1);
    });

    await userEvent.click(screen.getByRole("button", { name: "Delete current note" }));

    await waitFor(() => {
      expect(screen.getByText("No notes yet. Create your first one.")).toBeInTheDocument();
    });
  });
});
