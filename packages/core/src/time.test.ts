// time 测试：帧秒换算、时间码格式化
import { describe, expect, test } from "bun:test";
import { formatTimecode, framesToSeconds, secondsToFrames } from "./time";

describe("framesToSeconds / secondsToFrames", () => {
  test("基本换算", () => {
    expect(framesToSeconds(60, 30)).toBe(2);
    expect(secondsToFrames(2, 30)).toBe(60);
    expect(framesToSeconds(45, 30)).toBe(1.5);
    expect(secondsToFrames(1.5, 30)).toBe(45);
  });
  test("secondsToFrames 四舍五入", () => {
    expect(secondsToFrames(1 / 3, 30)).toBe(10); // 10.0
    expect(secondsToFrames(0.35, 30)).toBe(11);  // 10.5 → 11
    expect(secondsToFrames(0.2, 30)).toBe(6);
  });
  test("非法 fps 抛错", () => {
    expect(() => framesToSeconds(1, 0)).toThrow();
    expect(() => secondsToFrames(1, -30)).toThrow();
  });
});

describe("formatTimecode", () => {
  test("秒内时间码", () => {
    expect(formatTimecode(4.2, 30)).toBe("00:04.2");
    expect(formatTimecode(0, 30)).toBe("00:00.0");
    expect(formatTimecode(4.25, 30)).toBe("00:04.3"); // 42.5 → 43 个十分位
  });
  test("跨分钟", () => {
    expect(formatTimecode(65.34, 30)).toBe("01:05.3");
    expect(formatTimecode(60, 30)).toBe("01:00.0");
  });
  test("负数按 0 处理", () => {
    expect(formatTimecode(-3, 30)).toBe("00:00.0");
  });
});
