import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiProxyTarget = process.env.KEEPPAGE_API_PROXY_TARGET ?? "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react()],
  build: {
    target: "es2020",
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        demo: path.resolve(__dirname, "demo.html"),
      },
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react")) {
            return "react-vendor";
          }
          if (id.includes("node_modules/zod")) {
            return "zod-vendor";
          }
          if (id.includes("/packages/domain/")) {
            return "domain";
          }
          if (id.includes("/src/features/imports/")) {
            return "imports";
          }
          if (id.includes("/src/features/private/")) {
            return "private";
          }
          if (id.includes("/src/features/api-tokens/")) {
            return "api-tokens";
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
        rewrite: (inputPath) => inputPath.replace(/^\/api/, ""),
      },
    },
  },
});
