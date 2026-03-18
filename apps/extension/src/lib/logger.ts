type LogLevel = "info" | "warn" | "error";

export function createLogger(scope: string) {
  return {
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

export function logToConsole(
  scope: string,
  level: LogLevel,
  message: string,
  details?: unknown,
) {
  const prefix = `[KeepPage][${scope}]`;
  const writer = level === "error"
    ? console.error
    : level === "warn"
      ? console.warn
      : console.info;

  if (details === undefined) {
    writer(prefix, message);
    return;
  }

  writer(prefix, message, details);
}
