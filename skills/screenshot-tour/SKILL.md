---
name: screenshot-tour
version: 0.1.0
description: Turn a sequence of UI screenshots into a guided tour — Ken Burns zoom/pan over image layers, numbered callouts, and zoom-to-detail cuts.
trigger: The user supplies screenshots, mockups, slides, or frame grabs and wants them walked through as a video (image-led, not kinetic type).
---

# Screenshot Tour

Goal: a 20–40s 16:9 tour (1920×1080, 30fps) where the user's screenshots do the acting: each gets 3–6s of camera life (push-in or pan, never both in a row), 1–2 numbered callouts land beside the feature they name, and one zoom-to-detail cut punches into a region at 2×.

## Workflow

1. Collect the screenshots and ask which regions matter (pixel coords if they have them, else approximate percentages). Register every file with `asset.add { path, name }` before writing any DSL — the DSL references `assets/<name>`, and a typo'd path is this genre's #1 failure.
2. Order the shots into a narrative: overview → detail → outcome. One idea per shot; two ideas = two shots.
3. `storyboard.plan { intent: "tour of <product> in N shots", durationSeconds }` → remap onto shot scenes + one zoom-cut + optional outro.
4. Write `src/video.ts` with `s.image(name, "assets/shot-01.png", { width, height, at })` — always explicit width/height (no auto-fit): letterbox on a panel if the aspect differs from 16:9.
5. `compile.run` → 0 errors → `check.missingAssets` must come back clean BEFORE previewing; then `check.overflow` for captions.
6. `render.preview { scene, beat }` per shot: callouts must sit beside their feature (v1 has no leader lines — proximity is the pointer), and `render.range` over the zoom-cut to re-check the placement math on real frames.
7. QA gates (below) → `test.run` → repair ≤ `maxRepairLoops` → `transaction.rollback`; `render.final` + the asset list in the report.

## Recipes

Shot with Ken Burns — image static at full fit, camera provides the life; caption on a scrim if the shot is bright:

```ts
v.scene("shot-1", { duration: 5, background: "#0a0a12" }, (s) => {
  s.beat("shot-1", { at: 0.2, description: "Overview — the dashboard" });
  s.image("shot", "assets/shot-01.png", { width: 1720, height: 968, at: { x: 960, y: 508 } });
  s.text("caption", "The dashboard: everything in one glance", { size: 44, color: "#8b8ba7",
    at: { x: 960, y: 1004 }, enter: { effect: "fade", duration: 0.5, delay: 0.4 } });
  s.camera("push-in", { from: 1.0, to: 1.07 });
});
```

Callouts — numbered dots pop onto features, labels slide in beside them (dot + label adjacency replaces leader lines):

```ts
s.beat("callout-1", { at: 0.9, description: "Point at the render queue" });
s.beat("callout-2", { at: 2.5, description: "Point at the cost meter" });
s.image("shot", "assets/shot-02.png", { width: 1720, height: 968, at: { x: 960, y: 508 } });
const callouts = [ // dot ON the feature, label offset to open space — never over text
  { n: "1", x: 640, y: 400, label: "Render queue", lx: 850, ly: 400 },
  { n: "2", x: 1210, y: 620, label: "Cost meter", lx: 1000, ly: 620 },
];
for (const [i, c] of callouts.entries()) {
  s.ellipse(`dot-${i}`, { width: 52, height: 52, fill: "#f59e0b", at: { x: c.x, y: c.y },
    enter: { effect: "scale-pop", duration: 0.4, delay: 0.9 + i * 1.6, easing: "easeOutBack" } });
  s.text(`num-${i}`, c.n, { size: 34, weight: 800, color: "#0a0a12", at: { x: c.x, y: c.y - 2 },
    enter: { effect: "fade", duration: 0.3, delay: 1.0 + i * 1.6 } });
  s.text(`label-${i}`, c.label, { size: 40, weight: 600, color: "#ffffff", at: { x: c.lx, y: c.ly },
    enter: { effect: "slide-left", duration: 0.5, delay: 1.0 + i * 1.6, params: { distance: 60 } } });
}
s.camera("pan", { fromX: 0, toX: -70 }); // lateral drift ≤ ±80 or it reads as a swipe
```

Zoom-to-detail cut — the SAME asset re-placed at 2× with the region centered; the placement IS the zoom, so keep the camera static:

```ts
// screenshot is 1720×968; at 2× it is 3440×1936. To center region (rx, ry) of the original:
//   at.x = 960 - rx * 2 + 1720, at.y = 540 - ry * 2 + 968   (canvas center minus scaled offset)
v.scene("zoom", { duration: 4, background: "#0a0a12" }, (s) => {
  s.beat("zoom", { at: 0.2, description: "Punch into the render queue from shot-2" });
  s.image("detail", "assets/shot-02.png", { width: 3440, height: 1936, at: { x: 960 - 640 * 2 + 1720, y: 540 - 400 * 2 + 968 } });
  s.text("zoom-cap", "Queue depth at a glance", { size: 44, color: "#e2e8f0", at: { x: 960, y: 1004 },
    enter: { effect: "fade", duration: 0.5, delay: 0.5 } });
});
v.transition("cut", { between: ["shot-2", "zoom"] }); // punch in; crossfade 0.3 is the softer option
```

Letterboxing: a 4:3 grab becomes 1291×968 on a 1450×1030 panel rect behind it — the panel is the frame, the image keeps its aspect.

## QA gates

- `expect(scene("shot-2")).toHaveLayers("shot", "dot-0", "num-0", "label-0", "label-1")` — callout kit complete.
- `toContainText` for every caption and label, each after its entrance completes; captions at size ≥ 44 to stay legible over busy UI.
- `durationBetween`: shots 3–6, zoom 3–5; `noTextOverflow()` on caption scenes; `not.toBeBlack()` frame 0 (the image is the ink — never give it an `enter`).
- VAP gate before any of this: `check.missingAssets` clean after `compile.run`.

## Anti-patterns

- Leader lines — v1 has no line primitive; a dot beside its label points by proximity, and that is the style.
- More than 2 callouts per shot — the viewer stops seeing the UI; split the shot instead.
- Callouts naming something off-screen or in a different shot — dot and feature must share a frame.
- Auto-fit assumptions — always declare image width/height; a 16:10 grab stretched to 16:9 ships a distorted UI.
- Zoom cuts without the placement-math comment — un-reviewable magic numbers get "fixed" into broken ones.
- Pan then pan then pan — alternate push-in and pan, and let every third shot sit static on `static`.
- Bright screenshot + white caption — drop a scrim rect (`fill: "#0a0a12"`, `opacity: 0.55`) behind the caption band first.
