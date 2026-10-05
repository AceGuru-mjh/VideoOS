---
name: data-dashboard
version: 0.1.0
description: Dashboard story - KPI big numbers count up via typewriter while a trend line draws from rotated rect segments, then one takeaway lands.
trigger: The user provides real metrics (KPIs, a series, growth numbers) and asks for a dashboard recap, metrics reel, growth story, or "numbers video" with more than one figure.
---

# Data Dashboard

Goal: a 10-15s 1920x1080 metrics story in three scenes: 2-3 KPI cards count up, one trend line draws itself from rotated rect segments, then ONE takeaway sentence. Every number comes from the user verbatim; the takeaway is arithmetic on the shown numbers, never a new claim. One chart per scene - for bar charts, switch to the data-motion skill.

## Workflow

1. Pin the data contract: 2-3 KPIs (label, value, delta), one series for the trend (4-6 points), the period, and the takeaway sentence. Numbers verbatim - rounding gets a "~" on screen or nothing.
2. Compute geometry before writing DSL: value -> pixels mapping in a comment (`1 step = 62px`), the trend segment angles from the point list, KPI card x positions from canvas width. `storyboard.plan { intent: "<product> · metrics story", durationSeconds: 13 }` - remap onto the three acts.
3. Write `src/video.ts` (Recipes): KPI numbers count up with `typewriter` + easeOutCubic (duration 1.2s for 4-6 chars); trend segments are thin rects ROTATED around their own centers (screen y grows downward, so rising data = negative rotation).
4. `compile.run` -> 0 errors; `check.overflow` (KPI values at 96px mono).
5. `render.preview` at a mid-draw frame FIRST (segment alignment is the genre's #1 visual bug - segments must meet at the points, no gaps or stubs), then the settled frames.
6. QA gates (below) -> `test.run` -> repair loop (<= maxRepairLoops, then `transaction.rollback`) -> `render.final`.

| Act | Window | Scene | Job | Dominant element |
| --- | --- | --- | --- | --- |
| KPIs | 0-5s | `kpis` | 2-3 numbers count up | the numbers, mono >= 96 |
| Trend | 5-10s | `trend` | line draws to the last point | the amber line |
| Takeaway | 10-13s | `takeaway` | one sentence the numbers prove | the sentence |

## Recipes

KPI cards - card fades, label slides, value TYPES in (easeOutCubic typewriter reads as a count-up), delta pops last:

```ts
v.scene("kpis", { duration: 5, background: "#0a0a12" }, (s) => {
  s.beat("cards", { at: 0.2, description: "Cards fade in as a row" });
  s.beat("count", { at: 0.6, description: "Numbers count up" });
  s.beat("deltas", { at: 2.2, description: "Deltas pop after the count completes" });
  const KPIS = [
    { label: "WEEKLY RENDERS", value: "12,847", delta: "+18%", x: 420 },
    { label: "P95 LATENCY", value: "410ms", delta: "-32%", x: 960 },
    { label: "ACTIVE TEAMS", value: "3,204", delta: "+9%", x: 1500 },
  ];
  for (const [i, k] of KPIS.entries()) {
    s.rect(`card-${i}`, { width: 380, height: 320, fill: "#12121f", radius: 16, at: { x: k.x, y: 520 },
      enter: { effect: "fade", duration: 0.4, delay: i * 0.15 } });
    s.text(`label-${i}`, k.label, { size: 28, weight: 700, letterSpacing: 2, color: "#8b8ba7",
      at: { x: k.x, y: 420 }, enter: { effect: "slide-up", duration: 0.4, delay: 0.2 + i * 0.15, params: { distance: 30 } } });
    s.text(`value-${i}`, k.value, { size: 96, weight: 800, font: "monospace", color: "#ffffff", at: { x: k.x, y: 520 },
      enter: { effect: "typewriter", duration: 1.2, delay: 0.6 + i * 0.2, easing: "easeOutCubic" } });
    s.text(`delta-${i}`, k.delta, { size: 40, weight: 700, color: "#f59e0b", at: { x: k.x, y: 640 },
      enter: { effect: "scale-pop", duration: 0.4, delay: 2.2 + i * 0.15, easing: "easeOutBack" } });
  }
});
```

Trend line - each segment is a thin rect centered on the midpoint of its two points, length = the distance, rotation = the segment angle (negative = rising); segments fade in left-to-right like the line is drawing:

```ts
v.scene("trend", { duration: 5 }, (s) => {
  s.beat("draw", { at: 0.3, description: "Line draws left to right, one segment every 0.25s" });
  s.beat("peak", { at: 2.6, description: "Final point pops with its value" });
  // value->pixel map: 1 week = 320px x, 100 units = ~65px y (invert for screen y)
  const P = [{ x: 300, y: 780 }, { x: 620, y: 700 }, { x: 940, y: 740 }, { x: 1260, y: 560 }, { x: 1580, y: 470 }];
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1];
    s.rect(`seg-${i}`, { width: Math.hypot(b.x - a.x, b.y - a.y), height: 10, fill: "#f59e0b", radius: 5,
      rotation: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI, // screen y grows DOWN: rising = negative
      at: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      enter: { effect: "fade", duration: 0.35, delay: 0.3 + i * 0.25 } });
  }
  s.ellipse("peak-dot", { width: 26, height: 26, fill: "#f59e0b", at: { x: 1580, y: 470 },
    enter: { effect: "scale-pop", duration: 0.4, delay: 2.4, easing: "easeOutBack" } });
  s.text("peak-value", "12.8k / wk", { size: 56, weight: 800, font: "monospace", color: "#ffffff",
    at: { x: 1400, y: 350 }, enter: { effect: "fade", duration: 0.4, delay: 2.8 } });
});
```

Takeaway - the sentence is arithmetic on the shown numbers, colored in two lines:

```ts
v.scene("takeaway", { duration: 3.5 }, (s) => {
  s.beat("story", { at: 0.2, description: "One sentence the numbers prove" });
  s.text("line-1", "Renders doubled", { size: 72, weight: 800, color: "#ffffff",
    at: { x: "50%", y: "44%" }, enter: { effect: "slide-up", duration: 0.5, params: { distance: 50 } } });
  s.text("line-2", "while latency fell by a third", { size: 72, weight: 800, color: "#f59e0b",
    at: { x: "50%", y: "56%" }, enter: { effect: "slide-up", duration: 0.5, delay: 0.35, params: { distance: 50 } } });
  s.camera("push-in", { from: 1.0, to: 1.04 });
});
```

## QA gates

- `expect(frame(75)).toContainText("12,847")` - count-up completes at 0.6 + 1.2 = 1.8s (frame >= 54); typewriter shows the full string only at duration end.
- `expect(scene("trend")).toHaveLayers("seg-0", "seg-1", "seg-2", "seg-3", "peak-dot")`.
- Spoiler: `expect(frame(180)).not.toContainText("12.8k")` (peak label settles at 5 + 2.8 + 0.4 = 8.2s global = frame 246) then `expect(frame(255)).toContainText("12.8k")`.
- `expect(scene("kpis")).durationBetween(4, 6)`; `noTextOverflow()` on all three scenes.
- Takeaway honesty gate by hand: every claim in the sentence must be derivable from the shown KPIs - if a number appears only in the sentence, cut it.

## Anti-patterns

- Inventing or "smoothing" metrics - values verbatim from the user; "~12.8k" only when the exact figure is also shown once.
- 4+ KPI cards - three is the story limit; five is a spreadsheet.
- Segments without the mid-dwell `render.preview` - rotation happens around each segment's CENTER, so a wrong midpoint or length opens visible gaps at the joints.
- Line AND bars AND deltas in one scene - one visualization per scene; deltas live on the KPI cards.
- A trend with no endpoints labeled - if the line implies magnitude, label the first and last points.
- No takeaway scene - numbers without a sentence are a screensaver, not a story.
