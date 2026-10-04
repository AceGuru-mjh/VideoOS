// Visual QA suite for product-promo (dual-mode: `videoos test` and `bun test`).
// - `videoos test` / VAP test.run: assertions are collected by @videoos/qa and executed
//   by the session runner (the bun:test wrapper below degrades gracefully).
// - `bun test tests/`: the wrapper runs the collected assertions via runCollected.
//
// Frame math (fps 30): title [0,120) · features [105,255) · cta [240,330)
// Every toContainText frame is chosen AFTER the text's enter animation completes:
//   title    blur-up done at local 0.8s  → asserted at frame 30  (local 1.0s)
//   subtitle fade    done at local 1.0s  → asserted at frame 36  (local 1.2s)
//   items    slide   done at local 2.1s  → asserted at frame 180 (features local 2.5s)
//   cta/url  fade    done at local 1.4s  → asserted at frame 285 (cta local 1.5s)
import { compile } from "@videoos/compiler";
import { createRenderer } from "@videoos/render-canvas";
import { describe, it, expect, frame, scene, createQaContext, runCollected } from "@videoos/qa";
import definition from "../src/video";

const result = compile(definition);
const ctx = createQaContext(result, createRenderer(result));

describe("title-card", () => {
  it("does not start on a black frame (glow is already visible)", () => {
    expect(frame(0)).not.toBeBlack();
  });

  it("shows the main title after 1 second", () => {
    expect(frame(30)).toContainText("SHIP VIDEO");
  });

  it("shows the subtitle once its fade completes", () => {
    expect(frame(36)).toContainText("The agent-native video runtime");
  });
});

describe("features", () => {
  it("has the kinetic list layers", () => {
    expect(scene("features")).toHaveLayers("heading", "accent", "item-1", "item-2", "item-3");
  });

  it("keeps the beat grid (second item lands on its beat)", () => {
    expect(scene("features")).toHaveBeat("item-two");
  });

  it("fits the rhythm (4-6 seconds)", () => {
    expect(scene("features")).durationBetween(4, 6);
  });

  it("shows heading and all three items after the last slide completes (frame 180 = features local 2.5s)", () => {
    expect(frame(180)).toContainText("BUILT FOR AGENTS");
    expect(frame(180)).toContainText("01 · Deterministic pipeline");
    expect(frame(180)).toContainText("02 · Visual QA on every frame");
    expect(frame(180)).toContainText("03 · Rollback-safe agent edits");
  });

  it("has no overflowing text", () => {
    expect(scene("features")).noTextOverflow();
  });
});

describe("cta", () => {
  it("fits the rhythm (2-4 seconds)", () => {
    expect(scene("cta")).durationBetween(2, 4);
  });

  it("shows CTA and repo URL after both fades complete (frame 285 = cta local 1.5s)", () => {
    expect(frame(285)).toContainText("Start shipping today");
    expect(frame(285)).toContainText("github.com/AceGuru-mjh/VideoOS");
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
