import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, "dist-standalone"),
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      input: path.resolve(__dirname, "demo.html"),
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
