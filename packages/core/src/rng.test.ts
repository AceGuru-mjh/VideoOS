// createRng 测试：确定性、分布、边界
import { describe, expect, test } from "bun:test";
import { createRng } from "./rng";

describe("createRng", () => {
  test("相同 seed 产生完全相同的序列", () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 100; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  test("不同 seed 序列不同", () => {
    const a = createRng(1);
    const b = createRng(2);
    const seqA = Array.from({ length: 5 }, () => a.next());
    const seqB = Array.from({ length: 5 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  test("next() 始终落在 [0, 1)", () => {
    const rng = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test("int() 返回闭区间整数", () => {
    const rng = createRng(99);
    for (let i = 0; i < 200; i++) {
      const v = rng.int(3, 9);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(9);
    }
    expect(createRng(5).int(4, 4)).toBe(4);
  });

  test("int() 能覆盖整个区间", () => {
    const rng = createRng(11);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(rng.int(1, 5));
    expect(seen.size).toBe(5);
  });

  test("pick() 返回数组内元素，空数组抛错", () => {
    const rng = createRng(3);
    const arr = ["a", "b", "c"];
    for (let i = 0; i < 50; i++) expect(arr).toContain(rng.pick(arr));
    expect(() => rng.pick([])).toThrow();
  });

  test("非法 seed 抛错", () => {
    expect(() => createRng(Number.NaN)).toThrow();
    expect(() => createRng(Number.POSITIVE_INFINITY)).toThrow();
  });
});
