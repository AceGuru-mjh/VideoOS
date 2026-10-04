// 确定性随机数：xoshiro128**（splitmix32 播种）——全管线禁止 Math.random
export interface Rng {
  /** 均匀返回 [0, 1) */
  next(): number;
  /** 返回 [min, max] 闭区间内的整数（min > max 时自动交换） */
  int(min: number, max: number): number;
  /** 从非空数组中等概率选取一个元素 */
  pick<T>(arr: readonly T[]): T;
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

export function createRng(seed: number): Rng {
  if (typeof seed !== "number" || !Number.isFinite(seed)) {
    throw new RangeError(`createRng: seed must be a finite number, got ${String(seed)}`);
  }
  // splitmix32 生成 4 个 32 位初始状态字
  let sm = seed >>> 0;
  const nextSeed = (): number => {
    sm = (sm + 0x9e3779b9) >>> 0;
    let z = sm;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    return (z ^ (z >>> 15)) >>> 0;
  };
  const s: [number, number, number, number] = [nextSeed(), nextSeed(), nextSeed(), nextSeed()];

  const nextUint = (): number => {
    const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
    const t = (s[1] << 9) >>> 0;
    s[2] = (s[2] ^ s[0]) >>> 0;
    s[3] = (s[3] ^ s[1]) >>> 0;
    s[1] = (s[1] ^ s[2]) >>> 0;
    s[0] = (s[0] ^ s[3]) >>> 0;
    s[2] = (s[2] ^ t) >>> 0;
    s[3] = rotl(s[3], 11);
    return result;
  };

  return {
    next(): number {
      return nextUint() / 4294967296;
    },
    int(min: number, max: number): number {
      if (!Number.isFinite(min) || !Number.isFinite(max)) {
        throw new RangeError("rng.int: min/max must be finite numbers");
      }
      const lo = Math.ceil(Math.min(min, max));
      const hi = Math.floor(Math.max(min, max));
      const range = hi - lo + 1;
      if (range <= 0) return lo;
      // 拒绝采样：避免模偏差，保证确定性均匀
      const limit = Math.floor(4294967296 / range) * range;
      let v = nextUint();
      while (v >= limit) v = nextUint();
      return lo + (v % range);
    },
    pick<T>(arr: readonly T[]): T {
      if (arr.length === 0) throw new RangeError("rng.pick: array must not be empty");
      return arr[this.int(0, arr.length - 1)];
    },
  };
}
