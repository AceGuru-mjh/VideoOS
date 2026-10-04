// geo 测试：百分比解析、clamp、lerp
import { describe, expect, test } from "bun:test";
import { clamp, lerp, resolvePosition } from "./geo";

const CANVAS = { width: 1920, height: 1080 };

describe("resolvePosition", () => {
  test("百分比字符串", () => {
    expect(resolvePosition({ x: "50%", y: "25%" }, CANVAS)).toEqual({ x: 960, y: 270 });
    expect(resolvePosition({ x: "0%", y: "100%" }, CANVAS)).toEqual({ x: 0, y: 1080 });
  });
  test("负百分比与带符号写法", () => {
    expect(resolvePosition({ x: "-10%", y: "+10%" }, CANVAS)).toEqual({ x: -192, y: 108 });
  });
  test("数字直接透传", () => {
    expect(resolvePosition({ x: 100, y: 200 }, CANVAS)).toEqual({ x: 100, y: 200 });
  });
  test("数字与百分比混合", () => {
    expect(resolvePosition({ x: 960, y: "50%" }, CANVAS)).toEqual({ x: 960, y: 540 });
  });
  test("非法字符串抛错", () => {
    expect(() => resolvePosition({ x: "middle", y: "50%" }, CANVAS)).toThrow();
    expect(() => resolvePosition({ x: "50 px", y: "50%" }, CANVAS)).toThrow();
    expect(() => resolvePosition({ x: Number.NaN, y: 0 }, CANVAS)).toThrow();
  });
});

describe("clamp / lerp", () => {
  test("clamp", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
  test("lerp", () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(10, 0, 0.25)).toBe(7.5);
    expect(lerp(3, 7, 0)).toBe(3);
    expect(lerp(3, 7, 1)).toBe(7);
  });
});
