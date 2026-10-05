---
name: math-derivation
version: 0.1.0
description: Step-by-step formula animation: one line per scene, active line underlined, finished lines replay gray, implies arrows between steps, boxed result.
trigger: The user asks to animate a proof, derivation, or worked math steps - showing how one equation transforms into the next, line by line.
---

# Math Derivation

Goal: an 8-15s (1920x1080, 30fps) worked derivation: formula lines appear one per scene, the active line in white with a focus underline on the term being transformed, finished lines replayed gray above, "⟹" arrows between steps, and a boxed result held >= 0.8s. Monospace only - column math needs fixed glyph widths.

Engine fact that shapes everything: layer color and opacity are static in v1 - a line cannot dim mid-scene. So "finished lines turn gray" is done by re-declaring them gray in the NEXT scene and letting `v.transition("crossfade", { duration: 0.4, ... })` carry the state change. One step per scene is a necessity, not a style choice.

## Workflow

1. Collect 2-4 formula lines (<= 31 monospace chars each at size 56 - the width budget), the focus term per line (character index + length, counted in the source string), and a 2-4 word operation caption per step ("complete the square").
2. `storyboard.plan { intent: "derivation · <topic>", durationSeconds }` -> one scene per step + one result scene; delete everything else the template suggests.
3. Write `src/video.ts` (Recipes): lines replay from a `LINES` array via loop, never hand-copied per scene - text drift between scenes is this genre's #1 bug.
4. `compile.run` -> 0 errors -> `check.overflow`: monospace formulas at size 56 are the overflow-est strings in the library; obey the budget below.
5. `render.preview` one settled frame per scene - the underline must sit UNDER the focus term, not near it (count characters, never eyeball).
6. QA gates (below) -> `test.run` -> repair loop <= 3, then `render.final` with the final line quoted back.

Layout contract (1920 wide; with `align: "left"` the x you give IS the left edge, which makes the segment math work):

| Element | Rule |
| --- | --- |
| Line rows | y = 240 + i x 210 px, anchored at x = 420, `align: "left"` |
| Width budget | chars x 34 + 420 <= 1500 -> 31 chars at size 56 (size 44 -> 44 chars) |
| `⟹` arrows | x = 520, y = lineY(i) + 105 (midpoint between rows i and i+1), accent `#f59e0b` |
| Focus underline | rect height 5, width = len x 34, center x = 420 + (from + len / 2) x 34, y = lineY + 50 |
| Gray replay | `#64748b` at opacity 0.5 - stay >= 0.4 or QA's `toContainText` cannot see the line |

## Recipes

Constants + a step scene (step-2 of a 3-line derivation; duplicate per step, bumping `step`):

```ts
const SIZE = 56, CW = Math.round(SIZE * 0.6);   // monospace glyph advance ~= 0.6 x size
const LINES = [                                 // count chars in these strings - never eyeball
  "(a + b)^2  =  a^2 + 2ab + b^2",              // 0: focus "2ab" at 20
  "a^2 + b^2  =  (a + b)^2 - 2ab",              // 1: focus "- 2ab" at 24
  "2ab  =  (a + b)^2 - a^2 - b^2",              // 2: focus "2ab" at 0 (result)
];
const FOCUS = [{ from: 20, len: 3 }, { from: 24, len: 5 }, { from: 0, len: 3 }];
const OP = ["expand the square", "rearrange", "isolate the cross term"];
const lineY = (i: number) => 240 + i * 210;

v.scene("step-2", { duration: 3, background: "#0a0a12" }, (s) => {
  const step = 1;                               // active line index (0-based)
  s.beat("step-lands", { at: 0.15, description: "Active line readable by 0.8s" });
  s.text("topic", "ISOLATING THE CROSS TERM", { size: 30, weight: 700, letterSpacing: 4,
    color: "#94a3b8", at: { x: 420, y: 90, align: "left" } });   // no enter -> frame-0 ink
  for (let i = 0; i < step; i++) {              // gray replay of finished lines + arrows
    s.text(`line-${i + 1}`, LINES[i]!, { font: "monospace", size: SIZE, color: "#64748b", opacity: 0.5,
      at: { x: 420, y: lineY(i), align: "left" } });
    s.text(`imply-${i + 1}`, "⟹", { size: 40, color: "#f59e0b", at: { x: 520, y: lineY(i) + 105 } });
  }
  const f = FOCUS[step]!;
  s.text(`line-${step + 1}`, LINES[step]!, { font: "monospace", size: SIZE, weight: 600, color: "#f8fafc",
    at: { x: 420, y: lineY(step), align: "left" },
    enter: { effect: "blur-in", duration: 0.5, delay: 0.15, easing: "easeOutCubic" } });
  s.rect("focus-underline", { width: f.len * CW, height: 5, fill: "#f59e0b", radius: 2,
    at: { x: 420 + (f.from + f.len / 2) * CW, y: lineY(step) + 50 },
    enter: { effect: "wipe", duration: 0.4, delay: 0.7, easing: "easeOutCubic" } });
  s.text("caption", OP[step]!, { size: 28, color: "#f59e0b",
    at: { x: 420, y: lineY(step) + 115, align: "left" }, enter: { effect: "fade", duration: 0.35, delay: 0.9 } });
});
```

Variant - dim the non-focus terms by splitting the active line into segments (replaces the single active `s.text`):

```ts
s.text("seg-before", LINES[step]!.slice(0, f.from), { font: "monospace", size: SIZE, color: "#f8fafc", opacity: 0.45,
  at: { x: 420, y: lineY(step), align: "left" } });
s.text("seg-focus", LINES[step]!.slice(f.from, f.from + f.len), { font: "monospace", size: SIZE, weight: 700,
  color: "#f8fafc", at: { x: 420 + f.from * CW, y: lineY(step), align: "left" },
  enter: { effect: "fade", duration: 0.3, delay: 0.7 } });
s.text("seg-after", LINES[step]!.slice(f.from + f.len), { font: "monospace", size: SIZE, color: "#f8fafc", opacity: 0.45,
  at: { x: 420 + (f.from + f.len) * CW, y: lineY(step), align: "left" } });
```

Result scene - panel first (painter's order: text draws on top), all lines replayed, then stillness:

```ts
v.scene("result", { duration: 3.2, background: "#0a0a12" }, (s) => {
  s.beat("result", { at: 0.15, description: "Boxed result, then stillness" });
  const res = LINES[LINES.length - 1]!;
  s.rect("result-panel", { width: res.length * CW + 80, height: 120, fill: "#f59e0b", opacity: 0.12,
    radius: 10, at: { x: 420 + (res.length * CW) / 2, y: lineY(LINES.length - 1) },
    enter: { effect: "wipe", duration: 0.4, delay: 0.2 } });
  LINES.forEach((line, i) => {
    const last = i === LINES.length - 1;
    s.text(`line-${i + 1}`, line, { font: "monospace", size: SIZE, color: last ? "#f8fafc" : "#64748b",
      opacity: last ? 1 : 0.5, at: { x: 420, y: lineY(i), align: "left" } });
    if (!last) s.text(`imply-${i + 1}`, "⟹", { size: 40, color: "#f59e0b", at: { x: 520, y: lineY(i) + 105 } });
  });
  s.text("qed", "RESULT", { size: 26, weight: 700, letterSpacing: 4, color: "#f59e0b",
    at: { x: 420, y: lineY(LINES.length - 1) + 95, align: "left" }, enter: { effect: "fade", duration: 0.3, delay: 0.4 } });
});
```

If the renderer's font stack lacks the "⟹" glyph, swap to "=>" - same semantics, zero risk. Join steps with `v.transition("crossfade", { duration: 0.4, between: ["step-1", "step-2"] })` etc.

## QA gates

- `expect(frame(0)).not.toBeBlack()` - the topic text (declared without enter) is the frame-0 ink.
- Every step scene: `toContainText` for its active line at >= 0.65s scene-local; `toHaveLayers("focus-underline", "caption")` - the highlight pair survives edits.
- Gray replays stay assertable: opacity 0.5 (>= the ~0.05 visibility floor); if you dim further, QA cannot see the line and neither can viewers.
- Result scene: `toContainText` for the final line and "RESULT"; `toHaveLayers("result-panel")` declared before the lines (painter's order - assert by `layer.inspect` order if in doubt).
- `noTextOverflow()` on every scene, plus the budget check: longest line chars x 34 + 420 <= 1500.
- `durationBetween`: step scenes 2.5-3.2s each, result 2.8-3.5s, total 8-15s; last entrance (qed at 0.7s) leaves >= 0.8s of stillness.

## Anti-patterns

- Trying to gray a line out inside its own scene - color and opacity are static per layer in v1; the dimming happens by re-declaring gray in the next scene, and the crossfade is the animation.
- Eyeballing the underline position - count characters in the source string; one glyph off means underlining the wrong term, the worst kind of math error.
- Proportional fonts or over-budget lines - both break the chars x CW geometry: monospace only, and drop size 56 -> 44 (budget grows to 44 chars) before shrinking margins; a line touching the right edge fails `check.overflow`.
- All lines entering staggered in ONE scene - when everything is white and moving, active and done are indistinguishable; the per-scene split is the readability mechanism.
- Skipping operation captions - the arrow says THAT it transforms, the caption says WHY; without captions the derivation is a magic trick, not an explanation.
- `scale-pop` on formulas - bouncy entrances trivialize the content; blur-in and fade only.
