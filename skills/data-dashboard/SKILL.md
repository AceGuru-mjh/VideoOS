---
name: data-dashboard
version: 0.1.0
description: Dashboard-narrative pacing: hero KPI count-up, 2x1 metric pair, stair-step trend with arrow and conclusion sentence - pacing, not chart drawing.
trigger: The user asks for a metrics or KPI recap, a dashboard walkthrough, or a quarterly-numbers video with a beginning, a middle, and a conclusion.
---

# Data Dashboard

Goal: a 12-20s (1920x1080, 30fps) numbers story in three moves: one hero KPI counts up, a 2x1 pair contrasts, a stair-step trend resolves into a conclusion sentence. Division of labor: **data-motion** owns how to draw a chart (bars, masks, axes, easing semantics) - this skill owns the dashboard's narrative rhythm: which number lands first, how long it counts, when the trend turns into a sentence. Every number is user-supplied.

## Workflow

1. Collect the story spine: the hero metric (the one number that matters), the pair it contrasts (growth vs cost, volume vs latency), and the trend's 5-7 steps plus a one-line conclusion. Anything missing -> ask; no invented metrics (same rule as product-demo).
2. `storyboard.plan { intent: "dashboard · <period> recap", durationSeconds }` -> remap to hero -> duo -> trend; three scenes, one question each.
3. Write `src/video.ts` (Recipes): numbers in `font: "monospace"` (typed digits jitter horizontally in proportional fonts), labels in the default sans.
4. `compile.run` -> 0 errors -> `check.overflow` - the conclusion sentence is the overflow-est string in this genre.
5. `render.preview` at three moments: hero mid-count (digits must not wobble vertically), duo after the second card lands, trend after the arrow pops.
6. QA gates (below) -> `test.run` -> repair loop <= 3, then `render.final` with the conclusion sentence quoted back.

Number + label timing contract (every KPI block, scene-local):

| Layer | at | effect | duration | settled by |
| --- | --- | --- | --- | --- |
| label | 0.2s | `fade` | 0.5 | 0.7s |
| number | 0.4s | `typewriter` (easeOutCubic) | 1.0-1.4s (proportional to digits) | 1.8s |
| delta chip | 2.0s | `scale-pop` (easeOutBack) | 0.4 | 2.4s |
| hold | - | - | - | >= 0.8s before scene end |

Count-up duration: <= 3 digits 1.0s, 4-5 digits 1.2s, 6+ 1.4s. Longer reads as a slot machine, shorter as a flash.

## Recipes

Hero KPI - one number owns the screen; the glow ellipse (no enter) gives frame-0 ink:

```ts
v.scene("hero", { duration: 4.2, background: "#0a0a12" }, (s) => {
  s.beat("hero-open", { at: 0.2, description: "Label readable by 1s" });
  s.ellipse("glow", { width: 1100, height: 520, fill: "#22d3ee", opacity: 0.12, blur: 150,
    at: { x: "50%", y: "44%" } });
  s.text("label", "WEEKLY RENDERS", { size: 40, weight: 700, letterSpacing: 5, color: "#94a3b8",
    at: { x: "50%", y: "30%" }, enter: { effect: "fade", duration: 0.5, delay: 0.2 } });
  s.text("value", "12,847", { size: 170, weight: 800, font: "monospace", color: "#f8fafc",
    at: { x: "50%", y: "46%" }, enter: { effect: "typewriter", duration: 1.4, delay: 0.4, easing: "easeOutCubic" } });
  s.text("delta", "+38% vs last quarter", { size: 34, weight: 600, color: "#22c55e",
    at: { x: "50%", y: "62%" }, enter: { effect: "scale-pop", duration: 0.4, delay: 2.0, easing: "easeOutBack" } });
  s.camera("push-in", { from: 1.0, to: 1.05 });
});
```

Duo - 2x1 cards, never 2x2: the pairing IS the message, so one screen holds exactly one contrast:

```ts
const KPIS = [
  { x: "29%", label: "WEEKLY RENDERS", value: "12,847", delta: "+38%", tone: "good" },
  { x: "71%", label: "P95 PREVIEW TIME", value: "1.9s", delta: "-44%", tone: "good" },
];
v.scene("duo", { duration: 4.6, background: "#0a0a12" }, (s) => {
  s.beat("card-1", { at: 0.15 }); s.beat("card-2", { at: 0.6 });
  for (const [i, k] of KPIS.entries()) {
    const d = 0.15 + i * 0.45;                          // pair stagger, not a wall
    s.rect(`card-${i + 1}`, { width: 560, height: 460, fill: "#12121f", radius: 16,
      at: { x: k.x, y: "52%" },
      enter: { effect: "slide-up", duration: 0.5, delay: d, easing: "easeOutCubic", params: { distance: 60 } } });
    s.text(`label-${i + 1}`, k.label, { size: 30, weight: 700, letterSpacing: 3, color: "#94a3b8",
      at: { x: k.x, y: "36%" }, enter: { effect: "fade", duration: 0.4, delay: d + 0.2 } });
    s.text(`value-${i + 1}`, k.value, { size: 104, weight: 800, font: "monospace", color: "#f8fafc",
      at: { x: k.x, y: "50%" }, enter: { effect: "typewriter", duration: 1.2, delay: d + 0.35, easing: "easeOutCubic" } });
    s.text(`delta-${i + 1}`, k.delta, { size: 32, weight: 600, color: k.tone === "good" ? "#22c55e" : "#f59e0b",
      at: { x: k.x, y: "64%" }, enter: { effect: "fade", duration: 0.35, delay: d + 1.8 } });
  }
});
```

Trend - stair-step segments grow 0.3s apart (the data-motion slide-up-plus-mask trick, rotated into a staircase), then the arrow and conclusion land last:

```ts
const STEPS = [120, 180, 170, 260, 330, 420];   // height = round(value * 3) - keep the mapping in a comment
const BASELINE = 640, STEP_W = 150, GAP = 20;
v.scene("trend", { duration: 5.6, background: "#0a0a12" }, (s) => {
  s.beat("trend-start", { at: 0.3, description: "Staircase grows left to right" });
  for (const [i, h] of STEPS.entries()) {
    const x = 340 + i * (STEP_W + GAP) + STEP_W / 2;
    s.rect(`step-${i + 1}`, { width: STEP_W, height: h, fill: i === STEPS.length - 1 ? "#f59e0b" : "#38bdf8",
      radius: 4, at: { x, y: BASELINE - h / 2 },
      enter: { effect: "slide-up", duration: 0.55, delay: 0.3 + i * 0.3, easing: "easeOutCubic", params: { distance: h } } });
  }
  s.rect("mask", { width: 1920, height: 200, fill: "#0a0a12", at: { x: 960, y: BASELINE + 100 } });  // hides below baseline
  s.rect("arrow-shaft", { width: 110, height: 6, fill: "#f59e0b", radius: 3,
    at: { x: 1445, y: 170 }, enter: { effect: "wipe", duration: 0.35, delay: 2.5 } });
  s.rect("arrow-head", { width: 24, height: 24, fill: "#f59e0b", rotation: 45,
    at: { x: 1500, y: 170 }, enter: { effect: "fade", duration: 0.2, delay: 2.8 } });
  s.text("conclusion", "Costs down 38% while volume doubled", { size: 52, weight: 700, color: "#f8fafc",
    at: { x: "50%", y: "78%" }, enter: { effect: "blur-in", duration: 0.5, delay: 3.2 } });
});
```

The last step finishes at 0.3 + 5 x 0.3 + 0.55 = 2.35s, the conclusion settles at 3.7s - the remaining 1.9s is the reading hold. Join scenes with `v.transition("crossfade", { duration: 0.4, between: ["hero", "duo"] })` etc.

## QA gates

- `expect(frame(0)).not.toBeBlack()` (hero glow) and `expect(frame(30)).toContainText("WEEKLY RENDERS")` - the 1s hook; the number settles by 1.8s.
- `expect(frame(HERO_SETTLED)).toContainText("12,847")` with HERO_SETTLED >= 0.4 + 1.4 = 1.8s scene-local, and the typed string equals the source number character for character.
- Duo: both values at >= 0.95 + 1.2 = 2.15s scene-local; `toHaveLayers("card-1", "card-2", "value-1", "value-2")`.
- Trend: `toHaveLayers("step-1", "step-6", "mask", "arrow-head", "conclusion")`; conclusion text at >= 3.7s scene-local.
- `noTextOverflow()` on every scene; `durationBetween`: hero 3.5-5, duo 4-5.5, trend 4.5-6.5, total 12-20.
- Muted rule: deltas carry their sign, colors the tone - the story reads with sound off.

## Anti-patterns

- 2x2 (or 3x3) KPI grids - four simultaneous count-ups means zero focus; if four metrics matter, run two 2x1 duos in sequence.
- A trend without a conclusion - a staircase that ends in nothing is a screensaver; the sentence is the point (and a QA gate).
- Coming here for chart craft - bar masks, axes, and easing-to-semantics tables live in data-motion; use that skill to build the chart, this one to sequence the story.
- Proportional fonts for count-ups - typed digits shift horizontally as glyph widths vary; monospace only.
- Deltas in color only - the sign carries the meaning (color-blind viewers, muted autoplay); green/amber is the second channel, never the only one.
- Slot-machine count-ups (3s+) or 0.4s flashes - respect the duration table; every number finishes before its scene's final 0.8s.
