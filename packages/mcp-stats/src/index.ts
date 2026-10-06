// @videoos/mcp-stats —— 统计计算服务器（stdio MCP）：描述统计/直方图/分位数/线性回归/相关/
// 移动平均/z 分数/可复现抽样/两样本比较（Welch t + Cohen's d）。
// 纯 TS 数值计算：零依赖（不引入统计库）、零网络、零文件落盘。
// 时间线用途：视频数据面板的即席分析（渲染耗时分布、观看量趋势回归、A/B 片长比较等）。
// 直调可测：工具表导出为 `tools`（测试直调 handler）；仅作为入口脚本运行时才启动 stdio 服务器。
import { defineTool, err, ok, runStdioServer, type LiteTool } from "@videoos/mcp-lite";
import { z } from "zod";

// ---------------------------------------------------------------- 数值小工具

/** 输出统一 6 位小数截断（去浮点尾噪，Number("") 不可能出现——toFixed 恒返回数字串） */
function roundTo(value: number, digits = 6): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(digits));
}

/** 空数组守卫（语义校验：返回 err 而非 zod 抛错，便于 LLM 自纠） */
function requireNonEmpty(values: readonly number[], field: string): { ok: true } | { ok: false; error: string } {
  if (values.length === 0) return { ok: false, error: `E_EMPTY: ${field} must contain at least 1 value (got empty array)` };
  return { ok: true };
}

/** 线性插值分位数（R-7，numpy/Excel 默认）：sorted 升序、p ∈ [0,100] */
function percentileOfSorted(sorted: readonly number[], p: number): number {
  if (sorted.length === 1) return sorted[0]!;
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const frac = rank - lo;
  if (lo >= sorted.length - 1) return sorted[sorted.length - 1]!;
  return sorted[lo]! + frac * (sorted[lo + 1]! - sorted[lo]!);
}

/** 样本方差（n-1；n=1 → 0） */
function sampleVariance(values: readonly number[], mean: number): number {
  if (values.length < 2) return 0;
  const sumSq = values.reduce((acc, v) => acc + (v - mean) ** 2, 0);
  return sumSq / (values.length - 1);
}

/** 总体方差（n；z 分数等「把数据当总体」的场景用） */
function populationVariance(values: readonly number[], mean: number): number {
  if (values.length === 0) return 0;
  const sumSq = values.reduce((acc, v) => acc + (v - mean) ** 2, 0);
  return sumSq / values.length;
}

/** 带平均并列名次的秩（Spearman 用） */
function ranksOf(values: readonly number[]): number[] {
  const order = values.map((value, i) => ({ value, i })).sort((a, b) => a.value - b.value);
  const ranks = new Array<number>(values.length).fill(0);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]!.value === order[i]!.value) j++;
    const averageRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k]!.i] = averageRank;
    i = j + 1;
  }
  return ranks;
}

/** Pearson 相关系数（任一侧零方差 → null，由调用方决定 err 语义） */
function pearson(a: readonly number[], b: readonly number[]): number | null {
  const n = a.length;
  const meanA = a.reduce((s, v) => s + v, 0) / n;
  const meanB = b.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = a[i]! - meanA;
    const dy = b[i]! - meanB;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx <= 0 || syy <= 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

/** 标准正态 CDF（Abramowitz & Stegun 7.1.26 近似，|误差| < 7.5e-8） */
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const poly = t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const upperTail = 0.3989422804014327 * Math.exp(-(z * z) / 2) * poly;
  return z >= 0 ? 1 - upperTail : upperTail;
}

/** 简单 LCG（可复现随机）：Park-Miller 风格常数，uint32 状态 */
function lcgNext(state: number): number {
  return (Math.imul(state, 1664525) + 1013904223) >>> 0;
}

// ---------------------------------------------------------------- 共享 schema 片段

const valuesSchema = z.array(z.number().finite()).max(20_000).describe("数值数组（JSON 内恒为有限数）");

// ---------------------------------------------------------------- 工具表（导出供测试直调）

export const tools: LiteTool[] = [
  // ------------------------------------------------------------ stats.describe
  defineTool(
    "stats.describe",
    "Full descriptive statistics: count/mean/median/min/max/range, sample variance & stdDev, quartiles + IQR, biased skewness & excess kurtosis, optional mode, and IQR-fence outliers.",
    z.object({
      values: valuesSchema.describe("数值数组（≥1 个）"),
    }),
    ({ values }) => {
      const guard = requireNonEmpty(values, "values");
      if (!guard.ok) return err(guard.error);
      const count = values.length;
      const sorted = [...values].sort((a, b) => a - b);
      const sum = values.reduce((s, v) => s + v, 0);
      const mean = sum / count;
      const min = sorted[0]!;
      const max = sorted[count - 1]!;
      const variance = sampleVariance(values, mean);
      const stdDev = Math.sqrt(variance);
      const q1 = percentileOfSorted(sorted, 25);
      const q2 = percentileOfSorted(sorted, 50);
      const q3 = percentileOfSorted(sorted, 75);
      const iqr = q3 - q1;
      // 偏度/峰度：总体矩（有偏）估计；样本过小无意义 → 0
      const m2 = populationVariance(values, mean);
      const m3 = values.reduce((s, v) => s + (v - mean) ** 3, 0) / count;
      const m4 = values.reduce((s, v) => s + (v - mean) ** 4, 0) / count;
      const skewness = count >= 3 && m2 > 0 ? m3 / m2 ** 1.5 : 0;
      const kurtosis = count >= 4 && m2 > 0 ? m4 / (m2 * m2) - 3 : 0;
      // 众数：出现次数 > 1 才有意义（并列取最小值）
      const counts = new Map<number, number>();
      for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
      let bestValue: number | undefined;
      let bestCount = 1;
      for (const [v, c] of counts) {
        if (c > bestCount || (c === bestCount && bestValue !== undefined && v < bestValue)) {
          bestValue = v;
          bestCount = c;
        }
      }
      // IQR 离群点（1.5 倍围栏，保持原始顺序）
      const lowFence = q1 - 1.5 * iqr;
      const highFence = q3 + 1.5 * iqr;
      const outliers = values.filter((v) => v < lowFence || v > highFence);
      return ok({
        count,
        mean: roundTo(mean),
        median: roundTo(q2),
        min,
        max,
        range: roundTo(max - min),
        variance: roundTo(variance),
        stdDev: roundTo(stdDev),
        quartiles: { q1: roundTo(q1), q2: roundTo(q2), q3: roundTo(q3) },
        iqr: roundTo(iqr),
        skewness: roundTo(skewness),
        kurtosis: roundTo(kurtosis),
        ...(bestValue !== undefined ? { mode: bestValue } : {}),
        outliers,
        notes: "variance/stdDev 为样本估计（n-1）；skewness/kurtosis 为总体矩（有偏）估计，n<3 / n<4 时置 0",
      });
    },
  ),

  // ------------------------------------------------------------ stats.histogram
  defineTool(
    "stats.histogram",
    "Histogram bins: equal-width bins (or Sturges' rule for bin count); last bin is right-inclusive; returns per-bin [from,to,count] and maxCount.",
    z.object({
      values: valuesSchema,
      bins: z.number().int().min(1).max(1000).describe("等宽分箱数（binMode=equal 时生效）").default(10),
      binMode: z.enum(["equal", "sturges"]).describe("equal=按 bins 等宽；sturges=按 ceil(1+log2(n)) 自动定箱数").default("equal"),
    }),
    ({ values, bins, binMode }) => {
      const guard = requireNonEmpty(values, "values");
      if (!guard.ok) return err(guard.error);
      const count = values.length;
      const binCount = binMode === "sturges" ? Math.max(1, Math.ceil(1 + Math.log2(count))) : bins;
      const min = Math.min(...values);
      const max = Math.max(...values);
      // 全等值：人为给 ±0.5 的窗，宽度按 1 处理（全部落在第 1 箱）
      const from = min === max ? min - 0.5 : min;
      const to = min === max ? min + 0.5 : max;
      const width = min === max ? 1 : (to - from) / binCount;
      const counts = new Array<number>(binCount).fill(0);
      for (const v of values) {
        const idx = Math.min(binCount - 1, Math.max(0, Math.floor((v - from) / width)));
        counts[idx] = counts[idx]! + 1;
      }
      const out = counts.map((c, i) => ({
        from: roundTo(from + width * i),
        to: roundTo(from + width * (i + 1)),
        count: c,
      }));
      return ok({
        bins: out,
        maxCount: Math.max(...counts),
        binCount,
        binMode,
        n: count,
        min,
        max,
        note: "最后一箱右闭（含 max）；binMode=sturges 时 bins 参数被忽略",
      });
    },
  ),

  // ------------------------------------------------------------ stats.percentile
  defineTool(
    "stats.percentile",
    "Percentile with linear interpolation (R-7, same as numpy/excel PERCENTILE.INC); p ∈ [0,100].",
    z.object({
      values: valuesSchema,
      p: z.number().min(0).max(100).describe("百分位（0-100）"),
    }),
    ({ values, p }) => {
      const guard = requireNonEmpty(values, "values");
      if (!guard.ok) return err(guard.error);
      const sorted = [...values].sort((a, b) => a - b);
      return ok({
        p,
        value: roundTo(percentileOfSorted(sorted, p)),
        count: values.length,
        method: "linear interpolation (R-7)",
      });
    },
  ),

  // ------------------------------------------------------------ stats.regression
  defineTool(
    "stats.regression",
    "Simple linear regression (least squares): slope/intercept/r²/rmse/mae plus forward predictions for the next n x-steps (uniform step from the observed span).",
    z.object({
      points: z.array(z.object({
        x: z.number().finite().describe("自变量"),
        y: z.number().finite().describe("因变量"),
      })).min(2).max(10_000).describe("数据点（≥2 个）"),
      next: z.number().int().min(0).max(100).describe("向后预测步数（返回 predictions 数组，非函数）").default(5),
    }),
    ({ points, next }) => {
      const n = points.length;
      const xs = points.map((p) => p.x);
      const meanX = xs.reduce((s, v) => s + v, 0) / n;
      const meanY = points.reduce((s, p) => s + p.y, 0) / n;
      let sxx = 0;
      let syy = 0;
      let sxy = 0;
      for (const p of points) {
        sxx += (p.x - meanX) ** 2;
        syy += (p.y - meanY) ** 2;
        sxy += (p.x - meanX) * (p.y - meanY);
      }
      if (sxx <= 0) return err("E_DATA: regression needs at least 2 distinct x values (all x are identical)");
      const slope = sxy / sxx;
      const intercept = meanY - slope * meanX;
      const r2 = syy <= 0 ? 1 : (sxy * sxy) / (sxx * syy); // 因变量恒定时按完美拟合处理
      let sqSum = 0;
      let absSum = 0;
      for (const p of points) {
        const residual = p.y - (slope * p.x + intercept);
        sqSum += residual * residual;
        absSum += Math.abs(residual);
      }
      const maxX = Math.max(...xs);
      const minX = Math.min(...xs);
      const step = n > 1 ? (maxX - minX) / (n - 1) : 0;
      const nextXs: number[] = [];
      const predictions: number[] = [];
      for (let k = 1; k <= next; k++) {
        const x = maxX + step * k;
        nextXs.push(roundTo(x));
        predictions.push(roundTo(slope * x + intercept));
      }
      return ok({
        n,
        slope: roundTo(slope),
        intercept: roundTo(intercept),
        r2: roundTo(r2),
        rmse: roundTo(Math.sqrt(sqSum / n)),
        mae: roundTo(absSum / n),
        next,
        nextXs,
        predictions,
        note: "预测按观测跨度均匀步长外推（step=(maxX-minX)/(n-1)）；外推越远置信越低",
      });
    },
  ),

  // ------------------------------------------------------------ stats.correlation
  defineTool(
    "stats.correlation",
    "Pearson and Spearman correlation between two equal-length arrays (Spearman uses average ranks for ties).",
    z.object({
      a: valuesSchema.describe("第一组数值（≥2 个）"),
      b: valuesSchema.describe("第二组数值（≥2 个）"),
    }),
    ({ a, b }) => {
      if (a.length !== b.length) {
        return err(`E_LEN: a and b must have the same length (got ${a.length} vs ${b.length})`);
      }
      if (a.length < 2) return err("E_LEN: correlation needs at least 2 pairs");
      const pearsonR = pearson(a, b);
      if (pearsonR === null) return err("E_DATA: zero variance in a or b — correlation is undefined");
      const spearmanR = pearson(ranksOf(a), ranksOf(b));
      if (spearmanR === null) return err("E_DATA: zero variance in ranks — correlation is undefined");
      return ok({
        n: a.length,
        pearson: roundTo(pearsonR),
        spearman: roundTo(spearmanR),
      });
    },
  ),

  // ------------------------------------------------------------ stats.movingAverage
  defineTool(
    "stats.movingAverage",
    "Simple moving average with a fixed window: the first window-1 entries are null, then the window mean at each index.",
    z.object({
      values: valuesSchema,
      window: z.number().int().min(1).max(10_000).describe("窗口长度（≤ values 长度）"),
    }),
    ({ values, window }) => {
      const guard = requireNonEmpty(values, "values");
      if (!guard.ok) return err(guard.error);
      if (window > values.length) {
        return err(`E_ARGS: window (${window}) must not exceed values length (${values.length})`);
      }
      const result: Array<number | null> = new Array(values.length).fill(null);
      let sum = 0;
      for (let i = 0; i < values.length; i++) {
        sum += values[i]!;
        if (i >= window) sum -= values[i - window]!;
        if (i >= window - 1) result[i] = roundTo(sum / window);
      }
      return ok({ window, count: values.length, result });
    },
  ),

  // ------------------------------------------------------------ stats.zscore
  defineTool(
    "stats.zscore",
    "Standard scores (population stdDev, divides by n): z[i] = (values[i] - mean) / stdDev; zero stdDev → all zeros.",
    z.object({
      values: valuesSchema,
    }),
    ({ values }) => {
      const guard = requireNonEmpty(values, "values");
      if (!guard.ok) return err(guard.error);
      const count = values.length;
      const mean = values.reduce((s, v) => s + v, 0) / count;
      const stdDev = Math.sqrt(populationVariance(values, mean));
      const z = stdDev > 0 ? values.map((v) => roundTo((v - mean) / stdDev)) : values.map(() => 0);
      return ok({ count, mean: roundTo(mean), stdDev: roundTo(stdDev), z });
    },
  ),

  // ------------------------------------------------------------ stats.sample
  defineTool(
    "stats.sample",
    "Reproducible sampling: head / stride / random (seeded LCG + partial Fisher-Yates). Same seed → same sample.",
    z.object({
      values: valuesSchema,
      n: z.number().int().min(0).max(20_000).describe("抽样数量（≤ values 长度；0 = 空样本）"),
      method: z.enum(["head", "random", "stride"]).describe("head=前 n 个；random=种子随机（LCG）；stride=等距下标").default("random"),
      seed: z.number().int().min(0).max(4_294_967_295).describe("随机种子（method=random 时生效；省略则取当前时间并回显）").optional(),
    }),
    ({ values, n, method, seed }) => {
      const guard = requireNonEmpty(values, "values");
      if (!guard.ok) return err(guard.error);
      if (n > values.length) {
        return err(`E_ARGS: n (${n}) must not exceed values length (${values.length})`);
      }
      const length = values.length;
      let indices: number[];
      if (method === "head") {
        indices = Array.from({ length: n }, (_, i) => i);
      } else if (method === "stride") {
        // floor(i*len/n) 在 n ≤ len 时严格递增且互不相同
        indices = Array.from({ length: n }, (_, i) => Math.floor((i * length) / n));
      } else {
        const actualSeed = seed ?? (Date.now() >>> 0);
        let state = actualSeed;
        const rand = (): number => {
          state = lcgNext(state);
          return state / 4_294_967_296;
        };
        const pool = Array.from({ length }, (_, i) => i);
        for (let i = 0; i < n; i++) {
          const j = i + Math.floor(rand() * (length - i));
          const swap = pool[i]!;
          pool[i] = pool[j]!;
          pool[j] = swap;
        }
        indices = pool.slice(0, n);
        return ok({ method, n, seed: actualSeed, indices, items: indices.map((i) => values[i]!) });
      }
      return ok({ method, n, seed: seed ?? null, indices, items: indices.map((i) => values[i]!) });
    },
  ),

  // ------------------------------------------------------------ stats.compare
  defineTool(
    "stats.compare",
    "Two-sample comparison: Welch's t, Welch–Satterthwaite df, two-sided p via NORMAL approximation (not exact t), Cohen's d with effect-size label. Note the approximation before publishing.",
    z.object({
      a: valuesSchema.describe("样本 A（≥2 个）"),
      b: valuesSchema.describe("样本 B（≥2 个）"),
    }),
    ({ a, b }) => {
      if (a.length < 2 || b.length < 2) return err("E_LEN: both samples need at least 2 values (variance undefined otherwise)");
      const nA = a.length;
      const nB = b.length;
      const meanA = a.reduce((s, v) => s + v, 0) / nA;
      const meanB = b.reduce((s, v) => s + v, 0) / nB;
      const varA = sampleVariance(a, meanA);
      const varB = sampleVariance(b, meanB);
      const seA = varA / nA;
      const seB = varB / nB;
      const seTotal = seA + seB;
      if (seTotal <= 0) {
        return err("E_DATA: both samples have zero variance — t statistic undefined (constant values)");
      }
      const meanDiff = meanA - meanB;
      const t = meanDiff / Math.sqrt(seTotal);
      const df = seTotal ** 2 / (seA ** 2 / (nA - 1) + seB ** 2 / (nB - 1));
      const pValue = 2 * (1 - normalCdf(Math.abs(t)));
      const pooledSd = Math.sqrt(((nA - 1) * varA + (nB - 1) * varB) / (nA + nB - 2));
      if (pooledSd <= 0) return err("E_DATA: pooled standard deviation is zero — Cohen's d undefined");
      const cohensD = meanDiff / pooledSd;
      const absD = Math.abs(cohensD);
      const effectSize = absD < 0.2 ? "negligible" : absD < 0.5 ? "small" : absD < 0.8 ? "medium" : "large";
      return ok({
        nA,
        nB,
        meanA: roundTo(meanA),
        meanB: roundTo(meanB),
        meanDiff: roundTo(meanDiff),
        t: roundTo(t),
        df: roundTo(df),
        pValue: roundTo(pValue, 10),
        significantAt005: pValue < 0.05,
        cohensD: roundTo(cohensD),
        effectSize,
        method: "Welch's t-test + Cohen's d (pooled)",
        note: "p 值为正态近似（未查 t 分布精确分位），供快速筛查；正式结论请用精确 t 检验",
      });
    },
  ),
];

// ---------------------------------------------------------------- stdio 入口（直调测试不触发）

if (import.meta.main) {
  await runStdioServer(tools, { serverName: "mcp-stats", serverVersion: "0.1.0" });
}
