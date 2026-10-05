---
name: comparison
version: 0.1.0
description: Build a side-by-side product comparison video — fixed two-column split, per-dimension PK rows with score bars, and a fit-based verdict frame.
trigger: The user wants to compare two products, tools, frameworks, or plans head-to-head (A vs B, "versus", "which one should I pick") as a video.
---

# Comparison Review

Goal: a 25–40s 16:9 head-to-head (1920×1080, 30fps) where two contenders hold fixed columns, get scored dimension by dimension, and close on a fit-based verdict — never an invented winner.

## Workflow

1. Mine the source for: both product names, 3–4 dimensions, a score or concrete value per side, and the "pick X if…" logic. No scores given? Use qualitative values ("yes / add-on / none") — never fabricate numbers.
2. `storyboard.plan { intent: "<A> vs <B> · <category>", durationSeconds }` → remap shots onto matchup → pk → verdict; the structure below is the contract, the plan output is a draft.
3. Write `src/video.ts` with fixed grammar: column anchors at x = 27% and x = 73% that never move between scenes, one shared px-per-point scale per row (comment the mapping), and side-locked colors — A violet `#6d28d9`, B amber `#f59e0b`, in every scene.
4. `compile.run` → 0 errors; then `check.overflow` — dimension labels sit ON the divider, so each needs a background-colored knockout rect behind it or the label/line collision ships.
5. `render.preview { scene, beat }` per row block: bars must race in from the outer edges and stop at the divider — a bar crossing center reads as contamination.
6. QA gates (below) → `test.run` → repair ≤ `maxRepairLoops`; still red → `transaction.rollback` and re-plan with one fewer dimension. Then `render.final` → deliver the MP4 plus the score table you asserted, so the user can fact-check every number on screen.

| Act | Window | Scene | Job | Dominant element |
| --- | --- | --- | --- | --- |
| Matchup | 0–4s | `matchup` | name both contenders | two name cards + VS badge |
| PK | 4–21s | `pk` | 3–4 dimensions, one row block each | score bars racing to the divider |
| Verdict | 21–27s | `verdict` | who should pick which | two "pick X if…" panels |

## Recipes

Matchup — cards snap to the anchors, VS badge pops between them; the static divider is the frame-0 ink:

```ts
v.scene("matchup", { duration: 4, background: "#0a0a12" }, (s) => {
  s.beat("matchup", { at: 0.2, description: "Both names + VS badge" });
  s.rect("divider", { width: 4, height: 720, fill: "#8b8ba7", opacity: 0.4, at: { x: 960, y: 560 } });
  s.rect("card-a", { width: 620, height: 220, fill: "#12121e", radius: 16, at: { x: 518, y: 324 },
    enter: { effect: "slide-right", duration: 0.5, params: { distance: 140 } } });
  s.rect("card-b", { width: 620, height: 220, fill: "#12121e", radius: 16, at: { x: 1402, y: 324 },
    enter: { effect: "slide-left", duration: 0.5, params: { distance: 140 } } });
  s.text("name-a", "RenderX", { size: 88, weight: 800, color: "#ffffff", at: { x: 518, y: 298 },
    enter: { effect: "fade", duration: 0.4, delay: 0.3 } });
  s.text("name-b", "ShipFast", { size: 88, weight: 800, color: "#ffffff", at: { x: 1402, y: 298 },
    enter: { effect: "fade", duration: 0.4, delay: 0.3 } });
  s.ellipse("vs", { width: 140, height: 140, fill: "#f59e0b", at: { x: 960, y: 324 },
    enter: { effect: "scale-pop", duration: 0.5, delay: 0.7, easing: "easeOutBack" } });
  s.text("vs-label", "VS", { size: 56, weight: 800, color: "#0a0a12", at: { x: 960, y: 317 },
    enter: { effect: "fade", duration: 0.3, delay: 0.8 } });
});
```

PK rows — the signature: values land first (the claim), then tug-of-war bars race toward the divider and stop at it:

```ts
const rows = [ // bar widths precomputed: round(score × 56); PRICE is inverted → no bar
  { dim: "SPEED", a: "8.6", b: "9.1", aBar: 482, bBar: 510, bar: true },
  { dim: "PRICE", a: "$0/mo", b: "$29/mo", bar: false },
  { dim: "PLUGINS", a: "210", b: "96", aBar: 420, bBar: 192, bar: true },
];
for (const [i, row] of rows.entries()) {
  const y = 400 + i * 210; // row block centers: 400 / 610 / 820
  s.beat(`row-${i}`, { at: 0.4 + i * 5, description: `${row.dim} row` });
  s.rect(`knockout-${i}`, { width: 320, height: 90, fill: "#0a0a12", at: { x: 960, y } });
  s.text(`dim-${i}`, row.dim, { size: 40, weight: 700, letterSpacing: 4, color: "#8b8ba7",
    at: { x: 960, y }, enter: { effect: "fade", duration: 0.4, delay: 0.4 + i * 5 } });
  s.text(`val-a-${i}`, row.a, { size: 64, weight: 800, color: "#ffffff", at: { x: 518, y: y - 56 },
    enter: { effect: "slide-up", duration: 0.5, delay: 0.5 + i * 5, params: { distance: 60 } } });
  s.text(`val-b-${i}`, row.b, { size: 64, weight: 800, color: "#ffffff", at: { x: 1402, y: y - 56 },
    enter: { effect: "slide-up", duration: 0.5, delay: 0.6 + i * 5, params: { distance: 60 } } });
  if (row.bar) {
    s.rect(`bar-a-${i}`, { width: row.aBar, height: 46, fill: "#6d28d9", radius: 8,
      at: { x: 948 - row.aBar / 2, y: y + 66 },
      enter: { effect: "slide-right", duration: 0.9, delay: 0.8 + i * 5, easing: "easeOutCubic",
        params: { distance: 940 } } }); // races in from the left edge, stops 12px short of the divider
    s.rect(`bar-b-${i}`, { width: row.bBar, height: 46, fill: "#f59e0b", radius: 8,
      at: { x: 972 + row.bBar / 2, y: y + 66 },
      enter: { effect: "slide-left", duration: 0.9, delay: 0.8 + i * 5, easing: "easeOutCubic",
        params: { distance: 940 } } });
  }
}
```

Verdict — full-frame panel, two "pick X if" columns; add a WINNER chip ONLY if the user's own benchmark data crowns one:

```ts
v.scene("verdict", { duration: 6 }, (s) => {
  s.beat("verdict", { at: 0.3, description: "Fit-based verdict" });
  s.rect("panel", { width: 1600, height: 760, fill: "#12121e", radius: 20, at: { x: 960, y: 540 } });
  s.text("heading", "THE VERDICT", { size: 76, weight: 800, letterSpacing: 6, color: "#ffffff",
    at: { x: 960, y: 238 }, enter: { effect: "blur-in", duration: 0.6 } });
  s.text("pick-a", "Pick RenderX if", { size: 56, weight: 700, color: "#6d28d9", at: { x: 518, y: 410 },
    enter: { effect: "slide-up", duration: 0.5, delay: 0.5, params: { distance: 60 } } });
  s.text("pick-b", "Pick ShipFast if", { size: 56, weight: 700, color: "#f59e0b", at: { x: 1402, y: 410 },
    enter: { effect: "slide-up", duration: 0.5, delay: 0.5, params: { distance: 60 } } });
  // then 2–3 short "if" lines per column (size 44, muted), fade 0.2s apart
});
// join acts: v.transition("crossfade", { duration: 0.5, between: ["matchup", "pk"] }) then pk → verdict; adjacent only
```

## QA gates

- `toContainText` for both names, every dimension label, every value — each at a frame ≥ its entrance completion.
- `expect(scene("pk")).toHaveLayers("bar-a-0", "bar-b-0", "knockout-1")` — bars and knockouts survive edits.
- `durationBetween`: matchup 3–5, verdict 4–8; `noTextOverflow()` on pk and verdict; `expect(frame(0)).not.toBeBlack()`.
- Equal-scale check by eye in `render.preview`: if A's 8.6 bar out-lengths B's 9.1 bar, the video lies.

## Anti-patterns

- Declaring a winner without user data — fit-based verdicts only; a fabricated "WINNER" chip is the cardinal sin of the genre.
- Bars on inverted dimensions (price, latency): longer reads as better — show the value text only.
- Moving the column anchors between scenes — the split is the video's grammar; drifting columns feel like a bug.
- More than 4 dimensions, or two dimensions in one row block — attention dies; one claim per block, one beat per row, link a table for the long tail.
