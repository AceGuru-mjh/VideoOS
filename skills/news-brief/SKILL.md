---
name: news-brief
version: 0.1.0
description: News-brief videos: top ticker headline rotation at a fixed cadence, numbered bullets entering one by one, and a source end frame.
trigger: The user asks for a news update, briefing, or bulletin video that summarizes several headlines or announcements as a short list.
---

# News Brief

Goal: an 8–15s (1920×1080, 30fps) bulletin: 2–3 headlines rotate in a top ticker strip at a fixed cadence, 3–5 numbered bullets enter one by one (single line, ≤ 9 words each), and a source frame closes with attribution. Facts, sources, and dates come only from the user — a brief that invents one number stops being news.

## Workflow

1. Collect: 2–3 headlines (≤ 7 words), 3–5 bullets (≤ 9 words, single line each), source name(s), and the date. Ask for anything missing; placeholders ("[Source]", "[Date]") until supplied — never draft a plausible-sounding fact to fill a slot.
2. `storyboard.plan { intent: "news brief · <topic>", durationSeconds }` → three scenes: `ticker` (3–4s) → `bullets` (4.5–6s) → `sources` (2.2–3s).
3. Write `src/video.ts` (Recipes). Ticker = fixed-cadence slide rotation (v1 has no continuous scroll; the uniform cadence IS the ticker — see the note in Recipes).
4. `compile.run` → 0 errors; then `check.overflow` — bullets are single-line by contract; a wrap means reword the bullet, never shrink below 44px.
5. `render.preview { scene: "bullets", beat: "all-in" }` — the numbered column reads top-to-bottom, evenly spaced, and the ticker strip is visually separate from the bullet zone.
6. QA gates (below) → `test.run` → repair loop ≤ 3 (`scene.modify`; `transaction.begin` / `transaction.rollback` when re-timing the ticker).
7. `render.final` → deliver with a one-line source list in the summary.

## Recipes

Ticker strip — 2–3 headlines rotating at a fixed 1.6s cadence, each visible in its own window: enters `slide-left` (from the right), exits `slide-right` (to the left) — a constant leftward conveyor. Same distance, duration, and easing every rotation is what reads as "scrolling":

```ts
v.scene("ticker", { duration: 3.4, background: "#05070d" }, (s) => {
  s.beat("headlines", { at: 0.1, description: "First headline readable by 1s" });
  s.rect("strip", { width: 1920, height: 96, fill: "#111527", at: { x: 960, y: "16%" } });
  s.rect("strip-accent", { width: 10, height: 96, fill: "#f43f5e", at: { x: 96, y: "16%" } });
  s.text("brand", "WEEKLY BUILD", { size: 30, weight: 800, color: "#f43f5e", letterSpacing: 3, align: "left",
    at: { x: 140, y: "16%" }, enter: { effect: "fade", duration: 0.4 } });
  const CADENCE = 1.6; // scene duration = headline count * CADENCE + 0.2
  const HEADLINES = ["Compiler now 2x faster", "Agent kit goes public"];
  for (const [i, h] of HEADLINES.entries()) {
    const t = i * CADENCE;
    s.text(`head-${i + 1}`, h, { size: 44, weight: 600, color: "#f8fafc", align: "left",
      at: { x: 1000, y: "16%" }, in: t, out: t + CADENCE,
      enter: { effect: "slide-left", duration: 0.45, easing: "easeOutCubic", params: { distance: 240 } },
      exit: { effect: "slide-right", duration: 0.45, easing: "easeInCubic", params: { distance: 240 } } });
  }
});
```

Bullets — numbered rows, one line each, 0.4s stagger; `sources` closer ends the cut:

```ts
v.scene("bullets", { duration: 5, background: "#05070d" }, (s) => {
  s.beat("bullets-in", { at: 0.2, description: "Bullets enter one by one" });
  s.beat("all-in", { at: 2.2, description: "Full list readable" });
  s.text("kicker", "IN THIS BRIEF", { size: 34, weight: 800, letterSpacing: 4, color: "#f43f5e",
    at: { x: 960, y: "20%" }, enter: { effect: "fade", duration: 0.4 } });
  const POINTS = ["Compiler speed doubled this cycle", "Agent kit opened to all users",
    "Preview pins any frame for review", "Docs ship with every release"];
  for (const [i, p] of POINTS.entries()) {
    s.text(`num-${i + 1}`, `${i + 1}`, { size: 54, weight: 800, color: "#f43f5e", at: { x: 320, y: `${34 + i * 13}%` },
      enter: { effect: "scale-pop", duration: 0.4, delay: 0.3 + i * 0.4, easing: "easeOutBack" } });
    s.text(`point-${i + 1}`, p, { size: 46, weight: 600, color: "#e2e8f0", align: "left",
      at: { x: 380, y: `${34 + i * 13}%` },
      enter: { effect: "slide-left", duration: 0.45, delay: 0.35 + i * 0.4, easing: "easeOutCubic", params: { distance: 60 } } });
  }
});
v.transition("crossfade", { duration: 0.4, between: ["ticker", "bullets"] });

v.scene("sources", { duration: 2.5, background: "#05070d" }, (s) => {
  s.beat("sources", { at: 0.2, description: "Attribution readable, then still" });
  s.text("title", "Sources", { size: 56, weight: 700, color: "#f8fafc", at: { x: 960, y: "40%" },
    enter: { effect: "fade", duration: 0.5, delay: 0.2 } });
  s.text("list", "[Source name] — [Date]", { size: 36, color: "#8b8ba7", at: { x: 960, y: "54%" },
    enter: { effect: "fade", duration: 0.5, delay: 0.5 } });
});
v.transition("crossfade", { duration: 0.4, between: ["bullets", "sources"] });
```

Total = Σ durations − 0.4 × 2; the last 0.8s of `sources` are still. Vertical adaptation: strip at 12% (inside the top safe zone), bullets at y 30–70%, source frame centered — see the short-video skill for the 9:16 margins.

## QA gates

- `expect(frame(30)).toContainText(<headline 1>)` — the 1s readability contract on the opener.
- Each headline present at a frame inside its window after the enter completes (window start + 0.45).
- `toContainText` for every bullet at a frame ≥ its `delay + duration`; `toHaveLayers("kicker", "num-1", "point-1", "num-4", "point-4")` on the bullets scene.
- `expect(scene("bullets")).toHaveBeat("all-in")` — the list-complete beat survives edits.
- `noTextOverflow()` per scene + `check.overflow` — bullets wrap = reword (manual gate: every bullet ≤ 9 words).
- `durationBetween`: ticker 3.2–4.2s, bullets 4.5–6s, sources 2.2–3s, total 8–15s, final 0.8s still.
- Attribution gate (manual): the sources frame names real sources the user gave — never "various sources" or an invented outlet.

## Anti-patterns

- Inventing facts, numbers, or dates to fill slots — news briefs live and die on attribution; leave "[Source]" until the user supplies it.
- Bullets over 9 words or wrapping to two lines — the list rhythm dies and the 5s scene cannot hold 6 reading targets; reword or split (then drop to 4 bullets).
- More than 5 bullets — the cut exceeds 15s or the pacing doubles; the rest is a docs page.
- Mixed ticker cadence (0.9s then 2.1s) — the fixed cadence is what reads as scrolling; irregular timing reads as glitches.
- Bright decorative numbers outshining the points — numbers are wayfinding at one accent color; if the number is louder than the text, invert the hierarchy.
- Skipping the source frame — an unattributed brief is indistinguishable from rumor; the closer is part of the format, not an extra.
