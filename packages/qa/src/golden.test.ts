// golden 基准机制测试：updateGolden 生成 → 二次比对 pass（确定性）→ 篡改 → fail + diffPng + diff 落盘
import { afterAll, beforeAll, beforeEach, expect as bunExpect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { compile } from "@videoos/compiler";
import type { CompileResult } from "@videoos/compiler";
import { createRenderer } from "@videoos/render-canvas";
import {
  QaAssertionError, clearCollected, createQaContext, describe, expect, it, runCollected,
} from "./index";
import type { QaContext, QaOptions } from "./index";
import { basicDefinition } from "./fixtures";

const GOLDEN_ROOT = join(tmpdir(), "videoos-qa-golden-tests");

let compiled: CompileResult;

beforeAll(() => {
  compiled = compile(basicDefinition());
});
beforeEach(() => {
  rmSync(GOLDEN_ROOT, { recursive: true, force: true });
  clearCollected();
});
afterAll(() => {
  rmSync(GOLDEN_ROOT, { recursive: true, force: true }); // 临时目录清理
});

function ctxWith(options: QaOptions): QaContext {
  return createQaContext(compiled, createRenderer(compiled), options);
}

function tamperGolden(): void {
  // 篡改：同尺寸「重画」——保留背景色 + 左上角追加白色矩形（约 8.7% 像素变化）
  const canvas = createCanvas(640, 360);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#101020";
  ctx.fillRect(0, 0, 640, 360);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 200, 100);
  writeFileSync(join(GOLDEN_ROOT, "basic-15.png"), canvas.toBuffer("image/png"));
}

function catchAssertion(fn: () => void): QaAssertionError {
  try {
    fn();
  } catch (err) {
    if (err instanceof QaAssertionError) return err;
    throw new Error(`Expected QaAssertionError but got: ${String(err)}`);
  }
  throw new Error("Expected toMatchGolden to fail, but it passed");
}

test("首次 updateGolden：生成 golden 文件并 pass（details.goldenUpdated 通过 runner 透传）", async () => {
  const ctx = ctxWith({ goldenDir: GOLDEN_ROOT, updateGolden: true });
  describe("golden suite", () => {
    it("frame 15 golden", () => {
      expect(ctx.frame(15)).toMatchGolden("basic-15");
    });
  });
  const report = await runCollected(ctx);
  bunExpect(report.totalPassed).toBe(1);
  const result = report.suites[0]!.results[0]!;
  bunExpect(result.status).toBe("pass");
  bunExpect(result.details!.goldenUpdated).toBe(true);
  bunExpect(result.details!.golden).toBe(join(GOLDEN_ROOT, "basic-15.png"));
  const golden = readFileSync(join(GOLDEN_ROOT, "basic-15.png"));
  bunExpect(golden.length).toBeGreaterThan(100);
  bunExpect(golden.readUInt32BE(16)).toBe(640); // IHDR width
  bunExpect(golden.readUInt32BE(20)).toBe(360); // IHDR height
});

test("第二次比对 pass（无 updateGolden）；.png 后缀等价；阈值 1 仍过（逐字节一致的确定性契约）", () => {
  expect(ctxWith({ goldenDir: GOLDEN_ROOT, updateGolden: true }).frame(15)).toMatchGolden("basic-15"); // 生成
  const ctx = ctxWith({ goldenDir: GOLDEN_ROOT });
  expect(ctx.frame(15)).toMatchGolden("basic-15");
  expect(ctx.frame(15)).toMatchGolden("basic-15.png");
  expect(ctx.frame(15)).toMatchGolden("basic-15", { threshold: 1 }); // similarity 必须精确为 1
});

test("篡改 golden（重画）→ fail 且 diffPng 存在、diff PNG 落盘", () => {
  expect(ctxWith({ goldenDir: GOLDEN_ROOT, updateGolden: true }).frame(15)).toMatchGolden("basic-15");
  tamperGolden();

  const ctx = ctxWith({ goldenDir: GOLDEN_ROOT });
  const err = catchAssertion(() => expect(ctx.frame(15)).toMatchGolden("basic-15"));
  bunExpect(err.message).toContain("similarity");
  const similarity = err.details.similarity as number;
  bunExpect(similarity).toBeLessThan(0.98);
  bunExpect(similarity).toBeGreaterThanOrEqual(0.5);
  bunExpect(err.details.diffPng).toBeInstanceOf(Buffer);
  bunExpect((err.details.diffPng as Buffer).length).toBeGreaterThan(100);
  bunExpect(err.details.diff).toBe(join(GOLDEN_ROOT, "basic-15.diff.png"));
  const diffFile = readFileSync(join(GOLDEN_ROOT, "basic-15.diff.png"));
  bunExpect(diffFile.readUInt32BE(16)).toBe(640);
  bunExpect(diffFile.readUInt32BE(20)).toBe(360);
});

test("篡改后放宽 threshold（0.5）可通过 —— 阈值选项生效", () => {
  expect(ctxWith({ goldenDir: GOLDEN_ROOT, updateGolden: true }).frame(15)).toMatchGolden("basic-15");
  tamperGolden();
  const ctx = ctxWith({ goldenDir: GOLDEN_ROOT });
  expect(ctx.frame(15)).toMatchGolden("basic-15", { threshold: 0.5 });
});

test("golden 缺失且未开 updateGolden → fail 并给出提示", () => {
  const ctx = ctxWith({ goldenDir: GOLDEN_ROOT });
  const err = catchAssertion(() => expect(ctx.frame(15)).toMatchGolden("missing-one"));
  bunExpect(err.message).toContain("not found");
  bunExpect(err.details.golden).toBe(join(GOLDEN_ROOT, "missing-one.png"));
  bunExpect(String(err.details.hint)).toContain("updateGolden");
});

test("子目录名（goldenDir 内相对路径）与绝对路径名", () => {
  const updateCtx = ctxWith({ goldenDir: GOLDEN_ROOT, updateGolden: true });
  expect(updateCtx.frame(15)).toMatchGolden("shots/basic-15");
  bunExpect(existsSync(join(GOLDEN_ROOT, "shots/basic-15.png"))).toBe(true);
  const ctx = ctxWith({ goldenDir: GOLDEN_ROOT });
  expect(ctx.frame(15)).toMatchGolden("shots/basic-15");

  const absName = join(GOLDEN_ROOT, "escaped"); // 绝对路径逃逸 goldenDir
  expect(updateCtx.frame(15)).toMatchGolden(absName);
  bunExpect(existsSync(`${absName}.png`)).toBe(true);
  expect(ctx.frame(15)).toMatchGolden(absName);
});

test("QaOptions 解析：goldenDir 相对项目根（cwd）→ 绝对路径；默认 tests/golden", () => {
  bunExpect(ctxWith({ goldenDir: "some/rel/golden" }).options.goldenDir).toBe(resolve(process.cwd(), "some/rel/golden"));
  const ctxDefault = ctxWith({});
  bunExpect(ctxDefault.options.goldenDir).toBe(resolve(process.cwd(), "tests/golden"));
  bunExpect(ctxDefault.options.updateGolden).toBe(false);
  bunExpect(() => ctxWith({ goldenDir: "" })).toThrow(/goldenDir/);
});
