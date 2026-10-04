---
name: cinematic-video
version: 0.1.0
description: Compose multi-scene cinematic videos with camera moves, crossfades, and a named beat grid.
trigger: The user asks for a "cinematic", "movie-like", "trailer", "brand film", or otherwise emotionally paced multi-scene video with motion design (not a data/chart or screen-recording video).
---

# Cinematic Video

Goal: scenes that breathe — camera drift, layered entrances, crossfade rhythm, and a semantic beat grid an agent (or Studio user) can navigate later.

## Workflow

1. `storyboard.plan { intent, durationSeconds, style }` → shots. Keep 5–12s total for a first pass (4–6 shots). Rewrite the generated shot list to match the user's narrative before continuing — the template is a skeleton, not the story.
2. `storyboard.toScenes { shots }` → draft DSL. Paste it into `src/video.ts` (via `scene.modify`-style edits or a full rewrite), then `compile.run` and read `data.diagnostics` — must be 0 errors.
3. Add camera + layering per scene (see Recipes). One camera per scene; declare a soft glow/decoration rect **without** an `enter` so frame 0 is never black.
4. Stamp the beat grid: one `s.beat()` per narrative event (each entrance, each reveal) — beats become your QA anchors and the Studio timeline markers.
5. `compile.run` → `render.preview { scene, beat }` for every beat — eyeball each still before rendering video.
6. Write/extend `tests/video.test.ts` (see QA gates), `test.run`, fix until `allPassed`.
7. `render.final` (or `videoos render`) → report the MP4 path.

## Recipes

Scene skeleton (title card with camera + layered entrances):

```ts
v.scene("title", { duration: 4, background: "#0a0a12" }, (s) => {
  s.beat("title-enter", { at: 0.2, description: "Main title blur-up entrance" });
  s.beat("subtitle-enter", { at: 0.8, description: "Subtitle fade-in" });

  s.rect("glow", { width: 700, height: 700, fill: "#6d28d9", opacity: 0.25, blur: 120, at: { x: "50%", y: "38%" } });

  s.text("title", "SHIP VIDEO", {
    size: 140, weight: 800, letterSpacing: 6, color: "#ffffff",
    at: { x: "50%", y: "38%" },
    enter: { effect: "blur-up", duration: 0.8, easing: "easeOutCubic", params: { distance: 40, blur: 12 } },
  });

  s.text("subtitle", "The agent-native video runtime", {
    size: 44, color: "#8b8ba7", at: { x: "50%", y: "52%" },
    enter: { effect: "fade", duration: 0.6, delay: 0.4 },
  });

  s.camera("push-in", { from: 1.0, to: 1.08 });
});
```

Parameter recipes (the pacing that reads "cinematic"):

| Parameter | Recipe | Why |
| --- | --- | --- |
| Beat spacing | one beat every 0.8–1.5s | denser feels hectic, sparser feels slow |
| Push-in | `from: 1.0, to: 1.08` over 3–5s | subtle drift; >1.12 looks like a zoom |
| Pull-out | `from: 1.08, to: 1.0` | reveals context / breathes out |
| Pan | `fromX: 0, toX: ±80` | parallax-ish lateral move |
| Title entrance | `blur-up` 0.8s `easeOutCubic` | focus-pull feel |
| List/labels | `slide-up` 0.5–0.6s, stagger `delay` 0.3s apart | readable kinetic rhythm |
| Punctuation | `scale-pop` 0.5–0.6s `easeOutBack` | single-word accents only |
| Crossfade | 0.4–0.6s, shorter than both scenes | legal minimum; >0.8s drags |
| Scene length | 2.5–5s each; total 5–12s for v1 | keeps QA/render loops fast |
| Easing default | `easeOutCubic` everywhere except `typewriter` (use `linear`) | consistent physics |

Stagger pattern for a kinetic list (one effect, three delays):

```ts
s.text("item-1", "01 · Deterministic pipeline", { size: 46, at: { x: "50%", y: "44%" },
  enter: { effect: "slide-up", duration: 0.6, delay: 0.3, easing: "easeOutCubic", params: { distance: 60 } } });
s.text("item-2", "02 · Visual QA on every frame", { size: 46, at: { x: "50%", y: "56%" },
  enter: { effect: "slide-up", duration: 0.6, delay: 0.9, easing: "easeOutCubic", params: { distance: 60 } } });
s.text("item-3", "03 · Rollback-safe agent edits", { size: 46, at: { x: "50%", y: "68%" },
  enter: { effect: "slide-up", duration: 0.6, delay: 1.5, easing: "easeOutCubic", params: { distance: 60 } } });
```

## QA gates

Add these to `tests/video.test.ts` before declaring done (all frames are global; scene start = Σ previous durations − crossfade overlaps):

- `expect(frame(0)).not.toBeBlack()` — decoration visible from frame 0.
- Per key text: `expect(frame(N)).toContainText("…")` with `N/30 ≥ sceneStart + in + delay + duration` (entrance COMPLETE — `blur-up`/`fade` multiply opacity, partial frames fail).
- `expect(scene(name)).toHaveBeat(…)` for every beat you authored; `toHaveLayers(...)` for the scene's key layers.
- `expect(scene(name)).durationBetween(min, max)` pinning your pacing budget per scene.
- `expect(scene(name)).noTextOverflow()` on every scene with body copy.

## Anti-patterns

- No-frame-0 ink: every layer has an `enter` and the background is near-black → `not.toBeBlack()` fails. Keep one static decoration rect/ellipse.
- Asserting text mid-entrance (opacity ramp or typewriter slice) → flaky `toContainText`. Always assert after `delay + duration`.
- Camera on every scene: motion fatigue; alternate moving and static scenes.
- `slide-*` with default `distance: 40` on 1920×1080 — barely visible. Use 50–120px (or the element's own size for bar-growth effects).
- Transitions between non-adjacent scenes or ≥ the shorter scene — `DSL_NON_ADJACENT_TRANSITION` / `DSL_INVALID_TRANSITION` throw at build time.
- Randomness via `Math.random()` — breaks determinism and the cache. Use `createRng(seed)` from `@videoos/core` with the video `seed`.
- >5 layers animating simultaneously with different easings — soup. Layer with delays instead.
