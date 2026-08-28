import { describe, expect, it } from "vitest";
import { transitionUpdateFlow, type UpdateFlowState } from "./updateFlow";

describe("update flow", () => {
  it("requires both confirmations around download and install", () => {
    let state: UpdateFlowState = { phase: "idle" };
    state = transitionUpdateFlow(state, { type: "check" });
    state = transitionUpdateFlow(state, { type: "available", version: "2.3.0" });
    expect(state.phase).toBe("download-confirmation");
    state = transitionUpdateFlow(state, { type: "download-confirmed" });
    state = transitionUpdateFlow(state, { type: "download-progress", progress: 50 });
    expect(state).toMatchObject({ phase: "downloading", progress: 50 });
    state = transitionUpdateFlow(state, { type: "downloaded" });
    expect(state.phase).toBe("install-confirmation");
    state = transitionUpdateFlow(state, { type: "install-confirmed" });
    expect(state.phase).toBe("installing");
  });

  it("shows unavailable when no updater release can be downloaded", () => {
    const checked = transitionUpdateFlow({ phase: "checking" }, { type: "none" });
    expect(checked.phase).toBe("up-to-date");
    expect(transitionUpdateFlow({ phase: "checking" }, { type: "error", message: "updater unavailable" })).toEqual({
      phase: "error",
      message: "updater unavailable",
    });
  });
});
