---
name: interview-clip
version: 0.1.0
description: Cut interview or podcast material into shareable clips — lower-third speaker bar, burned captions, and a scale-pop pull-quote moment.
trigger: The user has interview / podcast / testimonial footage or a transcript and wants highlight clips, speaker titles, or big quote moments.
---

# Interview Clip

Goal: a 15–30s 16:9 clip (1920×1080, 30fps) cut from a longer conversation: the speaker identified by a lower-third bar that slides in from the left, speech carried by captions that never exceed two lines, and exactly ONE key quote blown up as the shareable moment. v1 has no video-in-video compositing — this skill builds the typographic cut; user-supplied still frames from the footage can join as backdrop image layers via `asset.add`.

## Workflow

1. Get the transcript and speaker names/roles; pick the quote: ≤ 90 chars, self-contained (no "it" without its referent), exact words — a quotation is never paraphrased. Footage audio exists? `audio.list` then `audio.set` it on the timeline; clip length = quote hold + 1.5s tail.
2. `storyboard.plan { intent: "interview highlight · <speaker> on <topic>", durationSeconds }` → remap onto intro (speaker bar) → quote moment → out-card.
3. Write `src/video.ts`: the bar slides from the LEFT (broadcast grammar — never fades up), the quote scales in with `easeOutBack`, captions sit on a scrim at the bottom band.
4. `compile.run` → 0 errors → `check.overflow`; captions wrap at `maxWidth: 1300` — if a segment wraps past two lines, cut words or split the segment, never shrink below 48.
5. `render.preview { scene, beat }` and read the quote aloud: if you run out of breath before the scale-pop settles, the hold is too short.
6. QA gates (below) → `test.run` → repair ≤ `maxRepairLoops` → `transaction.rollback` on persistent red.
7. `render.final` → deliver MP4 + the quote's timecode and the exact caption deck used.

## Recipes

Lower-third speaker bar — slides in from the left edge, amber tick hugging the bar, name over role:

```ts
v.scene("intro", { duration: 5, background: "#0a0a12" }, (s) => {
  s.beat("speaker", { at: 0.3, description: "Lower-third: who is talking" });
  s.rect("glow", { width: 700, height: 700, fill: "#6d28d9", opacity: 0.2, blur: 120, at: { x: 960, y: 432 } });
  s.rect("bar", { width: 780, height: 120, fill: "#12121e", opacity: 0.95, radius: 8, at: { x: 620, y: 900 },
    enter: { effect: "slide-left", duration: 0.5, params: { distance: 400 } } });
  s.rect("tick", { width: 12, height: 120, fill: "#f59e0b", at: { x: 236, y: 900 },
    enter: { effect: "slide-left", duration: 0.5, params: { distance: 400 } } });
  s.text("name", "Maya Chen", { size: 52, weight: 700, color: "#ffffff", at: { x: 660, y: 878 },
    enter: { effect: "fade", duration: 0.4, delay: 0.35 } });
  s.text("role", "Head of Platform, RenderX", { size: 36, color: "#8b8ba7", at: { x: 660, y: 926 },
    enter: { effect: "fade", duration: 0.4, delay: 0.5 } });
});
```

Pull-quote moment — the signature: oversized quote mark, the line scales up with overshoot, attribution settles under it, camera breathes in:

```ts
v.scene("quote", { duration: 8 }, (s) => {
  s.beat("quote", { at: 0.3, description: "The pull-quote moment" });
  s.camera("push-in", { from: 1.0, to: 1.04 });
  s.text("mark", "“", { size: 300, color: "#f59e0b", opacity: 0.35, at: { x: 480, y: 330 },
    enter: { effect: "fade", duration: 0.6 } });
  s.text("quote", "The cache paid for itself in a week.", { size: 76, weight: 700, color: "#ffffff",
    maxWidth: 1300, lineHeight: 1.25, align: "center", at: { x: 960, y: 520 },
    enter: { effect: "scale-pop", duration: 0.7, easing: "easeOutBack" } });
  s.text("attr", "— Maya Chen, Head of Platform", { size: 40, color: "#8b8ba7", at: { x: 960, y: 690 },
    enter: { effect: "fade", duration: 0.5, delay: 1.1 } });
});
```

Captions — scrim band, ≤ 2 lines, swap segments via per-layer enter/exit delays:

```ts
s.rect("scrim", { width: 1920, height: 170, fill: "#0a0a12", opacity: 0.55, at: { x: 960, y: 995 } });
s.text("cap-1", "We shipped the render cache in a single afternoon.", { size: 52, color: "#ffffff",
  maxWidth: 1300, lineHeight: 1.3, align: "center", at: { x: 960, y: 985 },
  enter: { effect: "fade", duration: 0.3, delay: 1.0 }, exit: { effect: "fade", duration: 0.3, delay: 3.6 } });
// cap-2 enters at 4.0 with the same shape — one segment per layer, timings from the transcript
```

Out-card (prose): name + "Full episode:" + link, `fade-black` out, last 0.8s still.

## QA gates

- `toContainText` for speaker name, role, the EXACT quote, and attribution — each after its entrance completes (quote settle = 0.3 + 0.7s local).
- `expect(scene("intro")).toHaveLayers("bar", "tick", "name", "role")`; `durationBetween`: quote 5–9, intro 3–6.
- `noTextOverflow()` on quote and captions; `not.toBeBlack()` at frame 0 (the glow has no `enter`).
- Manual gate: `inspect.frame` a settled caption frame and count text baselines — two max; v1 has no line-count assertion, this one is on you.

## Anti-patterns

- Paraphrasing the quote — exact words only; if it does not fit, pick a shorter quote.
- Two pull-quotes in one clip — pick the best moment; the rest is the episode's business.
- Speaker bar sliding from the right or fading up — broadcast grammar is left-in, and viewers feel the violation without naming it.
- Captions over two lines or past ~48 chars per line — dense caption blocks are where clips get muted and scrolled past.
- Quote type smaller than caption type — the quote must dominate (≥ 72 vs 52) or it is not a moment.
- Attribution arriving with the quote — let the quote land alone first; credit it at +1.1s.
