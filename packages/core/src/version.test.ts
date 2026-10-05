// 版本一致性守护（CI 红线）：
//   VIDEOOS_VERSION（单一源）必须与全部用户可见 app 的 package.json version 一致。
// 发版工作流 bump 时四文件同步更新；任何手工改动只改其一 → CI 红。
// （apps/studio 的 package.json version 仅随 app 打包元数据走，不运行时暴露，
//   但与 CLI/桌面同批发版，一并守护。）
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { VIDEOOS_VERSION } from "./version";

function pkgVersion(rel: string): string {
  const pkg = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "..", rel), "utf8")) as { version: string };
  return pkg.version;
}

describe("版本一致性（单一源守护）", () => {
  test("VIDEOOS_VERSION 是 x.y.z 语义化版本", () => {
    expect(VIDEOOS_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("CLI package.json 与单一源一致", () => {
    expect(pkgVersion("apps/cli/package.json")).toBe(VIDEOOS_VERSION);
  });

  test("Desktop package.json 与单一源一致（electron-builder 安装包命名）", () => {
    expect(pkgVersion("apps/desktop/package.json")).toBe(VIDEOOS_VERSION);
  });

  test("Server package.json 与单一源一致", () => {
    expect(pkgVersion("packages/server/package.json")).toBe(VIDEOOS_VERSION);
  });

  test("Studio package.json 与单一源一致", () => {
    expect(pkgVersion("apps/studio/package.json")).toBe(VIDEOOS_VERSION);
  });
});
