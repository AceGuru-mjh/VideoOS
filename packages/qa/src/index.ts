// @videoos/qa — 视频单元测试框架（SPEC §5 Visual QA Engine）
//
// 用法（bun test 内，收集器方案）：
//   import { describe, it, expect, createQaContext, runCollected } from "@videoos/qa";
//   const ctx = createQaContext(compile(def), createRenderer(compile(def)));
//   describe("intro", () => { it("标题可见", () => { expect(ctx.frame(30)).toContainText("VideoOS"); }); });
//   test("qa", async () => { const report = await runCollected(ctx); /* bun:test 断言 report */ });
//
// 用法（server / CLI，无 bun:test 依赖）：
//   const report = await runSuites([{ name, tests: [{ name, fn }] }], ctx);  →  toReportJson(report)
export type {
  Assertion, FrameAssertion, FrameNegatedAssertion, FrameSubject, GoldenMatchOptions,
  QaContext, QaInternals, QaOptions, QaReport, SceneAssertion, SceneSubject, Suite, SuiteResult, SuiteTest, TestFn, TestResult, TestStatus,
} from "./types";
export { QA_INTERNAL, QaAssertionError } from "./types";
export { describe, it, frame, scene, createQaContext, setActiveQaContext, runSuites, runCollected, clearCollected, collectedSuiteCount, toReportJson, computeVirHash } from "./runner";
export type { ItFn } from "./runner";
export { expect } from "./expect";
export { compareImages, renderDiff, loadImageDataSync, PIXEL_TOLERANCE } from "./diff";
export type { DiffResult } from "./diff";
