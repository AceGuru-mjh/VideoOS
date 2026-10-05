// mcp-media 协议级 E2E（Issue #35）：测试素材用 ffmpeg lavfi 自产（1s testsrc/sine），
// Bun.spawn 拉起真服务器进程（MCP_MEDIA_ROOTS = 临时目录）走 JSON-RPC 断言。
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
// 测试素材：临时目录 = 监狱根；ffmpeg lavfi 自产 1s 样本
// ---------------------------------------------------------------------------

const ROOT = mkdtempSync(join(tmpdir(), "mcp-media-"));

async function genMaterial(args: string[]): Promise<void> {
  const bin = Bun.which("ffmpeg") ?? "ffmpeg";
  const proc = Bun.spawn([bin, ...args], { cwd: ROOT, stdout: "ignore", stderr: "pipe", stdin: "ignore" });
  const stderrText = new Response(proc.stderr).text();
  const code = await proc.exited;
  if (code !== 0) throw new Error(`material generation failed: ${await stderrText}`);
}

let mcp: McpChild;

beforeAll(async () => {
  await genMaterial([
    "-f", "lavfi", "-i", "testsrc=duration=1:size=320x240:rate=10",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
    "-shortest", "-pix_fmt", "yuv420p", "av.mp4",
  ]);
  await genMaterial(["-f", "lavfi", "-i", "testsrc=duration=1:size=320x240:rate=10", "-pix_fmt", "yuv420p", "v2.mp4"]);
  await genMaterial(["-f", "lavfi", "-i", "testsrc=duration=1:size=160x120:rate=10", "-pix_fmt", "yuv420p", "small.mp4"]);
  mcp = await spawnMcp(join(import.meta.dir, "index.ts"), { MCP_MEDIA_ROOTS: ROOT });
}, 60_000);

/** 便捷：经服务器进程 media.probe 探测，返回 { ok, data } */
function probeViaServer(path: string): Promise<{ ok: boolean; data?: any; error?: string }> {
  return mcp.call("media.probe", { path });
}

describe("mcp-media 协议级 E2E（ffmpeg lavfi 素材）", () => {
  it("tools/list → 6 个工具", async () => {
    const tools = await mcp.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "media.concat",
      "media.convert",
      "media.extractAudio",
      "media.gif",
      "media.probe",
      "media.thumbnail",
    ]);
  }, 15_000);

  it("media.probe av.mp4：容器/时长/视频流 320x240/音频流", async () => {
    const r = await probeViaServer("av.mp4");
    expect(r.ok).toBe(true);
    expect(String(r.data.container)).toContain("mp4");
    expect(r.data.durationSeconds).toBeGreaterThanOrEqual(0.8);
    expect(r.data.durationSeconds).toBeLessThanOrEqual(1.3);
    const video = r.data.streams.find((s: any) => s.type === "video");
    const audio = r.data.streams.find((s: any) => s.type === "audio");
    expect(video).toBeDefined();
    expect(video.width).toBe(320);
    expect(video.height).toBe(240);
    expect(audio).toBeDefined();
  }, 15_000);

  it("media.probe 不存在的文件 → ok:false", async () => {
    const r = await probeViaServer("no-such-file.mp4");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("file not found");
  }, 15_000);

  it("media.probe 监狱外路径（../ 穿越）→ escapes jail", async () => {
    const r = await probeViaServer("../../etc/passwd");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("escapes jail");
  }, 15_000);

  it("media.probe 符号链接逃逸（链到监狱外真实文件）→ escapes jail", async () => {
    symlinkSync("/etc/hostname", join(ROOT, "escape-link.mp4"));
    const r = await probeViaServer("escape-link.mp4");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("escapes jail");
  }, 15_000);

  it("media.thumbnail av.mp4 at 0.5 → PNG 落盘", async () => {
    const r = await mcp.call("media.thumbnail", { input: "av.mp4", at: 0.5, output: "out.png" });
    expect(r.ok).toBe(true);
    const abs = join(ROOT, "out.png");
    expect(existsSync(abs)).toBe(true);
    expect(statSync(abs).size).toBeGreaterThan(0);
  }, 30_000);

  it("media.extractAudio copy → out.m4a 纯音频", async () => {
    const r = await mcp.call("media.extractAudio", { input: "av.mp4", output: "out.m4a", mode: "copy" });
    expect(r.ok).toBe(true);
    expect(existsSync(join(ROOT, "out.m4a"))).toBe(true);
    const probe = await probeViaServer("out.m4a");
    expect(probe.ok).toBe(true);
    expect(probe.data.streams.some((s: any) => s.type === "audio")).toBe(true);
    expect(probe.data.streams.some((s: any) => s.type === "video")).toBe(false);
  }, 30_000);

  it("media.extractAudio wav → 16kHz", async () => {
    const r = await mcp.call("media.extractAudio", { input: "av.mp4", output: "out.wav", mode: "wav" });
    expect(r.ok).toBe(true);
    expect(existsSync(join(ROOT, "out.wav"))).toBe(true);
    const probe = await probeViaServer("out.wav");
    expect(probe.ok).toBe(true);
    const audio = probe.data.streams.find((s: any) => s.type === "audio");
    expect(audio).toBeDefined();
    expect(audio.sampleRate).toBe(16000);
  }, 30_000);

  it("media.gif av.mp4 → GIF 落盘", async () => {
    const r = await mcp.call("media.gif", { input: "av.mp4", output: "out.gif" });
    expect(r.ok).toBe(true);
    const abs = join(ROOT, "out.gif");
    expect(existsSync(abs)).toBe(true);
    expect(statSync(abs).size).toBeGreaterThan(0);
  }, 30_000);

  it("media.convert -vf scale=160:120 → 宽 160", async () => {
    const r = await mcp.call("media.convert", { input: "av.mp4", output: "scaled.mp4", args: ["-vf", "scale=160:120"] });
    expect(r.ok).toBe(true);
    expect(existsSync(join(ROOT, "scaled.mp4"))).toBe(true);
    const probe = await probeViaServer("scaled.mp4");
    expect(probe.ok).toBe(true);
    const video = probe.data.streams.find((s: any) => s.type === "video");
    expect(video.width).toBe(160);
  }, 30_000);

  it("media.convert 危险参数（../ 与监狱外绝对路径）→ unsafe ffmpeg arg", async () => {
    const r1 = await mcp.call("media.convert", { input: "av.mp4", output: "x1.mp4", args: ["../evil"] });
    expect(r1.ok).toBe(false);
    expect(r1.error).toContain("unsafe ffmpeg arg");
    const r2 = await mcp.call("media.convert", { input: "av.mp4", output: "x2.mp4", args: ["/etc/passwd"] });
    expect(r2.ok).toBe(false);
    expect(r2.error).toContain("unsafe ffmpeg arg");
    expect(existsSync(join(ROOT, "x1.mp4"))).toBe(false);
  }, 15_000);

  it("media.concat [v2, v2] → 时长约 2s，concat 列表文件已清理", async () => {
    const r = await mcp.call("media.concat", { inputs: ["v2.mp4", "v2.mp4"], output: "concat-out.mp4" });
    expect(r.ok).toBe(true);
    const probe = await probeViaServer("concat-out.mp4");
    expect(probe.ok).toBe(true);
    expect(probe.data.durationSeconds).toBeGreaterThanOrEqual(1.7);
    expect(probe.data.durationSeconds).toBeLessThanOrEqual(2.4);
    expect(existsSync(join(ROOT, "concat-out.mp4.concat.txt"))).toBe(false);
  }, 30_000);

  it("media.concat 编码参数不一致（320x240 vs 160x120）→ mismatch", async () => {
    const r = await mcp.call("media.concat", { inputs: ["av.mp4", "small.mp4"], output: "concat-bad.mp4" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("mismatch");
    expect(r.error).toContain("160x120");
    expect(r.error).toContain("320x240");
    expect(existsSync(join(ROOT, "concat-bad.mp4.concat.txt"))).toBe(false);
  }, 30_000);

  it("ffmpeg 缺失（PATH=空目录）：probe 返回 ffmpeg not found 且服务器存活", async () => {
    const emptyPath = mkdtempSync(join(tmpdir(), "mcp-media-emptybin-"));
    const bare = await spawnMcp(join(import.meta.dir, "index.ts"), { PATH: emptyPath });
    try {
      const r = await bare.call("media.probe", { path: "av.mp4" });
      expect(r.ok).toBe(false);
      expect(r.error).toBe("ffmpeg not found");
      // 服务器进程仍在：后续 tools/list 正常响应
      const tools = await bare.listTools();
      expect(tools).toHaveLength(6);
    } finally {
      await bare.close();
    }
  }, 30_000);
});
