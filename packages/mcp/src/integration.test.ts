// MCP 集成测试：spawn `bun packages/mcp/test-server.ts --project <临时项目>`
// stdin 写 4 行（initialize / notifications/initialized / tools/list / tools/call compile.run）
// → stdout 断言 3 个响应（协议版本、tools 含 compile.run、compile.run 返回 scenes 数）。
// 临时项目必须位于仓库子树内（src/video.ts 的 `import "@videoos/dsl"` 依赖 workspace 解析），
// 目录名避开 packages/apps（防 bun test 误收集）。
import { afterAll, beforeAll, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ProjectWorkspace, createProjectTemplate } from "@videoos/workspace";

const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..");
const PROJECT_DIR = join(REPO_ROOT, `.tmp-mcp-it-${process.pid}`);
const TEST_SERVER = join(import.meta.dir, "..", "test-server.ts");
const TIMEOUT_MS = 30_000;

interface JsonRpcLine {
  jsonrpc: "2.0";
  id?: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

/** 子进程 stdout 逐行读取器（带超时；resolve 收到第 n 行） */
class LineReader {
  private lines: string[] = [];
  private waiters: Array<{ count: number; resolve: (lines: string[]) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }> = [];

  constructor(stream: { on(event: "data", cb: (chunk: Buffer) => void): void }) {
    let buffer = "";
    stream.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        this.lines.push(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
      }
      this.flush();
    });
  }

  private flush(): void {
    this.waiters = this.waiters.filter((w) => {
      if (this.lines.length >= w.count) {
        clearTimeout(w.timer);
        w.resolve(this.lines.splice(0, w.count));
        return false;
      }
      return true;
    });
  }

  /** 等待接下来的 n 行（带超时） */
  next(n: number, label: string): Promise<string[]> {
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.count !== n || w.resolve !== resolvePromise);
        reject(new Error(`timeout waiting for ${n} line(s) (${label}); got so far: ${JSON.stringify(this.lines)}`));
      }, TIMEOUT_MS);
      this.waiters.push({ count: this.lines.length + n, resolve: resolvePromise, reject, timer });
      this.flush();
    });
  }
}

let proc: ReturnType<typeof spawn> | null = null;
let reader: LineReader | null = null;

beforeAll(async () => {
  await rm(PROJECT_DIR, { recursive: true, force: true });
  // init（目录树 + 清单）+ createProjectTemplate（src/video.ts + tests + README）
  const ws = await ProjectWorkspace.init(PROJECT_DIR, { name: "mcp-it" });
  await createProjectTemplate(PROJECT_DIR, ws.manifest.name);
  if (!existsSync(join(PROJECT_DIR, "src", "video.ts"))) throw new Error("template entry missing");

  // spawn bun 运行 test-server（cwd/env 继承；stdio pipe）
  proc = spawn(process.execPath, [TEST_SERVER, "--project", PROJECT_DIR], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
    cwd: REPO_ROOT,
  });
  reader = new LineReader(proc.stdout!);
  proc.stderr!.on("data", (c: Buffer) => {
    const text = c.toString("utf8").trim();
    if (text.length > 0) console.error(`[test-server:stderr] ${text}`);
  });
});

afterAll(async () => {
  if (proc !== null && proc.exitCode === null && !proc.killed) {
    proc.kill("SIGTERM");
    await new Promise<void>((resolvePromise) => {
      const t = setTimeout(() => {
        proc?.kill("SIGKILL");
        resolvePromise();
      }, 5_000);
      proc!.once("exit", () => {
        clearTimeout(t);
        resolvePromise();
      });
    });
  }
  await rm(PROJECT_DIR, { recursive: true, force: true });
});

it("stdio 全链路：initialize → tools/list（含 compile.run）→ tools/call compile.run（scenes=2）", async () => {
  expect(proc).not.toBeNull();
  expect(reader).not.toBeNull();
  const stdin = proc!.stdin!;
  const lines = reader!;

  // 1. initialize
  stdin.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "videoos-test", version: "0.0.1" } },
    })}\n`,
  );
  const [initLine] = await lines.next(1, "initialize response");
  const init = JSON.parse(initLine) as JsonRpcLine;
  expect(init.id).toBe(1);
  expect(init.error).toBeUndefined();
  expect((init.result as { protocolVersion: string }).protocolVersion).toBe("2025-03-26");
  expect((init.result as { serverInfo: { name: string } }).serverInfo.name).toBe("videoos-test-server");

  // 2. initialized 通知（无响应）
  stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

  // 3. tools/list
  stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`);
  const [listLine] = await lines.next(1, "tools/list response");
  const list = JSON.parse(listLine) as JsonRpcLine;
  expect(list.id).toBe(2);
  expect(list.error).toBeUndefined();
  const tools = (list.result as { tools: Array<{ name: string; description: string; inputSchema: unknown }> }).tools;
  expect(tools.length).toBeGreaterThanOrEqual(30);
  const compileRun = tools.find((t) => t.name === "compile.run");
  expect(compileRun).toBeDefined();
  expect(typeof compileRun!.description).toBe("string");
  expect((compileRun!.inputSchema as { type?: string }).type).toBe("object");

  // 4. tools/call compile.run（arguments 缺省 → {}）
  stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "compile.run" } })}\n`);
  const [callLine] = await lines.next(1, "tools/call response");
  const call = JSON.parse(callLine) as JsonRpcLine;
  expect(call.id).toBe(3);
  expect(call.error).toBeUndefined();
  const out = call.result as { content: Array<{ type: string; text: string }>; isError: boolean };
  expect(out.isError).toBe(false);
  expect(out.content[0].type).toBe("text");
  const data = JSON.parse(out.content[0].text) as { scenes: number; totalFrames: number; duration: number; virPath: string };
  expect(data.scenes).toBe(2); // 模板 intro + outro
  expect(data.totalFrames).toBe(180); // 6.0s @ 30fps
  expect(data.duration).toBeCloseTo(6.0, 5);
  expect(data.virPath).toBe(join(PROJECT_DIR, ".video", "vir.json"));
  expect(existsSync(data.virPath)).toBe(true);

  // 5. 非法 JSON 行 → -32700（id null）
  stdin.write("{broken json\n");
  const [badLine] = await lines.next(1, "parse error response");
  const bad = JSON.parse(badLine) as JsonRpcLine;
  expect(bad.id).toBeNull();
  expect(bad.error?.code).toBe(-32700);

  // 6. EOF（stdin 关闭）→ 服务器正常退出 exit 0
  const code = await new Promise<number | null>((resolvePromise, reject) => {
    const t = setTimeout(() => reject(new Error("server did not exit after stdin EOF")), TIMEOUT_MS);
    proc!.once("exit", (c) => {
      clearTimeout(t);
      resolvePromise(c);
    });
    stdin.end();
  });
  expect(code).toBe(0);
}, 60_000);

it("SIGTERM 优雅退出（exit 0）", async () => {
  // 上一用例已 EOF 退出 → 重新 spawn 验证信号路径
  const p = spawn(process.execPath, [TEST_SERVER, "--project", PROJECT_DIR], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
    cwd: REPO_ROOT,
  });
  const exited = new Promise<{ code: number | null; signal: string | null }>((resolvePromise) => {
    p.once("exit", (code, signal) => resolvePromise({ code, signal }));
  });
  await new Promise((r) => setTimeout(r, 300)); // 等服务器起来（stdio ready 日志走 stderr）
  p.kill("SIGTERM");
  const { code, signal } = await exited;
  expect(signal).toBeNull(); // 信号被处理而非默认终止
  expect(code).toBe(0);
}, 60_000);
