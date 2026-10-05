---
name: chart-story
version: 0.1.0
description: Narrative arc for one chart - establish axes, annotate the key point, reveal growth, land the takeaway - plus bar-race frame carousels with frozen geometry.
trigger: The user wants a video built around a single chart ("explain this chart", a bar race, one dataset with a story) rather than a KPI dashboard or a many-chart montage.
---

# Chart Story

Goal: a 12-20s story (1920x1080) around ONE chart in four moves: establish (3-4s, axes and unit land before any data), annotate (2-3s, the key point gets marked), reveal (4-6s, the data grows), takeaway (2-3s, one sentence). Division of labor, three ways: data-motion owns HOW to draw a chart (bar/mask/axis geometry, easing semantics); data-dashboard owns KPI pacing (hero number, pair, trend); THIS skill owns the four-scene arc and the bar-race carousel.

## Workflow

1. Pin the story: the dataset, the unit, the ONE key point to annotate, and the takeaway sentence. No takeaway sentence, no chart-story - that is just data-motion.
2. Render the ground truth first: call the mcp-plot server's `plot.bar` (or `plot.line` for trends) with the same data and a title - the returned SVG is the reference. The video's reveal scene must END on the same shape, order, and values as that reference; the plot output is the contract, not a vibe.
3. Budget the arc: establish 3-4 / annotate 2-3 / reveal 4-6 / takeaway 2-3 seconds - 12-16s golden, 20s ceiling. Establish owns axis + unit labels (no data yet); annotate marks the key point (an ellipse ring + one phrase, no new data); reveal owns growth; takeaway owns the conclusion.
4. Write the scenes (Recipe 1). The reveal uses data-motion's bar-growth pattern: `slide-up` with `params.distance` = the bar's own height, mask rect declared AFTER the bars, value labels fading in only after each bar finishes.
5. Bar race (when the story is "the ranking flipped"): same scene structure, data re-sorted per frame - Recipe 2; `crossfade` 0.5s between frames, geometry FROZEN across frames.
6. `compile.run` -> 0 errors; `check.overflow`; then `render.preview` at four moments: establish settled, annotate mark, reveal mid-growth AND settled, takeaway.
7. `test.run` with the gates below (including the reference comparison review); repair loop <= 3 via `scene.modify`; `render.final`.

## Recipes

Establish then reveal - the arc's bookends (baseline y=778, scale 60px per hour):

```ts
v.scene("establish", { duration: 3.5, background: "#0a0a12" }, (s) => {
  s.beat("axes-land", { at: 0.2, description: "Axis + unit readable before data exists" });
  s.rect("axis", { width: 1200, height: 3, fill: "#8b8ba7", opacity: 0.7,
    at: { x: 960, y: 778 } });                          // frame-0 ink, no enter
  s.text("title", "RENDER HOURS BY STAGE", { size: 56, weight: 800, color: "#f8fafc",
    at: { x: "50%", y: "22%" }, enter: { effect: "slide-up", duration: 0.4, params: { distance: 50 } } });
  s.text("unit", "hours per week", { size: 34, color: "#94a3b8",
    at: { x: "50%", y: "34%" }, enter: { effect: "fade", duration: 0.4, delay: 0.3 } });
});
v.scene("reveal", { duration: 5, background: "#0a0a12" }, (s) => {
  s.beat("grow", { at: 0.3, description: "Bars rise from the axis, staggered" });
  const BARS = [                                          // height = round(hours x 60)
    { name: "bar-1", label: "BUILD", hours: 2, x: 700 },
    { name: "bar-2", label: "TEST", hours: 4, x: 960 },
    { name: "bar-3", label: "RENDER", hours: 7, x: 1220 },
  ];
  for (const [i, b] of BARS.entries()) {
    const h = b.hours * 60;
    s.rect(b.name, { width: 140, height: h, fill: "#22d3ee", radius: 6,
      at: { x: b.x, y: 778 - h / 2 },
      enter: { effect: "slide-up", duration: 1.2, delay: 0.3 + i * 0.35, easing: "easeOutCubic",
        params: { distance: h } } });
    s.text(`v-${i + 1}`, `${b.hours}h`, { size: 36, weight: 700, color: "#e2e8f0",
      at: { x: b.x, y: 778 - h - 44 }, enter: { effect: "fade", duration: 0.4, delay: 1.8 + i * 0.35 } });
    s.text(`l-${i + 1}`, b.label, { size: 30, color: "#94a3b8", at: { x: b.x, y: 826 },
      enter: { effect: "fade", duration: 0.4, delay: 2.0 + i * 0.35 } });
  }
  s.rect("mask", { width: 1920, height: 302, fill: "#0a0a12", at: { x: 960, y: 929 } });
});
```

Bar race - same slots, re-sorted data per frame, one crossfade:

```ts
// slot i = rank i; per frame the data is re-sorted so the leader is always slot 1
const FRAMES = [
  { name: "race-2019", rows: [["RENDER", 7], ["TEST", 4], ["BUILD", 2]] },
  { name: "race-2024", rows: [["TEST", 8], ["RENDER", 5], ["BUILD", 2]] },
];
for (const [f, frame] of FRAMES.entries()) {
  v.scene(frame.name, { duration: 4, background: "#0a0a12" }, (s) => {
    s.beat("frame-land", { at: 0.4, description: "Same layout, new ranking - leader first" });
    s.text("year", frame.name.replace("race-", ""), { size: 40, weight: 700, color: "#94a3b8",
      at: { x: "50%", y: "16%" }, enter: { effect: "fade", duration: 0.4 } });
    for (const [i, [label, hours]] of frame.rows.entries()) {
      const h = hours * 60;
      s.rect(`bar-${i + 1}`, { width: 140, height: h, fill: "#22d3ee", radius: 6,
        at: { x: 700 + i * 260, y: 778 - h / 2 } });    // geometry frozen across frames
      s.text(`v-${i + 1}`, `${hours}h`, { size: 36, weight: 700, color: "#e2e8f0",
        at: { x: 700 + i * 260, y: 778 - h - 44 } });
      s.text(`l-${i + 1}`, label, { size: 30, color: "#94a3b8", at: { x: 700 + i * 260, y: 826 } });
    }
  });
  if (f === 0) v.transition("crossfade", { duration: 0.5, between: ["race-2019", "race-2024"] });
}
```

Annotate and takeaway (prose patterns): annotate = an `ellipse` ring around the key bar/point plus one phrase at 44px (e.g. "TEST doubled"), `scale-pop` 0.4s; takeaway = the one conclusion sentence at 64-84px, `blur-up` 0.5s, still for the final 0.8s.

## QA gates

- Arc pinned: establish `durationBetween(3, 4.5)`; annotate `durationBetween(2, 3)`; reveal `durationBetween(4, 6)`; takeaway `durationBetween(2, 3)`; total 12-20s.
- Units before data: `expect(frame(<establish settled>)).toContainText("hours per week")` - the unit lands in establish, never in reveal.
- Reveal honesty: final values match the user dataset AND the `plot.bar` reference SVG (review gate: compare the settled `render.preview` against the reference before `render.final`).
- Reveal mechanics: `toHaveLayers("bar-1", "bar-2", "bar-3", "mask", "v-3", "l-3")` - the mask is declared after the bars (data-motion gotcha).
- Takeaway: one sentence, readable with >= 0.8s still left, and no number the chart never showed.
- Bar race: both frames `toHaveLayers("bar-1", "bar-2", "bar-3")` with identical slot geometry; exactly one crossfade between frames; `noTextOverflow()` plus `check.overflow` throughout.

## Anti-patterns

- Data before axes - a growing bar with no unit or baseline established is decoration; establish buys the reveal its meaning.
- A takeaway with a new number - the conclusion must be readable FROM the chart; fresh data in the last scene is a bait-and-switch.
- Geometry drift between bar-race frames - if slot x positions or the baseline move, the crossfade reads as a different chart, not a re-ranking; freeze the geometry.
- Two charts in one scene - the arc is per chart; a second dataset is a second arc or a data-dashboard.
- Skipping the plot.bar reference check - without a ground-truth render, bar proportions and ordering drift silently.
- Annotating more than one point - one key point per chart; two annotations halve each other's emphasis.
