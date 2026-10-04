// Visual QA suite for code-walkthrough (dual-mode: `videoos test` and `bun test`).
//
// Frame math (fps 30): terminal [0,195) · caption [180,270)
//   line-1 types 0.4 → 1.1s (complete)  → asserted at frame 90 (terminal-local 3.0s)
//   line-2 types 1.3 → 2.5s (complete)  → asserted at frame 90
//   line-3 types 2.8 → 3.4s — NOT complete at frame 90 (3.0s) → negative assertion
//   caption blur-up done at 0.8s, sub fade at 1.2s → asserted at frame 240 (caption-local 2.0s)
import { compile } from "@videoos/compiler";
import { createRenderer } from "@videoos/render-canvas";
import { describe, it, expect, frame, scene, createQaContext, runCollected } from "@videoos/qa";
import definition from "../src/video";

const result = compile(definition);
const ctx = createQaContext(result, createRenderer(result));

describe("terminal", () => {
  it("does not start on a black frame (window chrome visible from frame 0)", () => {
    expect(frame(0)).not.toBeBlack();
  });

  it("has the terminal window and traffic lights", () => {
    expect(scene("terminal")).toHaveLayers("window", "titlebar", "light-red", "light-yellow", "light-green");
  });

  it("keeps the compile-ok beat", () => {
    expect(scene("terminal")).toHaveBeat("compile-ok");
  });

  it("fits the rhythm (6-7 seconds)", () => {
    expect(scene("terminal")).durationBetween(6, 7);
  });

  it("shows compile input and output after they finish typing (frame 90 = terminal-local 3.0s)", () => {
    expect(frame(90)).toContainText("$ videoos compile");
    expect(frame(90)).toContainText("0 errors");
  });

  it("has NOT typed the test command yet at frame 90 (line-3 completes at local 3.4s)", () => {
    expect(frame(90)).not.toContainText("$ videoos test");
  });

  it("has no overflowing text", () => {
    expect(scene("terminal")).noTextOverflow();
  });
});

describe("caption", () => {
  it("fits the rhythm (2-4 seconds)", () => {
    expect(scene("caption")).durationBetween(2, 4);
  });

  it("shows the takeaway after its blur-up completes (frame 240 = caption-local 2.0s)", () => {
    expect(frame(240)).toContainText("Every frame is a function call.");
    expect(frame(240)).toContainText("all deterministic");
  });

  it("has no overflowing text", () => {
    expect(scene("caption")).noTextOverflow();
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
