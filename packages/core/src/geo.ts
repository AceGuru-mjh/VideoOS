// 几何工具：百分比位置解析（"50%"）、clamp、lerp
export interface Point { x: number; y: number }
export interface Size { width: number; height: number }
export interface PositionInput { x: number | string; y: number | string }

const PERCENT_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)%$/;

/** 把 position 解析为绝对像素；百分比相对画布宽/高（如 "50%" → width*0.5）；支持负百分比 */
export function resolvePosition(pos: PositionInput, canvas: Size): Point {
  if (!Number.isFinite(canvas.width) || !Number.isFinite(canvas.height) || canvas.width <= 0 || canvas.height <= 0) {
    throw new RangeError(`resolvePosition: canvas must have positive finite dimensions, got ${canvas.width}x${canvas.height}`);
  }
  const resolve = (value: number | string, total: number): number => {
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new Error(`Invalid position: ${String(value)}`);
      return value;
    }
    if (typeof value !== "string") {
      throw new Error(`Invalid position: ${String(value)} (number or "50%" expected)`);
    }
    const trimmed = value.trim();
    if (!PERCENT_RE.test(trimmed)) {
      throw new Error(`Invalid position: ${JSON.stringify(value)} (number or "50%" expected)`);
    }
    const pct = parseFloat(trimmed.slice(0, -1));
    return (pct / 100) * total;
  };
  return { x: resolve(pos.x, canvas.width), y: resolve(pos.y, canvas.height) };
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
