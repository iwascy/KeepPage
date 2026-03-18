import { defineContentScript } from "wxt/utils/define-content-script";
import { ensureBrowserRuntime } from "../src/lib/browser-polyfill";
import {
  initSingleFileFetchBridge,
  singleFileFetch,
  singleFileFrameFetch,
} from "../src/lib/singlefile-fetch";

type SingleFilePageData = {
  content?: string | number[];
};

type SingleFileApi = {
  processors?: Record<string, unknown>;
  getPageData: (
    options?: Record<string, unknown>,
    initOptions?: Record<string, unknown>,
    doc?: Document,
    win?: Window,
  ) => Promise<SingleFilePageData>;
};

type SingleFileGlobals = typeof globalThis & {
  singlefile?: SingleFileApi;
  singlefileBootstrap?: Record<string, unknown>;
};

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  main() {
    ensureBrowserRuntime();
    initSingleFileFetchBridge();
    void bootSingleFile();
  },
});

async function bootSingleFile() {
  const globals = globalThis as SingleFileGlobals;
  const [bootstrapModule, singleFileModule] = await Promise.all([
    import("single-file-core/single-file-bootstrap.js"),
    import("single-file-core/single-file.js"),
  ]);

  globals.singlefileBootstrap = bootstrapModule as Record<string, unknown>;

  const createGetPageData = () => (
    options: Record<string, unknown> = {},
    initOptions: Record<string, unknown> = {},
    doc?: Document,
    win?: Window,
  ) =>
    singleFileModule.getPageData(
      options,
      {
        fetch: singleFileFetch,
        frameFetch: singleFileFrameFetch,
        ...initOptions,
      },
      doc,
      win,
    );

  globals.singlefile = {
    ...(globals.singlefile ?? {}),
    processors:
      "processors" in bootstrapModule
        ? (bootstrapModule.processors as Record<string, unknown>)
        : globals.singlefile?.processors,
    getPageData: createGetPageData(),
  };
}
