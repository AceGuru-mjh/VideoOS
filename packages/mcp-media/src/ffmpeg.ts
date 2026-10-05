// ffmpeg/ffprobe 进程辅助（mcp-media 专用）：Bun.which 探测、超时看护、stderr 尾部错误。
// 约定：ffmpeg 缺失 → 结构化 "ffmpeg not found"（工具层不崩溃）；失败返回 { ok:false, error } 而非抛错。

/** runFfmpeg 结果：ok=false 时 error 为 stderr 尾部（最后 400 字符）或 "timeout" / "ffmpeg not found" */
export interface FfmpegRunResult {
  ok: boolean;
  error?: string;
}

/** ffprobe -show_streams 的单流精简形状（字段缺失时按 undefined 处理） */
export interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  sample_rate?: string;
  channels?: number;
}

/** ffprobe -show_format 的容器级精简形状 */
export interface ProbeFormat {
  format_name?: string;
  duration?: string;
  bit_rate?: string;
  size?: string;
}

/** probeJson 返回形状（ffprobe JSON 的子集） */
export interface ProbeResult {
  streams: ProbeStream[];
  format: ProbeFormat;
}

/** ffmpeg 可执行文件路径（PATH 探测）；缺失为 null */
export function ffmpegPath(): string | null {
  return Bun.which("ffmpeg");
}

/** ffprobe 可执行文件路径（PATH 探测）；缺失为 null */
export function ffprobePath(): string | null {
  return Bun.which("ffprobe");
}

/**
 * 运行 ffmpeg：stdout 丢弃、stderr 全量收集；
 * 超时 → kill(9) → error "timeout"；非零退出 → error 取 stderr 最后 400 字符。
 */
export async function runFfmpeg(args: string[], timeoutMs = 30_000): Promise<FfmpegRunResult> {
  const bin = ffmpegPath();
  if (bin === null) return { ok: false, error: "ffmpeg not found" };
  const proc = Bun.spawn([bin, ...args], { stdout: "ignore", stderr: "pipe", stdin: "ignore" });
  // stderr 立刻开始消费（否则管道写满会卡死子进程）
  const stderrText = new Response(proc.stderr).text();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      proc.kill(9);
    } catch {
      /* 已退出 */
    }
  }, timeoutMs);
  let code: number | null = null;
  try {
    code = await proc.exited;
  } finally {
    clearTimeout(timer);
  }
  const stderr = await stderrText.catch(() => "");
  if (timedOut) return { ok: false, error: "timeout" };
  if (code !== 0) {
    const tail = stderr.length > 400 ? stderr.slice(stderr.length - 400) : stderr;
    return { ok: false, error: tail.length > 0 ? tail : `ffmpeg exited with code ${String(code)}` };
  }
  return { ok: true };
}

/**
 * ffprobe 精简探测：`-v error -print_format json -show_format -show_streams`，stdout JSON.parse。
 * ffprobe 缺失或解析失败 → 抛错（由工具层捕获转 { ok:false }）。
 */
export async function probeJson(path: string): Promise<ProbeResult> {
  const bin = ffprobePath();
  if (bin === null) throw new Error("ffprobe not found");
  const proc = Bun.spawn([bin, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const stdoutText = new Response(proc.stdout).text();
  const stderrText = new Response(proc.stderr).text();
  const code = await proc.exited;
  if (code !== 0) {
    const stderr = await stderrText.catch(() => "");
    throw new Error(`ffprobe failed (exit ${code}): ${stderr.slice(-400)}`);
  }
  return JSON.parse(await stdoutText) as ProbeResult;
}

/** r_frame_rate（如 "30/1"、"30000/1001"）→ 保留两位小数的 fps；无法解析返回 undefined */
export function evalFps(rate: string | undefined): number | undefined {
  if (typeof rate !== "string" || rate.length === 0) return undefined;
  const m = /^(\d+)\/(\d+)$/.exec(rate);
  let value: number;
  if (m !== null) {
    const num = Number(m[1]);
    const den = Number(m[2]);
    if (den === 0) return undefined;
    value = num / den;
  } else {
    const n = Number(rate);
    if (!Number.isFinite(n)) return undefined;
    value = n;
  }
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(value * 100) / 100;
}
