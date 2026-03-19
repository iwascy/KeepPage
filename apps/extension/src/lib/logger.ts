export type LogLevel = "debug" | "info" | "warn" | "error";

const DEBUG_MODE_STORAGE_KEY = "debugMode";

let debugLoggingEnabled = false;
let debugLoggingInitialized = false;
let debugLoggingInitPromise: Promise<void> | null = null;
let debugLoggingListenerRegistered = false;

export function createLogger(scope: string) {
  return {
    debug(message: string, details?: unknown) {
      logToConsole(scope, "debug", message, details);
    },
    info(message: string, details?: unknown) {
      logToConsole(scope, "info", message, details);
    },
    warn(message: string, details?: unknown) {
      logToConsole(scope, "warn", message, details);
    },
    error(message: string, details?: unknown) {
      logToConsole(scope, "error", message, details);
    },
  };
}

export function isDebugLoggingEnabled() {
  ensureDebugLoggingInitialized();
  return debugLoggingEnabled;
}

export function logToConsole(
  scope: string,
  level: LogLevel,
  message: string,
  details?: unknown,
) {
  ensureDebugLoggingInitialized();
  if (level === "debug" && !debugLoggingEnabled) {
    return;
  }

  const prefix = `[KeepPage][${new Date().toISOString()}][${level.toUpperCase()}][${scope}]`;
  const writer = level === "error"
    ? console.error
    : level === "warn"
      ? console.warn
      : level === "debug"
        ? console.debug
        : console.info;

  if (details === undefined) {
    writer(prefix, message);
    return;
  }

  writer(prefix, message, details);
}

function ensureDebugLoggingInitialized() {
  if (debugLoggingInitialized || debugLoggingInitPromise || !canUseExtensionStorage()) {
    return;
  }

  if (!debugLoggingListenerRegistered) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes[DEBUG_MODE_STORAGE_KEY]) {
        return;
      }
      debugLoggingEnabled = changes[DEBUG_MODE_STORAGE_KEY].newValue === true;
    });
    debugLoggingListenerRegistered = true;
  }

  debugLoggingInitPromise = chrome.storage.local
    .get(DEBUG_MODE_STORAGE_KEY)
    .then((result) => {
      debugLoggingEnabled = result[DEBUG_MODE_STORAGE_KEY] === true;
    })
    .catch(() => {
      debugLoggingEnabled = false;
    })
    .finally(() => {
      debugLoggingInitialized = true;
      debugLoggingInitPromise = null;
    });
}

function canUseExtensionStorage() {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local && chrome.storage?.onChanged);
}
