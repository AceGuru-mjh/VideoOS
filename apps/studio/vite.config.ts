// VideoOS Studio — Vite dev server (dev mode proxies to @videoos/server on 4747).
// Production: `vite build` → dist/, served by packages/server as a static SPA.
// Set VIDEOOS_STUDIO_PROXY (env) to point the dev proxy at another studio
// server instance — e.g. wizard/E2E runs against a scratch server on 4793.
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxyTarget = env.VIDEOOS_STUDIO_PROXY || "http://127.0.0.1:4747";
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": { target: proxyTarget },
        "/ws": { target: proxyTarget, ws: true },
        // static mounts served by the studio server (thumbnails, rendered videos)
        "/renders": { target: proxyTarget },
        "/assets": { target: proxyTarget },
      },
    },
    build: { outDir: "dist", assetsDir: "studio-assets" },
    // 相对 base：dist 可挂任意子路径（桌面 /、预览面板 /studio/）
    // assetsDir 避开 /assets/*（server 的项目资产挂载路径）
    base: "./",
  };
});
