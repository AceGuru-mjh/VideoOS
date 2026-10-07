// 极简 semver 测试：parse / compare / diff 全分支（≥10 case）
import { describe, expect, test } from "bun:test";
import { compareVersions, isVersion, parseVersion, versionDiff } from "./semver";
import type { ReleaseType } from "./semver";

describe("parseVersion", () => {
  test("标准 x.y.z", () => {
    expect(parseVersion("0.3.0")).toEqual({ major: 0, minor: 3, patch: 0, prerelease: null });
  });

  test("容忍 v 前缀与空白", () => {
    expect(parseVersion(" v1.2.3 ")).toEqual({ major: 1, minor: 2, patch: 3, prerelease: null });
  });

  test("预发布标识", () => {
    expect(parseVersion("0.4.0-beta.1")?.prerelease).toBe("beta.1");
  });

  test("非法输入 → null（x.y / 空 / 乱码 / 前导零点）", () => {
    expect(parseVersion("1.2")).toBeNull();
    expect(parseVersion("")).toBeNull();
    expect(parseVersion("abc")).toBeNull();
    expect(parseVersion("1.2.3.4")).toBeNull();
    expect(parseVersion("1.2.3-")).toBeNull();
  });

  test("isVersion", () => {
    expect(isVersion("10.20.30")).toBe(true);
    expect(isVersion("v0.1.0")).toBe(true);
    expect(isVersion("next")).toBe(false);
  });
});

describe("compareVersions", () => {
  test("major / minor / patch 三级比较", () => {
    expect(compareVersions("1.2.3", "1.2.10")).toBeLessThan(0);
    expect(compareVersions("1.2.3", "1.10.0")).toBeLessThan(0);
    expect(compareVersions("1.2.3", "2.0.0")).toBeLessThan(0);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  test("正式版 > 预发布", () => {
    expect(compareVersions("0.4.0-beta.1", "0.4.0")).toBeLessThan(0);
  });

  test("预发布之间按标识比较（数字 < 字母；数值序而非字典序）", () => {
    expect(compareVersions("0.4.0-alpha", "0.4.0-beta")).toBeLessThan(0);
    expect(compareVersions("0.4.0-beta.2", "0.4.0-beta.10")).toBeLessThan(0);
    expect(compareVersions("0.4.0-1", "0.4.0-alpha")).toBeLessThan(0);
  });

  test("任一非法 → 抛错", () => {
    expect(() => compareVersions("x", "1.0.0")).toThrow();
  });
});

describe("versionDiff", () => {
  test.each([
    ["0.3.0", "0.3.1", "patch"],
    ["0.3.0", "0.4.0", "minor"],
    ["0.3.0", "1.0.0", "major"],
    ["0.3.0", "0.3.0", "none"],
    ["0.3.1", "0.3.0", "none"],
    ["0.3.0", "0.3.0-beta.1", "none"],
    ["bad", "0.3.1", "none"],
    ["0.3.0", "bad", "none"],
  ] as [string, string, ReleaseType][])("%s → %s = %s", (current, next, expected) => {
    expect(versionDiff(current, next)).toBe(expected);
  });
});
