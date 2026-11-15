import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@wod/shared": path.join(repoRoot, "packages", "shared", "src", "index.ts"),
      "@wod/engine": path.join(repoRoot, "packages", "engine", "src", "index.ts"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
    fs: {
      allow: [repoRoot],
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
