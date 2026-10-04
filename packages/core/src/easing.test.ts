// easing 测试：边界收敛、clamp、单调性、spring 参数化
import { describe, expect, test } from "bun:test";
import { EASING_NAMES, easing, easeOutBack, easeOutCubic, isEasingName, spring } from "./easing";

describe("easing", () => {
  test("EASING_NAMES 包含全部 11 个命名", () => {
    expect(EASING_NAMES).toEqual([
      "linear", "easeInQuad", "easeOutQuad", "easeInOutQuad",
      "easeInCubic", "easeOutCubic", "easeInOutCubic",
      "easeOutExpo", "easeOutBack", "spring", "bounce",
    ]);
    for (const name of EASING_NAMES) expect(isEasingName(name)).toBe(true);
    expect(isEasingName("warp")).toBe(false);
  });

  test("所有缓动在 t=0/1 处收敛到 0/1", () => {
    for (const name of EASING_NAMES) {
      const fn = easing(name);
      const digits = name === "spring" ? 3 : 10;
      expect(fn(0)).toBeCloseTo(0, 10);
      expect(fn(1)).toBeCloseTo(1, digits);
    }
  });

  test("输入被 clamp 到 [0,1]", () => {
    for (const name of EASING_NAMES) {
      const fn = easing(name);
      expect(fn(-1)).toBe(fn(0));
      expect(fn(2)).toBe(fn(1));
    }
  });

  test("linear 恒等", () => {
    expect(easing("linear")(0.25)).toBe(0.25);
    expect(easing("linear")(0.9)).toBeCloseTo(0.9, 12);
  });

  test("easeOutCubic 单调递增（抽查）", () => {
    const fn = easing("easeOutCubic");
    expect(fn(0.2)).toBeLessThan(fn(0.5));
    expect(fn(0.5)).toBeLessThan(fn(0.8));
    expect(fn(0.2)).toBeCloseTo(0.488, 3);
  });

  test("easeInOutCubic 单调递增", () => {
    const fn = easing("easeInOutCubic");
    let prev = fn(0);
    for (let i = 1; i <= 20; i++) {
      const v = fn(i / 20);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  test("easeOutBack 中段过冲（> 1）", () => {
    expect(easeOutBack(0.6)).toBeGreaterThan(1);
    expect(easeOutBack(1)).toBeCloseTo(1, 10);
  });

  test("easeOutCubic 直接导出且可用", () => {
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 10);
  });

  test("spring 确定性且受参数影响", () => {
    const a = spring({ stiffness: 100, damping: 10 });
    const b = spring({ stiffness: 100, damping: 10 });
    expect(a(0.5)).toBe(b(0.5));
    const c = spring({ stiffness: 100, damping: 4 });
    expect(c(0.5)).not.toBeCloseTo(a(0.5), 3);
    expect(a(0)).toBe(0);
    expect(a(1)).toBeCloseTo(1, 3);
  });

  test("未知缓动名抛错", () => {
    expect(() => easing("warp")).toThrow(/Unknown easing/);
  });
});
