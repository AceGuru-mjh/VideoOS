// resolveServeRoot（serve/preview 的项目根决策）纯函数测试：
// 默认 cwd 非项目 → null（无项目模式，v0.3 修复：不再硬退出）；
// 默认 cwd 是项目 → 打开；显式 --project → 原样返回（无效由 server 硬报错）。
import { describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ProjectWorkspace, createProjectTemplate } from "@videoos/workspace";
import { resolveServeRoot } from "./serve";

const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..", "..");
const FIXTURE_ROOT = join(REPO_ROOT, `.tmp-serve-root-${process.pid}`);

describe("resolveServeRoot", () => {
  test("默认 cwd 非项目目录 → null（无项目模式）", () => {
    expect(resolveServeRoot(undefined, "/tmp")).toBeNull();
  });

  test("默认 cwd 是项目目录 → 绝对路径", async () => {
    const projectRoot = join(FIXTURE_ROOT, "demo");
    await ProjectWorkspace.init(projectRoot, { name: "demo" });
    await createProjectTemplate(projectRoot, "demo");
    expect(resolveServeRoot(undefined, projectRoot)).toBe(projectRoot);
    await rm(FIXTURE_ROOT, { recursive: true, force: true });
  });

  test("显式 --project 相对路径 → 相对 cwd 解析的绝对路径", () => {
    expect(resolveServeRoot("my-video", "/home/z")).toBe("/home/z/my-video");
  });

  test("显式 --project 无效路径也原样返回（由 server 打开时硬报错）", () => {
    expect(resolveServeRoot("/definitely/not/a/project", "/tmp")).toBe("/definitely/not/a/project");
  });
});
