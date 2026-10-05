---
name: tech-intro
version: 0.1.0
description: Tech-styled product intro (5-8s): luminous grid backdrop, big-type blur-up reveal, camera push then pull.
trigger: The user asks for a "tech intro", "opening sting", futuristic/cyber product cold-open, or a few-second title card that precedes a longer video or stream.
---

# Tech Intro

Goal: a 5-8s 1920x1080 cold-open (square 1080x1080 when destined for social avatars) that establishes brand tone in one breath - grid, name, settle - because nothing else survives this duration.

## Workflow

1. Collect: product name (short - if it needs two lines, abbreviate), optional one-line tagline, accent color (default amber). Agree on 5-8s; longer is a product-demo, not a sting.
2. `storyboard.plan { intent: "<name> · tech intro sting", durationSeconds: 7 }` - collapse the shot list to 2 scenes / 3 acts (below); `storyboard.toScenes` output is a draft, the act table is the contract.
3. Write `src/video.ts`: grid rects FIRST (painter's order - type must paint over grid), then glow, then type. One camera per scene; the push-in / pull-out pair across scenes is the breathing pattern that defines this genre.
4. `compile.run` -> 0 errors required; letterSpaced caps overflow silently - run `check.overflow` too.
5. `render.preview { scene, beat }` on every beat - the grid must read as texture (squint test), never as content competing with the name.
6. QA gates (below) -> `test.run` -> repair loop (<= maxRepairLoops, then `transaction.rollback` if you began one) -> `render.final`.

| Act | Window | Scene | Job | Dominant element |
| --- | --- | --- | --- | --- |
| Grid establish | 0-1.5s | `grid` | the tech world exists | grid lines + violet glow (frame-0 ink) |
| Name reveal | 1.5-3.5s | `grid` | the name lands | name, size >= 140, blur-up |
| Lockup breathe | 3.5-7s | `lockup` | name + tagline settle, then still | tagline; camera pull-out |

## Recipes

Grid + reveal - verticals every 240px, horizontals every 270px, all static (no `enter`) so frame 0 has ink; name blur-ups at 0.9s under a push-in:

```ts
v.scene("grid", { duration: 3.5, background: "#0a0a12" }, (s) => {
  s.beat("grid-on", { at: 0.15, description: "Grid rises to visibility with the glow" });
  s.beat("name-in", { at: 0.9, description: "Name blur-up reveal" });
  for (let i = 1; i < 8; i++) {
    s.rect(`vline-${i}`, { width: 2, height: 1080, fill: "#8b8ba7", opacity: 0.12, at: { x: i * 240, y: 540 } });
  }
  for (let j = 1; j < 4; j++) {
    s.rect(`hline-${j}`, { width: 1920, height: 2, fill: "#8b8ba7", opacity: 0.12, at: { x: 960, y: j * 270 } });
  }
  s.rect("glow", { width: 900, height: 900, fill: "#6d28d9", opacity: 0.28, blur: 140, at: { x: "50%", y: "40%" } });
  s.text("name", "NEBULA", { size: 150, weight: 800, letterSpacing: 10, color: "#ffffff",
    at: { x: "50%", y: "40%" },
    enter: { effect: "blur-up", duration: 0.8, delay: 0.9, easing: "easeOutCubic", params: { distance: 40, blur: 14 } } });
  s.camera("push-in", { from: 1.0, to: 1.09 });
});
```

Lockup - the pull-out answers the push-in; amber rule wipes left-to-right, tagline blurs in, last 1.2s dead still:

```ts
v.scene("lockup", { duration: 3.5 }, (s) => {
  s.beat("settle", { at: 0.3, description: "Tagline settles under the name" });
  s.text("name-rest", "NEBULA", { size: 92, weight: 800, letterSpacing: 8, color: "#ffffff",
    at: { x: "50%", y: "40%" } });
  s.rect("rule", { width: 180, height: 4, fill: "#f59e0b", radius: 2, at: { x: "50%", y: "48%" },
    enter: { effect: "wipe", duration: 0.5, delay: 0.4 } });
  s.text("tagline", "compute at the edge", { size: 40, color: "#8b8ba7", at: { x: "50%", y: "55%" },
    enter: { effect: "blur-in", duration: 0.7, delay: 0.6 } });
  s.camera("pull-out", { from: 1.07, to: 1.0 });
});
v.transition("crossfade", { duration: 0.5, between: ["grid", "lockup"] });
```

Grid density dial (keep the ratios at any canvas):

| Canvas | Vertical spacing | Horizontal spacing | Line opacity |
| --- | --- | --- | --- |
| 1920x1080 | 240px | 270px | 0.10-0.15 |
| 1080x1080 | 216px | 216px | 0.10-0.15 |
| 1080x1920 | 270px | 240px | 0.10-0.15 |

## QA gates

- `expect(frame(0)).not.toBeBlack()` - the glow + grid are static, frame 0 has ink.
- `expect(frame(60)).toContainText("NEBULA")` - entrance completes at 0.9 + 0.8 = 1.7s; assert at >= frame 54.
- `expect(scene("grid")).toHaveLayers("glow", "name", "vline-1", "hline-1")` - grid survives edits.
- `expect(scene("grid")).durationBetween(3, 4)` and `expect(scene("lockup")).durationBetween(3, 4.5)`.
- `noTextOverflow()` on both scenes - letterSpacing inflates measured width past the compile heuristic.
- Lockup stillness: no layer in `lockup` has an `exit`; last entrance ends at 1.3s of a 3.5s scene.

## Anti-patterns

- Motion soup - camera + per-line grid animation + text effects at once. The grid is static; the camera and type carry all motion.
- Grid opacity > 0.2 or spacing < 160px - texture becomes noise, the name loses dominance.
- A second message (features, metrics, CTA) - that is product-demo territory; a sting states one name.
- Ending on movement - the last second must be still; intros get looped and scrubbed.
- Logos/screenshots by default - zero-asset; `s.image` only when the user supplies files (`asset.add`) with explicit width/height.
