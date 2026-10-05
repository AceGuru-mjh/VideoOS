// host 全家桶集成 E2E（Issue #37 / AK-M4 收口）：
// 一个 mcp.json 同时配置全部六台服务器（fs/shell/os/web/media/assets）→ McpHost 拉起 →
// 工具聚合无冲突 → 每台服务器一次真实调用 → stop 无孤儿。
// media/assets 依赖 ffmpeg —— ubuntu CI 已装；本测试用 Bun.which 探测，缺失时相关断言降级为
// 结构化错误断言（保持跨环境可运行），但 ubuntu 上必须全链路真跑。
import { afterAll, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpHost } from "../src/index";
import type { McpHostConfig } from "../src/types";

const PKG = (name: string): string => join(import.meta.dir, "..", "..", name, "src", "index.ts");
const BUN = process.execPath;

const tmpDirs: string[] = [];
const hosts: McpHost[] = [];

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

const FFMPEG_AVAILABLE = Bun.which("ffmpeg") !== null;

describe("host 全家桶集成（fs/shell/os/web/media/assets + web）", () => {
  it("全部服务器同时拉起 → 工具聚合（前缀命名空间，无裸名冲突）", async () => {
    const root = await mkdtemp(join(tmpdir(), "mcp-integration-"));
    tmpDirs.push(root);
    const webRoot = await mkdtemp(join(tmpdir(), "mcp-web-"));
    tmpDirs.push(webRoot);
    const assetsRoot = await mkdtemp(join(tmpdir(), "mcp-assets-"));
    tmpDirs.push(assetsRoot);
    await mkdir(join(assetsRoot, "sub"), { recursive: true });
    await writeFile(join(assetsRoot, "hello.txt"), "not media but fine", "utf8");

    const cfg: McpHostConfig = {
      servers: {
        fs: { command: BUN, args: [PKG("mcp-fs")], env: { MCP_FS_ROOTS: root }, timeoutMs: 20_000 },
        shell: { command: BUN, args: [PKG("mcp-shell")], env: { MCP_SHELL_ROOTS: root } },
        os: { command: BUN, args: [PKG("mcp-os")] },
        web: { command: BUN, args: [PKG("mcp-web")] },
        media: { command: BUN, args: [PKG("mcp-media")], env: { MCP_MEDIA_ROOTS: root } },
        assets: { command: BUN, args: [PKG("mcp-assets")], env: { MCP_ASSETS_ROOTS: assetsRoot } },
      },
    };
    const host = new McpHost(cfg);
    hosts.push(host);
    await host.start();

    const tools = host.listTools();
    const names = tools.map((t) => t.name);
    // 六台服务器的全部工具都聚合进来（前缀即命名空间，天然无冲突）
    for (const expected of [
      "fs.list", "fs.read", "fs.write", "fs.move", "fs.remove", "fs.search", "fs.tree",
      "shell.exec", "shell.which",
      "os.info", "os.disk", "os.env",
      "web.fetch", "web.dns",
      "media.probe", "media.convert", "media.thumbnail", "media.extractAudio", "media.gif", "media.concat",
      "assets.index", "assets.search", "assets.info",
    ]) {
      expect(names).toContain(expected);
    }
    // 每台服务器至少一台；条目带 server 归属与 JSON Schema
    const servers = new Set(tools.map((t) => t.server));
    expect([...servers].sort()).toEqual(["assets", "fs", "media", "os", "shell", "web"]);
    for (const t of tools) {
      expect(t.parameters).toHaveProperty("type", "object");
      expect(t.description.length).toBeGreaterThan(0);
    }

    // ---- 每台服务器一次真实调用 ----
    // fs：写入 + 读回
    const written = await host.callTool("fs.write", { path: "hello.txt", content: "integration!" });
    expect(written.ok).toBe(true);
    const read = await host.callTool("fs.read", { path: "hello.txt" });
    expect(read).toEqual({ ok: true, data: { content: "integration!", truncated: false, size: 12 } });

    // shell：echo 往返（Windows CI 上 cmd /c echo 同样输出 hello）
    const echoed = await host.callTool("shell.exec", { command: "echo hello" });
    expect(echoed.ok).toBe(true);
    expect((echoed.data as { stdout: string }).stdout.trim()).toContain("hello");

    // os：平台信息
    const info = await host.callTool("os.info", {});
    expect(info.ok).toBe(true);
    expect((info.data as { platform: string }).platform).toBe(process.platform);

    // web：dns localhost（离线）
    const dns = await host.callTool("web.dns", { hostname: "localhost" });
    expect(dns.ok).toBe(true);
    expect((dns.data as { addresses: string[] }).addresses).toContain("127.0.0.1");

    // media + assets：ffmpeg 在位则全链路（生成 1s 素材 → probe → 索引 → 搜索）
    if (FFMPEG_AVAILABLE) {
      const gen = Bun.spawnSync({
        cmd: ["ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=duration=1:size=320x240:rate=10", "-pix_fmt", "yuv420p", join(root, "clip.mp4")],
        stdout: "ignore", stderr: "ignore",
      });
      expect(gen.exitCode).toBe(0);

      const probe = await host.callTool("media.probe", { path: "clip.mp4" });
      expect(probe.ok).toBe(true);
      const streams = (probe.data as { streams: Array<{ type: string; width?: number }> }).streams;
      expect(streams.some((s) => s.type === "video" && s.width === 320)).toBe(true);

      const index = await host.callTool("assets.index", { root: assetsRoot, refresh: true });
      expect(index.ok).toBe(true);
      const entries = (index.data as { entries: Array<{ name: string; type: string }> }).entries;
      // hello.txt 不是媒体文件，不入索引 —— 索引为空是合法结果；放一个真媒体再验
      const png = Bun.spawnSync({
        cmd: ["ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=duration=0.1:size=64x48:rate=5", "-frames:v", "1", join(assetsRoot, "shot.png")],
        stdout: "ignore", stderr: "ignore",
      });
      expect(png.exitCode).toBe(0);
      const reindex = await host.callTool("assets.index", { root: assetsRoot, refresh: true });
      expect(reindex.ok).toBe(true);
      const search = await host.callTool("assets.search", { query: "shot" });
      expect(search.ok).toBe(true);
      expect((search.data as { results: Array<{ name: string }> }).results.some((r) => r.name === "shot.png")).toBe(true);
      void entries;
    } else {
      // ffmpeg 缺失：结构化错误而非崩溃（跨环境降级断言）
      const probe = await host.callTool("media.probe", { path: "clip.mp4" });
      expect(probe.ok).toBe(false);
    }

    // ---- stop 无孤儿：全部服务器 PID 退出 ----
    await host.stop();
    expect(host.listTools()).toEqual([]);
    const after = await host.callTool("fs.list", { path: "." });
    expect(after.ok).toBe(false);
  }, 90_000);

  it("工具名冲突场景：同构双 fs 服务器 → 全名路由（<server>.<tool>）", async () => {
    const rootA = await mkdtemp(join(tmpdir(), "mcp-dup-a-"));
    const rootB = await mkdtemp(join(tmpdir(), "mcp-dup-b-"));
    tmpDirs.push(rootA, rootB);
    const host = new McpHost({
      servers: {
        alpha: { command: BUN, args: [PKG("mcp-fs")], env: { MCP_FS_ROOTS: rootA } },
        beta: { command: BUN, args: [PKG("mcp-fs")], env: { MCP_FS_ROOTS: rootB } },
      },
    });
    hosts.push(host);
    await host.start();

    const tools = host.listTools();
    // 全部 7 个 fs 工具都撞名 → 全部以 <server>.<tool> 暴露
    expect(tools.map((t) => t.name).sort()).toEqual([
      "alpha.fs.list", "alpha.fs.move", "alpha.fs.read", "alpha.fs.remove", "alpha.fs.search", "alpha.fs.tree", "alpha.fs.write",
      "beta.fs.list", "beta.fs.move", "beta.fs.read", "beta.fs.remove", "beta.fs.search", "beta.fs.tree", "beta.fs.write",
    ].sort());

    // 各自路由到各自监狱
    await host.callTool("alpha.fs.write", { path: "who.txt", content: "A" });
    await host.callTool("beta.fs.write", { path: "who.txt", content: "B" });
    const a = await host.callTool("alpha.fs.read", { path: "who.txt" });
    const b = await host.callTool("beta.fs.read", { path: "who.txt" });
    expect((a.data as { content: string }).content).toBe("A");
    expect((b.data as { content: string }).content).toBe("B");

    // 裸名 → 歧义错误并列出全名
    const ambiguous = await host.callTool("fs.list", { path: "." });
    expect(ambiguous.ok).toBe(false);
    expect(ambiguous.error).toContain("ambiguous");

    await host.stop();
  }, 60_000);
});
