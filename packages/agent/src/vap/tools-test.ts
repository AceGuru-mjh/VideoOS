// Test 工具：test.run / test.results（QA 报告含每断言 pass/fail 与结构化失败线索）
import { z } from "zod";
import { asVapSession } from "../session";
import type { VapContext } from "../session";
import type { VapTool, VapToolArgs, VapToolResult } from "./registry";

export function createTestTools(): VapTool[] {
  const testRun: VapTool = {
    name: "test.run",
    description: "运行动态收集的 tests/*.test.ts（@videoos/qa 收集器：describe/it/expect/frame/scene）→ QaReport（suites/每断言结果/virHash）",
    schema: z.object({}),
    async execute(_args: VapToolArgs, ctx: VapContext): Promise<VapToolResult> {
      const session = asVapSession(ctx);
      try {
        const report = await session.runTests();
        return {
          ok: true,
          data: {
            ...report,
            allPassed: report.totalFailed === 0,
            files: await session.listTestFiles(),
          },
        };
      } catch (err) {
        return { ok: false, error: `TEST_RUN_FAILED: ${(err as Error).message}` };
      }
    },
  };

  const testResults: VapTool = {
    name: "test.results",
    description: "最近一次 QA 报告（未运行过则报错提示先 test.run）",
    schema: z.object({}),
    async execute(_args: VapToolArgs, ctx: VapContext): Promise<VapToolResult> {
      const session = asVapSession(ctx);
      if (session.lastQaReport === null) {
        return { ok: false, error: "NO_TEST_RESULTS: 尚未运行 test.run" };
      }
      return { ok: true, data: { ...session.lastQaReport, allPassed: session.lastQaReport.totalFailed === 0 } };
    },
  };

  return [testRun, testResults];
}
