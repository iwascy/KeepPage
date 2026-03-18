import { defineContentScript } from "wxt/utils/define-content-script";
import { ensureBrowserRuntime } from "../src/lib/browser-polyfill";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  allFrames: true,
  matchAboutBlank: true,
  matchOriginAsFallback: true,
  main() {
    ensureBrowserRuntime();
    void import("single-file-core/single-file-frames.js");
    const marker = "__KEEPPAGE_SINGLEFILE_FRAMES_READY__";
    (globalThis as Record<string, unknown>)[marker] = true;
  },
});
