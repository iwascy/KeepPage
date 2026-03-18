import { isStaleExtensionContextError } from "./extension-errors";

type RuntimeListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
) => unknown | Promise<unknown>;

type BrowserRuntime = {
  runtime: {
    id?: string;
    sendMessage: (message: unknown) => Promise<unknown>;
    getURL: (path: string) => string;
    onMessage: {
      addListener: (listener: RuntimeListener) => void;
      removeListener: (listener: RuntimeListener) => void;
    };
    lastError: chrome.runtime.LastError | undefined;
  };
};

const listenerMap = new WeakMap<RuntimeListener, Parameters<typeof chrome.runtime.onMessage.addListener>[0]>();

export function ensureBrowserRuntime(): BrowserRuntime | undefined {
  const existing = (globalThis as typeof globalThis & { browser?: BrowserRuntime }).browser;
  if (existing) {
    return existing;
  }
  if (typeof chrome === "undefined" || !chrome.runtime) {
    return undefined;
  }

  const browser: BrowserRuntime = {
    runtime: {
      id: chrome.runtime.id,
      sendMessage(message) {
        return new Promise((resolve, reject) => {
          try {
            chrome.runtime.sendMessage(message, (response) => {
              if (chrome.runtime.lastError) {
                const error = new Error(chrome.runtime.lastError.message);
                if (isStaleExtensionContextError(error)) {
                  resolve(undefined);
                  return;
                }
                reject(error);
                return;
              }
              resolve(response);
            });
          } catch (error) {
            if (isStaleExtensionContextError(error)) {
              resolve(undefined);
              return;
            }
            reject(error);
          }
        });
      },
      getURL(path) {
        return chrome.runtime.getURL(path);
      },
      onMessage: {
        addListener(listener) {
          const wrapped: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (
            message,
            sender,
            sendResponse,
          ) => {
            try {
              const result = listener(message, sender);
              if (result && typeof (result as Promise<unknown>).then === "function") {
                (result as Promise<unknown>)
                  .then((value) => {
                    if (value !== undefined) {
                      sendResponse(value);
                    }
                  })
                  .catch((error) => {
                    sendResponse({
                      error: error instanceof Error ? error.message : String(error),
                    });
                  });
                return true;
              }
              if (result !== undefined) {
                sendResponse(result);
              }
              return result !== undefined;
            } catch (error) {
              sendResponse({
                error: error instanceof Error ? error.message : String(error),
              });
              return false;
            }
          };
          listenerMap.set(listener, wrapped);
          chrome.runtime.onMessage.addListener(wrapped);
        },
        removeListener(listener) {
          const wrapped = listenerMap.get(listener);
          if (wrapped) {
            chrome.runtime.onMessage.removeListener(wrapped);
            listenerMap.delete(listener);
          }
        },
      },
      get lastError() {
        return chrome.runtime.lastError;
      },
    },
  };

  (globalThis as typeof globalThis & { browser?: BrowserRuntime }).browser = browser;
  return browser;
}
