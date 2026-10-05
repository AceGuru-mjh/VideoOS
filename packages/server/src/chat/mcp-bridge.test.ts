// McpBridge E2E（#53 服务端）：optional-peer 降级 / 状态快照（不 spawn）/ 真实拉起 mcp-fs /
// 白名单双层过滤 / mergeTools 工具定义 / restartIfConfigChanged 跟随。
// 真实 spawn 用 process.execPath + packages/mcp-fs/src/index.ts（stdio MCP 服务器，
// MCP_FS_ROOTS 注入临时监狱根）；绝对路径不依赖子进程 env 的 PATH 解析（确定性）。
import { afterAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { McpBridge } from "./mcp-bridge";
import { SettingsStore } from "../settings";
import type { McpServerEntry } from "../settings";

/** 真实 stdio MCP 服务器入口（mcp-fs：fs.list / fs.read / fs.write / fs.move / fs.remove / fs.search / fs.tree） */
const MCP_FS_ENTRY = resolve(import.meta.dir, "..", "..", "..", "mcp-fs", "src", "index.ts");
/** bun 可执行绝对路径（不依赖子 env PATH） */
const BUN = process.execPath;

const bridges: McpBridge[] = [];
const tmpDirs: string[] = [];

afterAll(async () => {
  for (const b of bridges) {
    try {
      await b.stop();
    } catch {
      // 已停止
    }
  }
  for (const d of tmpDirs) await rm(d, { recursive: true, force: true });
});

/** 临时数据目录 SettingsStore + 桥（可选预置 mcp 配置 / 模拟缺包）；afterAll 统一回收 */
async function newBridge(
  mcp?: { servers?: Record<string, McpServerEntry>; mergeTools?: boolean },
  opts?: { forceUnavailable?: boolean },
): Promise<{ bridge: McpBridge; store: SettingsStore }> {
  const dir = await mkdtemp(join(tmpdir(), "mcpbridge-"));
  tmpDirs.push(dir);
  const store = new SettingsStore(dir);
  if (mcp !== undefined) store.update({ mcp });
  const bridge = new McpBridge({
    settings: store,
    ...(opts?.forceUnavailable === true ? { forceUnavailable: true } : {}),
  });
  bridges.push(bridge);
  return { bridge, store };
}

/** mcp-fs 服务器条目（roots 为监狱根；extra 覆盖 enabled / whitelist 等） */
function fsEntry(roots: string, extra: Partial<McpServerEntry> = {}): McpServerEntry {
  return {
    command: BUN,
    args: [MCP_FS_ENTRY],
    env: { MCP_FS_ROOTS: roots },
    enabled: true,
    whitelist: [],
    timeoutMs: 10_000,
    ...extra,
  };
}

/** 必然 spawn 失败的条目（命令不存在 → Bun.spawn 同步抛 ENOENT → host 标记 unhealthy，host.start 仍 resolve） */
function ghostEntry(): McpServerEntry {
  return { command: "/nonexistent/videoos-mcp-ghost", args: [], env: {}, enabled: true, whitelist: [], timeoutMs: 500 };
}

/** 临时监狱根 + hello.txt（fs.read / fs.list 断言素材） */
async function jailRootWithHello(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "mcpbridge-fs-"));
  tmpDirs.push(root);
  await writeFile(join(root, "hello.txt"), "hello mcp bridge", "utf8");
  return root;
}

// ---------------------------------------------------------------------------
// optional peer 探测与降级
// ---------------------------------------------------------------------------

describe("McpBridge — optional peer 探测与降级", () => {
  it("detect()：monorepo workspace 可解析 → true（二次调用走缓存）", async () => {
    const { bridge } = await newBridge();
    expect(await bridge.detect()).toBe(true);
    expect(await bridge.detect()).toBe(true);
  }, 10_000);

  it("forceUnavailable（模拟缺包）：detect false / status 降级形状 / start no-op / 全方法空结果", async () => {
    const root = await jailRootWithHello();
    // 有配置也必须降级：available:false 时配置不进 servers 视图（app.ts 据此 501）
    const { bridge } = await newBridge({ servers: { fsd: fsEntry(root) }, mergeTools: true }, { forceUnavailable: true });

    expect(await bridge.detect()).toBe(false);
    expect(await bridge.status()).toEqual({ available: false, running: false, servers: [] });

    await bridge.start(); // no-op —— 不 spawn 任何进程
    expect((await bridge.status()).running).toBe(false);

    const res = await bridge.callTool("fs.read", { path: "hello.txt" });
    expect(res.ok).toBe(false);
    expect(typeof res.error).toBe("string");
    expect(await bridge.listTools()).toEqual([]);
    expect(await bridge.toolDefinitions()).toEqual([]);
  }, 10_000);
});

// ---------------------------------------------------------------------------
// 状态快照（status 不主动 spawn）
// ---------------------------------------------------------------------------

describe("McpBridge — 状态快照（不 spawn）", () => {
  it("空配置未启动：{available:true, running:false, servers:[]}", async () => {
    const { bridge } = await newBridge();
    expect(await bridge.status()).toEqual({ available: true, running: false, servers: [] });
  }, 10_000);

  it("已配置未启动：条目 enabled:true / running:false / toolCount:0（无 spawn）", async () => {
    const root = await jailRootWithHello();
    const { bridge } = await newBridge({ servers: { fsd: fsEntry(root) } });
    const st = await bridge.status();
    expect(st.available).toBe(true);
    expect(st.running).toBe(false);
    expect(st.servers).toHaveLength(1);
    expect(st.servers[0]).toMatchObject({ name: "fsd", enabled: true, running: false, healthy: true, toolCount: 0, tools: [] });
    expect(await bridge.listTools()).toEqual([]); // 未启动 → 空
    expect(await bridge.callTool("fs.list", { path: "." })).toEqual({ ok: false, error: "MCP_BRIDGE_NOT_RUNNING" });
  }, 10_000);
});

// ---------------------------------------------------------------------------
// 真实拉起 E2E（mcp-fs stdio 服务器）
// ---------------------------------------------------------------------------

describe("McpBridge — 真实拉起 E2E（mcp-fs）", () => {
  it("start → status.running / 工具聚合与归属 / 真实调用与日志 → stop 翻转", async () => {
    const root = await jailRootWithHello();
    const { bridge } = await newBridge({ servers: { fsd: fsEntry(root) } });

    await bridge.start();
    const st = await bridge.status();
    expect(st.running).toBe(true);
    expect(st.servers).toHaveLength(1);
    const fsd = st.servers[0];
    expect(fsd).toMatchObject({ name: "fsd", enabled: true, running: true, healthy: true });
    expect(fsd.toolCount).toBeGreaterThan(0);
    expect(fsd.tools).toHaveLength(fsd.toolCount);
    for (const t of fsd.tools) expect(t.description.length).toBeGreaterThan(0);
    // mcp-fs 真实工具名 + HostToolInfo.server 精确归属
    expect(fsd.tools.map((t) => t.name)).toContain("fs.list");
    expect(fsd.tools.every((t) => t.server === "fsd")).toBe(true);

    const names = (await bridge.listTools()).map((t) => t.name);
    expect(names).toContain("fs.list");
    expect(names).toContain("fs.read");
    expect(names).toContain("fs.tree");

    // 真实读：内容逐字节断言
    const read = await bridge.callTool("fs.read", { path: "hello.txt" });
    expect(read.ok).toBe(true);
    expect((read.data as { content: string }).content).toBe("hello mcp bridge");
    expect((read.data as { truncated: boolean }).truncated).toBe(false);

    // 真实列目录：条目命中
    const list = await bridge.callTool("fs.list", { path: "." });
    expect(list.ok).toBe(true);
    const entries = ((list.data as { entries: Array<{ name: string }> }).entries ?? []).map((e) => e.name);
    expect(entries).toContain("hello.txt");

    // 日志环：真实调用留痕
    expect(bridge.logs().some((l) => l.includes("fsd") && l.includes("fs.read"))).toBe(true);

    // 未知工具 → ok:false 不抛出
    const ghostTool = await bridge.callTool("ghost.tool", {});
    expect(ghostTool.ok).toBe(false);
    expect(typeof ghostTool.error).toBe("string");

    // stop → running 翻转 + 调用归一化错误
    await bridge.stop();
    const after = await bridge.status();
    expect(after.running).toBe(false);
    expect(after.servers[0].running).toBe(false);
    expect(await bridge.listTools()).toEqual([]);
    expect(await bridge.callTool("fs.read", { path: "hello.txt" })).toEqual({ ok: false, error: "MCP_BRIDGE_NOT_RUNNING" });
  }, 30_000);

  it("白名单：listTools 只含白名单内工具；白名单外调用被拒", async () => {
    const root = await jailRootWithHello();
    const { bridge } = await newBridge({ servers: { fsd: fsEntry(root, { whitelist: ["fs.list"] }) } });
    await bridge.start();
    expect((await bridge.listTools()).map((t) => t.name)).toEqual(["fs.list"]);
    expect((await bridge.status()).servers[0].toolCount).toBe(1);
    const denied = await bridge.callTool("fs.read", { path: "hello.txt" });
    expect(denied.ok).toBe(false);
    expect(denied.error ?? "").toContain("whitelist");
    await bridge.stop();
  }, 30_000);

  it("唯一服务器 enabled:false → start 后 bridge.running 仍为 false（host 不拉起任何进程）", async () => {
    const root = await jailRootWithHello();
    const { bridge } = await newBridge({ servers: { off: fsEntry(root, { enabled: false }) } });
    await bridge.start();
    const st = await bridge.status();
    expect(st.running).toBe(false);
    expect(st.servers).toHaveLength(1);
    expect(st.servers[0]).toMatchObject({ name: "off", enabled: false, running: false, healthy: true, toolCount: 0, tools: [] });
    expect(await bridge.listTools()).toEqual([]);
    expect((await bridge.callTool("fs.list", { path: "." })).ok).toBe(false);
    await bridge.stop();
  }, 30_000);
});

// ---------------------------------------------------------------------------
// mergeTools / toolDefinitions
// ---------------------------------------------------------------------------

describe("McpBridge — mergeTools / toolDefinitions", () => {
  it("mergeTools 关：running 且工具在场 → toolDefinitions() 仍为 []", async () => {
    const root = await jailRootWithHello();
    const { bridge } = await newBridge({ servers: { fsd: fsEntry(root) }, mergeTools: false });
    await bridge.start();
    expect((await bridge.listTools()).length).toBeGreaterThan(0);
    expect(await bridge.toolDefinitions()).toEqual([]);
    await bridge.stop();
  }, 30_000);

  it("mergeTools 开：白名单内工具的定义（name/description/parameters JSON Schema）", async () => {
    const root = await jailRootWithHello();
    const { bridge } = await newBridge({ servers: { fsd: fsEntry(root, { whitelist: ["fs.read", "fs.list"] }) }, mergeTools: true });
    await bridge.start();
    const defs = await bridge.toolDefinitions();
    expect(defs.map((d) => d.name).sort()).toEqual(["fs.list", "fs.read"]);
    const read = defs.find((d) => d.name === "fs.read");
    expect(read?.description.length ?? 0).toBeGreaterThan(0);
    expect(read?.parameters).toHaveProperty("type", "object");
    await bridge.stop();
  }, 30_000);
});

// ---------------------------------------------------------------------------
// restartIfConfigChanged（PUT /api/mcp/servers 之后的跟随）
// ---------------------------------------------------------------------------

describe("McpBridge — restartIfConfigChanged", () => {
  it("新增服务器条目 → 重启 host 并反映新集合（真实 a + 必然 spawn 失败的 ghost）", async () => {
    const root = await jailRootWithHello();
    const { bridge, store } = await newBridge({ servers: { a: fsEntry(root) } });
    await bridge.start();
    expect((await bridge.status()).servers.map((s) => s.name)).toEqual(["a"]);

    // 配置未变 → no-op（行为断言：不抛、状态保持）
    await bridge.restartIfConfigChanged();
    expect((await bridge.status()).running).toBe(true);

    // 新增 ghost：命令不存在 → spawn 同步抛 ENOENT → host 标记 unhealthy（host.start 仍 resolve）
    store.update({ mcp: { servers: { a: fsEntry(root), ghost: ghostEntry() } } });
    await bridge.restartIfConfigChanged();

    const st = await bridge.status();
    expect(st.running).toBe(true); // host 已启动且仍有 enabled 服务器
    expect(st.servers.map((s) => s.name)).toEqual(["a", "ghost"]);
    const a = st.servers.find((s) => s.name === "a");
    const ghost = st.servers.find((s) => s.name === "ghost");
    expect(a?.running).toBe(true);
    expect(a?.toolCount ?? 0).toBeGreaterThan(0); // 重启后 a 重新拉起，工具恢复
    expect(ghost?.running).toBe(false);
    expect(ghost?.healthy).toBe(false);
    // 日志环有 ghost 的 spawn 失败留痕
    expect(bridge.logs().some((l) => l.includes("ghost") && l.includes("(spawn)"))).toBe(true);
    // a 的工具在重启后仍可真实调用
    const read = await bridge.callTool("fs.read", { path: "hello.txt" });
    expect(read.ok).toBe(true);
    expect((read.data as { content: string }).content).toBe("hello mcp bridge");
    await bridge.stop();
  }, 30_000);

  it("未启动过 → restartIfConfigChanged 不自动拉起（no-op）", async () => {
    const root = await jailRootWithHello();
    const { bridge, store } = await newBridge({ servers: { a: fsEntry(root) } });
    store.update({ mcp: { servers: { b: fsEntry(root) } } });
    await bridge.restartIfConfigChanged();
    expect((await bridge.status()).running).toBe(false);
  }, 10_000);
});
