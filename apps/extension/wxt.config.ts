import { readFileSync } from "node:fs";
import { defineConfig } from "wxt";

const extensionPackage = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };
const extensionManifestVersion = "0.1.27";

if (extensionPackage.version !== extensionManifestVersion) {
  throw new Error("Extension package version and manifest version must stay in sync.");
}

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  browser: "chrome",
  manifestVersion: 3,
  manifest: {
    name: "KeepPage",
    description:
      "Archive-first 书签扩展：先本地归档，再异步同步，带质量诊断与可预览队列。",
    version: extensionManifestVersion,
    permissions: [
      "activeTab",
      "storage",
      "tabs",
      "scripting",
      "sidePanel",
      "contextMenus",
    ],
    host_permissions: ["<all_urls>"],
    action: {
      default_title: "保存当前页面到 KeepPage",
    },
    side_panel: {
      default_path: "sidepanel.html",
    },
    commands: {
      "save-current-page": {
        suggested_key: {
          default: "Ctrl+Shift+Y",
        },
        description: "保存当前页面并写入本地归档队列",
      },
      "open-side-panel": {
        suggested_key: {
          default: "Ctrl+Shift+O",
        },
        description: "打开 KeepPage Side Panel",
      },
    },
  },
});
