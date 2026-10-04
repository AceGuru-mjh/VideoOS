// color 测试：规范化、alpha 混合、亮度
import { describe, expect, test } from "bun:test";
import { isDark, normalizeColor, withAlpha } from "./color";

describe("normalizeColor", () => {
  test("3 位展开为 6 位小写", () => {
    expect(normalizeColor("#FFF")).toBe("#ffffff");
    expect(normalizeColor("#0aB")).toBe("#00aabb");
  });
  test("6 位转小写", () => {
    expect(normalizeColor("#AA BBCC".replace(" ", ""))).toBe("#aabbcc");
    expect(normalizeColor("#6D28D9")).toBe("#6d28d9");
  });
  test("8 位保留 alpha", () => {
    expect(normalizeColor("#AABBCCDD")).toBe("#aabbccdd");
  });
  test("非法输入抛错", () => {
    expect(() => normalizeColor("ffffff")).toThrow();
    expect(() => normalizeColor("#GGG")).toThrow();
    expect(() => normalizeColor("#12345")).toThrow();
    expect(() => normalizeColor("#1234567")).toThrow();
    expect(() => normalizeColor("")).toThrow();
  });
});

describe("withAlpha", () => {
  test("无 alpha 颜色直接设置 alpha", () => {
    expect(withAlpha("#ff0000", 0.5)).toBe("#ff000080");
    expect(withAlpha("#ff0000", 1)).toBe("#ff0000ff");
    expect(withAlpha("#ff0000", 0)).toBe("#ff000000");
  });
  test("已有 alpha 与新 alpha 相乘（乘法混合）", () => {
    expect(withAlpha("#ff000080", 0.5)).toBe("#ff000040"); // 0x80/255 * 0.5 ≈ 0.25 → 0x40
  });
  test("alpha 超界 clamp", () => {
    expect(withAlpha("#ffffff", 2)).toBe("#ffffffff");
    expect(withAlpha("#ffffff", -1)).toBe("#ffffff00");
  });
});

describe("isDark", () => {
  test("黑/白判断", () => {
    expect(isDark("#000000")).toBe(true);
    expect(isDark("#ffffff")).toBe(false);
    expect(isDark("#0a0a12")).toBe(true);
    expect(isDark("#f59e0b")).toBe(false);
  });
  test("带 alpha 的颜色按 RGB 判断", () => {
    expect(isDark("#00000080")).toBe(true);
  });
});
