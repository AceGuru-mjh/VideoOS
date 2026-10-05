// @videoos/mcp-shell 协议级 E2E（Issue #32）：Bun.spawn 拉起真服务器进程 + JSON-RPC stdio 客户端。
// 覆盖：回显/退出码/stderr / cwd 监狱（根内 ok、根外拒绝）/ which / 缺省 cwd /
// 超时 SIGKILL + 无孤儿进程（POSIX）/ maxOutput 截断（POSIX）。
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 测试辅助：Bun.spawn 拉起真服务器进程 + JSON-RPC stdio 客户端（协议级 E2E）
const CHILDREN: Array<Bun.Subprocess<"pipe", "pipe", "pipe">> = [];
afterAll(() => { for (const c of CHILDREN) { try { c.kill(); } catch { /* exited */ } } });

interface McpChild {
  listTools(): Promise<Array<{ name: string; description: string; parameters: Record<string, unknown> }>>;
  call(name: string, args?: Record<string, unknown>): Promise<{ ok: boolean; data?: any; error?: string }>;
  close(): Promise<void>;
}

async function spawnMcp(script: string, env: Record<string, string> = {}): Promise<McpChild> {
  const proc = Bun.spawn({
    cmd: ["bun", script],
    stdin: "pipe", stdout: "pipe", stderr: "pipe",
    env: { ...process.env, ...env },
  });
  CHILDREN.push(proc);
  let nextId = 1;
  let buffer = "";
  const waiters: Array<(line: string) => void> = [];
  const decoder = new TextDecoder();
  void (async () => {
    for await (const chunk of proc.stdout) {
      buffer += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        const w = waiters.shift();
        if (w) w(line);
      }
    }
    while (waiters.length > 0) waiters.shift()!("__EOF__");
  })();
  const request = async (method: string, params?: unknown): Promise<{ id: number; result?: any; error?: { code: number; message: string } }> => {
    const id = nextId++;
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    const line = await new Promise<string>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout waiting for ${method} #${id}`)), 10_000);
      waiters.push((l) => { clearTimeout(t); resolve(l); });
    });
    if (line === "__EOF__") throw new Error(`server exited while waiting for ${method}`);
    return JSON.parse(line);
  };
  const init = await request("initialize", { protocolVersion: "2025-03-26" });
  if (init.error) throw new Error(`initialize failed: ${JSON.stringify(init.error)}`);
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  return {
    listTools: async () => { const r = await request("tools/list"); if (r.error) throw new Error(r.error.message); return r.result.tools; },
    call: async (name, args = {}) => {
      const r = await request("tools/call", { name, arguments: args });
      if (r.error) return { ok: false, error: `${r.error.code}: ${r.error.message}` };
      return r.result;
    },
    close: async () => { try { proc.stdin.end(); } catch { /* ignore */ } await proc.exited; },
  };
}

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

const SERVER_SCRIPT = join(import.meta.dir, "index.ts");
const JAIL_ROOT = mkdtempSync(join(tmpdir(), "mcp-shell-jail-"));
// 监狱外素材：jail 根的兄弟目录（在 os.tmpdir 内但不在监狱里）
const OUTSIDE_DIR = mkdtempSync(join(tmpdir(), "mcp-shell-sib-"));

describe("mcp-shell 协议级 E2E（Issue #32）", () => {
  let client: McpChild;

  beforeAll(async () => {
    mkdirSync(join(JAIL_ROOT, "subdir"), { recursive: true });
    client = await spawnMcp(SERVER_SCRIPT, { MCP_SHELL_ROOTS: JAIL_ROOT });
  }, 15_000);

  it("shell.exec echo hello：exitCode 0 且 stdout 含 hello（双平台写法一致）", async () => {
    const res = await client.call("shell.exec", { command: "echo hello" });
    expect(res.ok).toBe(true);
    expect(res.data.exitCode).toBe(0);
    expect(String(res.data.stdout).trim()).toContain("hello");
    expect(res.data.timedOut).toBeUndefined(); // 正常路径不返回 timedOut 字段
  }, 15_000);

  it("shell.exec exit 3：exitCode 3", async () => {
    const res = await client.call("shell.exec", { command: "exit 3" });
    expect(res.ok).toBe(true);
    expect(res.data.exitCode).toBe(3);
  }, 15_000);

  it("shell.exec stderr：1>&2 重定向后 stderr 含 oops", async () => {
    const res = await client.call("shell.exec", { command: "echo oops 1>&2" });
    expect(res.ok).toBe(true);
    expect(res.data.exitCode).toBe(0);
    expect(String(res.data.stderr)).toContain("oops");
  }, 15_000);

  it("shell.exec cwd=监狱内子目录：ok 且 exitCode 0", async () => {
    const res = await client.call("shell.exec", { command: "echo x", cwd: "subdir" });
    expect(res.ok).toBe(true);
    expect(res.data.exitCode).toBe(0);
    expect(res.data.durationMs).toBeGreaterThanOrEqual(0);
  }, 15_000);

  it("shell.exec cwd=监狱外兄弟目录 → ok:false escapes jail", async () => {
    const res = await client.call("shell.exec", { command: "echo bad", cwd: OUTSIDE_DIR });
    expect(res.ok).toBe(false);
    expect(res.error ?? "").toContain("escapes jail");
  }, 15_000);

  it("shell.which bun：found true 且 path 非空", async () => {
    const res = await client.call("shell.which", { command: "bun" });
    expect(res.ok).toBe(true);
    expect(res.data.found).toBe(true);
    expect(typeof res.data.path).toBe("string");
    expect(String(res.data.path).length).toBeGreaterThan(0);
  }, 15_000);

  it("shell.which 不存在的命令：found false 且 path 为 null", async () => {
    const res = await client.call("shell.which", { command: "definitely-not-a-real-cmd-xyz" });
    expect(res.ok).toBe(true);
    expect(res.data.found).toBe(false);
    expect(res.data.path).toBeNull();
  }, 15_000);

  it("shell.exec 缺省 cwd（第一个监狱根）：ok", async () => {
    const res = await client.call("shell.exec", { command: "echo ok" });
    expect(res.ok).toBe(true);
    expect(res.data.exitCode).toBe(0);
    expect(String(res.data.stdout).trim()).toContain("ok");
  }, 15_000);

  it.skipIf(process.platform === "win32")("超时 SIGKILL：timedOut true、exitCode 124、无孤儿进程", async () => {
    const res = await client.call("shell.exec", { command: "sleep 14.72", timeoutMs: 500 });
    expect(res.ok).toBe(true);
    expect(res.data.timedOut).toBe(true);
    expect(res.data.exitCode).toBe(124);
    expect(res.data.durationMs).toBeLessThan(5000);
    expect(String(res.data.stderr)).toContain("[killed: timeout after 500ms]");
    // 验证无孤儿：pgrep 模式用 [.] 技巧避免匹配 pgrep 自身的 sh 包装进程；无匹配 → exit 1
    const check = await client.call("shell.exec", { command: 'pgrep -f "sleep 14[.]72"' });
    expect(check.ok).toBe(true);
    expect(check.data.exitCode).toBe(1);
  }, 20_000);

  it.skipIf(process.platform === "win32")("maxOutput 截断：stdout 封顶 1000 字符且 truncated true", async () => {
    const res = await client.call("shell.exec", {
      command: 'head -c 100000 /dev/zero | tr "\\0" "x"',
      maxOutput: 1000,
    });
    expect(res.ok).toBe(true);
    expect(res.data.exitCode).toBe(0);
    expect(res.data.truncated).toBe(true);
    expect(String(res.data.stdout).length).toBe(1000);
    expect(String(res.data.stdout)).toMatch(/^x+$/);
  }, 15_000);
});
