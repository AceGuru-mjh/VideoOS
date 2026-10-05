---
name: end-card
version: 0.1.0
description: Closing frame (2-4s): name + one CTA + URL or QR placeholder, fade-in only, 0.8-1.2s of stillness, background matched to the previous scene.
trigger: The user asks for an outro, end screen, closing card, subscribe screen, or brand sign-off - or any video needs its final settled frame designed.
---

# End Card

Goal: a 2-4s closing scene with exactly three elements - name (or logo), ONE CTA line, and a URL or QR placeholder - that fades in, never out, sits still for the final 0.8-1.2s, and joins the previous scene through a 0.4s crossfade over a matched background. The last frame is the deliverable: platforms freeze it, thumbnails use it, loops replay it.

## Workflow

1. Read the tail of the video: the previous scene's `background` hex and its settled look (`render.preview` on its last beat) - the end-card inherits that exact hex, so the seam is invisible.
2. Collect the three elements; ask for whatever is missing (which single CTA action? URL, or a QR image file?). Logo only if the user supplies a file (`asset.add`) - the zero-asset default is the name as a wordmark.
3. Write the 2-4s scene from the Recipes: entrances of at most 0.6s each, staggered at most 0.3s apart, all complete by ~1.3s; then hold. No layer in this scene declares `exit`.
4. Join with `v.transition("crossfade", { duration: 0.4, between: ["<last>", "end"] })` - never `cut` (pops against stillness) and never `fade-black` (a black gap breaks the settle).
5. `compile.run` -> 0 errors; `render.preview { scene: "end", beat: "settle" }` and scrub the final second specifically - that still frame is what most viewers keep seeing.
6. `test.run` with the stillness gates; repair loop of at most 3 via `scene.modify`.
7. Hand off: ad-remix tiers reuse this scene verbatim; a 9:16 deliverable re-anchors via the aspect-reframe table (brand 38%, CTA 52%, URL 62%, clear of the bottom 250px band); animated logo reveals are the logo-reveal skill - a reveal moves, an end-card settles.

## Recipes

Standard end-card - three elements, fade-in only, settle by 1.3s, still for the rest:

```ts
v.scene("end", { duration: 3, background: "#05070d" }, (s) => {   // = previous scene's hex
  s.beat("settle", { at: 1.3, description: "All three entered; still from here" });
  s.text("brand", "VideoOS", { size: 96, weight: 800, letterSpacing: 4, color: "#f8fafc",
    at: { x: "50%", y: "38%" }, enter: { effect: "fade", duration: 0.5, delay: 0.2 } });
  s.text("cta", "Star the repo", { size: 60, weight: 700, color: "#f59e0b",
    at: { x: "50%", y: "56%" }, enter: { effect: "fade", duration: 0.5, delay: 0.5 } });
  s.text("url", "github.com/AceGuru-mjh/VideoOS", { size: 40, color: "#8b8ba7",
    at: { x: "50%", y: "70%" }, enter: { effect: "fade", duration: 0.5, delay: 0.8 } });
});
```

QR placeholder variant - zero-asset until a real QR file lands:

```ts
v.scene("end", { duration: 3.5, background: "#0a0a12" }, (s) => {
  s.beat("settle", { at: 1.3, description: "QR slot + hint + CTA entered; still until the end" });
  s.rect("qr-slot", { width: 260, height: 260, fill: "#111827", radius: 12,
    at: { x: "50%", y: "40%" }, enter: { effect: "fade", duration: 0.5, delay: 0.2 } });
  s.text("qr-hint", "scan for the demo", { size: 36, color: "#94a3b8",
    at: { x: "50%", y: "54%" }, enter: { effect: "fade", duration: 0.5, delay: 0.5 } });
  s.text("cta", "Try it in 60 seconds", { size: 56, weight: 700, color: "#f8fafc",
    at: { x: "50%", y: "68%" }, enter: { effect: "fade", duration: 0.5, delay: 0.8 } });
});
// swap qr-slot for s.image("qr", "<asset path>", { width: 260, height: 260, ... })
// only after the user supplies a real QR file via asset.add - never fake a scannable
// code out of rects; a decorative "QR" wastes the one action this scene gets.
```

## QA gates

- Three elements present: `toContainText` for name, CTA, and URL (or qr-hint) at frames at or past each entrance completion; `toHaveLayers("brand", "cta", "url")` or the qr-slot set.
- Stillness: no layer's animation window intersects the final 0.8s - audit with `layer.inspect` (every `enter` ends by duration - 0.8); the last 24-36 frames are frozen.
- No exits: no layer in the scene declares `exit` - a fade-out end freezes mid-dissolve wherever the platform holds the final frame.
- Seam: background hex equals the previous scene's; `diff.frames` across the crossfade shows no luminance jump.
- `durationBetween` 2-4s; `noTextOverflow()`; `expect(frame(0)).not.toBeBlack()` (the matched background plus the earliest ink carries it).
- One CTA: exactly one imperative line - two competing asks fail review even when every assertion passes.

## Anti-patterns

- Exit animations ("out with a bang") - the final frame becomes a frozen mid-fade thumbnail on most platforms; it reads as an error, not an ending.
- `fade-black` before the end card - inserts a black gap exactly where the eye should rest; the crossfade from a matched background is the seamless join.
- Motion in the last second (a late logo pop) - anything entering after ~60% of the scene reads as a bug (tech-intro rule); the tail is stillness by definition.
- Two or three CTAs (subscribe AND click AND scan) - split attention means no action; pick the primary and move the rest to the description field.
- A contrasting background "for punch" - the end card inherits the previous scene's palette; a color switch snaps the eye at the moment it should settle.
- Five elements (QR + URL + name + tagline + CTA) - that is a poster, not a settle; three elements, one of them dominant.
