// mcp-media 协议级 E2E：spawn 真子进程，ffmpeg 样本用 lavfi 自产（testsrc/sine）。
// ffmpeg/ffprobe 缺失的机器上媒体用例自动 skip（本机两者都有 → 真跑）。
import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { mkdtempSync, writeFileSync, existsSync, statSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { spawnLiteServer } from "@videoos/mcp-lite/testing";

const SERVER = join(import.meta.dir, "index.ts");

const hasFfmpeg = (() => {
  try {
    return spawnSync("ffmpeg", ["-version"], { timeout: 5_000 }).error === undefined;
  } catch {
    return false;
  }
})();

/** 生成 1 秒 320x240@10fps 测试视频（lavfi testsrc，无外部素材依赖） */
function makeSample(dir: string, name: string, withAudio = false): string {
  const out = join(dir, name);
  const args = withAudio
    ? ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=1:size=320x240:rate=10",
       "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-pix_fmt", "yuv420p", "-c:a", "aac", out]
    : ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=1:size=320x240:rate=10",
       "-pix_fmt", "yuv420p", out];
  const res = spawnSync("ffmpeg", args, { timeout: 30_000 });
  if (res.status !== 0) throw new Error(`sample generation failed: ${res.stderr}`);
  return out;
}

describe("mcp-media (E2E)", () => {
  it(
    "exposes 6 media tools",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        expect(server.tools.map((t) => t.name).sort()).toEqual([
          "media.concat",
          "media.convert",
          "media.extractAudio",
          "media.gif",
          "media.probe",
          "media.thumbnail",
        ]);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  (hasFfmpeg ? it : it.skip)(
    "media.probe returns a compact format/streams summary for a lavfi sample",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "mcp-media-"));
      makeSample(root, "sample.mp4");
      const server = await spawnLiteServer(SERVER, { env: { MCP_MEDIA_ROOTS: root } });
      try {
        const result = await server.call("media.probe", { path: "sample.mp4" });
        expect(result.ok).toBe(true);
        const data = result.data as {
          format: { duration?: number; width?: number; height?: number; fps?: number; codec?: string; container?: string };
          streams: Array<{ type: string; codec?: string }>;
        };
        expect(data.format.width).toBe(320);
        expect(data.format.height).toBe(240);
        expect(data.format.fps).toBe(10);
        expect(data.format.duration).toBeCloseTo(1, 2);
        expect(data.format.codec).toBe("h264");
        expect(data.format.container).toBe("mov"); // format_name "mov,mp4,..." 取首段
        expect(data.streams.length).toBeGreaterThanOrEqual(1);
        expect(data.streams[0]!.type).toBe("video");

        const missing = await server.call("media.probe", { path: "nope.mp4" });
        expect(missing.ok).toBe(false);
        expect(missing.error).toContain("E_FFMPEG"); // 监狱内不存在 → ffprobe 结构化报错
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  (hasFfmpeg ? it : it.skip)(
    "media.convert re-encodes with allowlisted args and rejects dangerous flags",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "mcp-media-"));
      makeSample(root, "in.mp4");
      const server = await spawnLiteServer(SERVER, { env: { MCP_MEDIA_ROOTS: root } });
      try {
        const good = await server.call("media.convert", {
          input: "in.mp4",
          output: "cut.mp4",
          args: ["-t", "0.5", "-c:v", "libx264", "-crf", "30"],
        });
        expect(good.ok).toBe(true);
        const data = good.data as { output: string; durationMs: number };
        expect(data.durationMs).toBeGreaterThan(0);
        expect(existsSync(data.output)).toBe(true);

        for (const bad of [
          ["-i", "evil.mp4"],
          ["-y", "/dev/sda"],
          ["conv=notrunc"],
          ["-vf", "subtitles=/etc/passwd"],
          ["-filter_complex", "movie=/etc/passwd"],
          ["-c:v", "http://evil/x"],
        ]) {
          const rejected = await server.call("media.convert", {
            input: "in.mp4",
            output: "bad.mp4",
            args: bad as string[],
          });
          expect(rejected.ok).toBe(false);
          expect(rejected.error).toContain("E_ARGS");
        }
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  (hasFfmpeg ? it : it.skip)(
    "media.thumbnail grabs a PNG frame",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "mcp-media-"));
      makeSample(root, "sample.mp4");
      const server = await spawnLiteServer(SERVER, { env: { MCP_MEDIA_ROOTS: root } });
      try {
        const result = await server.call("media.thumbnail", {
          input: "sample.mp4",
          at: 0.5,
          output: "frame.png",
        });
        expect(result.ok).toBe(true);
        const data = result.data as { output: string };
        expect(existsSync(data.output)).toBe(true);
        expect(statSync(data.output).size).toBeGreaterThan(100);
        expect(readFileSync(data.output).subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  (hasFfmpeg ? it : it.skip)(
    "media.extractAudio copy (.m4a) and wav modes produce audio files",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "mcp-media-"));
      makeSample(root, "av.mp4", true);
      const server = await spawnLiteServer(SERVER, { env: { MCP_MEDIA_ROOTS: root } });
      try {
        const copy = await server.call("media.extractAudio", {
          input: "av.mp4",
          output: "tone.m4a",
          mode: "copy",
        });
        expect(copy.ok).toBe(true);
        expect(statSync(join(root, "tone.m4a")).size).toBeGreaterThan(500);

        const wav = await server.call("media.extractAudio", {
          input: "av.mp4",
          output: "tone.wav",
          mode: "wav",
        });
        expect(wav.ok).toBe(true);
        const buf = readFileSync(join(root, "tone.wav"));
        expect(buf.subarray(0, 4).toString("ascii")).toBe("RIFF"); // WAV 魔数
        expect(buf.readUInt32LE(24)).toBe(16000); // -ar 16000 → sample rate 字段
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  (hasFfmpeg ? it : it.skip)(
    "media.gif renders an animated GIF via the palette chain",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "mcp-media-"));
      makeSample(root, "sample.mp4");
      const server = await spawnLiteServer(SERVER, { env: { MCP_MEDIA_ROOTS: root } });
      try {
        const result = await server.call("media.gif", {
          input: "sample.mp4",
          output: "anim.gif",
          fps: 10,
          width: 160,
        });
        expect(result.ok).toBe(true);
        const buf = readFileSync(join(root, "anim.gif"));
        expect(buf.subarray(0, 4).toString("ascii")).toBe("GIF8");
        expect(buf.length).toBeGreaterThan(1000);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  (hasFfmpeg ? it : it.skip)(
    "media.concat joins same-codec files and reports ffmpeg stderr on mismatch",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "mcp-media-"));
      makeSample(root, "a.mp4");
      makeSample(root, "b.mp4");
      const server = await spawnLiteServer(SERVER, { env: { MCP_MEDIA_ROOTS: root } });
      try {
        const good = await server.call("media.concat", {
          inputs: ["a.mp4", "b.mp4"],
          output: "joined.mp4",
        });
        expect(good.ok).toBe(true);
        const data = good.data as { output: string; inputs: number };
        expect(data.inputs).toBe(2);
        expect(existsSync(data.output)).toBe(true);
        expect(join(root, "joined.mp4")).toBe(data.output);
        // 残留 concat 清单应被清理（输出目录下无 joined.mp4.concat-* 文件）
        const leftovers = readdirSync(root).filter((f) => f.startsWith("joined.mp4.concat"));
        expect(leftovers).toEqual([]);

        // 失败路径：首个输入是坏文件 → ffmpeg concat demuxer 硬报错，stderr 摘要原样返回
        writeFileSync(join(root, "broken.mp4"), Buffer.alloc(64, 2));
        const bad = await server.call("media.concat", {
          inputs: ["broken.mp4", "a.mp4"],
          output: "broken.mp4.out",
        });
        expect(bad.ok).toBe(false);
        expect(bad.error).toContain("E_FFMPEG");
        expect(bad.error).toContain("Invalid data");
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "jail escape attempts are rejected (E_JAIL)",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "mcp-media-"));
      writeFileSync(join(root, "in.mp4"), "not really a video");
      const server = await spawnLiteServer(SERVER, { env: { MCP_MEDIA_ROOTS: root } });
      try {
        const outside = await server.call("media.convert", {
          input: "in.mp4",
          output: "../escape.mp4",
        });
        expect(outside.ok).toBe(false);
        expect(outside.error).toContain("E_JAIL");

        const missingTool = await server.call("media.probe", { path: "/etc/passwd" });
        expect(missingTool.ok).toBe(false);
        expect(missingTool.error).toContain("E_JAIL");
      } finally {
        await server.close();
      }
    },
    20_000,
  );
});
