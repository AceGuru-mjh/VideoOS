---
name: tutorial
version: 0.1.0
description: Step-by-step tutorial videos: big numbered step anchors, scrim-plus-frame focus highlights, a fixed per-step rhythm, and a progress bar.
trigger: The user asks to turn a how-to, walkthrough, or set of instructions into a numbered step-by-step teaching video.
---

# Tutorial

Goal: a 15–25s (1920×1080, 30fps) instructional cut teaching one procedure in 3–5 numbered steps. Every step gets the same rhythm (introduce → explain → hand off), a big number as the visual anchor, and a scrim-plus-frame highlight that shows where to look. Zero-asset by default; for tours over real screenshots use the screenshot-tour skill.

## Workflow

1. Collect the procedure: 3–5 steps, each an imperative title (≤ 6 words), 2–3 detail lines (≤ 9 words, one line each — v1 text layers are single-line), and a "where" zone label (≤ 3 words). Confirm the step list with the user before writing DSL; teaching a wrong or invented sequence is the one unrecoverable error.
2. `storyboard.plan { intent: "tutorial · <procedure>", durationSeconds }` → remap onto hook (1.5–2s) → step scenes → recap (2.5s). The rhythm table below is the contract, not the template output.
3. Write `src/video.ts`: one scene per step with an identical layer grammar (`number-i`, `title-i`, `detail-i-*`, `zone`, `scrim`, `frame-outer`, `frame-inner`, `progress-track`, `progress-fill`).
4. `compile.run` → 0 errors; then `compile.diagnostics` — any `OVERFLOW_RISK` on a detail line is a hard fail (shorten the line, never shrink below 40px).
5. `render.preview { scene, beat }` on every step's `explain` beat: number + title are the dominant pair, the frame sits on its zone, the progress bar advanced exactly one notch.
6. QA gates (below) → `test.run` → repair loop ≤ 3 (`scene.modify`; wrap risky edits in `transaction.begin` / `transaction.rollback`).
7. `render.final` → deliver the MP4 with the step list as its summary.

Rhythm per step scene (6s at 3 steps; compress to 5.5s for 4–5 steps):

| Phase | Window | What happens |
| --- | --- | --- |
| Introduce | 0–1.5s | number `scale-pop`, title `blur-up`, scrim + frame fade in |
| Explain | 1.5–5.5s | 2–3 detail lines `slide-up`, 0.35s stagger |
| Hand off | 5.5–6s | everything settled; `crossfade` 0.5 into the next step |

## Recipes

Step scene — number anchor, scrim + two-rect cutout frame, detail lines:

```ts
v.scene("step-1", { duration: 6, background: "#0a0a12" }, (s) => {
  s.beat("introduce", { at: 0, description: "Number 01 + title readable" });
  s.beat("explain", { at: 1.5, description: "Detail lines land, 0.35s stagger" });
  s.beat("handoff", { at: 5.5, description: "Settled before the crossfade" });
  // 1) scrim: dims the whole frame
  s.rect("scrim", { width: 1920, height: 1080, fill: "#05070d", opacity: 0.45, at: { x: 960, y: 540 },
    enter: { effect: "fade", duration: 0.6 } });
  // 2) cutout frame: accent rect + background-colored rect stacked on top = a 12px
  //    outline ring whose inside stays undimmed — the "hole" in the scrim
  s.rect("frame-outer", { width: 676, height: 396, fill: "#f59e0b", radius: 14, at: { x: 1330, y: 540 },
    enter: { effect: "fade", duration: 0.45, delay: 0.15 } });
  s.rect("frame-inner", { width: 652, height: 372, fill: "#0a0a12", radius: 10, at: { x: 1330, y: 540 },
    enter: { effect: "fade", duration: 0.45, delay: 0.15 } });
  // 3) zone label names WHERE to look (the step's "where")
  s.text("zone", "the launcher", { size: 34, color: "#8b8ba7", letterSpacing: 2, at: { x: 1330, y: 540 },
    enter: { effect: "fade", duration: 0.5, delay: 0.35 } });
  // 4) left column: the anchor
  s.text("number-1", "01", { size: 190, weight: 800, color: "#f59e0b", at: { x: 340, y: 360 },
    enter: { effect: "scale-pop", duration: 0.5, easing: "easeOutBack" } });
  s.text("title-1", "Open the project", { size: 62, weight: 700, color: "#f8fafc", at: { x: 340, y: 500 },
    enter: { effect: "blur-up", duration: 0.5, delay: 0.3 } });
  const DETAILS = ["Click New in the launcher", "Pick the videoos template", "Name it after the lesson"];
  for (const [i, line] of DETAILS.entries()) {
    s.text(`detail-1-${i + 1}`, line, { size: 40, color: "#cbd5e1", at: { x: 340, y: 596 + i * 76 },
      enter: { effect: "slide-up", duration: 0.45, delay: 1.6 + i * 0.35, easing: "easeOutCubic", params: { distance: 40 } } });
  }
});
```

Progress bar — the same two layers in EVERY step scene, pixel math, filled share = step / total:

```ts
const TOTAL = 3, STEP = 1, TRACK_W = 1600, LEFT = 160; // bump STEP each scene; recap uses STEP = TOTAL
s.rect("progress-track", { width: TRACK_W, height: 6, fill: "#8b8ba7", opacity: 0.25, radius: 3,
  at: { x: 960, y: 1010 }, enter: { effect: "fade", duration: 0.4 } });
const W = Math.round((STEP / TOTAL) * TRACK_W);
// fade, NOT wipe: wipe only renders on text layers (a rect wipe is dropped with an
// EFFECT_UNSUPPORTED warning); the notch-to-notch width jump carries the progress
s.rect("progress-fill", { width: W, height: 6, fill: "#f59e0b", radius: 3, at: { x: LEFT + W / 2, y: 1010 },
  enter: { effect: "fade", duration: 0.5, delay: 0.2 } });
```

Hook (1.5–2s): the payoff as a claim — "Ship your first video in 3 steps" — at ≥ 100px, `scale-pop`, readable by 1s. Recap (2.5s): numbers 01–0N in a row (one layer each, 0.3s stagger) plus one closing line; the last 0.8s are still. Join steps with `v.transition("crossfade", { duration: 0.5, between: ["step-1", "step-2"] })`; total = Σ durations − 0.5 × (scenes − 1).

## QA gates

- `expect(frame(30)).toContainText(<hook claim>)` — the 1s readability contract.
- Per step: `toContainText` for the number, title, zone, and every detail line at a frame ≥ sceneStart + 1.6 + stagger + 0.45 (crossfade overlap included).
- `expect(scene("step-1")).toHaveLayers("scrim", "frame-outer", "frame-inner", "number-1", "title-1", "progress-fill")` — the step grammar survives edits.
- `expect(scene("step-1")).toHaveBeat("introduce")` and `("explain")` — rhythm is provable, not vibes.
- `noTextOverflow()` on every scene + `check.overflow` — 40px detail lines are the repeat offenders.
- `durationBetween`: steps 5.5–6.5s each; total 15–25s; the recap's final 0.8s free of new entrances.
- Muted rule: each step self-contained as text — a step that only makes sense narrated needs another detail line.

## Anti-patterns

- Frame without scrim (or scrim without frame) — the highlight is the PAIR: dim everything, then re-light one region; either half alone is decoration.
- Inventing or reordering steps the user never stated — a tutorial teaching the wrong sequence is worse than no tutorial; confirm the list first.
- More than 5 steps — each step needs ≥ 5s to land; past 5 the cut blows past 25s and recall collapses. Split into episodes.
- Two actions in one step ("open and configure") — the number anchor carries ONE idea per screen; split the step.
- Detail lines that wrap — v1 text layers are single-line; reword to ≤ 9 words instead of shrinking or stacking.
- A progress bar that regresses (step 3 fuller than step 4) — viewers use it as a checklist; a shrink reads as an error.
