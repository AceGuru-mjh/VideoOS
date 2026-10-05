// model-hub 测试共享基建：node:http 本地 mock（127.0.0.1 随机端口）+ 请求捕获。
// （附录 F：禁止 mock 全局 fetch —— bun 同进程 fetch 快路径返回失真 Response；
//   唯一放行姿势：node:http 起真服务 + 真实 fetch / 显式 fetchImpl 直连。）
import { createServer } from "node:http";
import type { Server } from "node:http";

export interface CapturedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface MockHandler {
  (req: CapturedRequest): { status: number; payload: string };
}

export interface RouteMock {
  url: string;
  requests: CapturedRequest[];
  setHandler(handler: MockHandler): void;
  stop(): void;
}

export function startRouteMock(initial: MockHandler): Promise<RouteMock> {
  const requests: CapturedRequest[] = [];
  let handler: MockHandler = initial;
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      raw += chunk;
    });
    req.on("end", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        headers[k] = Array.isArray(v) ? v.join(", ") : (v ?? "");
      }
      let body: unknown = raw;
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw;
        }
      }
      const captured: CapturedRequest = {
        method: req.method ?? "GET",
        url: `http://127.0.0.1:${port}${req.url ?? "/"}`,
        headers,
        body,
      };
      requests.push(captured);
      const { status, payload } = handler(captured);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(payload);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        requests,
        setHandler(next: MockHandler): void {
          handler = next;
        },
        stop(): void {
          server.close();
          server.closeAllConnections?.();
        },
      });
    });
  });
}

/** 找一个已关闭的本地端口（网络错误分支测试用：连接必拒） */
export async function closedPortUrl(): Promise<string> {
  const probe = createServer();
  await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
  const addr = probe.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : 0;
  await new Promise<void>((r) => probe.close(() => r()));
  return `http://127.0.0.1:${port}`;
}

/** OpenAI chat completion 成功响应体 */
export const openAiChatPayload = (content: string, model: string): string =>
  JSON.stringify({
    choices: [{ message: { content, role: "assistant" } }],
    usage: { prompt_tokens: 9, completion_tokens: 5 },
    model,
  });

/** OpenAI /models 成功响应体 */
export const openAiModelsPayload = (ids: string[]): string =>
  JSON.stringify({ object: "list", data: ids.map((id) => ({ id, object: "model" })) });
