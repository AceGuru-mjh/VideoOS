// @videoos/mcp-media —— 音视频处理工具服务器（stdio MCP）：ffprobe 探测 / ffmpeg 转码缩略图 GIF 拼接。
// 关键设计点：ffmpeg/ffprobe 缺失 → 结构化 E_BINARY（绝不炸服务器）；convert args 走旗标白名单
// （禁 -i、路径值、/dev/*、conv=、协议 URL）；落盘输入输出全部过 jailFromEnv("MCP_MEDIA_ROOTS")。
import { defineTool, runStdioServer, ok, err, jailFromEnv, TimeoutError, ToolError } from "@videoos/mcp-lite";
import { z } from "zod";
import { spawn, spawnSync } from "node:child_process";
import { basename } from "node:path";
import { writeFile, unlink } from "node:fs/promises";

const jail = await jailFromEnv("MCP_MEDIA_ROOTS");

/** 单次 ffmpeg/ffprobe 运行超时（ms） */
const FFMPEG_TIMEOUT_MS = 25_000;
/** stderr 收集上限（防止 OOM） */
const STDERR_CAP = 256 * 1024;

// ---------------------------------------------------------------------------
// 子进程助手（node:child_process —— Bun.spawn 的 stdout 没有 .read()，见 CONVENTIONS）
// ---------------------------------------------------------------------------

/** 二进制可用性缓存（module 级只读缓存；spawn 一次 -version 判定） */
const binaryCache = new Map<string, boolean>();
function hasBinary(bin: string): boolean {
  const cached = binaryCache.get(bin);
  if (cached !== undefined) return cached;
  let okBinary = false;
  try {
    const probe = spawnSync(bin, ["-version"], { timeout: 5_000, encoding: "utf8" });
    okBinary = probe.error === undefined;
  } catch {
    okBinary = false;
  }
  binaryCache.set(bin, okBinary);
  return okBinary;
}

/** 要求二进制存在，否则抛 E_BINARY（defineTool → 结构化错误） */
function requireBinary(bin: string): void {
  if (!hasBinary(bin)) {
    throw new ToolError("E_BINARY", `${bin} not found (install ffmpeg to enable mcp-media tools)`);
  }
}

interface ProcResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** spawn + 收集输出；超时杀进程并抛 TimeoutError（由调用方转 TIMEOUT 错误） */
function runProcess(bin: string, args: string[], options: { cwd?: string; timeoutMs?: number; input?: string } = {}): Promise<ProcResult> {
  const timeoutMs = options.timeoutMs ?? FFMPEG_TIMEOUT_MS;
  return new Promise<ProcResult>((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stdout.length < STDERR_CAP) stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < STDERR_CAP) stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new ToolError("E_BINARY", `${bin} not found (${error.message})`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (killed) {
        reject(new TimeoutError(timeoutMs));
        return;
      }
      resolve({ code: code ?? -1, stdout, stderr });
    });
    if (options.input !== undefined) {
      child.stdin.write(options.input);
      child.stdin.end();
    } else {
      child.stdin.end();
    }
  });
}

/** ffmpeg 失败 → 摘要 stderr（尾部 1KB，单行化） */
function ffmpegFailure(stderr: string): string {
  const tail = stderr.trim().split("\n").slice(-8).join(" | ").slice(-1000);
  return tail.length > 0 ? tail : "ffmpeg exited with a non-zero code";
}

// ---------------------------------------------------------------------------
// ffprobe JSON → 精简摘要
// ---------------------------------------------------------------------------

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  duration?: string;
  bit_rate?: string;
}

interface ProbeFormat {
  format_name?: string;
  duration?: string;
  bit_rate?: string;
  size?: string;
}

/** "10/1" → 10；非法 → undefined */
function parseRate(rate: string | undefined): number | undefined {
  if (typeof rate !== "string") return undefined;
  const [num, den] = rate.split("/");
  const n = Number(num);
  const d = den === undefined ? 1 : Number(den);
  if (Number.isFinite(n) && Number.isFinite(d) && d !== 0 && n >= 0) {
    const fps = n / d;
    if (Number.isFinite(fps)) return Math.round(fps * 1000) / 1000;
  }
  return undefined;
}

function numOrUndefined(value: string | undefined): number | undefined {
  if (typeof value !== "string") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

async function probeWithFfprobe(absPath: string): Promise<{
  format: { duration?: number; width?: number; height?: number; fps?: number; bitRate?: number; codec?: string; container?: string; sizeBytes?: number };
  streams: Array<{ type: string; codec?: string; width?: number; height?: number; duration?: number; bitRate?: number }>;
}> {
  const { code, stdout, stderr } = await runProcess(
    "ffprobe",
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", absPath],
  );
  if (code !== 0) {
    throw new ToolError("E_FFMPEG", `ffprobe failed for ${JSON.stringify(basename(absPath))}: ${ffmpegFailure(stderr)}`);
  }
  let parsed: { streams?: ProbeStream[]; format?: ProbeFormat };
  try {
    parsed = JSON.parse(stdout) as { streams?: ProbeStream[]; format?: ProbeFormat };
  } catch {
    throw new ToolError("E_FFMPEG", `ffprobe returned non-JSON output for ${JSON.stringify(basename(absPath))}`);
  }
  const streams = (parsed.streams ?? []).map((s) => ({
    type: s.codec_type ?? "unknown",
    codec: s.codec_name,
    width: s.width,
    height: s.height,
    duration: numOrUndefined(s.duration),
    bitRate: numOrUndefined(s.bit_rate),
  }));
  const video = (parsed.streams ?? []).find((s) => s.codec_type === "video");
  const fmt = parsed.format ?? {};
  return {
    format: {
      duration: numOrUndefined(fmt.duration) ?? numOrUndefined(video?.duration),
      width: video?.width,
      height: video?.height,
      fps: parseRate(video?.avg_frame_rate) ?? parseRate(video?.r_frame_rate),
      bitRate: numOrUndefined(fmt.bit_rate),
      codec: video?.codec_name,
      container: fmt.format_name?.split(",")[0],
      sizeBytes: numOrUndefined(fmt.size),
    },
    streams,
  };
}

// ---------------------------------------------------------------------------
// media.convert args 白名单（只放行常见编码/滤镜/比例/时序旗标；输入输出由工具自身控制）
// ---------------------------------------------------------------------------

const CONVERT_FLAGS_ALLOWLIST = new Set([
  "-c", "-c:v", "-c:a", "-codec", "-codec:v", "-codec:a",
  "-b:v", "-b:a", "-crf", "-preset", "-tune", "-profile:v", "-level",
  "-vf", "-filter:v", "-af", "-filter:a",
  "-ss", "-t", "-to", "-r", "-s", "-aspect", "-pix_fmt", "-fps_mode", "-vsync",
  "-movflags", "-shortest", "-an", "-vn", "-sn", "-dn",
  "-map", "-fs", "-threads", "-bufsize", "-maxrate", "-minrate",
  "-g", "-keyint_min", "-sc_threshold", "-ac", "-ar", "-strict",
]);

function validateConvertArgs(args: string[]): { ok: true } | { ok: false; reason: string } {
  for (const arg of args) {
    if (typeof arg !== "string" || arg.length === 0) {
      return { ok: false, reason: "args entries must be non-empty strings" };
    }
    if (arg.includes("\0")) {
      return { ok: false, reason: "args must not contain null bytes" };
    }
    if (arg.startsWith("-")) {
      if (!CONVERT_FLAGS_ALLOWLIST.has(arg)) {
        return {
          ok: false,
          reason: `flag ${JSON.stringify(arg)} is not in the media.convert allowlist (common codec/bitrate/filter/timing flags only; -i/-y and file paths are managed by the tool itself)`,
        };
      }
      continue;
    }
    // 值 token：禁止绝对路径、/dev/*、conv=、协议 URL、读文件的滤镜
    if (arg.startsWith("/")) {
      return { ok: false, reason: `path-like value ${JSON.stringify(arg)} is not allowed in args (input/output paths are set via the tool's own fields)` };
    }
    if (/^\/dev\//.test(arg) || arg === "/dev/null") {
      return { ok: false, reason: `"/dev/*" targets are not allowed` };
    }
    if (arg.includes("conv=")) {
      return { ok: false, reason: `"conv=" (destructive dd-style options) is not allowed` };
    }
    if (arg.includes("://") || /^(http|https|ftp|tcp|udp|rtmp|rtsp|srt|file|pipe|subfile):/i.test(arg)) {
      return { ok: false, reason: `protocol URL ${JSON.stringify(arg)} is not allowed (local jail files only)` };
    }
    if (/(^|[,;])\s*(subtitles|drawtext|movie|amovie)\s*=/.test(arg)) {
      return { ok: false, reason: `file-reading filters are not allowed in convert args (${JSON.stringify(arg)})` };
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 工具定义
// ---------------------------------------------------------------------------

const pathSchema = z.string().describe("relative to jail root or absolute inside roots");
const outputPathSchema = z.string().describe("output path inside jail roots (extension decides container)");

const tools = [
  defineTool(
    "media.probe",
    "Probe a media file with ffprobe: duration, dimensions, fps, codecs, container and per-stream summary.",
    z.object({ path: pathSchema }),
    async ({ path }) => {
      requireBinary("ffprobe");
      const abs = await jail.resolve(path);
      const probed = await probeWithFfprobe(abs);
      return ok(probed);
    },
  ),
  defineTool(
    "media.convert",
    "Transcode/re-encode a media file with ffmpeg (e.g. re-encode, cut with -ss/-t, scale via -vf). Returns {output, durationMs}.",
    z.object({
      input: pathSchema,
      output: outputPathSchema,
      args: z.array(z.string()).describe('extra ffmpeg flags, e.g. ["-c:v","libx264","-crf","23","-t","5"]; paths/-i/-y are rejected').optional(),
    }),
    async ({ input, output, args }) => {
      requireBinary("ffmpeg");
      const inputAbs = await jail.resolve(input);
      const outputAbs = await jail.resolve(output);
      const extra = args ?? [];
      const check = validateConvertArgs(extra);
      if (!check.ok) return err(`E_ARGS: ${check.reason}`);
      const started = Date.now();
      try {
        const { code, stderr } = await runProcess("ffmpeg", ["-y", "-i", inputAbs, ...extra, outputAbs]);
        if (code !== 0) {
          return err(`E_FFMPEG: ffmpeg exited ${code}: ${ffmpegFailure(stderr)}`);
        }
      } catch (error) {
        if (error instanceof TimeoutError) return err(`TIMEOUT: ffmpeg convert timed out after ${FFMPEG_TIMEOUT_MS}ms`);
        throw error;
      }
      return ok({ output: outputAbs, durationMs: Date.now() - started });
    },
  ),
  defineTool(
    "media.thumbnail",
    'Grab one frame as PNG: ffmpeg -ss <at> -i input -frames:v 1 output.png (fast input seek).',
    z.object({
      input: pathSchema,
      at: z.number().min(0).describe("seek position in seconds (input seek before -i, fast)").default(1.0),
      output: z.string().describe("output .png path inside jail roots"),
    }),
    async ({ input, at, output }) => {
      requireBinary("ffmpeg");
      const inputAbs = await jail.resolve(input);
      const outputAbs = await jail.resolve(output);
      try {
        const { code, stderr } = await runProcess("ffmpeg", [
          "-y", "-ss", String(at), "-i", inputAbs, "-frames:v", "1", outputAbs,
        ]);
        if (code !== 0) {
          return err(`E_FFMPEG: thumbnail failed: ${ffmpegFailure(stderr)}`);
        }
      } catch (error) {
        if (error instanceof TimeoutError) return err(`TIMEOUT: ffmpeg thumbnail timed out after ${FFMPEG_TIMEOUT_MS}ms`);
        throw error;
      }
      return ok({ output: outputAbs, at });
    },
  ),
  defineTool(
    "media.extractAudio",
    "Extract the audio track: mode copy keeps the original codec (use .aac/.m4a output); mode wav decodes to 16kHz mono WAV.",
    z.object({
      input: pathSchema,
      output: z.string().describe("output path inside jail roots (.m4a/.aac for copy, .wav for wav mode)"),
      mode: z.enum(["copy", "wav"]).describe('"copy" = -vn -acodec copy; "wav" = -vn -ac 1 -ar 16000').default("copy"),
    }),
    async ({ input, output, mode }) => {
      requireBinary("ffmpeg");
      const inputAbs = await jail.resolve(input);
      const outputAbs = await jail.resolve(output);
      const extra = mode === "copy"
        ? ["-vn", "-acodec", "copy"]
        : ["-vn", "-ac", "1", "-ar", "16000"];
      try {
        const { code, stderr } = await runProcess("ffmpeg", ["-y", "-i", inputAbs, ...extra, outputAbs]);
        if (code !== 0) {
          return err(`E_FFMPEG: extractAudio failed: ${ffmpegFailure(stderr)}`);
        }
      } catch (error) {
        if (error instanceof TimeoutError) return err(`TIMEOUT: ffmpeg extractAudio timed out after ${FFMPEG_TIMEOUT_MS}ms`);
        throw error;
      }
      return ok({ output: outputAbs, mode });
    },
  ),
  defineTool(
    "media.gif",
    "Make an animated GIF from a video range with the palette trick (fps + lanczos scale + palettegen/paletteuse in one pass).",
    z.object({
      input: pathSchema,
      output: z.string().describe("output .gif path inside jail roots"),
      start: z.number().min(0).describe("start time in seconds").optional(),
      dur: z.number().min(0.04).describe("clip duration in seconds").optional(),
      fps: z.number().int().min(1).max(30).describe("GIF frame rate").default(12),
      width: z.number().int().min(16).max(1920).describe("GIF width in px (height auto)").default(480),
    }),
    async ({ input, output, start, dur, fps, width }) => {
      requireBinary("ffmpeg");
      const inputAbs = await jail.resolve(input);
      const outputAbs = await jail.resolve(output);
      const seek: string[] = [
        ...(start !== undefined ? ["-ss", String(start)] : []),
        ...(dur !== undefined ? ["-t", String(dur)] : []),
      ];
      const filter = `fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`;
      try {
        const { code, stderr } = await runProcess("ffmpeg", [
          "-y", ...seek, "-i", inputAbs, "-vf", filter, "-loop", "0", outputAbs,
        ]);
        if (code !== 0) {
          return err(`E_FFMPEG: gif failed: ${ffmpegFailure(stderr)}`);
        }
      } catch (error) {
        if (error instanceof TimeoutError) return err(`TIMEOUT: ffmpeg gif timed out after ${FFMPEG_TIMEOUT_MS}ms`);
        throw error;
      }
      return ok({ output: outputAbs, fps, width });
    },
  ),
  defineTool(
    "media.concat",
    "Concatenate media files with identical codecs: writes a temp ffconcat list next to the output, then ffmpeg -f concat -safe 0 -c copy.",
    z.object({
      inputs: z.array(z.string()).min(2).describe("2+ input paths inside jail roots; all must share codec/params (stream copy, no re-encode)"),
      output: outputPathSchema,
    }),
    async ({ inputs, output }) => {
      requireBinary("ffmpeg");
      const inputAbs: string[] = [];
      for (const input of inputs) {
        inputAbs.push(await jail.resolve(input));
      }
      const outputAbs = await jail.resolve(output);
      // concat 清单写进输出目录（监狱内临时文件，跑完即删）
      const listPath = `${outputAbs}.concat-${Date.now()}.txt`;
      const escape = (p: string): string => p.replace(/'/g, "'\\''");
      const manifest = `ffconcat version 1.0\n${inputAbs.map((p) => `file '${escape(p)}'`).join("\n")}\n`;
      await writeFile(listPath, manifest, "utf8");
      try {
        const { code, stderr } = await runProcess("ffmpeg", [
          "-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outputAbs,
        ]);
        if (code !== 0) {
          return err(`E_FFMPEG: concat failed (inputs must share the same codec): ${ffmpegFailure(stderr)}`);
        }
      } catch (error) {
        if (error instanceof TimeoutError) return err(`TIMEOUT: ffmpeg concat timed out after ${FFMPEG_TIMEOUT_MS}ms`);
        throw error;
      } finally {
        await unlink(listPath).catch(() => {});
      }
      return ok({ output: outputAbs, inputs: inputAbs.length });
    },
  ),
];

await runStdioServer(tools, { serverName: "mcp-media", serverVersion: "0.1.0" });
