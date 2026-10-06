// mcp-stats 直调 handler 测试（不 spawn 子进程）：9 个工具逐一验证数值正确性（与手算/已知
// 性质对照）、边界（空数组/单元素/全等值/长度不匹配）与非法输入的 err(...) 语义错误路径。
import { describe, expect, it } from "bun:test";
import type { LiteTool, LiteToolResult } from "@videoos/mcp-lite";
import { tools } from "./index";

const byName = (name: string): LiteTool => {
  const tool = tools.find((t) => t.name === name);
  if (tool === undefined) throw new Error(`tool not found: ${name}`);
  return tool;
};

const call = (name: string, args: Record<string, unknown>): Promise<LiteToolResult> => byName(name).call(args);

const dataOf = (result: LiteToolResult): Record<string, unknown> => {
  expect(result.ok).toBe(true);
  return result.data as Record<string, unknown>;
};

describe("mcp-stats（直调 handler）", () => {
  it("暴露 9 个 stats.* 工具", () => {
    expect(tools.map((t) => t.name).sort()).toEqual([
      "stats.compare", "stats.correlation", "stats.describe", "stats.histogram",
      "stats.movingAverage", "stats.percentile", "stats.regression", "stats.sample", "stats.zscore",
    ]);
    expect(tools.every((t) => t.description.length > 0)).toBe(true);
    expect(tools.every((t) => (t.parameters as { type?: string }).type === "object")).toBe(true);
  });

  it("stats.describe 全量描述统计（[1..5] 手算对照）", async () => {
    const data = dataOf(await call("stats.describe", { values: [1, 2, 3, 4, 5] }));
    expect(data.count).toBe(5);
    expect(data.mean).toBe(3);
    expect(data.median).toBe(3);
    expect(data.min).toBe(1);
    expect(data.max).toBe(5);
    expect(data.range).toBe(4);
    expect(data.variance).toBe(2.5); // 样本方差（n-1）
    expect(data.stdDev).toBeCloseTo(1.581139, 5);
    expect(data.quartiles).toEqual({ q1: 2, q2: 3, q3: 4 });
    expect(data.iqr).toBe(2);
    expect(data.skewness).toBe(0); // 对称
    expect(data.kurtosis).toBeCloseTo(-1.3, 5); // 有偏超额峰度
    expect(data.outliers).toEqual([]);
    expect("mode" in data).toBe(false); // 无重复值 → 省略 mode
  });

  it("stats.describe 离群点/众数/单元素/空数组", async () => {
    const outlier = dataOf(await call("stats.describe", { values: [1, 2, 3, 4, 100] }));
    expect(outlier.outliers).toEqual([100]); // IQR 围栏 [−1, 7]
    expect(outlier.mean).toBe(22);

    const modeful = dataOf(await call("stats.describe", { values: [2, 2, 3, 3, 5] }));
    expect(modeful.mode).toBe(2); // 并列取最小

    const single = dataOf(await call("stats.describe", { values: [7] }));
    expect(single.count).toBe(1);
    expect(single.variance).toBe(0);
    expect(single.quartiles).toEqual({ q1: 7, q2: 7, q3: 7 });
    expect(single.outliers).toEqual([]);

    const empty = await call("stats.describe", { values: [] });
    expect(empty.ok).toBe(false);
    expect(empty.error).toContain("E_EMPTY");
  });

  it("stats.histogram 等宽分箱（[0..9] 5 箱各 2 个）+ 右闭末箱", async () => {
    const data = dataOf(await call("stats.histogram", { values: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], bins: 5 }));
    const bins = data.bins as Array<{ from: number; to: number; count: number }>;
    expect(bins).toHaveLength(5);
    expect(bins.map((b) => b.count)).toEqual([2, 2, 2, 2, 2]);
    expect(data.maxCount).toBe(2);
    expect(bins[0]!.from).toBe(0);
    expect(bins[4]!.to).toBe(9);
    expect(bins[1]!.from).toBeCloseTo(1.8, 5);
  });

  it("stats.histogram Sturges 定箱数 + 全等值退化", async () => {
    const sturges = dataOf(await call("stats.histogram", {
      values: Array.from({ length: 100 }, (_, i) => i),
      bins: 10,
      binMode: "sturges",
    }));
    expect(sturges.binCount).toBe(8); // ceil(1 + log2(100))
    expect((sturges.bins as unknown[]).length).toBe(8);

    const identical = dataOf(await call("stats.histogram", { values: [5, 5, 5], bins: 3 }));
    expect((identical.bins as Array<{ count: number }>)[0]!.count).toBe(3);

    const empty = await call("stats.histogram", { values: [] });
    expect(empty.ok).toBe(false);
    expect(empty.error).toContain("E_EMPTY");
  });

  it("stats.percentile 线性插值（R-7）", async () => {
    const values = [15, 20, 35, 40, 50];
    expect(dataOf(await call("stats.percentile", { values, p: 30 })).value).toBe(23); // 20 + 0.2×15
    expect(dataOf(await call("stats.percentile", { values, p: 50 })).value).toBe(35);
    expect(dataOf(await call("stats.percentile", { values, p: 0 })).value).toBe(15);
    expect(dataOf(await call("stats.percentile", { values, p: 100 })).value).toBe(50);
    expect(dataOf(await call("stats.percentile", { values: [42], p: 99 })).value).toBe(42);

    await expect(call("stats.percentile", { values, p: 101 })).rejects.toThrow(); // zod 越界
    const empty = await call("stats.percentile", { values: [], p: 50 });
    expect(empty.ok).toBe(false);
  });

  it("stats.regression 完美直线 + 外推预测数组", async () => {
    const data = dataOf(await call("stats.regression", {
      points: [
        { x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 5 }, { x: 3, y: 7 },
      ],
      next: 2,
    }));
    expect(data.slope).toBe(2);
    expect(data.intercept).toBe(1);
    expect(data.r2).toBe(1);
    expect(data.rmse).toBe(0);
    expect(data.mae).toBe(0);
    expect(data.nextXs).toEqual([4, 5]);
    expect(data.predictions).toEqual([9, 11]); // 数组而非函数
    expect(data.next).toBe(2);

    const noisy = dataOf(await call("stats.regression", {
      points: [{ x: 1, y: 2 }, { x: 2, y: 2.5 }, { x: 3, y: 2.2 }],
    }));
    expect(noisy.r2 as number).toBeGreaterThan(0);
    expect(noisy.r2 as number).toBeLessThan(1);

    const vertical = await call("stats.regression", { points: [{ x: 1, y: 1 }, { x: 1, y: 2 }] });
    expect(vertical.ok).toBe(false);
    expect(vertical.error).toContain("E_DATA");
    await expect(call("stats.regression", { points: [{ x: 1, y: 1 }] })).rejects.toThrow(); // zod .min(2)
  });

  it("stats.correlation Pearson/Spearman ±1、并列名次、长度与零方差校验", async () => {
    const perfect = dataOf(await call("stats.correlation", { a: [1, 2, 3], b: [2, 4, 6] }));
    expect(perfect.pearson).toBe(1);
    expect(perfect.spearman).toBe(1);

    const inverse = dataOf(await call("stats.correlation", { a: [1, 2, 3], b: [6, 4, 2] }));
    expect(inverse.pearson).toBe(-1);
    expect(inverse.spearman).toBe(-1);

    const tied = dataOf(await call("stats.correlation", { a: [1, 2, 2, 3], b: [1, 2, 2, 3] }));
    expect(tied.spearman).toBe(1); // 平均并列名次

    const mismatch = await call("stats.correlation", { a: [1, 2, 3], b: [1, 2] });
    expect(mismatch.ok).toBe(false);
    expect(mismatch.error).toContain("E_LEN");
    const zeroVar = await call("stats.correlation", { a: [1, 1, 1], b: [1, 2, 3] });
    expect(zeroVar.ok).toBe(false);
    expect(zeroVar.error).toContain("E_DATA");
  });

  it("stats.movingAverage 前 window-1 个为 null", async () => {
    const data = dataOf(await call("stats.movingAverage", { values: [1, 2, 3, 4, 5], window: 3 }));
    expect(data.result).toEqual([null, null, 2, 3, 4]);

    const window1 = dataOf(await call("stats.movingAverage", { values: [1, 2, 3], window: 1 }));
    expect(window1.result).toEqual([1, 2, 3]);

    const tooWide = await call("stats.movingAverage", { values: [1, 2], window: 3 });
    expect(tooWide.ok).toBe(false);
    expect(tooWide.error).toContain("E_ARGS");
    const empty = await call("stats.movingAverage", { values: [], window: 1 });
    expect(empty.ok).toBe(false);
  });

  it("stats.zscore 总体标准差 + 常数列全零", async () => {
    const data = dataOf(await call("stats.zscore", { values: [2, 4, 6] }));
    expect(data.mean).toBe(4);
    expect(data.stdDev).toBeCloseTo(1.632993, 5);
    const z = data.z as number[];
    expect(z[0]).toBeCloseTo(-1.224745, 5);
    expect(z[1]).toBe(0);
    expect(z[2]).toBeCloseTo(1.224745, 5);

    const constant = dataOf(await call("stats.zscore", { values: [9, 9, 9] }));
    expect(constant.z).toEqual([0, 0, 0]);
    expect(constant.stdDev).toBe(0);
  });

  it("stats.sample head/stride/可复现随机（LCG 种子）", async () => {
    const values = Array.from({ length: 10 }, (_, i) => i);
    const head = dataOf(await call("stats.sample", { values, n: 3, method: "head" }));
    expect(head.items).toEqual([0, 1, 2]);
    expect(head.indices).toEqual([0, 1, 2]);

    const stride = dataOf(await call("stats.sample", { values, n: 3, method: "stride" }));
    expect(stride.indices).toEqual([0, 3, 6]);

    const first = dataOf(await call("stats.sample", { values, n: 4, method: "random", seed: 42 }));
    const second = dataOf(await call("stats.sample", { values, n: 4, method: "random", seed: 42 }));
    expect(first.items).toEqual(second.items); // 同种子 → 同结果
    expect(first.seed).toBe(42);
    expect(new Set(first.indices as number[]).size).toBe(4); // 无放回不重复
    const different = dataOf(await call("stats.sample", { values, n: 4, method: "random", seed: 7 }));
    expect(different.items === first.items).toBe(false);

    const all = dataOf(await call("stats.sample", { values, n: 10, method: "random", seed: 1 }));
    expect((all.items as number[]).slice().sort((a, b) => a - b)).toEqual(values); // 全量抽样=排列
    const none = dataOf(await call("stats.sample", { values, n: 0, method: "random", seed: 1 }));
    expect(none.items).toEqual([]);

    const tooMany = await call("stats.sample", { values, n: 11, method: "head" });
    expect(tooMany.ok).toBe(false);
    expect(tooMany.error).toContain("E_ARGS");
  });

  it("stats.compare Welch t + Cohen's d（显著大差异样本）", async () => {
    const data = dataOf(await call("stats.compare", {
      a: [10, 12, 14, 16, 18],
      b: [2, 3, 4, 5, 6],
    }));
    expect(data.nA).toBe(5);
    expect(data.nB).toBe(5);
    expect(data.meanA).toBe(14);
    expect(data.meanB).toBe(4);
    expect(data.meanDiff).toBe(10);
    expect(data.t).toBeCloseTo(6.324555, 5);
    expect(data.df).toBeCloseTo(5.882353, 5);
    expect(data.pValue as number).toBeLessThan(0.001);
    expect(data.significantAt005).toBe(true);
    expect(data.cohensD).toBe(4);
    expect(data.effectSize).toBe("large");
    expect(data.method as string).toContain("Welch");
    expect(data.note as string).toContain("近似"); // 注明正态近似

    const noDiff = dataOf(await call("stats.compare", {
      a: [1, 2, 3, 4, 5],
      b: [1.1, 2.1, 3.1, 4.1, 5.1],
    }));
    expect(noDiff.significantAt005).toBe(false);
    expect(noDiff.effectSize).toBe("negligible");

    const degenerate = await call("stats.compare", { a: [5, 5, 5], b: [5, 5, 5] });
    expect(degenerate.ok).toBe(false);
    expect(degenerate.error).toContain("E_DATA");
    const tooShort = await call("stats.compare", { a: [1], b: [2, 3] });
    expect(tooShort.ok).toBe(false);
    expect(tooShort.error).toContain("E_LEN");
  });
});
