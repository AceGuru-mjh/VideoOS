---
name: data-motion
version: 0.1.0
description: Build animated charts (bars, axes, value labels, count-ups) from primitive rect/text layers — no chart library.
trigger: The user asks to visualize numbers in motion — bar charts, comparisons, counters, "data story", metrics over time, survey results as animation.
---

# Data Motion

Goal: honest, readable animated charts. VideoOS has no chart primitive — charts are `rect` layers you compose, which is the point: every bar is addressable by name (`scene.inspect`, `layer.modify`) and assertable in QA.

## Workflow

1. Pin the data contract first: series (labels + values), unit, and the ONE takeaway sentence. One chart per scene, one takeaway scene after it.
2. Compute geometry in the DSL file (or in your head) — value → pixel mapping must be explicit and round: `height = round(value × scale)`, baseline Y, bar width/gap from canvas size. Keep the mapping in a comment.
3. Write the chart scene: bars first (order matters — painter's order), then the background-colored **mask** below the baseline, then the axis, then labels (see Recipes).
4. `compile.run` → `check.overflow` → 0 errors / 0 violations.
5. `render.preview` at the settled frame (after the last enter completes) and at one mid-growth frame — verify bars rise FROM the axis, not slide across it.
6. QA gates (below) → `test.run` → repair until green → `render.final`.

## Recipes

**Bar growth** (the core trick): a bar's final center sits on the baseline; `slide-up` with `params.distance = bar height` starts it fully below the baseline; a mask rect (declared AFTER the bars) painted in the background color hides everything below the baseline — so the visible bar grows `0 → h`:

```ts
const BASELINE = 560; // canvas 1280×720
const BARS = [
  { name: "bar-1", value: "3.2", height: 154, x: 260, fill: "#6366f1", easing: "linear",       delay: 0.15 },
  { name: "bar-2", value: "5.8", height: 278, x: 500, fill: "#22d3ee", easing: "easeOutCubic", delay: 0.35 },
  { name: "bar-3", value: "4.4", height: 211, x: 740, fill: "#a78bfa", easing: "easeOutExpo",  delay: 0.55 },
  { name: "bar-4", value: "7.6", height: 365, x: 980, fill: "#f59e0b", easing: "bounce",       delay: 0.75 },
]; // height = round(value × 48)

for (const bar of BARS) {
  s.rect(bar.name, {
    width: 120, height: bar.height, fill: bar.fill, radius: 6,
    at: { x: bar.x, y: BASELINE - bar.height / 2 },           // final center on the baseline
    enter: { effect: "slide-up", duration: 1.8, delay: bar.delay, easing: bar.easing,
             params: { distance: bar.height } },               // distance = own height
  });
}

// mask below the baseline — MUST be declared after the bars it hides
s.rect("mask", { width: 1280, height: 160, fill: "#0a0a12", at: { x: 640, y: 640 } });

// axis on top of the mask
s.rect("axis", { width: 960, height: 3, fill: "#8b8ba7", opacity: 0.7, radius: 1.5, at: { x: 640, y: BASELINE } });
```

Growth timing = the enter window (`in + delay → +duration`). Mapping easing to data semantics:

| Easing | Reads as | Use for |
| --- | --- | --- |
| `linear` | steady accumulation | time series, totals |
| `easeOutCubic` | quick claim, gentle settle | most comparisons |
| `easeOutExpo` | explosive leader | the standout bar |
| `easeOutBack` | overshoot + settle | playful single highlights (never for precise comparisons) |
| `bounce` | ball-drop landing | the punchline bar; never exceeds target value, safe for growth |

Value labels fade in above each bar AFTER its bar finishes (`delay ≥ bar.delay + duration`), then axis labels below (declared after the mask so they draw on top):

```ts
s.text("value-1", "3.2", { size: 38, weight: 700, color: "#e2e8f0",
  at: { x: BARS[0].x, y: BASELINE - BARS[0].height - 44 },
  enter: { effect: "fade", duration: 0.5, delay: 2.0 } });
s.text("day-1", "MON", { size: 26, color: "#8b8ba7", at: { x: BARS[0].x, y: 608 },
  enter: { effect: "fade", duration: 0.4, delay: 2.6 } });
```

Count-up numbers: render the FINAL value with `typewriter` (`easeOutCubic`, duration ∝ digits, e.g. 1.0–1.4s) — the typed reveal reads as a count-up without per-frame text. For an axis-style count-up, type the label then the number in one string: `"12,847 frames"`.

```ts
s.text("metric", "12,847 frames", { size: 96, weight: 800, color: "#ffffff", font: "monospace",
  at: { x: "50%", y: "40%" }, enter: { effect: "typewriter", duration: 1.2, easing: "easeOutCubic" } });
```

Grid lines (optional): thin low-opacity rects at value ticks (`opacity: 0.15`, `fill: "#8b8ba7"`), declared BEFORE the bars so bars paint over them.

Accessibility of motion: keep total growth ≤ 2s per bar; stagger rather than launching everything simultaneously (sequential comprehension beats simultaneous spectacle); bars ≥ 100px wide at 720p; don't encode meaning in color alone — value labels are the accessibility path; avoid `easeOutBack` overshoot on negative-data framing (it reads as "exceeding the bad number").

## QA gates

```ts
expect(scene("chart")).toHaveLayers("bar-1", "bar-2", "bar-3", "bar-4"); // bars exist (rect layers)
expect(scene("chart")).toHaveLayers("mask", "axis", "value-1", "value-4");
expect(scene("chart")).toHaveBeat("bars-grow");
expect(scene("chart")).durationBetween(5, 8);           // growth + reading hold
expect(frame(SETTLED)).not.toBeBlack();                 // SETTLED > last delay + duration
expect(frame(SETTLED)).toContainText("7.6");            // final values, after label fades complete
expect(frame(SETTLED)).toContainText("RENDER HOURS…");  // title present
expect(scene("chart")).noTextOverflow();
expect(frame(TAKEAWAY_SETTLED)).toContainText("<takeaway sentence>"); // takeaway visible at end
```

`SETTLED` = global frame for chart-local time > max(bar.delay + 1.8, label.delay + 0.5) — for the recipe above, local ≥ 3.5s.

## Anti-patterns

- Forgetting the mask → bars visibly slide from below the frame instead of growing from the axis.
- Declaring the mask BEFORE the bars → mask hidden under bars, the trick silently breaks (painter's order).
- Negative values with this pattern — v1 has no below-baseline charts; rebase to zero or use a "delta" scene instead.
- Asserting value labels at a frame before their fade completes (`opacity ≤ 0.05` → invisible to `toContainText`).
- Truncated axes without labeling them — the chart must be honest; if the baseline isn't 0, say so on screen.
- Bars with identical easing and no stagger — reads as one block; stagger delays 0.15–0.3s and vary easings deliberately.
- Count-up via many text layers toggling `in`/`out` — one `typewriter` layer is cheaper, deterministic, and QA-friendly.
