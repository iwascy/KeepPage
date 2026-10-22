import { useEffect, useState } from "react";

export type ActiveTabInfo = {
  title: string;
  url: string;
  hostname: string;
  favIconUrl?: string;
  // Mirrors background capture rules: only http(s) pages can be saved.
  supported: boolean;
};

function toActiveTabInfo(tab: chrome.tabs.Tab | undefined): ActiveTabInfo | null {
  if (!tab?.url) {
    return null;
  }
  let hostname = "";
  let supported = false;
  try {
    const parsed = new URL(tab.url);
    supported = parsed.protocol === "http:" || parsed.protocol === "https:";
    hostname = supported ? parsed.hostname.replace(/^www\./, "") : parsed.protocol.replace(/:$/, "");
  } catch {
    hostname = tab.url;
  }
  return {
    title: tab.title?.trim() || hostname || "未命名网页",
    url: tab.url,
    hostname,
    favIconUrl: tab.favIconUrl && /^https?:|^data:image\//.test(tab.favIconUrl) ? tab.favIconUrl : undefined,
    supported,
  };
}

/** Tracks the active tab of the window that hosts this side panel. */
export function useActiveTab(enabled: boolean) {
  const [tab, setTab] = useState<ActiveTabInfo | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let windowId: number | undefined;
    let cancelled = false;

    async function refresh() {
      try {
        if (windowId === undefined) {
          windowId = (await chrome.windows.getCurrent()).id;
        }
        const [activeTab] = await chrome.tabs.query(
          windowId === undefined ? { active: true, lastFocusedWindow: true } : { active: true, windowId },
        );
        if (!cancelled) {
          setTab(toActiveTabInfo(activeTab));
        }
      } catch {
        if (!cancelled) {
          setTab(null);
        }
      }
    }

    const onActivated = (info: chrome.tabs.OnActivatedInfo) => {
      if (windowId === undefined || info.windowId === windowId) {
        void refresh();
      }
    };
    const onUpdated = (_tabId: number, change: chrome.tabs.OnUpdatedInfo, updatedTab: chrome.tabs.Tab) => {
      if (!updatedTab.active || (windowId !== undefined && updatedTab.windowId !== windowId)) {
        return;
      }
      if (change.title || change.url || change.favIconUrl || change.status === "complete") {
        setTab(toActiveTabInfo(updatedTab));
      }
    };

    void refresh();
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      cancelled = true;
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [enabled]);

  return tab;
}
