---
name: screenshot-tour
version: 0.1.0
description: Guided UI walkthroughs over user-supplied screenshots: slow Ken Burns push-in, numbered annotation dots, and flat placeholder cards.
trigger: The user provides screenshots or UI captures and asks for a product tour, feature walkthrough, or interface demo video.
---

# Screenshot Tour

Goal: a 10–20s (1920×1080, 30fps) guided tour over 3–5 user-supplied screenshots: each shot holds 2.5–3.5s under a slow push-in (scale 1 → 1.05), with one caption and 1–3 numbered annotation dots. Images exist ONLY when the user supplies files (`asset.add`); with no files, ship the identical timing over flat placeholder cards and swap the captures in later.

## Workflow

1. Collect from the user: screenshot files in viewing order, one caption per shot (≤ 7 words), and 1–3 annotation targets per shot in plain words ("the save button, top-right"). Ask for anything missing — never mock up a UI that was not provided.
2. `asset.add { path }` each file → `asset.list` to confirm names and sizes. Declare `width`/`height` on every image layer from the asset's real aspect ratio (fit inside 1600×760, letterbox with the scene background — never stretch). Assets not ready yet → placeholder recipe, and say so in the delivery note.
3. `storyboard.plan { intent: "screenshot tour · <product>", durationSeconds }` → title card (1.5–2s) → one scene per shot; the 2.5–3.5s per-shot window is the contract.
4. Write `src/video.ts` (Recipes): image first, camera push, caption, then dots — painter's order, dots on top.
5. `compile.run` → 0 errors → `check.overflow` → `check.missingAssets`: an unresolved image src is a hard stop, not a warning.
6. `render.preview { scene, beat }` per shot — every dot must sit ON the thing it names and ≥ 60px inside the shot's edge (the push-in magnifies and crops toward center); verify in the preview, not just in coordinates.
7. QA gates (below) → `test.run` → repair loop ≤ 3 (`scene.modify`; `transaction.begin` / `transaction.rollback` for annotation surgery) → `render.final`.

## Recipes

Tour scene — screenshot under a Ken Burns push, caption, numbered dot:

```ts
v.scene("shot-1", { duration: 3, background: "#0a0a12" }, (s) => {
  s.beat("hold", { at: 0.2, description: "Shot visible, caption lands" });
  s.image("shot", "assets/dashboard.png", { width: 1520, height: 855, radius: 12,
    at: { x: 960, y: 500 } });                        // 1520x855 keeps the source 16:9 ratio, fitted not stretched
  s.camera("push-in", { from: 1.0, to: 1.05 });       // Ken Burns: 0.05 over the whole shot, no more
  s.text("caption-1", "The project dashboard", { size: 44, weight: 600, color: "#f8fafc",
    at: { x: 960, y: 990 }, enter: { effect: "slide-up", duration: 0.4, delay: 0.2, params: { distance: 30 } } });
  // dot after the caption so the eye reads caption → dot
  s.ellipse("dot-1", { width: 56, height: 56, fill: "#f59e0b", at: { x: 700, y: 420 },
    enter: { effect: "scale-pop", duration: 0.4, delay: 0.7, easing: "easeOutBack" } });
  s.text("dot-1-n", "1", { size: 30, weight: 800, color: "#0a0a12", at: { x: 700, y: 420 },
    enter: { effect: "fade", duration: 0.3, delay: 0.75 } });
});
```

Pointer line — thin rotated rect from a dot toward its target (declare before the dot so the dot caps the line; fade it in — wipe only renders on text layers):

```ts
s.rect("ptr-2", { width: 130, height: 5, fill: "#f59e0b", radius: 2, rotation: -32, at: { x: 880, y: 560 },
  enter: { effect: "fade", duration: 0.35, delay: 1.1 } });
s.ellipse("dot-2", { width: 56, height: 56, fill: "#f59e0b", at: { x: 950, y: 500 },
  enter: { effect: "scale-pop", duration: 0.4, delay: 1.35, easing: "easeOutBack" } });
s.text("dot-2-n", "2", { size: 30, weight: 800, color: "#0a0a12", at: { x: 950, y: 500 },
  enter: { effect: "fade", duration: 0.3, delay: 1.4 } });
```

Placeholder card — no files yet; same beats and timing, flat color, explicit replace-me label:

```ts
s.rect("card-1", { width: 1520, height: 855, fill: "#111527", radius: 12, at: { x: 960, y: 500 },
  enter: { effect: "fade", duration: 0.5 } });
s.text("card-1-label", "Screenshot 1 of 3 — dashboard", { size: 44, color: "#8b8ba7",
  at: { x: 960, y: 500 }, enter: { effect: "fade", duration: 0.5, delay: 0.3 } });
```

Title card, then shots joined with `v.transition("crossfade", { duration: 0.4, between: ["shot-1", "shot-2"] })`; end the last shot on ≥ 0.8s of stillness. On annotation-dense shots skip the camera (static default) — motion plus dots reads as noise.

## QA gates

- `expect(frame(30)).toContainText(<title card name>)` — 1s readability on the opener.
- Per shot: `toContainText` for the caption and every dot number at a frame ≥ shotStart + delay + 0.45.
- `expect(scene("shot-1")).toHaveLayers("shot", "caption-1", "dot-1", "dot-1-n")`; placeholder mode asserts `("card-1", "card-1-label")`.
- `check.missingAssets` clean in image mode — placeholders are a deliberate draft choice, an unresolved src is a failed build.
- `durationBetween`: each shot 2.5–3.5s, title card ≤ 2.5s, total 10–20s.
- `noTextOverflow()` per scene + `check.overflow` — captions are single-line at 44px.
- Muted rule: captions carry the tour; a dot the viewer cannot locate in the preview is a misplaced dot, whatever the coordinates say.

## Anti-patterns

- Inventing screenshots, mock UIs, or hot-linked URLs — image layers only over files the user supplied via `asset.add`; a tour of fabricated UI is a credibility bug and `check.missingAssets` fails the build anyway.
- Stretching to fill the frame — declare width/height from the source's real ratio and letterbox; a stretched screenshot instantly reads as broken.
- Push-in past 1.05 — Ken Burns is ambience; at 1.1+ a 3s shot visibly drifts and starts cropping the annotations off.
- More than 3 dots per shot — each dot needs ~0.5s to land and be located; a 4th dot means the shot wants to be two shots.
- Dots near the shot's edge — the push-in magnifies toward center; anything within ~60px of the edge gets cropped mid-tour.
- Skipping the placeholder pass — the no-files draft is how you get timing and annotation sign-off before anyone hunts down clean captures.
