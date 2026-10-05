// @videoos/server：VideoOS Studio 本地 API 服务器（REST + WebSocket）。
// 用法（CLI `videoos serve` / Electron sidecar）：
//   const { server, port, state } = await startStudioServer({ port: 4747, projectRoot, studioDistDir });
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve, type ServerType } from "@hono/node-server";
import type { Hono } from "hono";
import { WebSocketServer, type WebSocket } from "ws";
import type { ModelProvider } from "@videoos/agent";
import { createStudioApp, type StudioAppOptions } from "./app";
import { ServerState } from "./state";

export { createStudioApp } from "./app";
export type { StudioAppOptions } from "./app";
export { ServerState, ServerError, EventHub } from "./state";
export type { ServerEvent, ServerStateOptions, ProjectSession, RenderJobState } from "./state";
export { STUDIO_TYPINGS } from "./typings";

export interface StartStudioServerOptions extends StudioAppOptions {
  /** 监听端口（默认 4747；0 = 随机） */
  port?: number;
  /** 绑定地址（默认 127.0.0.1，仅本机） */
  host?: string;
  /** 启动即打开的项目根目录 */
  projectRoot?: string;
  /** 数据目录（settings/sessions 落盘根；缺省 defaultDataDir() → 仓根 .videoos-data） */
  dataDir?: string;
  /** Agent provider 工厂（测试注入 ManualProvider 等；缺省 env 装配） */
  agentProviderFactory?: () => ModelProvider[];
}

export interface StudioServerHandle {
  server: ServerType;
  app: Hono;
  state: ServerState;
  port: number;
  wss: WebSocketServer;
  close(): Promise<void>;
}

/** 默认 studio dist 探测路径（monorepo 内 apps/studio/dist） */
function defaultStudioDist(): string | undefined {
  const here = resolve(dirnameOfModule(), "..", "..", "..");
  const candidate = resolve(here, "apps", "studio", "dist");
  return existsSync(candidate) ? candidate : undefined;
}

function dirnameOfModule(): string {
  return fileURLToPath(new URL(".", import.meta.url));
}

export async function startStudioServer(options: StartStudioServerOptions = {}): Promise<StudioServerHandle> {
  const state = new ServerState({
    ...(options.dataDir !== undefined ? { dataDir: options.dataDir } : {}),
    ...(options.agentProviderFactory !== undefined ? { agentProviderFactory: options.agentProviderFactory } : {}),
  });
  // 启动即拉起已配置且 enabled 的 MCP 服务器（host 不可用/无 enabled 条目时 no-op）——
  // 与 PUT /api/mcp/servers 的重启语义一致：重启 Studio 不丢 MCP 运行态
  void state.mcp.start().catch(() => undefined);
  const studioDistDir = options.studioDistDir ?? defaultStudioDist();
  const app = createStudioApp(state, studioDistDir !== undefined ? { studioDistDir } : {});

  const server = serve({ fetch: app.fetch, port: options.port ?? 4747, hostname: options.host ?? "127.0.0.1" });
  const port = (server.address() !== null && typeof server.address() === "object")
    ? (server.address() as { port: number }).port
    : (options.port ?? 4747);

  // WebSocket: /ws（VapEvent + 渲染进度 + server 事件广播）
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/ws") {
      wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
        state.hub.add(ws);
        ws.on("close", () => state.hub.remove(ws));
        ws.send(JSON.stringify({ type: "server", message: `videoos-studio ws ready (port ${port})` }));
      });
    } else {
      socket.destroy();
    }
  });

  if (options.projectRoot !== undefined) {
    await state.open(resolve(options.projectRoot));
  }

  const close = async (): Promise<void> => {
    for (const ws of wss.clients) ws.terminate();
    await new Promise<void>((res, rej) => {
      wss.close(() => res());
      server.close(() => res());
      setTimeout(() => res(), 2000);
      void rej;
    });
  };

  return { server, app, state, port, wss, close };
}
