---
name: visual-qa
version: 0.1.0
description: Write and repair visual QA suites for a VideoOS project — semantic-first assertions, golden thresholds, and the transactional repair loop.
trigger: You are about to edit a video project and must prove the edit didn't regress anything, or the user asks for "tests", "QA", "make it verifiable", "golden images", or a QA report for a video.
---

# Visual QA

Goal: a suite in `tests/video.test.ts` that fails with *actionable detail* when a video regresses, and passes deterministically forever after. QA is what makes agent editing safe — never ship a video edit without it.

## Workflow

1. Read the current world model: `compile.run` → `compile.vir` (scenes, beats, layers, timing) — the suite addresses these names.
2. Draft the suite **semantic-first** (zero render, zero flake): `toHaveLayers`, `toHaveBeat`, `durationBetween`, `noTextOverflow`, `toContainText`. Only then add pixel assertions (`not.toBeBlack`, `toHaveAverageBrightnessBetween`), and last goldens.
3. Compute frames from the timeline, not vibes: `frame = round((sceneStart + local) × fps)` where `sceneStart` subtracts crossfade overlaps. Put the math in a comment beside each assertion.
4. `transaction.begin { description: "extend QA suite" }` before editing shared files (the suite itself is snapshotted too).
5. Run: `test.run` → parse `data.allPassed` and each failure's `details`.
6. Repair (see Failure→fix table); re-run to green. `transaction.commit`.
7. Goldens, if used: `videoos test --update-golden` (or QA option `updateGolden: true`), **review the PNGs by eye**, commit them to git.
8. In CI: `videoos test` exit code (or the bun:test wrapper under `bun test`) gates the pipeline; render smoke tests need ffmpeg, pure QA does not.

## Recipes

Suite skeleton (dual-mode: `videoos test` AND `bun test`):

```ts
import { compile } from "@videoos/compiler";
import { createRenderer } from "@videoos/render-canvas";
import { describe, it, expect, frame, scene, createQaContext, runCollected } from "@videoos/qa";
import definition from "../src/video";

const result = compile(definition);
const ctx = createQaContext(result, createRenderer(result));

describe("intro", () => {
  it("shows the title after its entrance completes (frame 30 = local 1.0s > 0.8s)", () => {
    expect(frame(30)).toContainText("Hello VideoOS");
  });
  it("never shows the v2 spoiler before the reveal beat", () => {
    expect(frame(45)).not.toContainText("VideoOS v2");
  });
  it("holds the approved look", () => {
    expect(frame(60)).toMatchGolden("intro-60", { threshold: 0.98 });
  });
});

try {
  const { test } = await import("bun:test");
  test("video qa suite", async () => {
    const report = await runCollected(ctx);
    if (report.totalFailed > 0) throw new Error(JSON.stringify(report.suites, null, 2));
  });
} catch { /* videoos test mode: runner executes the collector */ }
```

Threshold strategy:

| Assertion | Default | Tighten to | Loosen to |
| --- | --- | --- | --- |
| `toMatchGolden` | `0.98` | `0.999` for cache-determinism checks ("byte-stable re-render") | `0.9` only for scenes with legally-similar content |
| `toBeBlack` | `0.98` | `1` for exact fade-to-black midpoints | `0.95` if grain/noise is expected |
| `toBeSimilarTo` | `0.98` | `0.999` for static holds | — |
| brightness | custom range | ±5 around observed value | — |

Semantic-first strategy in one line each:

- `toContainText` — copy correctness + entrance completion (post-typewriter slice!). Cost: zero render.
- `not.toContainText` — sequencing claims (typed prefix, spoiler suppression, exit windows).
- `toHaveLayers` / `toHaveBeat` — structure survived a refactor; localizes bugs to the DSL.
- `durationBetween` — pacing contracts (act lengths, hold times).
- `noTextOverflow` — real-font measurement; trusts over compile heuristics.
- `not.toBeBlack` — "has ink" (needs >2% non-dark samples — one thin line is not enough).
- `toHaveAverageBrightnessBetween` — mood envelopes (night scenes, flash frames).

## QA gates (for the suite itself)

- Every `toContainText` frame sits strictly after `in + delay + duration` of the target layer and before its `out` — write the inequality in the test name or comment.
- At least one structural assertion per scene (layers + a beat) and one duration contract per scene.
- At least one `not.toBeBlack()` on the opening frame of each scene that claims visible content.
- Golden names carry scene+frame (`intro-60.png`) and live in `tests/golden/` (committed).
- The suite runs green twice in a row from a clean checkout (no `--update-golden` needed on CI) — if it can't, it's flaky, fix it before merging.

## Failure → fix table

| `details` field | Meaning | Fix |
| --- | --- | --- |
| `visibleTexts: [...]` | what WAS on screen | typo in content; wrong frame (before entrance completes); layer opacity ≤ 0.05 |
| `overflows: [{ measuredWidth, limit }]` | real-font width over the bound | reduce `size`, shorten copy, or set `maxWidth` |
| `similarity` < `threshold` + `diff` path | golden pixel mismatch | intended → `--update-golden` + visual review; unintended → open the diff PNG (red = changed), find the layer |
| `missing: [...]` from `toHaveLayers` | layer gone/renamed | restore the layer or update the assertion — decide which, don't auto-delete assertions |
| `darkRatio ≥ 0.98` | frame is (nearly) black | static ink missing at frame 0 (decoration with no `enter`), or assert a later frame |
| `duration` outside `[min, max]` | scene length drifted | re-pin the pacing or restore the duration — never widen the range silently |
| `hint: "re-run with updateGolden"` | golden file absent | first run on this machine → generate with `--update-golden`, review, commit |

## The repair loop with rollback

```text
transaction.begin "fix intro regression"
  → edit (scene.modify / layer.modify / rewrite entry / edit the test if the CONTRACT was wrong)
  → compile.run            # 0 errors required
  → test.run               # read details, apply table above
  → green: transaction.commit → optional render.final
  → red after N tries (manifest agent.maxRepairLoops): transaction.rollback — files return to snapshot; report what you tried
```

Rules: fix the video or fix the assertion — but never delete an assertion just to go green; deleting a gate requires a stated reason in the commit/report. If `test.run` itself errors (`TEST_RUN_FAILED`), the test file threw at import (syntax / bad import path) — check the file, not the video.

## Anti-patterns

- Asserting full text mid-`typewriter` (only the typed prefix exists — `ceil(len·e)` chars).
- `toContainText` during a `blur-up`/`fade` ramp (opacity < 0.05 → invisible to the assertion).
- Goldens on every frame — assert settled keyframes only; goldens ∞ frames = slow CI and merge conflicts.
- Regenerating goldens to "fix" failures without eyeballing the new PNGs — that's how regressions ship.
- Time-based assertions (`Date.now`-style) or frames computed by running code — compute from the timeline literals; the suite must be deterministic like the render.
- One giant `it("everything works")` — the report then says nothing; one claim per `it`, named after the claim.
