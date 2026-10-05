---
name: math-derivation
version: 0.1.0
description: Formula derivation - one scene per step where the new term lands amber under a glow while earlier terms have settled to gray.
trigger: The user asks to animate a derivation, proof, identity expansion, or step-by-step equation walkthrough for teaching content.
---

# Math Derivation

Goal: a 10-20s 1920x1080 derivation (the math-teacher genre): one scene per step (3-6 steps, 2.5-3.5s each), the formula typeset in monospace term layers - the NEW term enters amber with a violet glow; crossfade and the same term is recast gray. Colors are fixed per layer, so "amber now, gray later" is achieved by SCENE-PER-STEP recasting - that recast is the genre's core DSL trick. Ends on the boxed result, held still.

## Workflow

1. Get the steps from the user (or derive them, then READ THEM BACK for confirmation - never animate math the user has not seen). One new thing per step; a step that changes two terms gets split.
2. `storyboard.plan { intent: "<identity> · derivation", durationSeconds: 14 }` - N step scenes + 1 result scene; crossfades 0.4s between adjacent steps only.
3. Write `src/video.ts`: formula terms as separate `s.text` layers. Position with the monospace layout law: char box ~ 0.62 x size, so `x_next = x_prev + (chars_prev + chars_next) x 0.31 x size` (+ one char of comfort around operators). Carried terms get NO `enter` - present from the scene's frame 0, already gray.
4. `compile.run` -> 0 errors; `check.overflow`.
5. `render.preview` EVERY step - math spacing is the #1 bug (gaps between terms, glowing the wrong term, misaligned fraction bars). Preview beats: the new-term landing and the settled formula.
6. QA gates (below) -> `test.run` -> repair loop (<= maxRepairLoops, then `transaction.rollback`) -> `render.final`.

| Act | Window | Job | Dominant element |
| --- | --- | --- | --- |
| Pose | 0-3s | the identity, whole | the LHS, >= 96 mono |
| Steps | 3-12s | one term lands amber per scene | the amber term + glow |
| Result | last 3.5s | boxed identity, still | the boxed line |

## Recipes

Pose + a step scene - carried terms have NO `enter` (they exist from frame 0, gray); the new term blur-ups amber over a glow rect declared BEFORE it (painter's order):

```ts
v.scene("step-1", { duration: 3, background: "#0a0a12" }, (s) => {
  s.beat("pose", { at: 0.3, description: "The identity to expand" });
  s.rect("glow", { width: 900, height: 420, fill: "#6d28d9", opacity: 0.14, blur: 130, at: { x: "50%", y: "46%" } });
  s.text("lhs", "(a + b)\u00B2", { size: 96, weight: 700, font: "monospace", color: "#ffffff",
    at: { x: "50%", y: "46%" },
    enter: { effect: "blur-up", duration: 0.6, easing: "easeOutCubic", params: { distance: 30, blur: 10 } } });
});

v.scene("step-3", { duration: 3 }, (s) => {
  s.beat("expand", { at: 0.3, description: "New term 2ab lands amber; a-squared and b-squared sit gray" });
  s.text("t-a2", "a\u00B2", { size: 80, weight: 700, font: "monospace", color: "#8b8ba7", at: { x: 640, y: 460 } });
  s.text("t-plus-1", "+", { size: 80, font: "monospace", color: "#8b8ba7", at: { x: 762, y: 460 } });
  s.rect("glow-2ab", { width: 240, height: 140, fill: "#6d28d9", opacity: 0.35, blur: 60, at: { x: 960, y: 460 } });
  s.text("t-2ab", "2ab", { size: 80, weight: 700, font: "monospace", color: "#f59e0b", at: { x: 960, y: 460 },
    enter: { effect: "blur-up", duration: 0.55, delay: 0.3, easing: "easeOutCubic", params: { distance: 26, blur: 10 } } });
  s.text("t-plus-2", "+", { size: 80, font: "monospace", color: "#8b8ba7", at: { x: 1140, y: 460 } });
  s.text("t-b2", "b\u00B2", { size: 80, weight: 700, font: "monospace", color: "#8b8ba7", at: { x: 1258, y: 460 } });
});
v.transition("crossfade", { duration: 0.4, between: ["step-1", "step-3"] });
```

Result - boxed identity: dark card + amber rules wiping from the left; hold still >= 1.5s (derivations end on proofs, not motion):

```ts
v.scene("result", { duration: 3.5 }, (s) => {
  s.beat("boxed", { at: 0.3, description: "Result settles into a boxed card and holds" });
  s.rect("card", { width: 780, height: 200, fill: "#12121f", radius: 12, at: { x: "50%", y: "46%" },
    enter: { effect: "fade", duration: 0.4 } });
  s.rect("rule-top", { width: 780, height: 5, fill: "#f59e0b", radius: 2, at: { x: "50%", y: "37.3%" },
    enter: { effect: "wipe", duration: 0.5, delay: 0.3 } });
  s.rect("rule-bottom", { width: 780, height: 5, fill: "#f59e0b", radius: 2, at: { x: "50%", y: "54.7%" },
    enter: { effect: "wipe", duration: 0.5, delay: 0.45 } });
  s.text("final", "(a + b)\u00B2 = a\u00B2 + 2ab + b\u00B2", { size: 60, weight: 700, font: "monospace",
    color: "#ffffff", at: { x: "50%", y: "46%" },
    enter: { effect: "blur-in", duration: 0.6, delay: 0.5 } });
});
```

Fractions and stacked scripts - v1 text is single-baseline, so build them from layers: a fraction is numerator / thin rect bar / denominator; a subscript is a smaller layer nudged down:

```ts
s.text("num", "1", { size: 56, font: "monospace", color: "#ffffff", at: { x: 960, y: 400 } });
s.rect("bar", { width: 110, height: 6, fill: "#ffffff", radius: 3, at: { x: 960, y: 460 } });
s.text("den", "1 \u2212 x", { size: 56, font: "monospace", color: "#ffffff", at: { x: 960, y: 520 } });
// subscript: "x" at size 64 + "n" at size 36, y +18, x +half the glyph width
```

## QA gates

- `expect(frame(30)).toContainText("(a + b)\u00B2")` - pose settles at 0.9s (frame >= 27).
- Step 3's new term: `expect(frame(190)).toContainText("2ab")` - step-3 starts at 5.2s global (3 + 3 - 2 x 0.4 crossfade overlap), the term settles at 5.2 + 0.3 + 0.55 = 6.05s (frame >= 182); always recompute from the crossfade table and comment the math.
- `expect(scene("step-3")).toHaveLayers("t-a2", "t-plus-1", "glow-2ab", "t-2ab", "t-plus-2", "t-b2")`.
- Every step: `durationBetween(2.5, 3.5)`; `noTextOverflow()`.
- Result stillness: last entrance ends at 1.1s of 3.5; `expect(frame(MID_RESULT)).toContainText("2ab")` and hand-check the final second in `render.preview`.
- Read-back gate: the user confirmed every step's content BEFORE `render.final` (math errors are content bugs QA cannot catch).

## Anti-patterns

- One scene for the whole derivation with recoloring hopes - layer colors are static; the recast happens ACROSS scenes, not within one.
- Two new terms in one step - split the step; derivations that leap lose students.
- The glow declared after the term - it paints over the text; glows always declare first.
- Sans-serif math - monospace only; term width math (0.62 x size per char) assumes it.
- Timing by vibes - term x positions are computed, and so are enter delays: the new term lands 0.3s into its scene, holds ~2s.
- Skipping the read-back - an unconfirmed derivation ships a wrong proof at 60fps.
