import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
// Import test-utils first so its vi.mock registrations apply before the widget
// imports the real Tauri API modules.
import {
  mockTauriApi,
  renderWithProviders,
  resetWidgetMocks,
  successResponse,
} from "./test-utils";
import TodoWidget from "../TodoWidget";

function mockTodoResponses(todos: unknown[] = [], goals: unknown[] = [], progress: unknown[] = []) {
  mockTauriApi.widgetGatewayRequest.mockImplementation(async (request: { scope?: string; request_type?: string; payload?: Record<string, unknown> }) => {
    if (request.scope === "todos") {
      return successResponse(todos);
    }
    if (request.scope === "goals") {
      return successResponse({ goals, progress });
    }
    return successResponse(null);
  });
}

describe("TodoWidget", () => {
  beforeEach(() => {
    resetWidgetMocks();
  });

  it("renders title and empty state", async () => {
    mockTodoResponses([], [], []);
    renderWithProviders(<TodoWidget widgetId="todo-test" />);

    expect(screen.getByText("Todo")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("All done! 🎉")).toBeInTheDocument();
    });
  });

  it("loads and displays todos from gateway", async () => {
    mockTodoResponses(
      [
        { id: 1, content: "Buy milk", done: false },
        { id: 2, content: "Walk dog", done: true },
      ],
      [],
      []
    );
    renderWithProviders(<TodoWidget widgetId="todo-test" />);

    await waitFor(() => {
      expect(screen.getByText("Buy milk")).toBeInTheDocument();
    });
    expect(screen.getByText("Walk dog")).toBeInTheDocument();
    expect(screen.getByText("1 remaining")).toBeInTheDocument();
  });

  it("adds a new todo through the input", async () => {
    mockTodoResponses([], [], []);
    mockTauriApi.addTodo.mockResolvedValue({ id: 3, content: "New task", done: false });

    renderWithProviders(<TodoWidget widgetId="todo-test" />);
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Add a task…")).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText("Add a task…");
    await userEvent.type(input, "New task");
    await userEvent.click(screen.getByRole("button", { name: "Add todo" }));

    await waitFor(() => {
      expect(mockTauriApi.addTodo).toHaveBeenCalledWith("New task");
    });
    await waitFor(() => {
      expect(screen.getByText("New task")).toBeInTheDocument();
    });
  });

  it("toggles a todo when checkbox is clicked", async () => {
    mockTodoResponses([{ id: 1, content: "Task", done: false }], [], []);
    mockTauriApi.toggleTodo.mockResolvedValue(undefined);

    renderWithProviders(<TodoWidget widgetId="todo-test" />);
    await waitFor(() => {
      expect(screen.getByText("Task")).toBeInTheDocument();
    });

    const checkbox = screen.getByRole("checkbox");
    await userEvent.click(checkbox);

    await waitFor(() => {
      expect(mockTauriApi.toggleTodo).toHaveBeenCalledWith(1);
    });
  });

  it("deletes a todo when trash button is clicked", async () => {
    mockTodoResponses([{ id: 1, content: "Task", done: false }], [], []);
    mockTauriApi.deleteTodo.mockResolvedValue(undefined);

    renderWithProviders(<TodoWidget widgetId="todo-test" />);
    await waitFor(() => {
      expect(screen.getByText("Task")).toBeInTheDocument();
    });

    const deleteButton = screen.getByRole("button", { name: "Delete todo" });
    await userEvent.click(deleteButton);

    await waitFor(() => {
      expect(mockTauriApi.deleteTodo).toHaveBeenCalledWith(1);
    });
  });

  it("shows clear-completed button when a todo is done", async () => {
    mockTodoResponses([{ id: 1, content: "Task", done: true }], [], []);
    mockTauriApi.deleteTodo.mockResolvedValue(undefined);

    renderWithProviders(<TodoWidget widgetId="todo-test" />);
    await waitFor(() => {
      expect(screen.getByText("Clear completed")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Clear completed"));
    await waitFor(() => {
      expect(mockTauriApi.deleteTodo).toHaveBeenCalledWith(1);
    });
  });
});
