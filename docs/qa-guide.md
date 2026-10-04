# Visual QA Guide

> How to test videos like code: the `@videoos/qa` assertion cookbook, the golden-image workflow, repair-friendly failure details, and running suites in CI.

Videos get unit tests. A suite is a plain TS file under `tests/` that compiles the DSL entry and asserts against **frames** (pixels + semantics) and **scenes** (structure). Semantic assertions cost zero rendering; pixel assertions render through the same canvas backend and content-addressed cache as final renders.

## 1. The shape of a suite

```ts
// tests/video.test.ts
import { compile } from "@videoos/compiler";
import { createRenderer } from "@videoos/render-canvas";
import { describe, it, expect, frame, scene, createQaContext, runCollected } from "@videoos/qa";
import definition from "../src/video";

const result = compile(definition);
const ctx = createQaContext(result, createRenderer(result));

describe("intro", () => {
  it("shows the title after 1 second", () => {
    expect(frame(30)).toContainText("Hello VideoOS");
  });
  it("does not start on a black frame", () => {
    expect(frame(0)).not.toBeBlack();
  });
});

// bun:test wrapper — makes the SAME file runnable under `bun test`:
try {
  const { test } = await import("bun:test");
  test("video qa suite", async () => {
    const report = await runCollected(ctx);
    if (report.totalFailed > 0) throw new Error(JSON.stringify(report.suites, null, 2));
  });
} catch {
  // under `videoos test` there is no bun runner: assertions stay in the
  // collector and the QA runner executes them instead.
}
```

Two modes, one file:

| Mode | Command | Who executes assertions |
| --- | --- | --- |
| CLI / VAP / Studio | `videoos test` · `test.run` · Tests panel | QA runner (`runCollected` over the collector) |
| bun | `bun test tests/` | the `bun:test` wrapper calling `runCollected(ctx)` |

Rules of thumb:

- `frame(n)` is a **global** frame number (0-based, clamped to `[0, totalFrames−1]`).
- `scene(name)` accepts the scene **name or id**.
- Assertions throw `QaAssertionError` with structured `details`; the runner captures them into the report.

## 2. Frame assertion cookbook

All subjects: `expect(frame(n))` — [`packages/qa/src/assertions.ts`](../packages/qa/src/assertions.ts) is the source of truth.

### `toContainText(text)` — semantic, zero rendering

Passes when any `draw-text` command at that frame has `opacity > 0.05` and `content.includes(text)`. The `content` is the **post-typewriter slice**, so mid-animation only the typed prefix matches.

```ts
it("title visible at 1s", () => expect(frame(30)).toContainText("Hello VideoOS"));
```

Use it for: copy correctness, entrance completion, reading order. Failure details include `visibleTexts` (layerId + content + opacity of everything visible) — usually enough to fix without opening an image.

**Timing rule**: assert the full string only at `sceneStart + in + delay + duration + ε`. For `typewriter`, the full string exists only after the animation completes (`ceil(len · e) < len` before that).

### `not.toContainText(text)`

```ts
it("no spoiler before the reveal", () => expect(frame(45)).not.toContainText("VideoOS v2"));
```

Great for pinning typewriter mid-typing behavior and for "gone after exit" checks (mind the `[in, out)` window — at `localT ≥ out` the layer isn't drawn at all).

### `toBeBlack(threshold = 0.98)` / `not.toBeBlack(threshold)`

Samples a 16px grid; a pixel is "dark" when r, g **and** b are all `< 16`. `toBeBlack` passes when ≥ `threshold` of samples are dark.

```ts
it("fade-black transition midpoint is dark", () => expect(frame(60)).toBeBlack());
it("opens on ink, not black", () => expect(frame(0)).not.toBeBlack());
```

Gotcha: a dark-blue background like `#0a0a12` is *not* "black" by this definition (b = 18 ≥ 16), but **`not.toBeBlack` needs > 2% non-dark samples** — one thin line is not enough; use a glow/decoration or assert a later frame.

### `toBeBlank()` / `not.toBeBlank()`

"Blank" = ≥ 98% of sampled pixels are within ±3 per channel of the frame's **background** color (transparent pixels count as blank). Use it to detect empty/missing layers on colored backgrounds where `toBeBlack` is meaningless.

### `toMatchGolden(name, { threshold = 0.98 })`

Pixel regression against `tests/golden/<name>.png` (default `goldenDir`; subdirectories auto-create).

```ts
it("matches the approved look", () => expect(frame(60)).toMatchGolden("intro-60", { threshold: 0.98 }));
```

See [§4 The golden workflow](#4-the-golden-workflow).

### `toBeSimilarTo(otherFrame, { threshold = 0.98 })`

Compares two frames of the **same video** — perfect for "static hold" checks (e.g. a pause scene shouldn't change):

```ts
it("hold frames are identical", () => expect(frame(150)).toBeSimilarTo(160, { threshold: 0.999 }));
```

### `toHaveAverageBrightnessBetween(min, max)`

Rec.601 luma average over all pixels, closed interval `[min, max]` (0–255). Use for mood/contrast envelopes ("night scene stays below 40", "flash frame above 200"):

```ts
it("stays moody", () => expect(frame(90)).toHaveAverageBrightnessBetween(0, 40));
```

## 3. Scene assertion cookbook

All subjects: `expect(scene(name))` — pure VIR reads, zero rendering.

| Assertion | Passes when | Failure details |
| --- | --- | --- |
| `durationBetween(min, max)` | scene duration (s) in the closed range | `duration`, `min`, `max` |
| `noTextOverflow()` | every text layer's **measured** width (real font metrics incl. `letterSpacing`) ≤ `maxWidth ?? width − 32` | `overflows: [{ layer, content, measuredWidth, limit }]` |
| `toHaveBeat(name)` | the beat exists | `beats` (all names) |
| `toHaveLayers(...names)` | all named layers exist | `missing`, `layers` |

```ts
expect(scene("features")).toHaveLayers("heading", "item-1", "item-2", "item-3");
expect(scene("intro")).toHaveBeat("title-enter");
expect(scene("intro")).durationBetween(3, 5);
expect(scene("intro")).noTextOverflow();
```

`noTextOverflow` is the cheap cousin of compile diagnostics — it uses real `measureText`, not the `chars × size × 0.62` heuristic, so trust it over `OVERFLOW_RISK`.

## 4. The golden workflow

Goldens are PNG baselines in `tests/golden/`. The comparison:

- similarity = fraction of pixels whose **all four channels** differ by ≤ 6 (tolerance `PIXEL_TOLERANCE`);
- pass when `similarity ≥ threshold` (default `0.98`);
- on mismatch: a red/white diff image is written next to the golden as `<name>.diff.png` (changed pixels red, unchanged translucent white) and the failure details carry `similarity`, `threshold`, `golden`, `diff`, `width`, `height`.

Generate / refresh:

```bash
videoos test --update-golden    # missing or mismatching goldens are (re)written and PASS
```

`--update-golden` only rewrites when the golden is **missing or fails**; passing goldens are left alone. Programmatic equivalent: `createQaContext(result, renderer, { updateGolden: true, goldenDir: "tests/golden" })`.

Golden discipline:

1. First run on a fresh project: `--update-golden`, then **review the PNGs** (they are the spec now) before committing.
2. Commit goldens to git — they are the regression contract.
3. When a render-behavior change is *intended*, re-run `--update-golden` and the diff in the PR is the visual review.
4. Pick thresholds per assertion: `0.98` default; `0.999+` for "must be identical" (e.g. cached re-render sanity); lower (e.g. `0.9`) only for scenes with intentional subpixel-adjacent motion.
5. Assert **settled** frames (after all enter/exit animations complete) unless you explicitly want the transition itself pinned.

## 5. Writing repair-friendly failures

QA reports are consumed by humans *and* agents (`test.run` returns the full report; Studio's Tests panel renders it). Make failures self-describing:

| Do | Why |
| --- | --- |
| One assertion per `it()`, name says the expectation | the report lists names first; "shows the CTA after both fades complete (frame 285 = cta local 1.5s)" beats "cta ok" |
| Prefer `toContainText` with the exact user-visible string | failure details show `visibleTexts` → the fix (typo? delay? wrong scene?) is usually obvious |
| Keep frame math in comments next to assertions | reviewers can re-derive `frame(180) = features.start 3.5s + local 2.5s` |
| Assert structure too (`toHaveLayers`, `toHaveBeat`) | structural failures localize the bug to the DSL, not the pixels |
| Use `not.toContainText` for sequencing claims | proves typing/reveal ordering, not just eventual visibility |

The runner's `QaReport` shape (also returned by VAP `test.run`):

```jsonc
{
  "totalPassed": 11, "totalFailed": 1, "durationMs": 812, "virHash": "…",
  "suites": [{
    "suite": "intro", "passed": 2, "failed": 1, "skipped": 0, "durationMs": 780,
    "results": [
      { "name": "title visible at 1s", "status": "fail",
        "message": "Frame 30 does not contain visible text \"Hello VideoOS\"",
        "details": { "assertion": "toContainText", "frame": 30,
                     "visibleTexts": [{ "layerId": "layer_intro_title", "content": "Hello Video", "opacity": 1 }] } }
    ]
  }]
}
```

`details` is the repair loop's fuel: `visibleTexts` (toContainText), `overflows` (noTextOverflow), `similarity`/`diff` (goldens), `missing` (toHaveLayers).

## 6. Running in CI

`videoos test` exits non-zero when any assertion fails, so CI is a one-liner. Reference job (GitHub Actions):

```yaml
jobs:
  qa:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: sudo apt-get update && sudo apt-get install -y ffmpeg   # only needed for render smoke tests
      - run: bun install
      - run: bunx tsc -p tsconfig.json --noEmit
      - run: bun test                    # suites via the bun:test wrapper
      # or, per project:
      # - run: cd examples/product-promo && videoos test
```

Notes:

- Pure QA (semantic + black/blank/brightness) needs **no ffmpeg**; only `render`-based smoke tests do.
- Frames render deterministically per platform+fonts; if CI fonts differ from your machine, golden thresholds may need slack, or pin fonts via `assets/fonts/` (recommended — see [DSL reference §12](./dsl-reference.md#12-fonts)).
- Long videos: QA renders only asserted frames (LRU-cached), so suite cost ∝ asserted frames, not duration.

## 7. Frame math cheat sheet

`frame(n)` is global. To target scene-local time:

```
sceneStart[i] = sceneStart[i-1] + duration[i-1] − transitionOverlap(i-1 → i)
globalFrame   = round((sceneStart + localSeconds) × fps)
```

`transitionOverlap` is the `crossfade`/`fade-black` duration (0 for `cut` or undeclared pairs). Or skip the arithmetic entirely — query beats semantically: `render.preview { scene, beat }`, `compile.vir`, or `inspect.frame` all resolve names to frames for you (see the [MCP guide](./mcp-guide.md)).

Golden rule: **every `toContainText` frame must sit after `in + delay + duration` of the target text layer** (and before its `out`).
