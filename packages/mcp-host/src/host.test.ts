// McpHost E2E 测试（Issue #30）：拉起/聚合/调用/超时/崩溃重启/白名单/无孤儿 ≥ 10 用例。
import { afterAll, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpHost, loadHostConfig } from "../src/index";
import type { HostLogEvent, McpHostConfig } from "../src/types";

const FIXTURE = join(import.meta.dir, "..", "test", "fixtures", "fixture-server.ts");
const hosts: McpHost[] = [];
const tmpDirs: string[] = [];

afterAll(async () => {
  for (const h of hosts) {
    try {
      await h.stop();
    } catch {
      // ignore
    }
  }
  for (const d of tmpDirs) await rm(d, { recursive: true, force: true });
});

/** bun 可执行文件绝对路径（不依赖子进程 env PATH 解析） */
const BUN = process.execPath;

function fixtureCfg(name: string, mode: string, extra: Record<string, unknown> = {}, env: Record<string, string> = {}): McpHostConfig {
  return {
    servers: {
      [name]: {
        command: BUN,
        args: [FIXTURE],
        env: { FIXTURE_MODE: mode, ...env },
        ...extra,
      },
    },
  };
}

async function newHost(cfg: McpHostConfig): Promise<McpHost> {
  const host = new McpHost(cfg);
  hosts.push(host);
  return host;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 轮询直到条件满足（崩溃重启等异步场景），超时抛错 */
async function until(cond: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const started = Date.now();
  while (!cond()) {
    if (Date.now() - started > timeoutMs) throw new Error(`timeout waiting for: ${what}`);
    await sleep(100);
  }
}

describe("McpHost — 拉起与聚合", () => {
  it("两个服务器 start → listTools 聚合（无冲突，裸名暴露）", async () => {
    const host = await newHost({
      servers: {
        a: { command: BUN, args: [FIXTURE], env: { FIXTURE_MODE: "echo" } },
        b: { command: BUN, args: [FIXTURE], env: { FIXTURE_MODE: "extra" } },
      },
    });
    await host.start();
    const tools = host.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["echo", "extra", "ping"]);
    const echoTool = tools.find((t) => t.name === "echo");
    expect(echoTool?.server).toBe("a");
    expect(echoTool?.parameters).toHaveProperty("type", "object");
    expect(echoTool?.description.length).toBeGreaterThan(0);
  }, 20_000);

  it("callTool 往返 + on(log) 事件", async () => {
    const logs: HostLogEvent[] = [];
    const host = await newHost(fixtureCfg("solo", "echo"));
    host.on("log", (e) => logs.push(e));
    await host.start();
    const res = await host.callTool("echo", { text: "hello host" });
    expect(res).toEqual({ ok: true, data: { echoed: "hello host" } });
    await host.stop(); // 停掉，日志已足够
    const call = logs.find((e) => e.tool === "echo");
    expect(call?.server).toBe("solo");
    expect(call?.ok).toBe(true);
    expect(call?.ms).toBeGreaterThanOrEqual(0);
  }, 20_000);

  it("callTool 未知工具 → ok:false", async () => {
    const host = await newHost(fixtureCfg("solo2", "echo"));
    await host.start();
    const res = await host.callTool("ghost-tool", {});
    expect(res.ok).toBe(false);
    expect(res.error).toContain("unknown tool");
  }, 20_000);

  it("同名工具冲突 → <server>.<name> 全名暴露；裸名歧义报错；全名可调用", async () => {
    const host = await newHost({
      servers: {
        one: { command: BUN, args: [FIXTURE], env: { FIXTURE_MODE: "dup" } },
        two: { command: BUN, args: [FIXTURE], env: { FIXTURE_MODE: "dup" } },
      },
    });
    await host.start();
    const names = host.listTools().map((t) => t.name).sort();
    expect(names).toEqual(["one.shared", "two.shared"]);

    const viaFull = await host.callTool("one.shared", { from: "one" });
    expect(viaFull).toEqual({ ok: true, data: { from: "one" } });

    const ambiguous = await host.callTool("shared", { from: "x" });
    expect(ambiguous.ok).toBe(false);
    expect(ambiguous.error).toContain("ambiguous");
    expect(ambiguous.error).toContain("one.shared");
    expect(ambiguous.error).toContain("two.shared");
  }, 20_000);

  it("allowedTools 白名单：未列出的工具不可见且不可调用", async () => {
    const host = await newHost(fixtureCfg("gated", "echo", { allowedTools: ["echo"] }));
    await host.start();
    expect(host.listTools().map((t) => t.name)).toEqual(["echo"]);
    const denied = await host.callTool("ping", {});
    expect(denied.ok).toBe(false);
    expect(denied.error).toContain("whitelist");
    const allowed = await host.callTool("echo", { text: "ok" });
    expect(allowed.ok).toBe(true);
  }, 20_000);

  it("enabled:false 的服务器不被拉起", async () => {
    const host = await newHost({
      servers: {
        off: { command: BUN, args: [FIXTURE], env: { FIXTURE_MODE: "echo" }, enabled: false },
        on: { command: BUN, args: [FIXTURE], env: { FIXTURE_MODE: "extra" } },
      },
    });
    await host.start();
    expect(host.listTools().map((t) => t.name)).toEqual(["extra"]);
    const res = await host.callTool("echo", { text: "x" });
    expect(res.ok).toBe(false);
  }, 20_000);
});

describe("McpHost — 超时与自愈", () => {
  it("call 超时：杀本次不杀进程（timeoutMs 300 → 慢工具超时，后续快工具仍可用）", async () => {
    const host = await newHost(fixtureCfg("slow", "slow", { timeoutMs: 300 }));
    await host.start();
    const timed = await host.callTool("slow-echo", { text: "late" });
    expect(timed.ok).toBe(false);
    expect(timed.error).toContain("timeout after 300ms");
    // 慢工具在服务器侧还要跑 ~500ms —— 等它落地（迟到响应会被丢弃），再验证进程仍活着
    await sleep(700);
    const fast = await host.callTool("ping", {});
    expect(fast).toEqual({ ok: true, data: { pong: true } });
  }, 20_000);

  it("进程崩溃 → 指数退避自动重启 → 工具恢复可用；日志事件可见", async () => {
    const logs: HostLogEvent[] = [];
    const host = await newHost(fixtureCfg("phoenix", "crash"));
    host.on("log", (e) => logs.push(e));
    await host.start();

    const killed = await host.callTool("boom", {});
    expect(killed.ok).toBe(false); // 服务器退出，挂起请求被拒

    // 工具已知但服务器已死 → “not running”（而非 unknown tool）
    const dead = await host.callTool("ping", {});
    expect(dead.ok).toBe(false);
    expect(dead.error).toContain("not running");

    await until(() => logs.some((e) => e.tool === "(crash)"), 5_000, "crash log event");
    // 重启完成后 ping 恢复（退避 300ms + 启动时间）
    let revived = false;
    for (let i = 0; i < 40 && !revived; i++) {
      await sleep(150);
      const res = await host.callTool("ping", {});
      revived = res.ok === true;
    }
    expect(revived).toBe(true);
    expect(logs.some((e) => e.tool === "(crash)" && e.server === "phoenix")).toBe(true);
  }, 30_000);

  it("重启频控：3 次/分钟耗尽 → 标记 unhealthy 并从 listTools 排除", async () => {
    const logs: HostLogEvent[] = [];
    const host = await newHost(fixtureCfg("doomed", "crash-on-start"));
    host.on("log", (e) => logs.push(e));
    await host.start(); // 首次拉起失败（启动即退出）

    await until(() => logs.some((e) => e.tool === "(unhealthy)"), 20_000, "unhealthy marking");
    expect(host.listTools()).toEqual([]);
    const res = await host.callTool("ping", {});
    expect(res.ok).toBe(false); // 未知工具或 not running —— 服务器已排除，不可调用
    await host.stop();
  }, 40_000);
});

describe("McpHost — stop 无孤儿 + 配置装载", () => {
  it("stop() 后子进程全部退出（PID 文件断言，无孤儿）；二次 stop 幂等", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcphost-pid-"));
    tmpDirs.push(dir);
    const pidFile = join(dir, "pid.txt");
    const host = await newHost(fixtureCfg("mortal", "echo", {}, { FIXTURE_PID_FILE: pidFile }));
    await host.start();
    const res = await host.callTool("ping", {});
    expect(res.ok).toBe(true);

    let pid = 0;
    for (let i = 0; i < 50; i++) {
      try {
        pid = parseInt((await readFile(pidFile, "utf8")).trim(), 10);
        if (Number.isFinite(pid) && pid > 0) break;
      } catch {
        // 文件可能尚未写入
      }
      await sleep(100);
    }
    expect(pid).toBeGreaterThan(0);

    await host.stop();
    // SIGTERM → 3s 宽限 → SIGKILL；最多等 4s
    let gone = false;
    for (let i = 0; i < 40 && !gone; i++) {
      await sleep(100);
      try {
        process.kill(pid, 0); // 仍存活
      } catch {
        gone = true; // ESRCH：进程已消失
      }
    }
    expect(gone).toBe(true);
    await host.stop(); // 幂等
  }, 30_000);

  it("loadHostConfig：合法 mcp.json / 未知字段 / 缺 command / 非 JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mcphost-cfg-"));
    tmpDirs.push(dir);

    const good = join(dir, "good.json");
    await writeFile(good, JSON.stringify({ servers: { fs: { command: "bun", args: ["x.ts"], env: { A: "1" }, timeoutMs: 20000 } } }));
    const cfg = await loadHostConfig(good);
    expect(cfg.servers.fs?.command).toBe("bun");
    expect(cfg.servers.fs?.enabled).toBe(true); // 默认补全
    expect(cfg.servers.fs?.timeoutMs).toBe(20000);

    const unknownField = join(dir, "unknown.json");
    await writeFile(unknownField, JSON.stringify({ servers: { s: { command: "bun", args: [], oops: true } } }));
    let err1: unknown;
    try {
      await loadHostConfig(unknownField);
    } catch (e) {
      err1 = e;
    }
    expect((err1 as Error).message).toContain("invalid mcp.json");
    expect((err1 as Error).message).toContain("oops");

    const missingCommand = join(dir, "missing.json");
    await writeFile(missingCommand, JSON.stringify({ servers: { s: { args: [] } } }));
    let err2: unknown;
    try {
      await loadHostConfig(missingCommand);
    } catch (e) {
      err2 = e;
    }
    expect((err2 as Error).message).toContain("command");

    const notJson = join(dir, "broken.json");
    await writeFile(notJson, "{oops");
    await expect(loadHostConfig(notJson)).rejects.toThrow("not valid JSON");

    await expect(loadHostConfig(join(dir, "absent.json"))).rejects.toThrow("cannot read");
  }, 15_000);
});
