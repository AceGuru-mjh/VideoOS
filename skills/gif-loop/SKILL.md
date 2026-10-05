---
name: gif-loop
version: 0.1.0
description: Seamless looping GIF (3-6s): rest-to-rest motion so first and last frames match, 480px / 12-15fps / 8MB budgets, export via the media.gif MCP tool.
trigger: The deliverable is a looping GIF for docs, a README, Slack, or a demo embed - something that must autoplay silently forever - rather than a playable video file.
---

# GIF Loop

Goal: a 3-6s loop body whose first and last frames are equivalent: every motion starts from rest and returns to rest, one persistent layer anchors the seam, and the export lands inside the byte budget (480px wide, 12-15fps, at most 8MB) via the MCP `media.gif` tool. This is the one genre where exits are correct - a GIF returns to its start instead of ending (the end-card "fade in, never out" rule does not apply here).

## Workflow

1. Design the loop body 3-6s under the rest-to-rest contract: transient layers enter by ~40% of the body, exits complete by duration - 0.2s, and ONE persistent layer (glow, mark) with no enter and no exit carries frame 0 and the seam.
2. Write `src/video.ts` from the Recipes. Critical text is at least 96px in the master - at 480px wide the GIF shows a quarter size, and 96px becomes a readable 24px.
3. `compile.run` -> 0 errors; `render.preview` the FIRST and LAST frames specifically - they must match; confirm with `diff.frames` between frame 0 and the final frame (minimal delta = the seam gate).
4. `test.run` - the MP4 master's gates still apply; the GIF is a transform of a green master, not a QA bypass. Repair loop of at most 3 via `scene.modify`.
5. `render.final` the MP4 master (30fps full size).
6. Convert with the MCP `media.gif` tool: `{ input: <mp4>, output: <loop.gif>, fps: 12, width: 480 }` - fps 15 only for slow, small-amplitude motion.
7. Budget check: the file stays at or under 8MB (read the size back with `media.probe` on the .gif). Over budget -> apply the motion budget IN ORDER: fps 15 -> 12, then duration -1s, then halve slide distances and wipe spans; re-convert and re-check, at most 3 passes. Watch the loop twice end-to-end before delivering - one pass hides seam bugs.

## Recipes

Word loop - typewriter in, wipe out, glow rect as the persistent seam anchor:

```ts
v.scene("loop", { duration: 4, background: "#05070d" }, (s) => {
  s.beat("word-done", { at: 1.2, description: "Typed in; wipe-out completes by 3.7s" });
  s.rect("base", { width: 620, height: 300, fill: "#22d3ee", opacity: 0.14, blur: 110,
    at: { x: "50%", y: "46%" } });                 // persistent: no enter, no exit
  s.text("word", "ship it", { size: 150, weight: 800, color: "#f8fafc",
    at: { x: "50%", y: "46%" },
    enter: { effect: "typewriter", duration: 0.9, delay: 0.3 },
    exit: { effect: "wipe", duration: 0.5, delay: 3.2, easing: "easeInCubic" } });
});
```

Bar sweep loop - motion-first: the sweep is the show; everything exits, the dot anchors the seam:

```ts
v.scene("sweep", { duration: 3 }, (s) => {
  s.beat("sweep", { at: 0, description: "Rest to rest in 3s; exits done by 2.7s" });
  s.ellipse("dot", { width: 90, height: 90, fill: "#f59e0b", blur: 40,
    at: { x: "50%", y: "42%" } });                 // persistent seam anchor + frame-0 ink
  s.rect("bar", { width: 900, height: 12, fill: "#f8fafc", radius: 6,
    at: { x: "50%", y: "62%" },
    enter: { effect: "wipe", duration: 0.7, delay: 0.2, easing: "easeOutCubic" },
    exit: { effect: "wipe", duration: 0.6, delay: 2.1, easing: "easeInCubic" } });
  s.text("label", "v0.1 shipped", { size: 96, weight: 700, color: "#e2e8f0",
    at: { x: "50%", y: "40%" },
    enter: { effect: "blur-up", duration: 0.5, delay: 0.4 },
    exit: { effect: "fade", duration: 0.4, delay: 2.3 } });
});
```

## QA gates

- Seam gate: `diff.frames` between frame 0 and the final frame shows only the persistent base - any transient ink in the last frame is a seam bug.
- Rest tail: every `exit` completes by duration - 0.2s (audit via `layer.inspect`); nothing is mid-flight at the wrap point.
- Persistent base: at least one layer with no `enter` and no `exit` - it also satisfies `expect(frame(0)).not.toBeBlack()` (this genre would otherwise fail the library-wide ink rule with an empty frame 0).
- `durationBetween` 3-6s for the loop body.
- `noTextOverflow()` plus `check.overflow` on the master; critical text at least 96px (24px at 480px wide).
- Export budget: width 480, fps 12-15, file at or under 8MB - verified after conversion with `media.probe`, re-convert loop capped at 3.
- Loop watch: preview at least two consecutive wraps before delivery; seam bugs only appear at the wrap.

## Anti-patterns

- Enter-only loops - last frame full, first frame empty: the loop pops at the seam. This is THE GIF bug, and it comes from reusing end-scene habits (end-card skill) where exits are banned.
- 30fps exports - triple the bytes for motion no eye tracks at 480px; 12-15fps is the budget, not a compromise.
- Motion-heavy loops at 15fps - big wipes burn bytes; drop to 12 before cutting content (motion budget order).
- Bodies over 6s - GIF players scrub and pause poorly and bytes scale linearly; long loops ship as MP4 via `render.final`.
- Emptying frame 0 for "purity" - fails the ink gate and turns the seam into a black pop; keep one persistent layer.
- CTAs inside loops - an end-card settle is a dead frame looping forever; loops stay kinetic, end-cards end videos (different genres, opposite exit rules).
