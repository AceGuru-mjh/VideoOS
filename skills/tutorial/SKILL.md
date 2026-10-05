---
name: tutorial
version: 0.1.0
description: Structure a how-to / walkthrough video as numbered step scenes, each with a spotlight focus frame wiping onto the action region.
trigger: The user asks to teach a procedure — setup, walkthrough, "how to do X", feature tour with steps — as a video (teaching steps, not marketing hype).
---

# Tutorial

Goal: a 30–45s 16:9 how-to (1920×1080, 30fps) with one step per scene: a giant step number anchoring the left column, an action line on top, and a schematic work area on the right where an amber focus frame wipes onto exactly the region that step touches.

## Workflow

1. Decompose the procedure into 3–5 steps, one action each ("click Publish" is a step; "set up and publish" is two). Real screenshots exist? This skill stays schematic by default — hand off to **screenshot-tour** for image-led tours.
2. `storyboard.plan { intent: "how to <goal> in N steps", durationSeconds }` → remap onto overview → step-1..N (5–7s each) → recap.
3. Write `src/video.ts`: step number ≥ 120px at x ≈ 16%, work-area panel 900×560 at (1306, 594), focus frame = tint + four edge rects entering with `wipe` (Recipes).
4. `compile.run` → 0 errors → `check.overflow` (the action line at size 60 is the usual offender: ≤ 30 chars or split it).
5. `render.preview { scene, beat }` for every step — the #1 tutorial sin is a spotlight pointing at the wrong region; verify frame lands ON the thing the step names.
6. QA gates (below) → `test.run` → repair ≤ `maxRepairLoops`, then `transaction.rollback` and cut a step rather than rushing the rest.
7. `render.final` → deliver MP4 + the step list, so the user can diff it against the real procedure.

| Act | Window | Scene | Job | Dominant element |
| --- | --- | --- | --- | --- |
| Overview | 0–5s | `overview` | promise + step count | "3 steps to X" headline |
| Steps | 5–35s | `step-1..3` | one action each | giant number + focus frame |
| Recap | 35–40s | `recap` | checklist + next step | numbered checklist rows |

## Recipes

Step scene skeleton — number left, action top, camera drift for a "live demo" feel:

```ts
v.scene("step-1", { duration: 6, background: "#0a0a12" }, (s) => {
  s.beat("step-1", { at: 0.2, description: "Step 01 — open the render panel" });
  s.text("num", "01", { size: 220, weight: 800, color: "#f59e0b", font: "monospace",
    at: { x: 307, y: 454 }, enter: { effect: "slide-up", duration: 0.5, params: { distance: 80 } } });
  s.text("num-label", "STEP", { size: 36, weight: 700, letterSpacing: 8, color: "#8b8ba7",
    at: { x: 307, y: 610 }, enter: { effect: "fade", duration: 0.4, delay: 0.2 } });
  s.text("action", "Open the render panel", { size: 60, weight: 700, color: "#ffffff",
    at: { x: 845, y: 216 }, maxWidth: 1100,
    enter: { effect: "slide-up", duration: 0.5, delay: 0.3, params: { distance: 60 } } });
  // work area + focus frame (next recipe) goes here
  s.camera("push-in", { from: 1.0, to: 1.05 });
});
```

Work area + spotlight — the signature: a schematic UI from rects, then a hollow amber frame (four edge rects + tint) wiping onto the target; the region stays visible through the frame:

```ts
s.rect("work", { width: 900, height: 560, fill: "#12121e", radius: 16, at: { x: 1306, y: 594 } });
s.rect("rail", { width: 180, height: 544, fill: "#0a0a12", opacity: 0.7, at: { x: 946, y: 594 } });
s.rect("block-a", { width: 300, height: 160, fill: "#0a0a12", opacity: 0.7, radius: 10, at: { x: 1250, y: 430 } });
s.rect("block-c", { width: 650, height: 150, fill: "#0a0a12", opacity: 0.7, radius: 10, at: { x: 1425, y: 690 } });
const fx = 1250, fy = 430, fw = 360, fh = 220; // the region this step touches (block-a)
s.rect("focus-tint", { width: fw - 16, height: fh - 16, fill: "#f59e0b", opacity: 0.1, radius: 10,
  at: { x: fx, y: fy }, enter: { effect: "wipe", duration: 0.5, delay: 1.0 } });
s.rect("focus-top", { width: fw, height: 8, fill: "#f59e0b", radius: 4, at: { x: fx, y: fy - fh / 2 + 4 },
  enter: { effect: "wipe", duration: 0.5, delay: 1.0 } });
s.rect("focus-bottom", { width: fw, height: 8, fill: "#f59e0b", radius: 4, at: { x: fx, y: fy + fh / 2 - 4 },
  enter: { effect: "wipe", duration: 0.5, delay: 1.0 } });
s.rect("focus-left", { width: 8, height: fh, fill: "#f59e0b", radius: 4, at: { x: fx - fw / 2 + 4, y: fy },
  enter: { effect: "wipe", duration: 0.5, delay: 1.0 } });
s.rect("focus-right", { width: 8, height: fh, fill: "#f59e0b", radius: 4, at: { x: fx + fw / 2 - 4, y: fy },
  enter: { effect: "wipe", duration: 0.5, delay: 1.0 } });
s.text("focus-label", "Render panel", { size: 40, weight: 600, color: "#f59e0b", at: { x: fx, y: 584 },
  enter: { effect: "fade", duration: 0.4, delay: 1.5 } });
s.ellipse("cursor", { width: 30, height: 30, fill: "#f59e0b", at: { x: fx, y: fy },
  enter: { effect: "scale-pop", duration: 0.4, delay: 1.8, easing: "easeOutBack" } }); // the click point
```

Recap — numbered checklist reusing the step-number motif, then a "next" tease:

```ts
const done = ["Panel open", "Preset chosen", "First render queued"];
for (const [i, line] of done.entries()) {
  s.text(`num-${i}`, `0${i + 1}`, { size: 40, weight: 700, font: "monospace", color: "#f59e0b",
    at: { x: 660, y: 480 + i * 110 }, enter: { effect: "fade", duration: 0.4, delay: 0.4 + i * 0.5 } });
  s.text(`line-${i}`, line, { size: 52, weight: 600, color: "#e2e8f0", at: { x: 1040, y: 480 + i * 110 },
    enter: { effect: "slide-right", duration: 0.5, delay: 0.45 + i * 0.5, params: { distance: 50 } } });
}
```

Join step scenes with `v.transition("crossfade", { duration: 0.35, between: ["step-1", "step-2"] })` — faster than marketing cuts; steps should feel like turning pages.

## QA gates

- `toContainText` for each step number ("01"…"03"), action line, and focus label — after each entrance completes.
- `expect(scene("step-1")).toHaveLayers("num", "focus-tint", "focus-top", "focus-bottom", "focus-left", "focus-right", "cursor")`.
- `durationBetween`: every step scene 4–7; recap 3–5; `noTextOverflow()` on all scenes; `not.toBeBlack()` at frame 0 (the work panel has no `enter` — it is the ink).

## Anti-patterns

- Two actions in one step — split the scene; the number promises exactly one thing.
- Focus frame without `wipe` — a fading frame reads as decoration; a wiping frame reads as "look HERE".
- Spotlight on the wrong region — the death sentence for a tutorial; `render.preview` every step before test.
- Step number under 120px — it is the anchor and the progress indicator; small numbers are subtitles.
- More than 6 steps in one video — split chapters or hand off to a course (see **course-intro** for chapter grammar).
- Mixing real screenshots into the schematic style — pick one visual world per video.
