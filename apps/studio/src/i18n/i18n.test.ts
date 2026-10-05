// i18n 契约测试：zh/en 键位奇偶（漏译即红）、common/chat 段所有权互斥、查词行为。
import { describe, expect, test } from "bun:test";
import { flattenKeys, topLevelOverlap, translate, type Dictionary } from "./core";
import { en } from "./en";
import { enChat } from "./locales/en-chat";
import { enCommon } from "./locales/en-common";
import { zh } from "./zh";
import { zhChat } from "./locales/zh-chat";
import { zhCommon } from "./locales/zh-common";

describe("i18n 词典奇偶性", () => {
  test("zh 与 en 键位完全一致（缺一即失败）", () => {
    const zhKeys = flattenKeys(zh).sort();
    const enKeys = flattenKeys(en).sort();
    expect(zhKeys).toEqual(enKeys);
  });

  test("common 与 chat 词典顶层段互斥（所有权不重叠）", () => {
    expect(topLevelOverlap(zhCommon as Dictionary, zhChat as Dictionary)).toEqual([]);
    expect(topLevelOverlap(enCommon as Dictionary, enChat as Dictionary)).toEqual([]);
  });

  test("空段至少存在（chat/skills/mcp 占位）", () => {
    for (const section of ["chat", "skills", "mcp"]) {
      expect(zh[section]).toBeDefined();
      expect(en[section]).toBeDefined();
    }
  });
});

describe("translate 查词行为", () => {
  const dict: Dictionary = {
    a: { b: "值", hello: "你好 {name}，第 {n} 次" },
  };

  test("点路径命中", () => {
    expect(translate(dict, "a.b")).toBe("值");
  });

  test("参数插值", () => {
    expect(translate(dict, "a.hello", { name: "VideoOS", n: 3 })).toBe("你好 VideoOS，第 3 次");
  });

  test("缺失键回显键本身（不崩溃）", () => {
    expect(translate(dict, "a.missing")).toBe("a.missing");
    expect(translate(dict, "nope.nope")).toBe("nope.nope");
  });

  test("指向非字符串叶子回显键本身", () => {
    expect(translate(dict, "a")).toBe("a");
  });

  test("未知参数保留占位符", () => {
    expect(translate(dict, "a.hello", { name: "x" })).toBe("你好 x，第 {n} 次");
  });
});
