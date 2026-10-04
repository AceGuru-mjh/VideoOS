// ffmpeg 探测 + PNG 序列编码（命令模板见 SPEC §4.2 / M3 任务契约）
// Windows 兼容：spawn 一律 shell:false + 数组 args（无需引号转义）；传给 ffmpeg 的路径统一为正斜杠
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EncodeError } from "./types";
import type { EncodeOptions, EncodeResult } from "./types";

const DEFAULT_CRF = 18;
const DEFAULT_PRESET = "medium";
const STDERR_TAIL_LIMIT = 2000;

const COMMON_PATHS_POSIX = ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg", "/snap/bin/ffmpeg"];
const COMMON_PATHS_WIN = ["C:\\ffmpeg\\bin\\ffmpeg.exe", "C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe"];

/**
 * ffmpeg 可执行文件探测：FFMPEG_PATH（显式覆盖，路径无效时直接判未 found，不静默回退——
 * 便于暴露配置错误）→ 常见安装路径 → which/where PATH 查找 → 裸名探测。
 */
export function detectFfmpeg(): string | null {
  const isWin = process.platform === "win32";
  const exe = isWin ? "ffmpeg.exe" : "ffmpeg";
  const envPath = process.env.FFMPEG_PATH;
  if (typeof envPath === "string" && envPath.length > 0) {
    return existsSync(envPath) ? envPath : null;
  }
  const candidates: string[] = [...(isWin ? COMMON_PATHS_WIN : COMMON_PATHS_POSIX)];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  // PATH 查找（which/where 均为系统内建工具，无需 shell）
  const lookup = spawnSync(isWin ? "where" : "which", [exe], { shell: false, encoding: "utf8" });
  if (lookup.status === 0 && typeof lookup.stdout === "string") {
    const first = lookup.stdout.trim().split(/\r?\n/)[0] ?? "";
    if (first.length > 0 && existsSync(first)) return first;
  }
  // 兜底：裸名直接探测（如 PATH 含 ffmpeg 但 which 不可用的环境）
  const direct = spawnSync(exe, ["-version"], { shell: false });
  if (direct.error === undefined && direct.status === 0) return exe;
  return null;
}

/** ffmpeg -version 首行（如 "ffmpeg version 7.1.5-0+deb13u1 ..."）；失败返回 null */
export async function ffmpegVersion(bin: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(bin, ["-version"], { shell: false });
    let stdout = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.on("error", () => resolve(null));
    child.on("close", (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }
      const first = stdout.split(/\r?\n/, 1)[0] ?? "";
      resolve(first.length > 0 ? first.trim() : null);
    });
  });
}

/** 是否为裸命令名（不含路径分隔符 → 交给 PATH 解析，不做存在性预检） */
function isBareCommand(bin: string): boolean {
  return !bin.includes("/") && !bin.includes("\\");
}

/** 传给 ffmpeg 的路径统一正斜杠（Windows 下 ffmpeg 亦接受正斜杠，避免反斜杠转义歧义） */
function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

/** 展示用命令行：含空白的参数加引号 */
function formatCommand(bin: string, args: string[]): string {
  return [bin, ...args].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ");
}

function frameFileName(index: number): string {
  return `frame_${String(index).padStart(6, "0")}.png`;
}

function validateEncodeOptions(opts: EncodeOptions): { fps: number; width: number; height: number } {
  const { fps, width, height } = opts;
  if (typeof fps !== "number" || !Number.isFinite(fps) || fps <= 0) {
    throw new EncodeError("ENCODE_INVALID_OPTIONS", `fps must be a positive finite number, got: ${String(fps)}`);
  }
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new EncodeError("ENCODE_INVALID_OPTIONS", `width/height must be positive integers, got: ${width}x${height}`);
  }
  if (opts.crf !== undefined && (typeof opts.crf !== "number" || !Number.isFinite(opts.crf))) {
    throw new EncodeError("ENCODE_INVALID_OPTIONS", `crf must be a finite number when provided, got: ${String(opts.crf)}`);
  }
  if (opts.preset !== undefined && (typeof opts.preset !== "string" || opts.preset.length === 0)) {
    throw new EncodeError("ENCODE_INVALID_OPTIONS", `preset must be a non-empty string when provided, got: ${JSON.stringify(opts.preset)}`);
  }
  if (opts.audio !== undefined && (typeof opts.audio.path !== "string" || opts.audio.path.length === 0)) {
    throw new EncodeError("ENCODE_INVALID_OPTIONS", "audio.path must be a non-empty string when audio is provided");
  }
  if (opts.audio?.volume !== undefined && (typeof opts.audio.volume !== "number" || !Number.isFinite(opts.audio.volume) || opts.audio.volume < 0)) {
    throw new EncodeError("ENCODE_INVALID_OPTIONS", `audio.volume must be a non-negative finite number, got: ${String(opts.audio?.volume)}`);
  }
  return { fps, width, height };
}

/** 统计 framesDir 内 frame_%06d.png 数量（编码前快速失败 + EncodeResult.frames 数据源） */
async function countPngFrames(framesDir: string): Promise<number> {
  let names: string[];
  try {
    names = await readdir(framesDir);
  } catch (err) {
    throw new EncodeError("ENCODE_NO_FRAMES", `Cannot read frames directory "${framesDir}": ${(err as Error).message}`);
  }
  return names.filter((n) => /^frame_\d{6}\.png$/.test(n)).length;
}

/** ffmpeg PNG 序列编码器 */
export class FfmpegEncoder {
  /** 探测/指定的 ffmpeg 路径；未找到为 null */
  readonly bin: string | null;

  /** @param bin 显式二进制路径；缺省走 detectFfmpeg() */
  constructor(bin?: string) {
    this.bin = bin !== undefined ? bin : detectFfmpeg();
  }

  /** 渲染前调用：尽早失败（避免渲染完成后才发现无法编码） */
  ensureAvailable(): void {
    if (this.bin === null) {
      throw new EncodeError(
        "ENCODE_FFMPEG_NOT_FOUND",
        "ffmpeg binary not found; install ffmpeg, set FFMPEG_PATH, or pass encoder.bin — run `videoos doctor` to diagnose the environment",
      );
    }
    if (!isBareCommand(this.bin) && !existsSync(this.bin)) {
      throw new EncodeError(
        "ENCODE_FFMPEG_NOT_FOUND",
        `ffmpeg binary not found at "${this.bin}" — run \`videoos doctor\` to diagnose the environment`,
      );
    }
  }

  /**
   * PNG 序列 → 视频文件。
   * 命令模板：
   *   ffmpeg -y -progress pipe:1 -nostats -framerate <fps> -i <dir>/frame_%06d.png
   *     [-i <audio> -filter:a "volume=<v>"] -c:v libx264|libvpx-vp9 -crf 18 -preset medium
   *     -pix_fmt yuv420p [-c:a aac|libopus -shortest] [-movflags +faststart] <output>
   */
  async encodePngSequence(framesDir: string, output: string, opts: EncodeOptions): Promise<EncodeResult> {
    this.ensureAvailable();
    const bin = this.bin as string;
    const { fps } = validateEncodeOptions(opts);
    const codec = opts.codec ?? "h264";
    const crf = opts.crf ?? DEFAULT_CRF;
    const preset = opts.preset ?? DEFAULT_PRESET;

    const frames = await countPngFrames(framesDir);
    if (frames === 0) {
      throw new EncodeError("ENCODE_NO_FRAMES", `No frame_%06d.png found in "${framesDir}"`);
    }

    const args: string[] = ["-y", "-progress", "pipe:1", "-nostats",
      "-framerate", String(fps),
      "-i", `${normalizePath(framesDir).replace(/\/+$/, "")}/frame_%06d.png`];
    if (opts.audio !== undefined) args.push("-i", normalizePath(opts.audio.path));
    if (codec === "h264") {
      args.push("-c:v", "libx264", "-crf", String(crf), "-preset", preset, "-pix_fmt", "yuv420p");
    } else {
      // libvpx-vp9：crf 恒质量模式需 -b:v 0
      args.push("-c:v", "libvpx-vp9", "-crf", String(crf), "-b:v", "0", "-pix_fmt", "yuv420p");
    }
    if (opts.audio !== undefined) {
      if (opts.audio.volume !== undefined) args.push("-filter:a", `volume=${opts.audio.volume}`);
      args.push("-c:a", codec === "h264" ? "aac" : "libopus", "-shortest");
    }
    if (codec === "h264") args.push("-movflags", "+faststart");
    args.push(normalizePath(output));

    const { command, stderrTail } = await this.run(bin, args, opts.onProgress);
    return { output, frames, durationSeconds: frames / fps, command, stderrTail };
  }

  /** 内存帧集合 → 视频文件（按帧号升序落盘临时目录后编码；帧号重排为连续序列） */
  async encodeFrames(buffers: Map<number, Buffer>, output: string, opts: EncodeOptions): Promise<EncodeResult> {
    validateEncodeOptions(opts);
    if (!(buffers instanceof Map) || buffers.size === 0) {
      throw new EncodeError("ENCODE_NO_FRAMES", "encodeFrames requires a non-empty Map<number, Buffer>");
    }
    const ordered = [...buffers.keys()].sort((a, b) => a - b);
    for (const f of ordered) {
      if (!Buffer.isBuffer(buffers.get(f))) {
        throw new EncodeError("ENCODE_INVALID_FRAME_BUFFER", `Frame ${f} is not a Buffer`);
      }
    }
    this.ensureAvailable();
    const dir = await mkdtemp(join(tmpdir(), "videoos-encode-"));
    try {
      let idx = 0;
      for (const f of ordered) {
        await writeFile(join(dir, frameFileName(idx++)), buffers.get(f)!);
      }
      return await this.encodePngSequence(dir, output, opts);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** 运行 ffmpeg：解析 stdout 的 `frame=N` 进度行；非零退出码抛 EncodeError（含命令行 + stderr 尾部） */
  private run(bin: string, args: string[], onProgress?: (framesEncoded: number) => void): Promise<{ command: string; stderrTail: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(bin, args, { shell: false });
      const command = formatCommand(bin, args);
      let stderr = "";
      let stdoutRemainder = "";
      child.on("error", (err) => {
        reject(new EncodeError("ENCODE_FFMPEG_NOT_FOUND", `Failed to spawn ffmpeg ("${bin}"): ${err.message}`));
      });
      child.stdout?.on("data", (chunk: Buffer) => {
        stdoutRemainder += chunk.toString("utf8");
        const lines = stdoutRemainder.split(/\r?\n/);
        stdoutRemainder = lines.pop() ?? ""; // 末行可能不完整，留待下一块
        if (onProgress === undefined) return;
        for (const line of lines) {
          const m = /^frame=(\d+)$/.exec(line);
          if (m !== null) onProgress(Number(m[1]));
        }
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("close", (code) => {
        const stderrTail = stderr.length > STDERR_TAIL_LIMIT ? stderr.slice(stderr.length - STDERR_TAIL_LIMIT) : stderr;
        if (code === 0) {
          resolve({ command, stderrTail });
        } else {
          reject(new EncodeError(
            "ENCODE_FAILED",
            `ffmpeg exited with code ${code}\ncommand: ${command}\nstderr (tail):\n${stderrTail}`,
          ));
        }
      });
    });
  }
}
