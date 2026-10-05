// @videoos/mcp-host E2E：spawn 真子进程（fixture-echo/-slow/-crash + packages/mcp-time 真服务器），
// 覆盖 SPEC §3.4：配置校验 / 聚合 / 冲突全名 / 超时不杀进程 / 崩溃重启 unhealthy / 白名单 / stop 幂等。
// 所有 it 显式 20_000 超时；liveHosts + afterEach 兜底清理全部子进程（绝不泄漏）。
import { describe, expect, it, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadHostConfig, McpHost, type HostLogEvent, type McpHostConfig } from "./index";

const ECHO = join(import.meta.dir, "..", "test-servers", "fixture-echo.ts");
const SLOW = join(import.meta.dir, "..", "test-servers", "fixture-slow.ts");
const CRASH = join(import.meta.dir, "..", "test-servers", "fixture-crash.ts");
const TIME = join(import.meta.dir, "..", "..", "mcp-time", "src", "index.ts");

const liveHosts: McpHost[] = [];

/** 起 host 并登记到 liveHosts（afterEach 统一 stop，兜底任何断言失败路径） */
async function startHost(config: McpHostConfig): Promise<McpHost> {
  const host = new McpHost(config);
  liveHosts.push(host);
  await host.start();
  return host;
}

afterEach(async () => {
  while (liveHosts.length > 0) {
    const host = liveHosts.pop();
    if (host !== undefined) await host.stop();
  }
});

/** 轮询直到条件成立（超时抛错）——用于等异步重启/退避走完 */
async function until(cond: () => boolean, timeoutMs = 15_000, intervalMs = 25): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`condition not met within ${timeoutMs}ms`);
}

function statusOf(host: McpHost, server: string) {
  const status = host.inspect().find((s) => s.server === server);
  if (status === undefined) throw new Error(`no such server: ${server}`);
  return status;
}

describe("mcp-host: loadHostConfig", () => {
  it(
    "parses and validates a legal mcp.json",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "mcp-host-cfg-"));
      try {
        const path = join(dir, "mcp.json");
        writeFileSync(
          path,
          JSON.stringify({
            servers: {
              time: { command: "bun", args: ["run", "packages/mcp-time/src/index.ts"], timeoutMs: 20_000, allowedTools: ["time.now"] },
              off: { command: "bun", args: [], enabled: false },
            },
            restartBackoff: 100,
          }),
        );
        const config = await loadHostConfig(path);
        expect(Object.keys(config.servers).sort()).toEqual(["off", "time"]);
        expect(config.servers.time.command).toBe("bun");
        expect(config.servers.time.args).toEqual(["run", "packages/mcp-time/src/index.ts"]);
        expect(config.servers.time.timeoutMs).toBe(20_000);
        expect(config.servers.time.allowedTools).toEqual(["time.now"]);
        expect(config.servers.off.enabled).toBe(false);
        expect(config.restartBackoff).toBe(100);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    20_000,
  );

  it(
    "rejects unknown server fields with a path in the error message",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "mcp-host-cfg-"));
      try {
        const path = join(dir, "mcp.json");
        writeFileSync(path, JSON.stringify({ servers: { echo: { command: "bun", args: [], oops: true } } }));
        await expect(loadHostConfig(path)).rejects.toThrow("oops");
        await expect(loadHostConfig(path)).rejects.toThrow("servers > echo");
        // 缺必填字段：错误信息指到具体字段
        writeFileSync(path, JSON.stringify({ servers: { echo: { args: [] } } }));
        await expect(loadHostConfig(path)).rejects.toThrow("command");
        // 顶层未知字段同样报错
        writeFileSync(path, JSON.stringify({ servers: {}, bogus: 1 }));
        await expect(loadHostConfig(path)).rejects.toThrow("bogus");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    20_000,
  );

  it(
    "rejects unreadable files, bad JSON and missing servers",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "mcp-host-cfg-"));
      try {
        const path = join(dir, "mcp.json");
        writeFileSync(path, "{ not json");
        await expect(loadHostConfig(path)).rejects.toThrow("invalid JSON");
        writeFileSync(path, JSON.stringify({ hello: "world" }));
        await expect(loadHostConfig(path)).rejects.toThrow("servers");
        await expect(loadHostConfig(join(dir, "nope.json"))).rejects.toThrow("cannot read");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    20_000,
  );
});

describe("mcp-host (E2E)", () => {
  it(
    "start() spawns servers and aggregates tools across servers",
    async () => {
      const host = await startHost({
        servers: {
          echo: { command: "bun", args: ["run", ECHO] },
          time: { command: "bun", args: ["run", TIME] },
        },
      });
      const tools = host.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual([
        "add",
        "echo",
        "time.convert",
        "time.duration",
        "time.format",
        "time.now",
        "time.parse",
        "time.zones",
      ]);
      const byName = new Map(tools.map((t) => [t.name, t]));
      expect(byName.get("echo")?.server).toBe("echo");
      expect(byName.get("time.now")?.server).toBe("time");
      expect(typeof byName.get("echo")?.description).toBe("string");
      expect(byName.get("add")?.parameters).toHaveProperty("type", "object");
    },
    20_000,
  );

  it(
    "callTool happy path: echo / time.now / qualified name / log events",
    async () => {
      const logs: HostLogEvent[] = [];
      const host = new McpHost({
        servers: {
          echo: { command: "bun", args: ["run", ECHO] },
          time: { command: "bun", args: ["run", TIME] },
        },
      });
      liveHosts.push(host);
      host.on("log", (event) => logs.push(event));
      await host.start();

      const echoed = await host.callTool("echo", { text: "hello host" });
      expect(echoed.ok).toBe(true);
      expect((echoed.data as { echo: string }).echo).toBe("hello host");

      // 全名（"<server>.<name>"）同样可调用
      const viaQualified = await host.callTool("echo.echo", { text: "qualified" });
      expect(viaQualified.ok).toBe(true);
      expect((viaQualified.data as { echo: string }).echo).toBe("qualified");

      const now = await host.callTool("time.now", { timeZone: "Asia/Shanghai" });
      expect(now.ok).toBe(true);
      expect((now.data as { iso: string }).iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/);

      const echoLog = logs.find((event) => event.tool === "echo" && event.ok);
      expect(echoLog?.server).toBe("echo");
      expect(typeof echoLog?.ms).toBe("number");
      expect(logs.some((event) => event.server === "time" && event.tool === "time.now" && event.ok)).toBe(true);
    },
    20_000,
  );

  it(
    "name conflicts expose tools under qualified <server>.<name>",
    async () => {
      const host = await startHost({
        servers: {
          a: { command: "bun", args: ["run", ECHO], env: { FIXTURE_TAG: "a" } },
          b: { command: "bun", args: ["run", ECHO], env: { FIXTURE_TAG: "b" } },
        },
      });
      expect(host.listTools().map((t) => t.name).sort()).toEqual(["a.add", "a.echo", "b.add", "b.echo"]);

      const fromA = await host.callTool("a.echo", { text: "x" });
      expect(fromA.ok).toBe(true);
      expect((fromA.data as { echo: string; tag: string }).tag).toBe("a");

      const fromB = await host.callTool("b.echo", { text: "y" });
      expect(fromB.ok).toBe(true);
      expect((fromB.data as { echo: string; tag: string }).tag).toBe("b");
    },
    20_000,
  );

  it(
    "callTool timeout returns error, keeps the process alive, drops the late response",
    async () => {
      const host = await startHost({
        servers: {
          slow: { command: "bun", args: ["run", SLOW], env: { FIXTURE_SLEEP_MS: "1000" }, timeoutMs: 300 },
        },
      });
      const timedOut = await host.callTool("slow.echo", { text: "late" });
      expect(timedOut.ok).toBe(false);
      expect(timedOut.error).toBe("timeout after 300ms");
      expect(statusOf(host, "slow").running).toBe(true); // 不杀进程

      // 等服务器把慢调用做完（其迟到响应将被按 id 丢弃），随后短调用必须成功
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      const ping = await host.callTool("slow.ping");
      expect(ping.ok).toBe(true);
      expect((ping.data as { pong: boolean }).pong).toBe(true);
      expect(statusOf(host, "slow").running).toBe(true);
    },
    20_000,
  );

  it(
    "immediate-crash server: start() survives, backs off, becomes unhealthy and is excluded",
    async () => {
      const logs: HostLogEvent[] = [];
      const host = new McpHost({
        servers: {
          echo: { command: "bun", args: ["run", ECHO] },
          crash: { command: "bun", args: ["run", CRASH] }, // 启动即 exit(1)
        },
        restartBackoff: 100,
      });
      liveHosts.push(host);
      host.on("log", (event) => logs.push(event));
      await host.start(); // 不得因 crash 服务器抛错

      await until(() => statusOf(host, "crash").unhealthy);
      expect(statusOf(host, "crash").restarts).toBe(3);
      expect(host.listTools().map((t) => t.server)).toEqual(["echo", "echo"]); // crash 被排除
      const stillOk = await host.callTool("echo", { text: "still alive" });
      expect(stillOk.ok).toBe(true);
      expect(logs.some((event) => event.server === "crash" && event.error?.includes("unhealthy") === true)).toBe(true);
    },
    20_000,
  );

  it(
    "late-crash server: listed tools disappear from listTools after unhealthy",
    async () => {
      const host = await startHost({
        servers: {
          crash: {
            command: "bun",
            args: ["run", CRASH],
            env: { FIXTURE_CRASH_MODE: "late", FIXTURE_CRASH_DELAY_MS: "500" },
          },
        },
        restartBackoff: 100,
      });
      // start() 完成握手时 crash.now 已可聚合（崩溃发生在 500ms 之后）
      expect(host.listTools().map((t) => t.name)).toContain("crash.now");
      await until(() => statusOf(host, "crash").unhealthy);
      expect(host.listTools()).toEqual([]);
      const gone = await host.callTool("crash.now", {});
      expect(gone.ok).toBe(false);
      expect(gone.error).toContain("TOOL_NOT_FOUND");
    },
    20_000,
  );

  it(
    "allowedTools whitelist filters listTools and denies non-whitelisted calls",
    async () => {
      const host = await startHost({
        servers: {
          echo: { command: "bun", args: ["run", ECHO], allowedTools: ["echo"] },
        },
      });
      expect(host.listTools().map((t) => t.name)).toEqual(["echo"]);

      const denied = await host.callTool("add", { a: 1, b: 2 });
      expect(denied.ok).toBe(false);
      expect(denied.error).toBe("tool not allowed: add");

      const allowed = await host.callTool("echo", { text: "in" });
      expect(allowed.ok).toBe(true);
      expect((allowed.data as { echo: string }).echo).toBe("in");
    },
    20_000,
  );

  it(
    "stop() terminates all children gracefully and is idempotent",
    async () => {
      const host = await startHost({
        servers: {
          echo: { command: "bun", args: ["run", ECHO] },
          time: { command: "bun", args: ["run", TIME] },
        },
      });
      const before = host.inspect();
      expect(before.map((s) => s.running)).toEqual([true, true]);
      expect(before.every((s) => typeof s.pid === "number")).toBe(true);

      await host.stop();
      const after = host.inspect();
      expect(after.length).toBe(2);
      for (const status of after) {
        expect(status.running).toBe(false);
        expect(status.exitCode).not.toBe(null); // SIGTERM 优雅退出 → exitCode 0
      }
      expect(host.listTools()).toEqual([]);
      await host.stop(); // 幂等 no-op
    },
    20_000,
  );

  it(
    "enabled:false servers are skipped at start",
    async () => {
      const logs: HostLogEvent[] = [];
      const host = new McpHost({
        servers: {
          echo: { command: "bun", args: ["run", ECHO] },
          off: { command: "bun", args: ["run", ECHO], enabled: false },
        },
      });
      liveHosts.push(host);
      host.on("log", (event) => logs.push(event));
      await host.start();
      expect(host.listTools().map((t) => t.server)).toEqual(["echo", "echo"]);
      expect(statusOf(host, "off").running).toBe(false);
      expect(statusOf(host, "off").pid).toBeUndefined();
      expect(logs.some((event) => event.server === "off" && event.message?.includes("skipped") === true)).toBe(true);
    },
    20_000,
  );

  it(
    "concurrent callTool requests are paired by id correctly",
    async () => {
      const host = await startHost({
        servers: {
          echo: { command: "bun", args: ["run", ECHO] },
          time: { command: "bun", args: ["run", TIME] },
        },
      });
      const [sum1, echoed, sum2, iso] = await Promise.all([
        host.callTool("add", { a: 1, b: 2 }),
        host.callTool("echo", { text: "first" }),
        host.callTool("add", { a: 10, b: 32 }),
        host.callTool("time.now", { timeZone: "UTC" }),
      ]);
      expect(sum1.ok).toBe(true);
      expect((sum1.data as { sum: number }).sum).toBe(3);
      expect(echoed.ok).toBe(true);
      expect((echoed.data as { echo: string }).echo).toBe("first");
      expect(sum2.ok).toBe(true);
      expect((sum2.data as { sum: number }).sum).toBe(42);
      expect(iso.ok).toBe(true);
      expect((iso.data as { iso: string }).iso).toMatch(/\+00:00$/);
    },
    20_000,
  );
});
