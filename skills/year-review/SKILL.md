---
name: year-review
version: 0.1.0
description: Year-in-review videos: a four-KPI count-up dashboard open, a highlight-moment carousel, and a color-inversion keyword finale.
trigger: The user asks for a year-in-review, annual recap, or year-end wrap-up video with stats and highlights (team, product, or personal).
---

# Year Review

Goal: a 15–25s (1920×1080, 30fps) recap in three movements: a KPI dashboard open (4 numbers, count-up, staggered), a highlight carousel (one moment per ~2s: time label + one sentence), and a keyword finale — the year's word lands with `scale-pop` as the whole frame inverts color (dark scenes → light finale). Numbers and moments come from the user; the keyword is confirmed, never invented.

## Workflow

1. Collect: exactly 4 KPIs (value + short label), 3–5 highlight moments (time label like "Q1" or "MARCH" + one sentence ≤ 9 words), and the year keyword. Ask for all three; placeholders ("[N]", "[Moment]") until supplied — invented KPIs are the top credibility failure of this genre.
2. `storyboard.plan { intent: "year review · <year>", durationSeconds }` → `kpi` (5–6s) → `moment-1..N` (2s each) → `keyword` (3–4s). Budget: total = Σ durations − overlaps; more moments = longer cut, not faster moments.
3. Write `src/video.ts` (Recipes). Count-ups are `typewriter` on the FINAL value (data-motion pattern); the inversion finale is a light-background scene after the dark ones, joined by `fade-black`.
4. `compile.run` → 0 errors; then `check.overflow` — KPI values at ≥ 100px with labels beneath are the wrap risk (shrink the value, keep the label ≥ 30px).
5. `render.preview { scene: "kpi", beat: "all-in" }` and the keyword scene — the dashboard must read as a 2×2 grid; the finale must feel like a full-screen flip, not another slide.
6. QA gates (below) → `test.run` → repair loop ≤ 3 (`scene.modify`; `transaction.begin` / `transaction.rollback` when re-gridding KPIs).
7. `render.final` → deliver with the KPI list and the keyword in the summary.

## Recipes

KPI dashboard open — 2×2 grid, count-up via typewriter, 0.35s stagger between cards:

```ts
v.scene("kpi", { duration: 5.5, background: "#05070d" }, (s) => {
  s.beat("year", { at: 0.2, description: "Year heading readable by 1s" });
  s.beat("all-in", { at: 2.6, description: "All four KPIs landed" });
  s.text("heading", "2024 IN NUMBERS", { size: 54, weight: 800, letterSpacing: 4, color: "#f8fafc",
    at: { x: 960, y: "16%" }, enter: { effect: "blur-up", duration: 0.5 } });
  const KPIS = [
    { name: "kpi-renders", value: "12,847", label: "renders shipped", x: "30%", y: 40 },
    { name: "kpi-tests", value: "39,204", label: "tests passed", x: "70%", y: 40 },
    { name: "kpi-agents", value: "1,142", label: "agent sessions", x: "30%", y: 68 },
    { name: "kpi-scenes", value: "96", label: "scenes per project", x: "70%", y: 68 },
  ];
  for (const [i, k] of KPIS.entries()) {
    s.text(k.name, k.value, { size: 108, weight: 800, color: "#22d3ee", font: "monospace",
      at: { x: k.x, y: `${k.y}%` },
      enter: { effect: "typewriter", duration: 1.1, delay: 0.3 + i * 0.35, easing: "easeOutCubic" } });
    s.text(`${k.name}-label`, k.label, { size: 32, color: "#8b8ba7", at: { x: k.x, y: `${k.y + 9}%` },
      enter: { effect: "fade", duration: 0.4, delay: 0.55 + i * 0.35 } });
  }
});
```

Highlight moment — ~2s per scene, time label + one sentence (single line), quick crossfades:

```ts
v.scene("moment-1", { duration: 2, background: "#05070d" }, (s) => {
  s.beat("moment", { at: 0.15, description: "Time + sentence readable" });
  s.text("when", "MARCH", { size: 40, weight: 800, letterSpacing: 6, color: "#f59e0b",
    at: { x: 960, y: "38%" }, enter: { effect: "fade", duration: 0.3 } });
  s.text("what", "The agent kit went public", { size: 64, weight: 700, color: "#f8fafc",
    at: { x: 960, y: "52%" }, enter: { effect: "slide-up", duration: 0.4, delay: 0.15, easing: "easeOutCubic", params: { distance: 40 } } });
});
v.transition("crossfade", { duration: 0.3, between: ["moment-1", "moment-2"] });
```

Keyword finale — light background + dark text = the color inversion; `fade-black` in, then stillness:

```ts
v.scene("keyword", { duration: 3.5, background: "#f8fafc" }, (s) => {
  s.beat("word", { at: 0.2, description: "Keyword lands, frame inverts" });
  s.text("kicker", "THE WORD FOR THE YEAR", { size: 30, weight: 800, letterSpacing: 5, color: "#64748b",
    at: { x: 960, y: "34%" }, enter: { effect: "fade", duration: 0.4 } });
  s.text("word", "RESILIENT", { size: 170, weight: 800, letterSpacing: 8, color: "#0a0a12",
    at: { x: 960, y: "48%" }, enter: { effect: "scale-pop", duration: 0.6, easing: "easeOutCubic" } });
  s.text("signoff", "See you in 2025", { size: 36, color: "#64748b", at: { x: 960, y: "66%" },
    enter: { effect: "fade", duration: 0.5, delay: 1.0 } }); // sign-off year = review year + 1, derived not invented
});
v.transition("fade-black", { duration: 0.5, between: ["moment-4", "keyword"] });
```

The fade-black dip before the light scene is what sells the inversion — the eye gets one black beat, then the flip. Example: 5.5 + 4×2 + 3.5 − (4×0.3 + 0.5) ≈ 15.3s; each extra moment adds ~1.7s.

## QA gates

- `expect(frame(30)).toContainText("2024 IN NUMBERS")` — the 1s readability contract (use the user's year).
- All four KPI values and labels present at a frame ≥ max delay + duration (≈ 2.5s in-scene, after the last typewriter completes).
- Each moment's `when` + `what` present at a frame ≥ its entrance completion (0.55s in-scene).
- `expect(scene("kpi")).toHaveLayers("heading", "kpi-renders", "kpi-tests", "kpi-agents", "kpi-scenes")` — the 2×2 grid survives edits.
- `toContainText(<keyword>)` at ≥ 1s into the finale; the keyword matches what the user confirmed.
- `noTextOverflow()` on every scene + `check.overflow` — 108px values and 170px keyword.
- `durationBetween`: kpi 5–6.5s, moments 1.8–2.2s each, keyword 3–4s, total 15–25s, final 0.8s still.
- Muted rule: the recap works as text; a moment that needs narration to parse gets rewritten to one sentence.

## Anti-patterns

- Inventing or rounding up KPIs — recap numbers get screenshotted and quoted back; ship "[N]" placeholders until the real ones arrive.
- More than 4 KPIs — the 2×2 grid IS the dashboard; a 5th card breaks the grid and none get read.
- Moments longer than one sentence — each moment owns ~2s; a second sentence overruns or steals the next moment's window.
- Inverting color anywhere but the finale — the light scene is the signature ending; a mid-video flip spoils the payoff.
- Choosing the year keyword for the user — propose candidates from their moments, but the word on screen must be user-confirmed (it becomes the year's label).
- Count-up via many stacked text layers — one typewriter layer per KPI is cheaper, deterministic, and assertable (see the data-motion skill).
