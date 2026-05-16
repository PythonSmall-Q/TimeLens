import * as api from "@/services/tauriApi";

type LogLevel = "error" | "warn" | "info" | "debug";

function stringifyArg(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return `${arg.name}: ${arg.message}\n${arg.stack ?? ""}`;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function send(level: LogLevel, args: unknown[]) {
  const message = args.map(stringifyArg).join(" ");
  void api.appendFrontendLog(level, message).catch(() => {
    // Keep console behavior non-blocking even if native bridge is unavailable.
  });
}

export function initFrontendFileLogger() {
  const rawConsole = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
  };

  console.log = (...args: unknown[]) => {
    rawConsole.log(...args);
    send("info", args);
  };

  console.info = (...args: unknown[]) => {
    rawConsole.info(...args);
    send("info", args);
  };

  console.warn = (...args: unknown[]) => {
    rawConsole.warn(...args);
    send("warn", args);
  };

  console.error = (...args: unknown[]) => {
    rawConsole.error(...args);
    send("error", args);
  };

  console.debug = (...args: unknown[]) => {
    rawConsole.debug(...args);
    send("debug", args);
  };

  window.addEventListener("error", (event) => {
    const payload = [
      event.message,
      event.filename ? `at ${event.filename}:${event.lineno}:${event.colno}` : "",
      event.error instanceof Error ? event.error.stack ?? "" : "",
    ].filter(Boolean);
    send("error", payload);
  });

  window.addEventListener("unhandledrejection", (event) => {
    send("error", ["UnhandledRejection", stringifyArg(event.reason)]);
  });

  send("info", ["Frontend file logger initialized"]);
}
