// Visual QA suite for data-story (dual-mode: `videoos test` and `bun test`).
//
// Frame math (fps 30): chart [0,195) · takeaway [180,270)
//   bars finish growing at chart-local 2.55s (last: delay 0.75 + duration 1.8)
//   value labels complete at 3.1s, weekday labels at 3.3s, title at 0.6s
//   → chart assertions live at frame 105 (chart-local 3.5s, everything settled)
//   takeaway typewriter completes at takeaway-local 1.4s, sub fade at 1.5s
//   → takeaway assertions live at frame 240 (takeaway-local 2.0s)
import { compile } from "@videoos/compiler";
import { createRenderer } from "@videoos/render-canvas";
import { describe, it, expect, frame, scene, createQaContext, runCollected } from "@videoos/qa";
import definition from "../src/video";

const result = compile(definition);
const ctx = createQaContext(result, createRenderer(result));

describe("chart", () => {
  it("has the four bar rect layers", () => {
    expect(scene("chart")).toHaveLayers("bar-1", "bar-2", "bar-3", "bar-4");
  });

  it("has the axis furniture and labels", () => {
    expect(scene("chart")).toHaveLayers("mask", "axis", "value-1", "value-4", "day-1", "day-4");
  });

  it("keeps the bars-grow beat", () => {
    expect(scene("chart")).toHaveBeat("bars-grow");
  });

  it("fits the rhythm (6-7 seconds)", () => {
    expect(scene("chart")).durationBetween(6, 7);
  });

  it("is not a black frame once the chart has settled (frame 105)", () => {
    expect(frame(105)).not.toBeBlack();
  });

  it("shows title and value labels after all animations complete (frame 105 = chart-local 3.5s)", () => {
    expect(frame(105)).toContainText("RENDER HOURS SAVED PER WEEK");
    expect(frame(105)).toContainText("3.2");
    expect(frame(105)).toContainText("5.8");
    expect(frame(105)).toContainText("7.6");
  });

  it("has no overflowing text", () => {
    expect(scene("chart")).noTextOverflow();
  });
});

describe("takeaway", () => {
  it("fits the rhythm (2.5-3.5 seconds)", () => {
    expect(scene("takeaway")).durationBetween(2.5, 3.5);
  });

  it("shows the full takeaway after typing completes (frame 240 = takeaway-local 2.0s > 1.4s)", () => {
    expect(frame(240)).toContainText("Determinism turns data into story.");
  });

  it("shows the subline after its fade completes", () => {
    expect(frame(240)).toContainText("Same input. Same pixels. Every time.");
  });

  it("has no overflowing text", () => {
    expect(scene("takeaway")).noTextOverflow();
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
  // Not running under `bun test` (e.g. `videoos test`): assertions stay in the
  // collector and are executed by the QA runner instead.
}
