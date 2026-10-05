---
name: tech-intro
version: 0.1.0
description: Tech-style product intro (5-8s): grid backdrop, big blur-up wordmark, camera push, accent glow.
trigger: The user asks for a tech / futuristic / "digital feel" opening title or intro sting for a product, release, or channel (shorter than a full promo).
---

# Tech Intro

Goal: a 5–8s (1920×1080, 30fps) tech-styled opener: dark backdrop, subtle grid, one dominant wordmark that lands in the first second, camera breathing, and a still final 0.8s. Zero-asset: grid and glow are rects, the wordmark is text.

## Workflow

1. Collect: product/wordmark text, one optional tagline (≤ 8 words), accent color (default `#22d3ee`; never pure indigo/blue unless the user's brand demands it). Ask if missing — do not invent a tagline.
2. `storyboard.plan { intent: "tech intro · <wordmark>", durationSeconds }` → three beats only: land (0–1s), breathe (1–5s), hold (final 0.8s+). Delete any extra shots the template suggests — intros are one scene, not a story.
3. Write `src/video.ts` as ONE scene (Recipes). Grid = 2 rect "lines" per axis is wrong — use the loop recipe; keep every layer named `grid-*`, `wordmark`, `tagline`, `glow`.
4. `compile.run` → 0 errors; then `compile.diagnostics` — treat any `OVERFLOW_RISK` on the wordmark as a hard fail (shrink font before shrinking margins).
5. `render.preview { scene: "intro", beat: "land" }` and `{ beat: "breathe" }` — check: exactly ONE dominant element (the wordmark) at every beat; grid is texture, tagline is secondary.
6. `test.run` → QA gates below; repair loop ≤ 3 (`scene.modify` inside `transaction.begin` … `transaction.rollback` if you started one).
7. `render.final` → report the MP4 path + the accent hex you chose.

Timing contract (30fps): wordmark must be fully readable by frame 30 (1s). Grid fade completes by 1.5s. Nothing new enters after 60% of duration — the tail is stillness, not more motion.

## Recipes

Land — wordmark blur-up over a faded grid, glow rect as frame-0 ink:

```ts
v.scene("intro", { duration: 6, background: "#05070d" }, (s) => {
  s.beat("land", { at: 0, description: "Wordmark readable" });
  s.beat("breathe", { at: 1.2, description: "Camera push + grid drift" });
  // grid: vertical + horizontal lines, 120px pitch, one loop, low opacity
  for (let x = 1; x < 16; x++) {
    s.rect(`grid-v-${x}`, { width: 1, height: 1080, fill: "#22d3ee", opacity: 0.08,
      at: { x: `${(x / 16) * 100}%`, y: "50%" }, enter: { effect: "fade", duration: 1.2, delay: 0.1 } });
  }
  for (let y = 1; y < 9; y++) {
    s.rect(`grid-h-${y}`, { width: 1920, height: 1, fill: "#22d3ee", opacity: 0.08,
      at: { x: "50%", y: `${(y / 9) * 100}%` }, enter: { effect: "fade", duration: 1.2, delay: 0.2 } });
  }
  // frame-0 ink: glow under the wordmark (noTextOverflow-safe, blur large)
  s.rect("glow", { width: 760, height: 420, fill: "#22d3ee", opacity: 0.16, blur: 130,
    at: { x: "50%", y: "42%" } });
  s.text("wordmark", "VideoOS", { size: 170, weight: 800, letterSpacing: 6, color: "#f8fafc",
    at: { x: "50%", y: "42%" }, enter: { effect: "blur-up", duration: 0.7, easing: "easeOutCubic" } });
});
```

Breathe + hold — tagline second, camera push small (≤ 8%), then stillness (no exit animations):

```ts
  s.beat("hold", { at: 5.0, description: "All motion settled" });
  s.text("tagline", "The agent-native video IDE", { size: 40, color: "#7dd3fc", letterSpacing: 2,
    at: { x: "50%", y: "58%" }, enter: { effect: "fade", duration: 0.6, delay: 1.4 } });
  s.rect("underline", { width: 0, height: 3, fill: "#22d3ee", radius: 2, at: { x: "50%", y: "50%" },
    enter: { effect: "wipe", duration: 0.8, delay: 1.1, easing: "easeOutCubic" } });
  s.camera("push-in", { from: 1.0, to: 1.06 });
```

Grid drift (optional, when duration > 6s): stagger grid line fades by index — `delay: 0.1 + i * 0.02` — a 120 BPM feel where something happens every half-beat, but total motion stays subtle. Tagline count-up? No — intros stay static text; kinetic numbers belong to data-motion.

## QA gates

- `expect(frame(0)).not.toBeBlack()` — the glow rect guarantees ink at frame 0.
- `expect(frame(30)).toContainText("<wordmark>")` — the 1-second readability contract.
- `toContainText` for the tagline at a frame ≥ its entrance completion (≈ 2.0s + margin).
- `expect(scene("intro")).toHaveLayers("wordmark", "tagline", "glow")` — structure survives edits.
- `noTextOverflow()` on the scene; also run `check.overflow` — wordmark ≥ 150px is the overflow-est element in the whole library.
- `durationBetween`: total 5–8s; final 0.8s free of new entrances (assert via `toHaveBeat` on `hold` at ≤ duration − 0.8).
- Muted-video rule: the intro must work with sound off — if any beat only makes sense with audio, cut that beat, not the rule.

## Anti-patterns

- Two-line wordmarks at 170px — split into `wordmark` + `tagline` layers instead; two big texts in one scene = no dominant element.
- Glitch/wipe/zap transitions into the NEXT scene — tech intros end on stillness; hand off with `v.transition("crossfade", …)` at most.
- Indigo/purple default palettes — pick cyan/teal/amber unless the user's brand system says otherwise.
- Entering elements during the hold (logo pop at 5.5s) — anything new after 60% of duration reads as a bug, not a flourish.
- Grid brighter than the wordmark — grid opacity stays ≤ 0.12; texture never competes with type.
