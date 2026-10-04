// Visual QA suite for kinetic-typography (dual-mode: `videoos test` and `bun test`).
//
// Frame math (fps 30): typewriter [0,120) · moves [108,228)
// Typewriter semantics: content is sliced to ceil(len * easing(t)), so a
// toContainText(FULL_TEXT) only passes AFTER delay + duration elapsed:
//   line-1 types 0.0 → 1.5s (complete)      → asserted at frame 60  (local 2.0s)
//   line-2 types 1.6 → 3.2s (complete)      → asserted at frame 105 (local 3.5s)
//   moves   pop 0.6 / slides to 2.0s local  → asserted at frame 180 (moves local 2.4s)
import { compile } from "@videoos/compiler";
import { createRenderer } from "@videoos/render-canvas";
import { describe, it, expect, frame, scene, createQaContext, runCollected } from "@videoos/qa";
import definition from "../src/video";

const result = compile(definition);
const ctx = createQaContext(result, createRenderer(result));

describe("typewriter", () => {
  it("does not start on a black frame (glow visible from frame 0)", () => {
    expect(frame(0)).not.toBeBlack();
  });

  it("has not typed the full first line at frame 0 (typewriter slices content)", () => {
    expect(frame(0)).not.toContainText("TYPE IS MOTION.");
  });

  it("shows the full first line after typing completes (frame 60 = local 2.0s > 1.5s)", () => {
    expect(frame(60)).toContainText("TYPE IS MOTION.");
  });

  it("shows the full second line after its delayed typing completes (frame 105 = local 3.5s > 3.2s)", () => {
    expect(frame(105)).toContainText("Every character lands on a beat.");
  });

  it("fits the rhythm (3.5-4.5 seconds)", () => {
    expect(scene("typewriter")).durationBetween(3.5, 4.5);
  });

  it("keeps the type-start beat", () => {
    expect(scene("typewriter")).toHaveBeat("type-start");
  });

  it("has no overflowing text", () => {
    expect(scene("typewriter")).noTextOverflow();
  });
});

describe("moves", () => {
  it("has all four motion labels", () => {
    expect(scene("moves")).toHaveLayers("pop", "up", "left", "right");
  });

  it("shows heading and all slide labels after the last slide settles (frame 180 = moves local 2.4s)", () => {
    expect(frame(180)).toContainText("FOUR WAYS TO MOVE");
    expect(frame(180)).toContainText("SLIDE UP");
    expect(frame(180)).toContainText("SLIDE LEFT");
    expect(frame(180)).toContainText("SLIDE RIGHT");
  });

  it("has no overflowing text", () => {
    expect(scene("moves")).noTextOverflow();
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
