---
name: year-review
version: 0.1.0
description: Recap a year as a data big-screen — giant count-up stats, a month timeline strip, and a best-moments card carousel.
trigger: The user asks for a year in review, annual recap, wrapped-style retrospective, or team year-end highlights video.
---

# Year Review

Goal: a 30–45s 16:9 year-end big-screen (1920×1080, 30fps): the year number opens huge, 3–4 stats count up in monospace, then a best-moments carousel cuts through the months on a 2.5s rhythm while a month strip along the bottom tracks which month you are in.

## Workflow

1. Collect REAL numbers only: 3–4 stats (value + label, user-sourced), 4–8 best moments (month + title ≤ 20 chars + one line ≤ 36 chars). A wrapped-style recap without data is a facts sheet away — make the user fill it first; fabricated stats poison the whole genre.
2. `storyboard.plan { intent: "<year> in review · team recap", durationSeconds }` → remap onto open → stats → moment-<month> scenes (2.5s each) → close.
3. Write `src/video.ts`: stats count up via `typewriter` (monospace, duration ∝ digits, 1.2–1.6s); every moment scene carries the SAME month-strip chrome with its own month lit amber; carousel joins with `cut` transitions.
4. `compile.run` → 0 errors → `check.overflow` (moment titles at size 88 wrap fast — cap 20 chars).
5. `render.preview` the stats scene plus one moment per quarter, and `render.range` across a carousel cut — 2.5s ± 0.3 is the groove: faster is panic, slower is a memorial.
6. QA gates (below) → `test.run` → repair ≤ `maxRepairLoops` → `transaction.rollback`; `render.final` + the stats table for fact-checking.

## Recipes

Open — the year in 320px monospace, pulling back to reveal the label:

```ts
v.scene("open", { duration: 4, background: "#0a0a12" }, (s) => {
  s.beat("year", { at: 0.2, description: "Year number reveal" });
  s.rect("glow", { width: 900, height: 900, fill: "#6d28d9", opacity: 0.22, blur: 140, at: { x: 960, y: 475 } });
  s.text("year", "2025", { size: 320, weight: 800, color: "#ffffff", font: "monospace",
    at: { x: 960, y: 475 }, enter: { effect: "blur-up", duration: 0.9 } });
  s.text("label", "THE YEAR IN REVIEW", { size: 48, weight: 700, letterSpacing: 8, color: "#f59e0b",
    at: { x: 960, y: 713 }, enter: { effect: "fade", duration: 0.6, delay: 0.6 } });
  s.camera("pull-out", { from: 1.08, to: 1.0 });
});
```

Stats big-screen — three columns, numbers count up, labels fade in only after their number lands:

```ts
const stats = [
  { x: 480, n: "1,204", l: "videos shipped" },
  { x: 960, n: "38", l: "countries reached" },
  { x: 1440, n: "97%", l: "deadlines met" },
];
for (const [i, st] of stats.entries()) {
  s.beat(`stat-${i}`, { at: 0.3 + i * 0.7, description: `${st.l} count-up` });
  s.text(`num-${i}`, st.n, { size: 150, weight: 800, font: "monospace", color: "#ffffff", at: { x: st.x, y: 432 },
    enter: { effect: "typewriter", duration: 1.2 + i * 0.1, delay: 0.3 + i * 0.7, easing: "easeOutCubic" } });
  s.text(`label-${i}`, st.l, { size: 44, color: "#8b8ba7", at: { x: st.x, y: 562 },
    enter: { effect: "fade", duration: 0.5, delay: 1.8 + i * 0.7 } });
}
s.rect("rule", { width: 1400, height: 4, fill: "#6d28d9", opacity: 0.6, radius: 2, at: { x: 960, y: 648 },
  enter: { effect: "wipe", duration: 0.8, delay: 0.2 } });
```

Month strip — the carousel's spine: same chrome in EVERY moment scene, current month lit and underlined:

```ts
const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
const monthIndex = 2; // this scene's month — MAR
s.rect("strip", { width: 1760, height: 100, fill: "#12121e", opacity: 0.9, radius: 12, at: { x: 960, y: 990 } });
for (const [i, m] of MONTHS.entries()) {
  const cur = i === monthIndex;
  s.text(`m-${i}`, m, { size: 30, weight: cur ? 700 : 400, color: cur ? "#f59e0b" : "#8b8ba7",
    at: { x: 180 + i * 150, y: 985 }, enter: { effect: "fade", duration: 0.4, delay: 0.2 } });
}
s.rect("m-underline", { width: 64, height: 5, fill: "#f59e0b", radius: 2, at: { x: 180 + monthIndex * 150, y: 1028 },
  enter: { effect: "scale-pop", duration: 0.4, delay: 0.35, easing: "easeOutBack" } });
```

Moment card — 2.5s scene: month tag, title, one line, card behind, strip below; carousel cuts between moments:

```ts
v.scene("moment-mar", { duration: 2.5, background: "#0a0a12" }, (s) => {
  s.beat("moment", { at: 0.15, description: "March: v1 launch" });
  s.rect("card", { width: 1000, height: 560, fill: "#12121e", radius: 20, at: { x: 960, y: 470 },
    enter: { effect: "slide-up", duration: 0.45, params: { distance: 120 }, easing: "easeOutCubic" } });
  s.text("month", "MARCH", { size: 40, weight: 700, letterSpacing: 6, color: "#f59e0b",
    at: { x: 960, y: 300 }, enter: { effect: "fade", duration: 0.3 } });
  s.text("title", "v1 launch day", { size: 88, weight: 800, color: "#ffffff", maxWidth: 880,
    at: { x: 960, y: 430 }, enter: { effect: "slide-up", duration: 0.45, delay: 0.1, params: { distance: 70 } } });
  s.text("line", "46 issues closed in the final week", { size: 44, color: "#8b8ba7", maxWidth: 860,
    at: { x: 960, y: 560 }, enter: { effect: "fade", duration: 0.4, delay: 0.3 } });
  // month strip recipe goes here with monthIndex = 2
});
v.transition("cut", { between: ["moment-mar", "moment-apr"] }); // crossfade 0.3 is the softer option
```

Close scene (prose): "Thank you, 2025" at 120 blur-up, "See you in 2026 →" amber, `fade-black` out, last second still.

## QA gates

- `toContainText` for the year, every stat value AND label (stat labels settle at 1.8 + 2 × 0.7 + 0.5 ≈ 3.7s local — assert after), and every moment title.
- `expect(scene("moment-mar")).toHaveLayers("card", "month", "title", "m-2", "m-underline")` — the strip ships with the card.
- `durationBetween`: every moment scene 2.2–2.8, stats 8–12, open 3–5; `noTextOverflow()` on stats and moments; `not.toBeBlack()` frame 0 (glow, no `enter`).
- Carousel rhythm by eye via `render.range` spanning two cuts — if you cannot feel the beat, neither can the viewer.

## Anti-patterns

- Invented stats — this genre is a trust product; one made-up number retroactively poisons every real one.
- Carousel faster than ~2s per card — montage euphoria becomes strobing; slower than ~3s and it is a slideshow.
- A moment scene missing the month strip — the spine breaks and the timeline feeling dies.
- Two moments from the same month — merge them or pick the stronger one.
- More than 8 moments — cut to the arc; the strip has twelve slots, not the video twelve scenes.
- Stats scene past 12s — the count-up is the beat, the hold is silence; 8–12s total.
