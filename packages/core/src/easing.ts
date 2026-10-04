// 命名缓动库：easing(name, params?) 工厂 + 全部具名实现；输入统一 clamp 到 [0,1]（spring 输出可过冲）
export type EasingFn = (t: number) => number;
export interface SpringParams { stiffness?: number; damping?: number }
export type EasingParams = SpringParams;

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

export function linear(t: number): number { return clamp01(t); }
export function easeInQuad(t: number): number { const x = clamp01(t); return x * x; }
export function easeOutQuad(t: number): number { const x = clamp01(t); return x * (2 - x); }
export function easeInOutQuad(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}
export function easeInCubic(t: number): number { const x = clamp01(t); return x * x * x; }
export function easeOutCubic(t: number): number { const x = clamp01(t); return 1 - Math.pow(1 - x, 3); }
export function easeInOutCubic(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}
export function easeOutExpo(t: number): number {
  const x = clamp01(t);
  return x >= 1 ? 1 : 1 - Math.pow(2, -10 * x);
}
export function easeOutBack(t: number): number {
  const x = clamp01(t);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}
export function bounce(t: number): number {
  const x = clamp01(t);
  const n1 = 7.5625;
  const d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) { const u = x - 1.5 / d1; return n1 * u * u + 0.75; }
  if (x < 2.5 / d1) { const u = x - 2.25 / d1; return n1 * u * u + 0.9375; }
  const u = x - 2.625 / d1;
  return n1 * u * u + 0.984375;
}

const springCache = new Map<string, EasingFn>();

/** 参数化弹簧（默认 stiffness=100 / damping=10）；固定步长数值模拟 → 确定性；输出允许过冲 */
export function spring(params?: SpringParams): EasingFn {
  const stiffness = params?.stiffness ?? 100;
  const damping = params?.damping ?? 10;
  if (!Number.isFinite(stiffness) || stiffness <= 0) {
    throw new RangeError(`spring: stiffness must be > 0, got ${String(stiffness)}`);
  }
  if (!Number.isFinite(damping) || damping <= 0) {
    throw new RangeError(`spring: damping must be > 0, got ${String(damping)}`);
  }
  const key = `${stiffness}|${damping}`;
  const cached = springCache.get(key);
  if (cached !== undefined) return cached;
  const dt = 1 / 480;
  const samples: number[] = [0];
  let x = 0;
  let v = 0;
  const maxSteps = 4800; // 最多模拟 10 秒
  while (samples.length <= maxSteps) {
    const a = -stiffness * (x - 1) - damping * v; // 单位质量阻尼弹簧，目标 x=1
    v += a * dt;
    x += v * dt;
    samples.push(x);
    if (samples.length > 120 && Math.abs(x - 1) < 1e-4 && Math.abs(v) < 1e-3) break;
  }
  const steps = samples.length - 1;
  const fn: EasingFn = (t: number): number => {
    const pos = clamp01(t) * steps;
    const i = Math.floor(pos);
    if (i >= steps) return samples[steps];
    const frac = pos - i;
    return samples[i] + (samples[i + 1] - samples[i]) * frac;
  };
  springCache.set(key, fn);
  return fn;
}

export const EASING_NAMES: string[] = [
  "linear", "easeInQuad", "easeOutQuad", "easeInOutQuad",
  "easeInCubic", "easeOutCubic", "easeInOutCubic",
  "easeOutExpo", "easeOutBack", "spring", "bounce",
];

const REGISTRY: Record<string, (params?: EasingParams) => EasingFn> = {
  linear: () => linear,
  easeInQuad: () => easeInQuad,
  easeOutQuad: () => easeOutQuad,
  easeInOutQuad: () => easeInOutQuad,
  easeInCubic: () => easeInCubic,
  easeOutCubic: () => easeOutCubic,
  easeInOutCubic: () => easeInOutCubic,
  easeOutExpo: () => easeOutExpo,
  easeOutBack: () => easeOutBack,
  spring: (p) => spring(p),
  bounce: () => bounce,
};

export function isEasingName(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(REGISTRY, name);
}

/** 按名称获取缓动函数；spring 可通过 params 传入 stiffness/damping */
export function easing(name: string, params?: EasingParams): EasingFn {
  const factory = REGISTRY[name];
  if (factory === undefined) {
    throw new Error(`Unknown easing "${name}". Available: ${EASING_NAMES.join(", ")}`);
  }
  return factory(params);
}
