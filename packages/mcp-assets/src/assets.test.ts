// mcp-assets 协议级 E2E（Issue #36）：PNG（@napi-rs/canvas 自产）+ WAV/MP4（ffmpeg lavfi 自产）
// + 字体（系统 DejaVu，缺失时退化为伪 TTF 断言 size-only 路径），
// Bun.spawn 拉起真服务器进程（MCP_ASSETS_ROOTS = 临时目录）走 JSON-RPC 断言。
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";

// ---------------------------------------------------------------------------
// 测试辅助：Bun.spawn 拉起真服务器进程 + JSON-RPC stdio 客户端（协议级 E2E）
// 注意：cmd 用 process.execPath（bun 绝对路径）——Bun.spawn 按子进程 env 的 PATH
// 解析裸命令名，用绝对路径才能在 PATH 被改写的场景下稳定拉起。
// ---------------------------------------------------------------------------

const CHILDREN: Array<Bun.Subprocess<"pipe", "pipe", "pipe">> = [];
afterAll(() => {
  for (const c of CHILDREN) {
    try {
      c.kill();
    } catch {
      /* exited */
    }
  }
});

interface McpChild {
  listTools(): Promise<Array<{ name: string; description: string; parameters: Record<string, unknown> }>>;
  call(name: string, args?: Record<string, unknown>): Promise<{ ok: boolean; data?: any; error?: string }>;
  close(): Promise<void>;
}

async function spawnMcp(script: string, env: Record<string, string> = {}): Promise<McpChild> {
  const proc = Bun.spawn({
    cmd: [process.execPath, script],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
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
      const t = setTimeout(() => reject(new Error(`timeout waiting for ${method} #${id}`)), 15_000);
      waiters.push((l) => {
        clearTimeout(t);
        resolve(l);
      });
    });
    if (line === "__EOF__") throw new Error(`server exited while waiting for ${method}`);
    return JSON.parse(line);
  };
  const init = await request("initialize", { protocolVersion: "2025-03-26" });
  if (init.error) throw new Error(`initialize failed: ${JSON.stringify(init.error)}`);
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  return {
    listTools: async () => {
      const r = await request("tools/list");
      if (r.error) throw new Error(r.error.message);
      return r.result.tools;
    },
    call: async (name, args = {}) => {
      const r = await request("tools/call", { name, arguments: args });
      if (r.error) return { ok: false, error: `${r.error.code}: ${r.error.message}` };
      return r.result;
    },
    close: async () => {
      try {
        proc.stdin.end();
      } catch {
        /* ignore */
      }
      await proc.exited;
    },
  };
}

// ---------------------------------------------------------------------------
// 测试素材：临时目录 = 监狱根
// ---------------------------------------------------------------------------

const ROOT = mkdtempSync(join(tmpdir(), "mcp-assets-"));
const DEJAVU = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
/** 真 DejaVu 可用 → 断言 family；否则伪 TTF → 断言 size-only 回退路径 */
let realFont = false;

async function genFfmpeg(args: string[]): Promise<void> {
  const bin = Bun.which("ffmpeg") ?? "ffmpeg";
  const proc = Bun.spawn([bin, ...args], { cwd: ROOT, stdout: "ignore", stderr: "pipe", stdin: "ignore" });
  const stderrText = new Response(proc.stderr).text();
  const code = await proc.exited;
  if (code !== 0) throw new Error(`material generation failed: ${await stderrText}`);
}

let mcp: McpChild;

beforeAll(async () => {
  // PNG：canvas 自绘 120x90
  const canvas = createCanvas(120, 90);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#22c55e";
  ctx.fillRect(0, 0, 120, 90);
  writeFileSync(join(ROOT, "test-image.png"), canvas.toBuffer("image/png"));
  // WAV / MP4：ffmpeg lavfi 1s
  await genFfmpeg(["-f", "lavfi", "-i", "sine=frequency=440:duration=1", "test-tone.wav"]);
  await genFfmpeg(["-f", "lavfi", "-i", "testsrc=duration=1:size=320x240:rate=10", "-pix_fmt", "yuv420p", "test-clip.mp4"]);
  // 字体：优先拷贝系统 DejaVu；缺失则写伪 TTF 字节（走 size-only 回退路径）
  if (existsSync(DEJAVU)) {
    copyFileSync(DEJAVU, join(ROOT, "test-font.ttf"));
    realFont = true;
  } else {
    const fake = new Uint8Array(256);
    fake.set([0, 1, 0, 0]);
    for (let i = 4; i < fake.length; i++) fake[i] = Math.floor(Math.random() * 256);
    writeFileSync(join(ROOT, "test-font.ttf"), fake);
    realFont = false;
  }
  mcp = await spawnMcp(join(import.meta.dir, "index.ts"), { MCP_ASSETS_ROOTS: ROOT });
}, 60_000);

describe("mcp-assets 协议级 E2E", () => {
  it("tools/list → 3 个工具", async () => {
    const tools = await mcp.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["assets.index", "assets.info", "assets.search"]);
    for (const t of tools) {
      expect((t.parameters as { type?: string }).type).toBe("object");
    }
  }, 15_000);

  it("assets.index：四类素材 + 尺寸/时长 + .assets-index.json 镜像", async () => {
    const r = await mcp.call("assets.index", { root: ROOT });
    expect(r.ok).toBe(true);
    const entries: any[] = r.data.entries;
    const png = entries.find((e) => e.name === "test-image.png");
    expect(png).toBeDefined();
    expect(png.type).toBe("image");
    expect(png.width).toBe(120);
    expect(png.height).toBe(90);
    const wav = entries.find((e) => e.name === "test-tone.wav");
    expect(wav.type).toBe("audio");
    expect(wav.durationSeconds).toBeGreaterThanOrEqual(0.5);
    expect(wav.durationSeconds).toBeLessThanOrEqual(1.5);
    const mp4 = entries.find((e) => e.name === "test-clip.mp4");
    expect(mp4.type).toBe("video");
    expect(mp4.durationSeconds).toBeGreaterThanOrEqual(0.5);
    expect(mp4.durationSeconds).toBeLessThanOrEqual(1.5);
    const font = entries.find((e) => e.name === "test-font.ttf");
    expect(font).toBeDefined();
    expect(font.type).toBe("font");
    expect(r.data.count).toBe(entries.length);
    // 镜像文件已写盘且含 entries
    const mirror = join(ROOT, ".assets-index.json");
    expect(existsSync(mirror)).toBe(true);
    expect(readFileSync(mirror, "utf8")).toContain("entries");
  }, 30_000);

  it("内存缓存：refresh 不传不重扫；refresh:true 捡到新文件", async () => {
    const first = await mcp.call("assets.index", { root: ROOT });
    expect(first.ok).toBe(true);
    const count = first.data.count as number;
    writeFileSync(join(ROOT, "late.png"), readFileSync(join(ROOT, "test-image.png")));
    const cached = await mcp.call("assets.index", { root: ROOT });
    expect(cached.ok).toBe(true);
    expect(cached.data.count).toBe(count);
    expect((cached.data.entries as any[]).some((e) => e.name === "late.png")).toBe(false);
    const refreshed = await mcp.call("assets.index", { root: ROOT, refresh: true });
    expect(refreshed.ok).toBe(true);
    expect(refreshed.data.count).toBe(count + 1);
    expect((refreshed.data.entries as any[]).some((e) => e.name === "late.png")).toBe(true);
  }, 30_000);

  it("assets.search：名称子串命中 / 未命中为空", async () => {
    const hit = await mcp.call("assets.search", { query: "test-image" });
    expect(hit.ok).toBe(true);
    expect((hit.data.results as any[]).some((e) => e.name === "test-image.png")).toBe(true);
    expect(hit.data.total).toBeGreaterThan(0);
    const miss = await mcp.call("assets.search", { query: "zzz-not-there" });
    expect(miss.ok).toBe(true);
    expect(miss.data.results).toHaveLength(0);
    expect(miss.data.total).toBe(0);
  }, 15_000);

  it("assets.search type=audio：排除 png/mp4", async () => {
    const r = await mcp.call("assets.search", { query: "test", type: "audio" });
    expect(r.ok).toBe(true);
    const results = r.data.results as any[];
    expect(results.length).toBeGreaterThan(0);
    for (const e of results) expect(e.type).toBe("audio");
    expect(results.some((e) => e.name === "test-tone.wav")).toBe(true);
    expect(results.some((e) => e.name === "test-image.png" || e.name === "test-clip.mp4")).toBe(false);
  }, 15_000);

  it("未建索引即搜索（新进程）→ no index yet", async () => {
    const fresh = await spawnMcp(join(import.meta.dir, "index.ts"), { MCP_ASSETS_ROOTS: ROOT });
    try {
      const r = await fresh.call("assets.search", { query: "test" });
      expect(r.ok).toBe(false);
      expect(r.error).toContain("no index yet");
    } finally {
      await fresh.close();
    }
  }, 30_000);

  it("assets.info png → 120x90", async () => {
    const r = await mcp.call("assets.info", { path: "test-image.png" });
    expect(r.ok).toBe(true);
    expect(r.data.type).toBe("image");
    expect(r.data.width).toBe(120);
    expect(r.data.height).toBe(90);
    expect(r.data.sizeBytes).toBeGreaterThan(0);
  }, 15_000);

  it("assets.info 字体 → 名称表（真 DejaVu）/ size-only（伪 TTF）", async () => {
    const r = await mcp.call("assets.info", { path: "test-font.ttf" });
    expect(r.ok).toBe(true);
    expect(r.data.type).toBe("font");
    expect(r.data.sizeBytes).toBeGreaterThan(0);
    if (realFont) {
      const family = r.data.family as string | undefined;
      const fullName = r.data.fullName as string | undefined;
      const matched = family === "DejaVu Sans" || String(fullName ?? "").includes("DejaVu Sans");
      expect(matched).toBe(true);
    } else {
      expect(r.data.format).toBe("ttf");
      expect(r.data.family).toBeUndefined();
    }
  }, 15_000);

  it("监狱外：assets.info 越狱路径 / assets.index 越狱 root / 符号链接逃逸 → ok:false", async () => {
    const info = await mcp.call("assets.info", { path: "../../etc/passwd" });
    expect(info.ok).toBe(false);
    expect(info.error).toContain("escapes jail");
    const index = await mcp.call("assets.index", { root: "/etc" });
    expect(index.ok).toBe(false);
    expect(index.error).toContain("escapes jail");
    symlinkSync("/etc/passwd", join(ROOT, "escape-link.png"));
    const viaLink = await mcp.call("assets.info", { path: "escape-link.png" });
    expect(viaLink.ok).toBe(false);
    expect(viaLink.error).toContain("escapes jail");
  }, 15_000);

  it("搜索截断：60 个 cap-*.png → results 50 / total 60", async () => {
    const pngBytes = readFileSync(join(ROOT, "test-image.png"));
    for (let i = 1; i <= 60; i++) {
      writeFileSync(join(ROOT, `cap-${String(i).padStart(2, "0")}.png`), pngBytes);
    }
    const refreshed = await mcp.call("assets.index", { root: ROOT, refresh: true });
    expect(refreshed.ok).toBe(true);
    const r = await mcp.call("assets.search", { query: "cap-" });
    expect(r.ok).toBe(true);
    expect(r.data.results).toHaveLength(50);
    expect(r.data.total).toBe(60);
  }, 60_000);
});
