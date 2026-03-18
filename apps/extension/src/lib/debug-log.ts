import { MESSAGE_TYPE, type DebugLogEvent } from "./messages";

export async function emitDebugLogToTab(
  tabId: number | undefined,
  scope: string,
  level: DebugLogEvent["level"],
  message: string,
  details?: unknown,
) {
  if (typeof tabId !== "number") {
    return;
  }

  const event: DebugLogEvent = {
    type: MESSAGE_TYPE.DebugLog,
    scope,
    level,
    message,
    details,
  };

  try {
    await chrome.tabs.sendMessage(tabId, event);
  } catch {
    // Ignore: page may no longer exist or content script may be unavailable.
  }
}
