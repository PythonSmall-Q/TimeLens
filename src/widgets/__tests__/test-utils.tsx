import { vi } from "vitest";
import { render } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import enCommon from "@/i18n/locales/en/common.json";
import enWidgets from "@/i18n/locales/en/widgets.json";

// Initialize a lightweight i18n instance for widget tests.
i18n.use(initReactI18next).init({
  resources: {
    en: { common: enCommon, widgets: enWidgets },
  },
  lng: "en",
  fallbackLng: "en",
  defaultNS: "common",
  ns: ["common", "widgets"],
  interpolation: { escapeValue: false },
});

// Use individual hoisted mocks so that vi.mock factories can delegate to them.
// Returning a plain object from vi.mock does not reliably share mutable state
// across `import *` consumers (e.g. WidgetClient), but function delegation does.
const mockUnlisten = vi.fn();
const mockWidgetGatewayRequest = vi.fn();
const mockListenWidgetEvent = vi.fn().mockResolvedValue(mockUnlisten);
const mockRecordWidgetPermissionAccess = vi.fn();
const mockWidgetGrantConsent = vi.fn();
const mockWidgetDenyConsent = vi.fn();
const mockGetCurrentWebviewWindow = vi.fn().mockReturnValue({
  close: vi.fn(),
  isFocused: vi.fn().mockResolvedValue(true),
  onFocusChanged: vi.fn().mockResolvedValue(mockUnlisten),
  setMinSize: vi.fn().mockResolvedValue(undefined),
  innerSize: vi.fn().mockResolvedValue({ width: 400, height: 300 }),
  setSize: vi.fn().mockResolvedValue(undefined),
  setAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
});
const mockGetAllWidgets = vi.fn().mockResolvedValue([]);
const mockGetWidgetState = vi.fn().mockResolvedValue(null);
const mockSetWidgetState = vi.fn().mockResolvedValue(undefined);
const mockDeleteWidgetState = vi.fn().mockResolvedValue(undefined);
const mockGetTodayHourly = vi.fn().mockResolvedValue([]);
const mockGetInterruptionPeriods = vi.fn().mockResolvedValue([]);
const mockGetBrowserDomainStats = vi.fn().mockResolvedValue([]);
const mockGetBrowserExtensionStatus = vi.fn().mockResolvedValue({ connected: false });
const mockGetMonitorStatus = vi.fn().mockResolvedValue({ active: true, current_app: "Test" });
const mockOnActiveWindowChanged = vi.fn().mockResolvedValue(mockUnlisten);
const mockImportPetPack = vi.fn();
const mockAddTodo = vi.fn();
const mockToggleTodo = vi.fn();
const mockDeleteTodo = vi.fn();
const mockReorderTodos = vi.fn();
const mockGetTodos = vi.fn().mockResolvedValue([]);
const mockGetUsageGoals = vi.fn().mockResolvedValue([]);
const mockGetGoalProgress = vi.fn().mockResolvedValue([]);
const mockGetFocusModeActive = vi.fn().mockResolvedValue(false);
const mockListFocusSessions = vi.fn().mockResolvedValue([]);
const mockStartFocusSession = vi.fn().mockResolvedValue(1);
const mockStopFocusSession = vi.fn().mockResolvedValue(undefined);
const mockGetLocalApiBaseUrl = vi.fn().mockResolvedValue("http://localhost:0");
const mockIssueWidgetApiToken = vi.fn().mockResolvedValue({ token: "token" });
const mockSendNativeNotification = vi.fn();

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => mockGetCurrentWebviewWindow(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (url: string) => url,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => mockListenWidgetEvent(...args),
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

vi.mock("@tauri-apps/api/dpi", () => ({
  LogicalSize: class {
    constructor(public width: number, public height: number) {}
  },
}));

vi.mock("@/services/tauriApi", () => ({
  widgetGatewayRequest: (...args: unknown[]) => mockWidgetGatewayRequest(...args),
  listenWidgetEvent: (...args: unknown[]) => mockListenWidgetEvent(...args),
  recordWidgetPermissionAccess: (...args: unknown[]) => mockRecordWidgetPermissionAccess(...args),
  widgetGrantConsent: (...args: unknown[]) => mockWidgetGrantConsent(...args),
  widgetDenyConsent: (...args: unknown[]) => mockWidgetDenyConsent(...args),
  getCurrentWebviewWindow: () => mockGetCurrentWebviewWindow(),
  getAllWidgets: (...args: unknown[]) => mockGetAllWidgets(...args),
  getWidgetState: (...args: unknown[]) => mockGetWidgetState(...args),
  setWidgetState: (...args: unknown[]) => mockSetWidgetState(...args),
  deleteWidgetState: (...args: unknown[]) => mockDeleteWidgetState(...args),
  getTodayHourly: (...args: unknown[]) => mockGetTodayHourly(...args),
  getInterruptionPeriods: (...args: unknown[]) => mockGetInterruptionPeriods(...args),
  getBrowserDomainStats: (...args: unknown[]) => mockGetBrowserDomainStats(...args),
  getBrowserExtensionStatus: (...args: unknown[]) => mockGetBrowserExtensionStatus(...args),
  getMonitorStatus: (...args: unknown[]) => mockGetMonitorStatus(...args),
  onActiveWindowChanged: (...args: unknown[]) => mockOnActiveWindowChanged(...args),
  importPetPack: (...args: unknown[]) => mockImportPetPack(...args),
  addTodo: (...args: unknown[]) => mockAddTodo(...args),
  toggleTodo: (...args: unknown[]) => mockToggleTodo(...args),
  deleteTodo: (...args: unknown[]) => mockDeleteTodo(...args),
  reorderTodos: (...args: unknown[]) => mockReorderTodos(...args),
  getTodos: (...args: unknown[]) => mockGetTodos(...args),
  getUsageGoals: (...args: unknown[]) => mockGetUsageGoals(...args),
  getGoalProgress: (...args: unknown[]) => mockGetGoalProgress(...args),
  getFocusModeActive: (...args: unknown[]) => mockGetFocusModeActive(...args),
  listFocusSessions: (...args: unknown[]) => mockListFocusSessions(...args),
  startFocusSession: (...args: unknown[]) => mockStartFocusSession(...args),
  stopFocusSession: (...args: unknown[]) => mockStopFocusSession(...args),
  getLocalApiBaseUrl: (...args: unknown[]) => mockGetLocalApiBaseUrl(...args),
  issueWidgetApiToken: (...args: unknown[]) => mockIssueWidgetApiToken(...args),
  sendNativeNotification: (...args: unknown[]) => mockSendNativeNotification(...args),
}));

export const mockTauriApi = {
  widgetGatewayRequest: mockWidgetGatewayRequest,
  listenWidgetEvent: mockListenWidgetEvent,
  recordWidgetPermissionAccess: mockRecordWidgetPermissionAccess,
  widgetGrantConsent: mockWidgetGrantConsent,
  widgetDenyConsent: mockWidgetDenyConsent,
  getCurrentWebviewWindow: mockGetCurrentWebviewWindow,
  getAllWidgets: mockGetAllWidgets,
  getWidgetState: mockGetWidgetState,
  setWidgetState: mockSetWidgetState,
  deleteWidgetState: mockDeleteWidgetState,
  getTodayHourly: mockGetTodayHourly,
  getInterruptionPeriods: mockGetInterruptionPeriods,
  getBrowserDomainStats: mockGetBrowserDomainStats,
  getBrowserExtensionStatus: mockGetBrowserExtensionStatus,
  getMonitorStatus: mockGetMonitorStatus,
  onActiveWindowChanged: mockOnActiveWindowChanged,
  importPetPack: mockImportPetPack,
  addTodo: mockAddTodo,
  toggleTodo: mockToggleTodo,
  deleteTodo: mockDeleteTodo,
  reorderTodos: mockReorderTodos,
  getTodos: mockGetTodos,
  getUsageGoals: mockGetUsageGoals,
  getGoalProgress: mockGetGoalProgress,
  getFocusModeActive: mockGetFocusModeActive,
  listFocusSessions: mockListFocusSessions,
  startFocusSession: mockStartFocusSession,
  stopFocusSession: mockStopFocusSession,
  getLocalApiBaseUrl: mockGetLocalApiBaseUrl,
  issueWidgetApiToken: mockIssueWidgetApiToken,
  sendNativeNotification: mockSendNativeNotification,
};

export { mockUnlisten };

export function renderWithProviders(ui: React.ReactNode) {
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

/**
 * Build a successful gateway response payload.
 */
export function successResponse(payload: unknown) {
  return {
    request_id: "r1",
    status: "success" as const,
    payload,
  };
}

/**
 * Configure the gateway mock to return a successful payload for a given scope.
 * If no scope is provided, the response is returned for all gateway requests.
 */
export function mockGatewayResponse(payload: unknown, scope?: string) {
  mockWidgetGatewayRequest.mockImplementation(async (request: { scope?: string }) => {
    if (scope && request.scope !== scope) {
      return successResponse(null);
    }
    return successResponse(payload);
  });
}

/**
 * Configure gateway state reads/writes. Provide an initial map of key -> value.
 * State writes update the stored map so subsequent reads reflect the change.
 */
export function mockGatewayState(initialState: Record<string, string | null>) {
  const state = { ...initialState };
  mockWidgetGatewayRequest.mockImplementation(async (request: { request_type?: string; scope?: string; payload?: { key?: string; value?: string } }) => {
    if (request.scope === "state" && request.request_type === "state_read") {
      const key = request.payload?.key;
      if (key && key in state) {
        return successResponse(state[key]);
      }
      return successResponse(null);
    }
    if (request.scope === "state" && request.request_type === "state_write") {
      const key = request.payload?.key;
      if (key) {
        state[key] = request.payload.value ?? null;
      }
      return successResponse(null);
    }
    if (request.scope === "state" && request.request_type === "state_delete") {
      const key = request.payload?.key;
      if (key) {
        delete state[key];
      }
      return successResponse(null);
    }
    return successResponse(null);
  });
}

/**
 * Reset all widget-related mocks between tests.
 */
export function resetWidgetMocks() {
  vi.clearAllMocks();
  mockWidgetGatewayRequest.mockReset();
  mockGetCurrentWebviewWindow.mockReturnValue({
    close: vi.fn(),
    isFocused: vi.fn().mockResolvedValue(true),
    onFocusChanged: vi.fn().mockResolvedValue(mockUnlisten),
    setMinSize: vi.fn().mockResolvedValue(undefined),
    innerSize: vi.fn().mockResolvedValue({ width: 400, height: 300 }),
    setSize: vi.fn().mockResolvedValue(undefined),
    setAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
  });
}
