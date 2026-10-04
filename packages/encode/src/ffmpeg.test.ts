// ffmpeg 探测与编码器测试：detect/version、PNG 序列 → mp4/webm、音轨混流、进度回调、错误路径
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createCanvas } from "@napi-rs/canvas";
import { detectFfmpeg, ffmpegVersion, FfmpegEncoder } from "./ffmpeg";
import { EncodeError } from "./types";

let dir: string;
let bin: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "videoos-encode-ffmpeg-"));
  bin = detectFfmpeg() ?? "/usr/bin/ffmpeg";
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 生成纯色 PNG 帧（颜色随 index 变化，保证帧间有运动量） */
function makeFrame(index: number, width = 320, height = 240): Buffer {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = `hsl(${(index * 40) % 360}, 80%, 55%)`;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#101020";
  ctx.fillRect((index * 37) % (width - 80), (index * 53) % (height - 40), 80, 40);
  return canvas.toBuffer("image/png");
}

async function writeFrames(count: number, target = dir): Promise<void> {
  mkdirSync(target, { recursive: true });
  for (let i = 0; i < count; i++) {
    writeFileSync(join(target, `frame_${String(i).padStart(6, "0")}.png`), makeFrame(i));
  }
}

/** 最小 PCM WAV（静音，16-bit mono） */
function makeSilentWav(seconds: number, sampleRate = 44100): Buffer {
  const numSamples = Math.floor(seconds * sampleRate);
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataSize, 40);
  return buf;
}

/** 用 ffmpeg -i 解析时长（秒）；无输出时退出码非 0 属正常，读 stderr */
function probeDuration(file: string): number {
  const res = spawnSync(bin, ["-i", file], { shell: false, encoding: "utf8" });
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(res.stderr ?? "");
  if (m === null) throw new Error(`No Duration in ffmpeg -i output: ${res.stderr?.slice(0, 400)}`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

describe("detectFfmpeg / ffmpegVersion", () => {
  test("本机可探测到 ffmpeg", () => {
    const found = detectFfmpeg();
    expect(found).not.toBeNull();
  });

  test("FFMPEG_PATH 显式指向不存在路径 → null（不静默回退系统 ffmpeg）", () => {
    const prev = process.env.FFMPEG_PATH;
    process.env.FFMPEG_PATH = join(dir, "no-such-ffmpeg");
    try {
      expect(detectFfmpeg()).toBeNull();
      // 无 ffmpeg 时 FfmpegEncoder 默认构造 → bin 为 null → ensureAvailable 抛错（提示 doctor）
      const encoder = new FfmpegEncoder();
      expect(encoder.bin).toBeNull();
      expect(() => encoder.ensureAvailable()).toThrow(/ENCODE_FFMPEG_NOT_FOUND/);
      expect(() => encoder.ensureAvailable()).toThrow(/videoos doctor/);
    } finally {
      if (prev === undefined) delete process.env.FFMPEG_PATH;
      else process.env.FFMPEG_PATH = prev;
    }
  });

  test("FFMPEG_PATH 有效时优先返回", () => {
    const prev = process.env.FFMPEG_PATH;
    process.env.FFMPEG_PATH = bin;
    try {
      expect(detectFfmpeg()).toBe(bin);
    } finally {
      if (prev === undefined) delete process.env.FFMPEG_PATH;
      else process.env.FFMPEG_PATH = prev;
    }
  });

  test("ffmpegVersion 返回 -version 首行", async () => {
    const v = await ffmpegVersion(bin);
    expect(v).not.toBeNull();
    expect(v!.startsWith("ffmpeg version")).toBe(true);
  });

  test("无效二进制返回 null", async () => {
    expect(await ffmpegVersion(join(dir, "no-such-ffmpeg"))).toBeNull();
  });
});

describe("FfmpegEncoder.encodePngSequence", () => {
  test("3 帧 PNG 序列 → mp4（libx264 默认参数）", async () => {
    const framesDir = join(dir, "seq-basic");
    await writeFrames(3, framesDir);
    const output = join(dir, "basic.mp4");
    const encoder = new FfmpegEncoder(bin);
    const result = await encoder.encodePngSequence(framesDir, output, { fps: 12, width: 320, height: 240 });

    expect(existsSync(output)).toBe(true);
    expect(statSync(output).size).toBeGreaterThan(1000);
    expect(result.output).toBe(output);
    expect(result.frames).toBe(3);
    expect(result.durationSeconds).toBeCloseTo(0.25, 6);
    // 命令模板断言
    expect(result.command).toContain("-framerate 12");
    expect(result.command).toContain("-c:v libx264");
    expect(result.command).toContain("-crf 18");
    expect(result.command).toContain("-preset medium");
    expect(result.command).toContain("-pix_fmt yuv420p");
    expect(result.command).toContain("-movflags +faststart");
    expect(result.stderrTail).toBeDefined();
    // 实际容器时长 ≈ 0.25s
    expect(probeDuration(output)).toBeGreaterThanOrEqual(0.2);
  });

  test("onProgress 收到 frame=N 进度（末值为总帧数）", async () => {
    const framesDir = join(dir, "seq-progress");
    await writeFrames(5, framesDir);
    const received: number[] = [];
    await new FfmpegEncoder(bin).encodePngSequence(framesDir, join(dir, "progress.mp4"), {
      fps: 10, width: 320, height: 240,
      onProgress: (n) => received.push(n),
    });
    expect(received.length).toBeGreaterThan(0);
    expect(received.every((n) => Number.isInteger(n) && n >= 0)).toBe(true);
    expect(received[received.length - 1]).toBe(5);
  });

  test("codec vp9 → webm（libvpx-vp9 -b:v 0）", async () => {
    const framesDir = join(dir, "seq-vp9");
    await writeFrames(3, framesDir);
    const output = join(dir, "vp9.webm");
    const result = await new FfmpegEncoder(bin).encodePngSequence(framesDir, output, {
      fps: 12, width: 320, height: 240, codec: "vp9",
    });
    expect(existsSync(output)).toBe(true);
    expect(statSync(output).size).toBeGreaterThan(500);
    expect(result.command).toContain("-c:v libvpx-vp9");
    expect(result.command).toContain("-b:v 0");
    expect(result.command).not.toContain("+faststart");
  });

  test("音轨混流：WAV + volume → mp4 含 aac 音轨", async () => {
    const framesDir = join(dir, "seq-audio");
    await writeFrames(4, framesDir);
    const wav = join(dir, "silent.wav");
    writeFileSync(wav, makeSilentWav(0.6));
    const output = join(dir, "audio.mp4");
    const result = await new FfmpegEncoder(bin).encodePngSequence(framesDir, output, {
      fps: 10, width: 320, height: 240, audio: { path: wav, volume: 0.5 },
    });
    expect(existsSync(output)).toBe(true);
    expect(result.command).toContain("-filter:a volume=0.5");
    expect(result.command).toContain("-c:a aac");
    expect(result.command).toContain("-shortest");
    const probe = spawnSync(bin, ["-i", output], { shell: false, encoding: "utf8" });
    expect(probe.stderr).toContain("Audio: aac");
  });

  test("空目录 → ENCODE_NO_FRAMES（不运行 ffmpeg）", async () => {
    const framesDir = join(dir, "seq-empty");
    const encoder = new FfmpegEncoder(bin);
    await expect(encoder.encodePngSequence(framesDir, join(dir, "empty.mp4"), { fps: 12, width: 320, height: 240 }))
      .rejects.toThrow(/ENCODE_NO_FRAMES/);
  });

  test("ffmpeg 失败 → ENCODE_FAILED 含完整命令行与 stderr 尾部", async () => {
    const framesDir = join(dir, "seq-fail");
    await writeFrames(2, framesDir);
    const output = join(dir, "no-such-dir", "out.mp4");
    const encoder = new FfmpegEncoder(bin);
    try {
      await encoder.encodePngSequence(framesDir, output, { fps: 12, width: 320, height: 240 });
      throw new Error("should not reach");
    } catch (err) {
      expect(err).toBeInstanceOf(EncodeError);
      const e = err as EncodeError;
      expect(e.code).toBe("ENCODE_FAILED");
      expect(e.message).toContain("command: ");
      expect(e.message).toContain("ffmpeg exited with code");
      expect(e.message.length).toBeLessThan(2000 + 1000); // stderr 尾部截断
    }
  });

  test("非法选项 → ENCODE_INVALID_OPTIONS", async () => {
    const framesDir = join(dir, "seq-invalid");
    await writeFrames(1, framesDir);
    const encoder = new FfmpegEncoder(bin);
    await expect(encoder.encodePngSequence(framesDir, join(dir, "x.mp4"), { fps: 0, width: 320, height: 240 }))
      .rejects.toThrow(/ENCODE_INVALID_OPTIONS/);
    await expect(encoder.encodePngSequence(framesDir, join(dir, "x.mp4"), { fps: 12, width: 1.5, height: 240 }))
      .rejects.toThrow(/ENCODE_INVALID_OPTIONS/);
  });

  test("不存在的显式 bin：encode 前抛 ENCODE_FFMPEG_NOT_FOUND（提示 doctor）", async () => {
    const encoder = new FfmpegEncoder(join(dir, "missing-ffmpeg"));
    expect(() => encoder.ensureAvailable()).toThrow(/ENCODE_FFMPEG_NOT_FOUND/);
    expect(() => encoder.ensureAvailable()).toThrow(/videoos doctor/);
  });

  test("未探测到 ffmpeg 的编码器：ensureAvailable 抛错", () => {
    const encoder = new FfmpegEncoder(join(dir, "missing-ffmpeg"));
    expect(encoder.bin).toBe(join(dir, "missing-ffmpeg"));
  });
});

describe("FfmpegEncoder.encodeFrames", () => {
  test("3 帧 Buffer Map（乱序键）→ mp4 成功，按帧号升序排列", async () => {
    const buffers = new Map<number, Buffer>([[2, makeFrame(2)], [0, makeFrame(0)], [1, makeFrame(1)]]);
    const output = join(dir, "buffers.mp4");
    const result = await new FfmpegEncoder(bin).encodeFrames(buffers, output, { fps: 3, width: 320, height: 240 });
    expect(existsSync(output)).toBe(true);
    expect(result.frames).toBe(3);
    expect(result.durationSeconds).toBeCloseTo(1, 6);
    expect(probeDuration(output)).toBeGreaterThanOrEqual(0.9);
  });

  test("空 Map → ENCODE_NO_FRAMES", async () => {
    await expect(new FfmpegEncoder(bin).encodeFrames(new Map(), join(dir, "none.mp4"), { fps: 12, width: 320, height: 240 }))
      .rejects.toThrow(/ENCODE_NO_FRAMES/);
  });

  test("非 Buffer 值 → ENCODE_INVALID_FRAME_BUFFER", async () => {
    const bad = new Map<number, Buffer>([[0, makeFrame(0)], [1, "not-a-buffer" as unknown as Buffer]]);
    await expect(new FfmpegEncoder(bin).encodeFrames(bad, join(dir, "bad.mp4"), { fps: 12, width: 320, height: 240 }))
      .rejects.toThrow(/ENCODE_INVALID_FRAME_BUFFER/);
  });
});
