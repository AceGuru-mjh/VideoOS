// @videoos/mcp-fs 协议级 E2E（Issue #31）：Bun.spawn 拉起真服务器进程 + JSON-RPC stdio 客户端。
// 覆盖：7 工具形状 / list 递归深度与 zod 上限 / read 截断与双编码 / write sha256 /
// move（含跨根拒绝）/ remove（非空目录保护）/ search（glob + contentRegex + 1MB 上限）/
// tree / 监狱三连（..逃逸、绝对路径越狱、符号链接越狱 —— 硬门槛）。
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
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
const JAIL_ROOT = mkdtempSync(join(tmpdir(), "mcp-fs-jail-"));
// 监狱外素材：jail 根的兄弟目录（仍在 os.tmpdir 内，但不在监狱里）
const OUTSIDE_DIR = mkdtempSync(join(tmpdir(), "mcp-fs-outside-"));

describe("mcp-fs 协议级 E2E（Issue #31）", () => {
  let client: McpChild;

  beforeAll(async () => {
    writeFileSync(join(OUTSIDE_DIR, "outside.txt"), "outside secret");
    // 嵌套结构：a.txt / sub/b.txt / sub/deep/c.txt
    writeFileSync(join(JAIL_ROOT, "a.txt"), "aaa");
    mkdirSync(join(JAIL_ROOT, "sub", "deep"), { recursive: true });
    writeFileSync(join(JAIL_ROOT, "sub", "b.txt"), "bbb");
    writeFileSync(join(JAIL_ROOT, "sub", "deep", "c.txt"), "ccc");
    client = await spawnMcp(SERVER_SCRIPT, { MCP_FS_ROOTS: JAIL_ROOT });
  }, 15_000);

  it("tools/list 返回 7 个工具，parameters 均为 object JSON Schema", async () => {
    const tools = await client.listTools();
    expect(tools).toHaveLength(7);
    expect(tools.map((t) => t.name).sort()).toEqual([
      "fs.list", "fs.move", "fs.read", "fs.remove", "fs.search", "fs.tree", "fs.write",
    ]);
    for (const t of tools) {
      expect(t.description.length).toBeGreaterThan(0);
      expect((t.parameters as { type?: string }).type).toBe("object");
    }
  }, 15_000);

  it("fs.list 默认 depth=1：只列一层（a.txt + sub）", async () => {
    const res = await client.call("fs.list", { path: "." });
    expect(res.ok).toBe(true);
    expect(res.data.entries.map((e: any) => e.name)).toEqual(["a.txt", "sub"]);
    expect(res.data.entries[0].type).toBe("file");
    expect(res.data.entries[0].size).toBe(3);
    expect(res.data.entries[1].type).toBe("dir");
    expect(res.data.entries[1].size).toBe(0);
    expect(typeof res.data.entries[0].mtime).toBe("string");
    expect(res.data.root).toBe(JAIL_ROOT);
  }, 15_000);

  it("fs.list depth=2：包含 sub/b.txt 与 sub/deep，但不含第三层", async () => {
    const res = await client.call("fs.list", { path: ".", depth: 2 });
    expect(res.ok).toBe(true);
    const names = res.data.entries.map((e: any) => e.name);
    expect(names).toEqual(["a.txt", "sub", "sub/b.txt", "sub/deep"]);
    expect(names).not.toContain("sub/deep/c.txt");
  }, 15_000);

  it("fs.list depth=6 越界 → -32602 zod 校验错误", async () => {
    const res = await client.call("fs.list", { path: ".", depth: 6 });
    expect(res.ok).toBe(false);
    expect(res.error ?? "").toMatch(/-32602|depth/);
  }, 15_000);

  it("fs.read utf8 全量：content/size/truncated", async () => {
    writeFileSync(join(JAIL_ROOT, "read.txt"), "hello world");
    const res = await client.call("fs.read", { path: "read.txt" });
    expect(res.ok).toBe(true);
    expect(res.data.content).toBe("hello world");
    expect(res.data.size).toBe(11);
    expect(res.data.truncated).toBe(false);
  }, 15_000);

  it("fs.read maxBytes=3 截断 5 字节文件：content 3 字符、truncated true、size 5", async () => {
    writeFileSync(join(JAIL_ROOT, "five.txt"), "hello");
    const res = await client.call("fs.read", { path: "five.txt", maxBytes: 3 });
    expect(res.ok).toBe(true);
    expect(res.data.content).toBe("hel");
    expect(res.data.truncated).toBe(true);
    expect(res.data.size).toBe(5);
  }, 15_000);

  it("fs.read base64：content 为 base64(hello)", async () => {
    const res = await client.call("fs.read", { path: "five.txt", encoding: "base64" });
    expect(res.ok).toBe(true);
    expect(res.data.content).toBe(Buffer.from("hello").toString("base64"));
    expect(res.data.truncated).toBe(false);
    expect(res.data.size).toBe(5);
  }, 15_000);

  it("fs.write 建嵌套路径并返回 bytes + 12 位 sha256，fs.read 可读回", async () => {
    const res = await client.call("fs.write", { path: "w/nested/file.txt", content: "written content" });
    expect(res.ok).toBe(true);
    expect(res.data.bytes).toBe(15);
    expect(res.data.sha256).toMatch(/^[0-9a-f]{12}$/);
    expect(res.data.sha256).toBe(createHash("sha256").update("written content").digest("hex").slice(0, 12));
    const back = await client.call("fs.read", { path: "w/nested/file.txt" });
    expect(back.ok).toBe(true);
    expect(back.data.content).toBe("written content");
  }, 15_000);

  it("fs.move 根内重命名：旧路径消失、新路径存在（fs.list 验证）", async () => {
    writeFileSync(join(JAIL_ROOT, "moveme.txt"), "move data");
    const res = await client.call("fs.move", { from: "moveme.txt", to: "moved.txt" });
    expect(res.ok).toBe(true);
    expect(res.data.moved).toBe(true);
    const list = await client.call("fs.list", { path: "." });
    const names = list.data.entries.map((e: any) => e.name);
    expect(names).toContain("moved.txt");
    expect(names).not.toContain("moveme.txt");
    const read = await client.call("fs.read", { path: "moved.txt" });
    expect(read.data.content).toBe("move data");
  }, 15_000);

  it("fs.move 跨根拒绝：多根监狱下 root1 → root2 返回 cross-root", async () => {
    const otherRoot = mkdtempSync(join(tmpdir(), "mcp-fs-other-"));
    // ';' 在 POSIX 与 Windows 的 parseRoots 里都是合法分隔符
    const multi = await spawnMcp(SERVER_SCRIPT, { MCP_FS_ROOTS: `${JAIL_ROOT};${otherRoot}` });
    writeFileSync(join(JAIL_ROOT, "mv.txt"), "x");
    const res = await multi.call("fs.move", { from: "mv.txt", to: join(otherRoot, "mv2.txt") });
    expect(res.ok).toBe(false);
    expect(res.error ?? "").toContain("cross-root");
    // 反向（from 在第二根内、to 相对第一根）同样按 cross-root 拒绝
    const back = await multi.call("fs.move", { from: join(otherRoot, "mv2.txt"), to: "back.txt" });
    expect(back.ok).toBe(false);
    expect(back.error ?? "").toContain("cross-root");
  }, 15_000);

  it("fs.remove：文件 removed=1；非空目录非递归拒绝；递归 removed=路径总数；删除后 ENOENT", async () => {
    writeFileSync(join(JAIL_ROOT, "r.txt"), "bye");
    const file = await client.call("fs.remove", { path: "r.txt" });
    expect(file.ok).toBe(true);
    expect(file.data.removed).toBe(1);

    mkdirSync(join(JAIL_ROOT, "dirtoremove", "sub"), { recursive: true });
    writeFileSync(join(JAIL_ROOT, "dirtoremove", "child.txt"), "c");
    writeFileSync(join(JAIL_ROOT, "dirtoremove", "sub", "grand.txt"), "g");
    const denied = await client.call("fs.remove", { path: "dirtoremove" });
    expect(denied.ok).toBe(false);
    expect(denied.error ?? "").toContain("not empty");

    const rec = await client.call("fs.remove", { path: "dirtoremove", recursive: true });
    expect(rec.ok).toBe(true);
    // 目录自身 + child.txt + sub + sub/grand.txt = 4
    expect(rec.data.removed).toBe(4);

    const again = await client.call("fs.remove", { path: "dirtoremove" });
    expect(again.ok).toBe(false);
  }, 15_000);

  it("fs.search glob *.txt：命中 a.txt 与 sub/b.txt（c.md 不命中）", async () => {
    mkdirSync(join(JAIL_ROOT, "searchdir", "sub"), { recursive: true });
    writeFileSync(join(JAIL_ROOT, "searchdir", "a.txt"), "aa");
    writeFileSync(join(JAIL_ROOT, "searchdir", "sub", "b.txt"), "bb");
    writeFileSync(join(JAIL_ROOT, "searchdir", "c.md"), "cc");
    const res = await client.call("fs.search", { root: "searchdir", glob: "*.txt" });
    expect(res.ok).toBe(true);
    expect(res.data.matches.map((m: any) => m.path)).toEqual(["a.txt", "sub/b.txt"]);
    expect(res.data.truncated).toBe(false);
  }, 15_000);

  it("fs.search contentRegex：含 NEEDLE 的小文件命中、无词不命中、>1MB 跳过；非法正则报错", async () => {
    mkdirSync(join(JAIL_ROOT, "contentdir"), { recursive: true });
    writeFileSync(join(JAIL_ROOT, "contentdir", "needle.txt"), "has NEEDLE inside");
    writeFileSync(join(JAIL_ROOT, "contentdir", "plain.txt"), "nothing to see here");
    // 1.1MB 大文件，开头就是 NEEDLE —— 若 1MB 过滤失效本用例会翻车
    writeFileSync(join(JAIL_ROOT, "contentdir", "big.bin"), Buffer.concat([Buffer.from("NEEDLE"), Buffer.alloc(1_100_000, 0x61)]));
    const res = await client.call("fs.search", { root: "contentdir", glob: "*", contentRegex: "NEEDLE" });
    expect(res.ok).toBe(true);
    expect(res.data.matches.map((m: any) => m.path)).toEqual(["needle.txt"]);
    expect(res.data.matches.map((m: any) => m.path)).not.toContain("big.bin");

    const bad = await client.call("fs.search", { root: "contentdir", glob: "*", contentRegex: "(unclosed" });
    expect(bad.ok).toBe(false);
    expect(bad.error ?? "").toContain("invalid contentRegex");
  }, 15_000);

  it("fs.tree：目录带 / 后缀、文件带 (N B)，目录在前文件在后", async () => {
    mkdirSync(join(JAIL_ROOT, "treedir", "sub"), { recursive: true });
    writeFileSync(join(JAIL_ROOT, "treedir", "a.txt"), "abc");
    writeFileSync(join(JAIL_ROOT, "treedir", "sub", "b.md"), "ok");
    const res = await client.call("fs.tree", { path: "treedir" });
    expect(res.ok).toBe(true);
    expect(res.data.tree).toBe(["treedir/", "  sub/", "    b.md (2 B)", "  a.txt (3 B)"].join("\n"));
    expect(res.data.tree).toContain("sub/");
    expect(res.data.tree).toContain("(3 B)");
  }, 15_000);

  it("监狱三连（硬门槛）：.. 逃逸 / 绝对路径越狱 / 符号链接越狱 / fs.write 越狱", async () => {
    // (a) 相对 .. 逃出监狱根
    const a = await client.call("fs.read", { path: "../outside.txt" });
    expect(a.ok).toBe(false);
    expect(a.error ?? "").toContain("escapes jail");
    // (b) 绝对路径指向监狱根的兄弟目录
    const b = await client.call("fs.read", { path: join(OUTSIDE_DIR, "outside.txt") });
    expect(b.ok).toBe(false);
    expect(b.error ?? "").toContain("escapes jail");
    // (c) 符号链接逃逸：监狱内 symlink 指向监狱外目录，读其中的文件必须被拒
    let linkCreated = true;
    const linkPath = join(JAIL_ROOT, "linkdir");
    try {
      symlinkSync(OUTSIDE_DIR, linkPath, "dir");
    } catch {
      try {
        symlinkSync(OUTSIDE_DIR, linkPath, "junction"); // Windows 无特权时用 junction
      } catch {
        linkCreated = false; // 连 junction 都建不了 → 本平台跳过该子用例
      }
    }
    if (linkCreated) {
      const c = await client.call("fs.read", { path: "linkdir/outside.txt" });
      expect(c.ok).toBe(false);
      expect(c.error ?? "").toContain("escapes jail");
    } else {
      console.log("[skip] 本平台无法创建符号链接（EPERM），symlink 越狱子用例跳过");
    }
    // (d) fs.write 越狱同样被拒
    const w = await client.call("fs.write", { path: "../x", content: "nope" });
    expect(w.ok).toBe(false);
    expect(w.error ?? "").toContain("escapes jail");
  }, 15_000);
});
