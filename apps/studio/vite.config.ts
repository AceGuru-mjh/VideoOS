// VideoOS Studio — Vite dev server (dev mode proxies to @videoos/server on 4747).
// Production: `vite build` → dist/, served by packages/server as a static SPA.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:4747" },
      "/ws": { target: "http://127.0.0.1:4747", ws: true },
      // static mounts served by the studio server (thumbnails, rendered videos)
      "/renders": { target: "http://127.0.0.1:4747" },
      "/assets": { target: "http://127.0.0.1:4747" },
    },
  },
  build: { outDir: "dist", assetsDir: "assets" },
  // 相对 base：dist 可挂任意子路径（桌面 /、预览面板 /studio/）
  base: "./",
});
