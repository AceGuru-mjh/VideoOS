// videoos skills 命令测试：matchSkills 纯函数 + loadSkills 实库集成 + CLI 冒烟。
// matchSkills 覆盖：空查询全量 / 拉丁多词任一命中 / CJK 子串 / 大小写不敏感 /
// 无命中空数组 / 结果字母序稳定。CLI 冒烟用 commander 的 program.parseAsync
// （输出走 console.log — 断言以退出码 + 内部函数为准，不截获 stdout）。
import { describe, expect, test } from "bun:test";
import { program } from "../index";
import { loadSkills } from "@videoos/server";
import { matchSkills } from "./skills";

function fake(name: string, description: string, trigger: string) {
  return { name, version: "0.1.0", description, trigger, body: "", source: "builtin" as const };
}

const FAKES = [
  fake("tech-intro", "Product tech introduction video", "User asks for a tech intro"),
  fake("subtitle-burn", "Burn subtitles into video", "User asks to burn subtitles 字幕"),
  fake("kinetic-lyrics", "Kinetic lyrics video", "歌词动态视频"),
];

describe("matchSkills（纯函数）", () => {
  test("空查询 → 全量（字母序）", () => {
    const out = matchSkills("", FAKES);
    expect(out.map((s) => s.name)).toEqual(["kinetic-lyrics", "subtitle-burn", "tech-intro"]);
  });

  test("拉丁单词子串 + 大小写不敏感", () => {
    const out = matchSkills("SUBTITLE", FAKES);
    expect(out.map((s) => s.name)).toEqual(["subtitle-burn"]);
  });

  test("多词任一命中（OR 语义）", () => {
    const out = matchSkills("lyrics intro", FAKES);
    expect(out.map((s) => s.name)).toEqual(["kinetic-lyrics", "tech-intro"]);
  });

  test("CJK 子串命中 description", () => {
    const out = matchSkills("字幕", FAKES);
    expect(out.map((s) => s.name)).toEqual(["subtitle-burn"]);
  });

  test("CJK 命中 trigger", () => {
    const out = matchSkills("歌词", FAKES);
    expect(out.map((s) => s.name)).toEqual(["kinetic-lyrics"]);
  });

  test("无命中 → 空数组", () => {
    expect(matchSkills("nonexistent-xyz", FAKES)).toEqual([]);
  });

  test("空白词忽略（全空白查询不炸）", () => {
    const out = matchSkills("   ", FAKES);
    expect(out).toHaveLength(3);
  });
});

describe("skills 命令（真实技能库集成）", () => {
  test("内置库 42 个技能全部可加载（Agent Kit P3 交付量）", async () => {
    const all = await loadSkills(null);
    expect(all.length).toBeGreaterThanOrEqual(42);
    // 抽查已知技能存在
    const names = new Set(all.map((s) => s.name));
    for (const n of ["tech-intro", "subtitle-burn", "kinetic-lyrics", "year-review", "trailer-cut"]) {
      expect(names.has(n)).toBe(true);
    }
  });

  test("matchSkills 对真实库的搜索：subtitle 命中字幕系技能", async () => {
    const all = await loadSkills(null);
    const out = matchSkills("subtitle", all);
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out.every((s) => `${s.name}${s.description}`.toLowerCase().includes("subtitle"))).toBe(true);
  });

  test("matchSkills 真实库搜索：subtitle 命中字幕系技能", async () => {
    const all = await loadSkills(null);
    expect(matchSkills("subtitle", all).length).toBeGreaterThanOrEqual(1);
  });

  test("matchSkills 真实库搜索：lyrics 命中歌词系技能", async () => {
    const all = await loadSkills(null);
    const out = matchSkills("lyrics", all);
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out.some((s) => s.name === "kinetic-lyrics")).toBe(true);
  });

  test("CLI：videoos skills list 退出码 0", async () => {
    const prevArgv = process.argv;
    process.argv = ["bun", "videoos", "skills", "list"]; // argv[0:2] 为 node/脚本占位
    try {
      await program.parseAsync(process.argv);
      expect(process.exitCode ?? 0).toBe(0);
    } finally {
      process.argv = prevArgv;
    }
  });

  test("CLI：videoos skills search subtitle 正常退出", async () => {
    const prevArgv = process.argv;
    process.argv = ["bun", "videoos", "skills", "search", "subtitle"];
    try {
      await program.parseAsync(process.argv);
      expect(process.exitCode ?? 0).toBe(0);
    } finally {
      process.argv = prevArgv;
    }
  });

  test("CLI：videoos skills show <未知名> → exitCode 1 + 提示", async () => {
    const prevArgv = process.argv;
    const prevExit = process.exitCode;
    process.argv = ["bun", "videoos", "skills", "show", "definitely-not-a-skill"];
    try {
      await program.parseAsync(process.argv);
      expect(process.exitCode).toBe(1);
    } finally {
      process.argv = prevArgv;
      process.exitCode = prevExit ?? 0;
    }
  });
});
