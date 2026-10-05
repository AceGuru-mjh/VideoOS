// @videoos/mcp-media — ffmpeg 工具箱服务器（Issue #35，SPEC §3.5 mcp-media 表）。
// 工具：media.probe / media.convert / media.thumbnail / media.extractAudio / media.gif / media.concat。
// 安全基线：所有输入/输出路径经路径监狱（env MCP_MEDIA_ROOTS）校验；convert 附加参数做白名单校验；
// ffmpeg/ffprobe 缺失 → 结构化 { ok:false, error: "ffmpeg not found" }（服务器不崩溃）。
import { defineTool, runStdioServer } from "@videoos/mcp-lite";
import { z } from "zod/v4";
import { rmSync, statSync, writeFileSync } from "node:fs";
import { parseRoots, createJail } from "./jail";
import type { PathJail } from "./jail";
import { evalFps, ffmpegPath, ffprobePath, probeJson, runFfmpeg } from "./ffmpeg";
import type { ProbeResult, ProbeStream } from "./ffmpeg";

/** 路径监狱：多根 = env MCP_MEDIA_ROOTS（缺省回落 cwd） */
const jail: PathJail = createJail(parseRoots(process.env.MCP_MEDIA_ROOTS, process.cwd()));

/** 统一的越狱/异常 → ToolResult 转换（业务失败不抛错） */
function toError(err: unknown): { ok: false; error: string } {
  return { ok: false, error: err instanceof Error ? err.message : String(err) };
}

/** jail.resolveIn 包装：JailError → { ok:false } */
function resolveInJail(userPath: string): { ok: true; abs: string } | { ok: false; error: string } {
  try {
    return { ok: true, abs: jail.resolveIn(userPath) };
  } catch (err) {
    return toError(err);
  }
}

/** 输入文件存在性检查（resolveInJail 之后调用） */
function ensureFile(abs: string, userPath: string): { ok: true } | { ok: false; error: string } {
  try {
    if (statSync(abs).isFile()) return { ok: true };
  } catch {
    /* fallthrough */
  }
  return { ok: false, error: `file not found: ${userPath}` };
}

/** convert 附加参数安全校验：非字符串 / 含 ".." / 含 "://" / /dev/ 设备 / 越狱绝对路径 → unsafe ffmpeg arg */
function checkArgSafety(arg: string): string | null {
  if (arg.includes("..")) return "unsafe ffmpeg arg";
  if (arg.includes("://")) return "unsafe ffmpeg arg";
  if (arg.startsWith("/dev/")) return "unsafe ffmpeg arg";
  const looksAbsolute = arg.startsWith("/") || arg.startsWith("\\\\") || /^[a-zA-Z]:[\\/]/.test(arg);
  if (looksAbsolute) {
    try {
      jail.resolveIn(arg);
    } catch {
      return "unsafe ffmpeg arg";
    }
  }
  return null;
}

/** ffprobe JSON → media.probe 精简输出 */
function mapProbe(json: ProbeResult): {
  container: string;
  durationSeconds: number;
  bitrate: number;
  sizeBytes: number;
  streams: Array<{
    type: "video" | "audio" | "other";
    codec: string;
    width?: number;
    height?: number;
    fps?: number;
    sampleRate?: number;
    channels?: number;
  }>;
} {
  const streams = json.streams.map((s: ProbeStream) => {
    if (s.codec_type === "video") {
      return {
        type: "video" as const,
        codec: s.codec_name ?? "unknown",
        ...(s.width !== undefined ? { width: s.width } : {}),
        ...(s.height !== undefined ? { height: s.height } : {}),
        ...(evalFps(s.r_frame_rate) !== undefined ? { fps: evalFps(s.r_frame_rate) as number } : {}),
      };
    }
    if (s.codec_type === "audio") {
      return {
        type: "audio" as const,
        codec: s.codec_name ?? "unknown",
        ...(s.sample_rate !== undefined && s.sample_rate.length > 0 ? { sampleRate: Number(s.sample_rate) } : {}),
        ...(s.channels !== undefined ? { channels: s.channels } : {}),
      };
    }
    return { type: "other" as const, codec: s.codec_name ?? "unknown" };
  });
  const duration = Number(json.format.duration);
  return {
    container: json.format.format_name ?? "",
    durationSeconds: Number.isFinite(duration) ? Math.round(duration * 100) / 100 : 0,
    bitrate: Number(json.format.bit_rate) || 0,
    sizeBytes: Number(json.format.size) || 0,
    streams,
  };
}

const mediaProbe = defineTool({
  name: "media.probe",
  description: "ffprobe 探测媒体信息（容器/时长/比特率/尺寸/流列表）",
  schema: z.object({ path: z.string().min(1) }),
  call: async (args) => {
    if (ffmpegPath() === null) return { ok: false, error: "ffmpeg not found" };
    if (ffprobePath() === null) return { ok: false, error: "ffprobe not found" };
    const resolved = resolveInJail(args.path);
    if (!resolved.ok) return resolved;
    const exists = ensureFile(resolved.abs, args.path);
    if (!exists.ok) return exists;
    try {
      const json = await probeJson(resolved.abs);
      return { ok: true, data: mapProbe(json) };
    } catch (err) {
      return toError(err);
    }
  },
});

const mediaConvert = defineTool({
  name: "media.convert",
  description: "ffmpeg 转封装/转码（附加参数白名单校验，输出必须落在监狱内）",
  schema: z.object({
    input: z.string().min(1),
    output: z.string().min(1),
    args: z.array(z.string()).default([]),
  }),
  call: async (args) => {
    if (ffmpegPath() === null) return { ok: false, error: "ffmpeg not found" };
    const input = resolveInJail(args.input);
    if (!input.ok) return input;
    const exists = ensureFile(input.abs, args.input);
    if (!exists.ok) return exists;
    const output = resolveInJail(args.output);
    if (!output.ok) return output;
    for (const arg of args.args) {
      const problem = checkArgSafety(arg);
      if (problem !== null) return { ok: false, error: problem };
    }
    const started = Date.now();
    const run = await runFfmpeg(["-y", "-i", input.abs, ...args.args, output.abs]);
    if (!run.ok) return { ok: false, error: run.error };
    return { ok: true, data: { output: output.abs, durationMs: Date.now() - started } };
  },
});

const mediaThumbnail = defineTool({
  name: "media.thumbnail",
  description: "截取视频单帧为图片（ffmpeg -ss <at> -frames:v 1）",
  schema: z.object({
    input: z.string().min(1),
    at: z.number().min(0).default(1.0),
    output: z.string().min(1),
  }),
  call: async (args) => {
    if (ffmpegPath() === null) return { ok: false, error: "ffmpeg not found" };
    const input = resolveInJail(args.input);
    if (!input.ok) return input;
    const exists = ensureFile(input.abs, args.input);
    if (!exists.ok) return exists;
    const output = resolveInJail(args.output);
    if (!output.ok) return output;
    const started = Date.now();
    const run = await runFfmpeg(["-y", "-ss", String(args.at), "-i", input.abs, "-frames:v", "1", output.abs]);
    if (!run.ok) return { ok: false, error: run.error };
    return { ok: true, data: { output: output.abs, durationMs: Date.now() - started } };
  },
});

const mediaExtractAudio = defineTool({
  name: "media.extractAudio",
  description: "抽取音轨（copy 直拷或转 16kHz 单声道 wav）",
  schema: z.object({
    input: z.string().min(1),
    output: z.string().min(1),
    mode: z.enum(["copy", "wav"]).default("copy"),
  }),
  call: async (args) => {
    if (ffmpegPath() === null) return { ok: false, error: "ffmpeg not found" };
    const input = resolveInJail(args.input);
    if (!input.ok) return input;
    const exists = ensureFile(input.abs, args.input);
    if (!exists.ok) return exists;
    const output = resolveInJail(args.output);
    if (!output.ok) return output;
    // copy → -vn -acodec copy（流直拷）；wav → -ac 1 -ar 16000（重编码为 16kHz 单声道）
    const modeArgs = args.mode === "copy" ? ["-vn", "-acodec", "copy"] : ["-ac", "1", "-ar", "16000"];
    const started = Date.now();
    const run = await runFfmpeg(["-y", "-i", input.abs, ...modeArgs, output.abs]);
    if (!run.ok) return { ok: false, error: run.error };
    return { ok: true, data: { output: output.abs, durationMs: Date.now() - started } };
  },
});

const mediaGif = defineTool({
  name: "media.gif",
  description: "视频片段转 GIF（fps/scale-lanczos 可调，-loop 0 循环）",
  schema: z.object({
    input: z.string().min(1),
    output: z.string().min(1),
    start: z.number().min(0).optional(),
    dur: z.number().min(0).optional(),
    fps: z.number().int().min(1).max(30).default(12),
    width: z.number().int().min(64).max(1920).default(480),
  }),
  call: async (args) => {
    if (ffmpegPath() === null) return { ok: false, error: "ffmpeg not found" };
    const input = resolveInJail(args.input);
    if (!input.ok) return input;
    const exists = ensureFile(input.abs, args.input);
    if (!exists.ok) return exists;
    const output = resolveInJail(args.output);
    if (!output.ok) return output;
    const seekArgs = [
      ...(args.start !== undefined ? ["-ss", String(args.start)] : []),
      ...(args.dur !== undefined ? ["-t", String(args.dur)] : []),
    ];
    const started = Date.now();
    const run = await runFfmpeg([
      "-y",
      ...seekArgs,
      "-i",
      input.abs,
      "-vf",
      `fps=${args.fps},scale=${args.width}:-1:flags=lanczos`,
      "-loop",
      "0",
      output.abs,
    ]);
    if (!run.ok) return { ok: false, error: run.error };
    return { ok: true, data: { output: output.abs, durationMs: Date.now() - started } };
  },
});

/** concat 统一编码参数画像：主视频（codec+尺寸）或纯音频（codec） */
interface ConcatProfile {
  kind: "video" | "audio";
  codec: string;
  width?: number;
  height?: number;
}

async function concatProfileOf(absPath: string, userPath: string): Promise<ConcatProfile> {
  const json = await probeJson(absPath);
  const video = json.streams.find((s) => s.codec_type === "video");
  if (video !== undefined) {
    return { kind: "video", codec: video.codec_name ?? "unknown", ...(video.width !== undefined ? { width: video.width } : {}), ...(video.height !== undefined ? { height: video.height } : {}) };
  }
  const audio = json.streams.find((s) => s.codec_type === "audio");
  if (audio !== undefined) return { kind: "audio", codec: audio.codec_name ?? "unknown" };
  throw new Error(`no audio/video stream in ${userPath}`);
}

const mediaConcat = defineTool({
  name: "media.concat",
  description: "拼接多个同编码参数的媒体文件（concat demuxer + -c copy，统一编码参数校验）",
  schema: z.object({
    inputs: z.array(z.string().min(1)).min(2).max(16),
    output: z.string().min(1),
  }),
  call: async (args) => {
    if (ffmpegPath() === null) return { ok: false, error: "ffmpeg not found" };
    const inputsAbs: string[] = [];
    for (const userPath of args.inputs) {
      const resolved = resolveInJail(userPath);
      if (!resolved.ok) return resolved;
      const exists = ensureFile(resolved.abs, userPath);
      if (!exists.ok) return exists;
      inputsAbs.push(resolved.abs);
    }
    const output = resolveInJail(args.output);
    if (!output.ok) return output;

    // 统一编码参数校验：主视频 codec+尺寸一致，或全部纯音频且 codec 一致
    const profiles: ConcatProfile[] = [];
    for (let i = 0; i < inputsAbs.length; i++) {
      try {
        profiles.push(await concatProfileOf(inputsAbs[i], args.inputs[i]));
      } catch (err) {
        return toError(new Error(`input ${i + 1}: ${err instanceof Error ? err.message : String(err)}`));
      }
    }
    const first = profiles[0];
    const mismatched = profiles.some(
      (p) =>
        p.kind !== first.kind ||
        p.codec !== first.codec ||
        (first.kind === "video" && (p.width !== first.width || p.height !== first.height)),
    );
    if (mismatched) {
      const summary = profiles
        .map((p, i) => `input ${i + 1}: ${p.kind === "video" ? `video ${p.codec} ${p.width}x${p.height}` : `audio ${p.codec}`}`)
        .join("; ");
      return {
        ok: false,
        error: `concat mismatch (unified encoding parameter validation): ${summary} — all inputs must share the same primary video codec and size, or all be audio-only with the same codec`,
      };
    }

    // concat 列表文件写在监狱内、紧挨输出文件；' 转义为 \'
    const listPath = `${output.abs}.concat.txt`;
    const lines = inputsAbs.map((p) => `file '${p.replace(/'/g, "\\'")}'`);
    writeFileSync(listPath, `${lines.join("\n")}\n`, "utf8");
    const started = Date.now();
    try {
      const run = await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", output.abs]);
      if (!run.ok) return { ok: false, error: run.error };
    } finally {
      try {
        rmSync(listPath);
      } catch {
        /* 尽力删除列表文件 */
      }
    }
    return { ok: true, data: { output: output.abs, durationMs: Date.now() - started } };
  },
});

await runStdioServer([mediaProbe, mediaConvert, mediaThumbnail, mediaExtractAudio, mediaGif, mediaConcat], {
  serverName: "mcp-media",
  serverVersion: "0.1.0",
});
