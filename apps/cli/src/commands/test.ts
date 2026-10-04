// videoos test [--update-golden]：ctx.runTests → 每断言 ✓/✗ + 汇总；failed>0 → exit 1
import type { Command } from "commander";
import type { QaReport, TestResult } from "@videoos/qa";
import { SessionError } from "@videoos/agent";
import { color, ctxFor, fail, formatDuration, openProject, resolveProjectRoot, withProjectOption } from "../util";

function mark(status: TestResult["status"]): string {
  if (status === "pass") return color.green("✓");
  if (status === "skip") return color.gray("○");
  return color.red("✗");
}

export function printTestReport(report: QaReport): void {
  for (const suite of report.suites) {
    const suiteMark = suite.failed === 0 ? color.green("✓") : color.red("✗");
    console.log(`${suiteMark} ${suite.suite}：${suite.passed} 通过 / ${suite.failed} 失败 / ${suite.skipped} 跳过（${formatDuration(suite.durationMs)}）`);
    for (const t of suite.results) {
      const line = `  ${mark(t.status)} ${t.name}`;
      console.log(t.status === "fail" ? color.red(line) : t.status === "skip" ? color.gray(line) : line);
      if (t.status === "fail" && t.message !== undefined) {
        console.log(color.red(`      ${t.message}`));
      }
    }
  }
  console.log("");
  const summary =
    report.totalFailed === 0
      ? color.green(`全部通过：${report.totalPassed} 个断言（${formatDuration(report.durationMs)}）`)
      : color.red(`失败：${report.totalFailed}/${report.totalPassed + report.totalFailed} 个断言（${formatDuration(report.durationMs)}）`);
  console.log(summary);
  console.log(color.gray(`virHash ${report.virHash.slice(0, 12)}（QA 与缓存键对齐）`));
}

export function registerTestCommand(program: Command): void {
  withProjectOption(
    program
      .command("test")
      .description("运行视觉 QA（tests/*.test.ts：语义断言 / golden diff / 溢出检测）")
      .option("--update-golden", "golden 缺失/失配时以当前渲染覆盖写入并判 pass"),
  ).action(async (opts: { project?: string; updateGolden?: boolean }) => {
    const project = await openProject(resolveProjectRoot(opts.project));
    if (project === null) return;
    const ctx = await ctxFor(project);
    try {
      const report = await ctx.runTests({ ...(opts.updateGolden === true ? { updateGolden: true } : {}) });
      printTestReport(report);
      if (report.totalFailed > 0) {
        fail(`QA 未通过（${report.totalFailed} 个断言失败）`);
      }
    } catch (err) {
      if (err instanceof SessionError) {
        fail(err.message);
      } else {
        fail(`测试失败：${err instanceof Error ? err.message : String(err)}`);
      }
    }
  });
}
