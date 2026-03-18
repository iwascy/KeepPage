import { defineContentScript } from "wxt/utils/define-content-script";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  allFrames: true,
  matchAboutBlank: true,
  matchOriginAsFallback: true,
  world: "MAIN",
  main() {
    void import("single-file-core/single-file-hooks-frames.js");
    const marker = "__KEEPPAGE_SINGLEFILE_MAIN_HOOK_READY__";
    (globalThis as Record<string, unknown>)[marker] = true;
  },
});
