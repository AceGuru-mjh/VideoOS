// Visual QA suite（双模式：bun test 与 videoos test）。
// - bun test：底部 bun:test 包装器执行收集到的断言
// - videoos test / VAP test.run：断言已注册进 @videoos/qa 收集器，由 runner 统一执行
//   （bun:test 的 test() 在 runner 外会抛 "Cannot use test outside of the test runner"，故 try/catch 降级）
import { compile } from "@videoos/compiler";
import { createRenderer } from "@videoos/render-canvas";
import { describe, it, expect, frame, scene, createQaContext, runCollected } from "@videoos/qa";
import definition from "../src/video";

const result = compile(definition);
const ctx = createQaContext(result, createRenderer(result));

describe("intro", () => {
  it("shows the main title after 1 second", () => {
    expect(frame(30)).toContainText("Hello VideoOS");
  });

  it("does not start on a black frame", () => {
    expect(frame(0)).not.toBeBlack();
  });
});

describe("outro", () => {
  it("fits the rhythm (2-4 seconds)", () => {
    expect(scene("outro")).durationBetween(2, 4);
  });
});

try {
  const { test } = await import("bun:test");
  test("video qa suite", async () => {
    const report = await runCollected(ctx);
    if (report.totalFailed > 0) {
      throw new Error(
        `QA failed: ${report.totalFailed} test(s)\n${JSON.stringify(report.suites, null, 2)}`,
      );
    }
  });
} catch {
  // 非 bun test 环境（videoos test）：断言留在收集器，由 runner 执行
}
