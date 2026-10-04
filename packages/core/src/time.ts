// 时间工具：帧/秒换算与时间码格式化（"MM:SS.T"，T=十分之一秒）
function assertFps(fps: number): void {
  if (typeof fps !== "number" || !Number.isFinite(fps) || fps <= 0) {
    throw new RangeError(`fps must be a positive finite number, got ${String(fps)}`);
  }
}

export function framesToSeconds(frames: number, fps: number): number {
  assertFps(fps);
  return frames / fps;
}

/** 秒 → 帧（四舍五入取整） */
export function secondsToFrames(seconds: number, fps: number): number {
  assertFps(fps);
  return Math.round(seconds * fps);
}

/** 4.25s → "00:04.3" 风格（分钟:秒.十分位；负数按 0 处理） */
export function formatTimecode(seconds: number, fps: number): string {
  assertFps(fps);
  const totalTenths = Math.max(0, Math.round(seconds * 10));
  const minutes = Math.floor(totalTenths / 600);
  const secs = Math.floor((totalTenths % 600) / 10);
  const tenths = totalTenths % 10;
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${tenths}`;
}
