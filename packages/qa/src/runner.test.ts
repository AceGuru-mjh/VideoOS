// runner 测试：describe/it 收集器、runSuites/runCollected 汇总、报告序列化、全局 frame/scene、virHash
import { beforeAll, expect as bunExpect, test } from "bun:test";
import { compile } from "@videoos/compiler";
import type { CompileResult } from "@videoos/compiler";
import { createRenderer } from "@videoos/render-canvas";
import {
  QaAssertionError, clearCollected, collectedSuiteCount, computeVirHash, createQaContext,
  describe, expect, frame, it, runCollected, runSuites, scene, setActiveQaContext, toReportJson,
} from "./index";
import type { QaContext, QaReport, Suite } from "./index";
import { basicDefinition, blackDefinition } from "./fixtures";

let compiled: CompileResult;
let ctx: QaContext;

beforeAll(() => {
  clearCollected();
  compiled = compile(basicDefinition());
  ctx = createQaContext(compiled, createRenderer(compiled));
});

test("runCollected：pass/fail/skip 汇总数字正确；QaAssertionError → TestResult(message+details)；未知异常 → message", async () => {
  clearCollected();
  describe("hello suite", () => {
    it("contains greeting", () => {
      expect(ctx.frame(15)).toContainText("Hello");
    });
    it("duration ok", () => {
      expect(ctx.scene("hello")).durationBetween(0.5, 1.5);
    });
    it("missing text fails", () => {
      expect(ctx.frame(15)).toContainText("Goodbye");
    });
    it.skip("skipped with body", () => {
      throw new Error("never runs");
    });
    it.skip("pending without body");
    it("generic error", () => {
      throw new Error("boom");
    });
  });
  const report = await runCollected(ctx);

  bunExpect(report.suites).toHaveLength(1);
  const suite = report.suites[0]!;
  bunExpect(suite.suite).toBe("hello suite");
  bunExpect(suite.passed).toBe(2);
  bunExpect(suite.failed).toBe(2);
  bunExpect(suite.skipped).toBe(2);
  bunExpect(report.totalPassed).toBe(2);
  bunExpect(report.totalFailed).toBe(2);
  bunExpect(report.durationMs).toBeGreaterThanOrEqual(0);
  bunExpect(suite.durationMs).toBeGreaterThanOrEqual(0);
  bunExpect(report.virHash).toBe(computeVirHash(compiled.vir));

  bunExpect(suite.results.map((r) => r.status)).toEqual(["pass", "pass", "fail", "skip", "skip", "fail"]);
  const failAssertion = suite.results[2]!;
  bunExpect(failAssertion.message).toContain("Goodbye");
  bunExpect((failAssertion.details!.visibleTexts as unknown[]).length).toBeGreaterThan(0);
  bunExpect(failAssertion.details!.assertion).toBe("toContainText");
  const failGeneric = suite.results[5]!;
  bunExpect(failGeneric.message).toBe("boom");
  bunExpect(failGeneric.details).toBeUndefined();
  const skipped = suite.results[3]!;
  bunExpect(skipped.status).toBe("skip");
  bunExpect(skipped.message).toBeUndefined();
});

test("runCollected 执行后自动清空收集器（二次运行为空报告）", async () => {
  const empty = await runCollected(ctx);
  bunExpect(empty.suites).toHaveLength(0);
  bunExpect(empty.totalPassed).toBe(0);
  bunExpect(empty.totalFailed).toBe(0);
});

test("异步测试函数：await 正常执行 / async 抛 QaAssertionError 被捕获", async () => {
  clearCollected();
  describe("async suite", () => {
    it("async pass", async () => {
      await Promise.resolve();
      expect(ctx.frame(15)).toContainText("Hello");
    });
    it("async fail", async () => {
      await Promise.resolve();
      throw new QaAssertionError("async boom", { assertion: "custom" });
    });
  });
  const report = await runCollected(ctx);
  bunExpect(report.totalPassed).toBe(1);
  bunExpect(report.totalFailed).toBe(1);
  const failed = report.suites[0]!.results[1]!;
  bunExpect(failed.message).toBe("async boom");
  bunExpect(failed.details!.assertion).toBe("custom");
});

test("嵌套 describe → 'outer > inner' 套件命名", async () => {
  clearCollected();
  describe("outer", () => {
    describe("inner", () => {
      it("nested test", () => {
        expect(ctx.frame(0)).not.toBeBlack();
      });
    });
  });
  bunExpect(collectedSuiteCount()).toBe(2);
  const report = await runCollected(ctx);
  bunExpect(report.suites.map((s) => s.suite)).toEqual(["outer", "outer > inner"]);
  bunExpect(report.totalPassed).toBe(1);
});

test("it() 在 describe 外调用 → 使用错误", () => {
  bunExpect(() => it("orphan", () => {})).toThrow(/inside describe/);
});

test("runSuites：手动构造 Suite[]；运行期全局 frame()/scene() 绑定 ctx、结束后恢复原活动上下文", async () => {
  setActiveQaContext(null);
  const suites: Suite[] = [
    {
      name: "manual",
      tests: [
        { name: "global frame during run", fn: () => { expect(frame(15)).toContainText("Hello VideoOS"); } },
        { name: "global scene during run", fn: () => { expect(scene("hello")).toHaveBeat("show"); } },
        { name: "fail case", fn: () => { expect(frame(0)).toBeBlack(); } },
      ],
    },
  ];
  const report = await runSuites(suites, ctx);
  bunExpect(report.totalPassed).toBe(2);
  bunExpect(report.totalFailed).toBe(1);
  bunExpect(report.suites[0]!.results[2]!.message).toContain("not black");
  // 运行结束后恢复为之前的 active（此处为 null）
  bunExpect(() => frame(0)).toThrow(QaAssertionError);
  bunExpect(() => frame(0)).toThrow(/No active QA context/);
});

test("全局 frame()/scene()：createQaContext 自动设为活动上下文；无上下文时友好报错", () => {
  const ctx2 = createQaContext(compiled, createRenderer(compiled));
  expect(frame(15)).toContainText("Hello");
  bunExpect(scene("hello").name).toBe("hello");
  setActiveQaContext(null);
  bunExpect(() => frame(0)).toThrow(/No active QA context/);
  bunExpect(() => scene("hello")).toThrow(/No active QA context/);
  setActiveQaContext(ctx2); // 还原活动上下文
});

test("computeVirHash：确定性 + 差异敏感（canonical JSON + sha256 hex）", () => {
  const hash1 = computeVirHash(compile(basicDefinition()).vir);
  const hash2 = computeVirHash(compile(basicDefinition()).vir);
  const hash3 = computeVirHash(compile(blackDefinition()).vir);
  bunExpect(hash1).toBe(hash2);
  bunExpect(hash1).not.toBe(hash3);
  bunExpect(hash1).toMatch(/^[0-9a-f]{64}$/);
});

test("createQaContext：renderer 与 compile 的 VIR 不匹配 → 明确报错", () => {
  const other = compile(blackDefinition());
  bunExpect(() => createQaContext(compiled, createRenderer(other))).toThrow(/does not match/);
});

test("toReportJson：JSON.parse roundtrip；Buffer 摘要化（不泄漏二进制数组）", () => {
  const report: QaReport = {
    suites: [
      {
        suite: "s", passed: 0, failed: 1, skipped: 0, durationMs: 1.5,
        results: [
          { name: "t", suite: "s", status: "fail", message: "m", details: { diffPng: Buffer.from([1, 2, 3]), similarity: 0.5 } },
        ],
      },
    ],
    totalPassed: 0, totalFailed: 1, durationMs: 2.5, virHash: "abc",
  };
  const json = toReportJson(report);
  bunExpect(json.includes('"type":"Buffer"')).toBe(false);
  const parsed = JSON.parse(json) as QaReport;
  bunExpect(parsed.totalFailed).toBe(1);
  bunExpect(parsed.suites[0]!.durationMs).toBe(1.5);
  bunExpect(parsed.suites[0]!.results[0]!.details!.diffPng).toBe("<binary 3 bytes>");
  bunExpect(parsed.suites[0]!.results[0]!.details!.similarity).toBe(0.5);
});
