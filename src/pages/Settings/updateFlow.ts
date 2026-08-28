export type UpdateFlowState =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "download-confirmation"; version: string }
  | { phase: "downloading"; version: string; progress: number | null }
  | { phase: "install-confirmation"; version: string }
  | { phase: "installing"; version: string }
  | { phase: "up-to-date" }
  | { phase: "unavailable" }
  | { phase: "error"; message: string };

export type UpdateFlowEvent =
  | { type: "check" }
  | { type: "available"; version: string }
  | { type: "none" }
  | { type: "download-confirmed" }
  | { type: "download-progress"; progress: number | null }
  | { type: "downloaded" }
  | { type: "install-confirmed" }
  | { type: "error"; message: string }
  | { type: "reset" };

export function transitionUpdateFlow(state: UpdateFlowState, event: UpdateFlowEvent): UpdateFlowState {
  if (event.type === "reset") return { phase: "idle" };
  if (event.type === "error") return { phase: "error", message: event.message };
  if (event.type === "check") return { phase: "checking" };
  if (state.phase === "checking" && event.type === "available") {
    return { phase: "download-confirmation", version: event.version };
  }
  if (state.phase === "checking" && event.type === "none") return { phase: "up-to-date" };
  if (state.phase === "download-confirmation" && event.type === "download-confirmed") {
    return { phase: "downloading", version: state.version, progress: 0 };
  }
  if (state.phase === "downloading" && event.type === "download-progress") {
    return { ...state, progress: event.progress };
  }
  if (state.phase === "downloading" && event.type === "downloaded") {
    return { phase: "install-confirmation", version: state.version };
  }
  if (state.phase === "install-confirmation" && event.type === "install-confirmed") {
    return { phase: "installing", version: state.version };
  }
  return state;
}
