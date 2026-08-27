import "@testing-library/jest-dom/vitest";

const store: Record<string, string> = {};
Object.defineProperty(window, "localStorage", {
  value: {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      Object.keys(store).forEach((k) => delete store[k]);
    },
  },
  writable: true,
});

// Pin test language before i18n initializes.
window.localStorage.setItem("timelens-language", "en");

// Minimal Tauri webview window mock for widget tests.
Object.defineProperty(globalThis, "__TAURI_INTERNALS__", {
  value: {
    metadata: {
      currentWindow: { label: "test-widget" },
      currentWebview: { label: "test-widget" },
    },
    plugins: {},
    convertFileSrc: (url: string) => url,
    invoke: () => Promise.resolve(),
    transformCallback: () => 0,
  },
  writable: true,
  configurable: true,
});

// Mock matchMedia for components that may query media features.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  }),
});
