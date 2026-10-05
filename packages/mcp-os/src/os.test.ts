// @videoos/mcp-os 协议级 E2E（Issue #33）：Bun.spawn 拉起真服务器进程 + JSON-RPC stdio 客户端。
// 覆盖：os.info 字段与隐私红线（不含用户名/家目录）/ os.info 与 process 一致 /
// os.disk 缺省与显式路径（win32 容忍 statfs 不支持）/ os.env 白名单 + 敏感掩码 + 空数组 -32602。
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { homedir, tmpdir, userInfo } from "node:os";
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
    cmd: [process.execPath, script],
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

describe("mcp-os 协议级 E2E（Issue #33）", () => {
  let client: McpChild;

  beforeAll(async () => {
    client = await spawnMcp(SERVER_SCRIPT, {
      FAKE_API_KEY: "super-secret-value",
      MY_PLAIN_VAR: "visible",
      MY_DB_PASSWORD: "hunter2",
    });
  }, 15_000);

  it("os.info：字段形状齐全，且不含用户名/家目录（隐私红线）", async () => {
    const res = await client.call("os.info");
    expect(res.ok).toBe(true);
    expect(typeof res.data.platform).toBe("string");
    expect(String(res.data.platform).length).toBeGreaterThan(0);
    expect(res.data.cpuCount).toBeGreaterThanOrEqual(1);
    expect(res.data.memTotalBytes).toBeGreaterThan(0);
    expect(res.data.memFreeBytes).toBeGreaterThanOrEqual(0);
    expect(typeof res.data.cpuModel).toBe("string");
    const serialized = JSON.stringify(res.data);
    // 隐私红线：不泄漏用户名「路径形态」（/home/<user>、/Users/<user>、/<user>/ 段）与家目录串。
    // 注意：GitHub 托管 runner 的 hostname 形如 "runner-xxxx-project-xxxx" —— 含用户名子串的是
    // 机器名而非用户路径，裸子串断言会误伤；SPEC 要求 hostname 必须输出，故只断言路径形态泄漏。
    const user = userInfo().username;
    if (user.length >= 2) {
      const pathLeakPatterns = [`/${user}/`, `/Users/${user}`, `\\Users\\${user}`, `home/${user}`, `home\\${user}`];
      for (const pattern of pathLeakPatterns) {
        expect(serialized.includes(pattern)).toBe(false);
      }
      for (const value of Object.values(res.data)) {
        expect(String(value)).not.toBe(user);
      }
    }
    const home = homedir();
    if (home.length > 0) expect(serialized.includes(home)).toBe(false);
    // 字段白名单：不允许混入 username/homedir/userInfo 之类的键
    expect(Object.keys(res.data).sort()).toEqual([
      "arch", "cpuCount", "cpuModel", "hostname", "memFreeBytes", "memTotalBytes", "platform", "release",
    ]);
  }, 15_000);

  it("os.info：platform/arch 与测试进程一致", async () => {
    const res = await client.call("os.info");
    expect(res.ok).toBe(true);
    expect(res.data.platform).toBe(process.platform);
    expect(res.data.arch).toBe(process.arch);
  }, 15_000);

  it("os.disk 缺省 path：ok 或（win32 等 statfs 不支持时）ok:false，不崩溃", async () => {
    const res = await client.call("os.disk");
    if (res.ok) {
      expect(res.data.totalBytes).toBeGreaterThan(0);
      expect(res.data.freeBytes).toBeGreaterThan(0);
      expect(typeof res.data.availableBytes).toBe("number");
      expect(typeof res.data.path).toBe("string");
    } else {
      expect(typeof res.error).toBe("string");
      expect(String(res.error).length).toBeGreaterThan(0);
    }
  }, 15_000);

  it("os.disk 显式 tmpdir path：同样形状", async () => {
    const res = await client.call("os.disk", { path: tmpdir() });
    if (res.ok) {
      expect(res.data.totalBytes).toBeGreaterThan(0);
      expect(res.data.freeBytes).toBeGreaterThan(0);
      expect(res.data.path).toBe(tmpdir());
    } else {
      expect(typeof res.error).toBe("string");
    }
  }, 15_000);

  it("os.env：明文可见，KEY/PASSWORD 键名掩码为 ***", async () => {
    const res = await client.call("os.env", { keys: ["MY_PLAIN_VAR", "FAKE_API_KEY", "MY_DB_PASSWORD"] });
    expect(res.ok).toBe(true);
    expect(res.data.MY_PLAIN_VAR).toBe("visible");
    expect(res.data.FAKE_API_KEY).toBe("***");
    expect(res.data.MY_DB_PASSWORD).toBe("***");
  }, 15_000);

  it("os.env：未设置的键不出现在结果里", async () => {
    const res = await client.call("os.env", { keys: ["VIDEOOS_NOT_SET_XYZ"] });
    expect(res.ok).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(res.data, "VIDEOOS_NOT_SET_XYZ")).toBe(false);
    expect(JSON.stringify(res.data)).toBe("{}");
  }, 15_000);

  it("os.env：只请求 MY_PLAIN_VAR 时不泄露 FAKE_API_KEY（白名单语义）", async () => {
    const res = await client.call("os.env", { keys: ["MY_PLAIN_VAR"] });
    expect(res.ok).toBe(true);
    expect(res.data.MY_PLAIN_VAR).toBe("visible");
    expect(Object.prototype.hasOwnProperty.call(res.data, "FAKE_API_KEY")).toBe(false);
    expect(JSON.stringify(res.data)).not.toContain("super-secret-value");
  }, 15_000);

  it("os.env：空 keys 数组 → -32602 zod 校验错误", async () => {
    const res = await client.call("os.env", { keys: [] });
    expect(res.ok).toBe(false);
    expect(res.error ?? "").toMatch(/-32602|keys/);
  }, 15_000);
});
