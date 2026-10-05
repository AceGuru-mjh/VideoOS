---
name: logo-reveal
version: 0.1.0
description: Broadcast-style logo reveal (2.5-4s): mask-erase uncover, light sweep, then a dead-still lockup inside title-safe.
trigger: The user asks for a logo reveal, sting, ident, or brand lockup animation, or to animate a logo or wordmark — no logo file needed.
---

# Logo Reveal

Goal: a 2.5–4s (1920×1080, 30fps) brand sting — an accent bar sweeps the logo area left to right while a background-colored mask slides away uncovering the mark, a soft light pass follows, then a fully still lockup for the final 1s+. Zero-asset default: no logo file means a text wordmark (big type + tracking).

## Workflow

1. Collect: a logo file (transparent PNG) OR the wordmark text, optional tagline (≤ 6 words), brand accent color, duration 2.5–4s. Never fabricate or guess a brand mark — no file means text lockup.
2. `storyboard.plan { intent: "logo reveal · <brand>", durationSeconds }` → collapse to ONE scene with three beats: uncover (bar + mask), light pass, lockup. A reveal is one scene, not a story.
3. Write `src/video.ts` per Recipes. File logo: `asset.add` it, declare `s.image` with explicit width/height, and declare it BEFORE the mask — painter's order decides what the mask can hide.
4. `compile.run` → 0 errors; read `compile.diagnostics`: any `OVERFLOW_RISK` on the wordmark is a hard fail (shrink the font before the margins), and `EFFECT_UNSUPPORTED` means a rect used `wipe` — wipe is text-only, rects sweep via `slide-right`.
5. `render.preview { scene: "reveal", beat: "uncover" }` and `{ beat: "lockup" }` — the uncover frame must show the mark half-exposed behind the mask edge; the lockup frame must show zero motion, mark inside the 5% side margins.
6. `test.run` → QA gates → repair ≤ 3 (`scene.modify` inside `transaction.begin` / `transaction.rollback`) → `render.final`; report the MP4 path and whether the lockup is a file logo or text.

Timing contract (3.5s cut):

| Beat | Window | Motion | Engine primitive |
| --- | --- | --- | --- |
| uncover | 0–1.1s | bar crosses the zone; mask slides off right, exposing the mark left to right | rect `slide-right`, distance = off-canvas minus covering offset |
| light pass | 0.8–1.8s | blurred white rect glides across the mark | rect `slide-right` + `blur: 60` |
| lockup | final ≥ 1s | nothing enters, nothing moves | last entrance completes by duration − 1 |

## Recipes

Text wordmark version (zero-asset) — mask math in the comments:

```ts
// canvas 1920x1080; logo zone centered on (960, 460); mask parks off-canvas at x 2600
v.scene("reveal", { duration: 3.5, background: "#0a0a12" }, (s) => {
  s.beat("uncover", { at: 0, description: "Bar moving at frame 0, mask sliding off" });
  s.beat("lockup", { at: 2.3, description: "All motion settled" });
  s.ellipse("glow", { width: 900, height: 620, fill: "#6d28d9", opacity: 0.16, blur: 130,
    at: { x: 960, y: 460 } });                             // static ink under everything
  s.text("wordmark", "ACME", { size: 190, weight: 800, letterSpacing: 18, color: "#f8fafc",
    at: { x: 960, y: 460 } });                             // present from frame 0 — hidden by the mask
  // mask: background-colored, declared AFTER the wordmark so it paints on top;
  // starts covering it (x 960), exits to x 2600 — its left edge is the reveal line
  s.rect("mask", { width: 1300, height: 460, fill: "#0a0a12",
    at: { x: 2600, y: 460 },
    enter: { effect: "slide-right", duration: 1.1, easing: "easeOutCubic", params: { distance: 1640 } } });
  // leading bar: final position off-canvas right; at frame 0 it already sits at x 900
  s.rect("sweep-bar", { width: 150, height: 12, fill: "#22d3ee", radius: 6,
    at: { x: 2500, y: 640 },
    enter: { effect: "slide-right", duration: 0.9, easing: "easeOutCubic", params: { distance: 1600 } } });
  s.rect("light-pass", { width: 380, height: 560, fill: "#ffffff", opacity: 0.3, blur: 60,
    at: { x: 2400, y: 460 },
    enter: { effect: "slide-right", duration: 1.0, delay: 0.8, easing: "easeOutCubic", params: { distance: 2000 } } });
  s.text("tagline", "Motion systems studio", { size: 36, color: "#8b8ba7", letterSpacing: 3,
    at: { x: 960, y: 600 }, enter: { effect: "fade", duration: 0.5, delay: 1.6 } });
});
```

File logo version — same trick, shorter cut, size declared:

```ts
v.scene("reveal", { duration: 3, background: "#0a0a12" }, (s) => {
  s.beat("uncover", { at: 0, description: "Mask slides off the mark" });
  s.beat("lockup", { at: 1.9, description: "Still lockup begins" });
  s.ellipse("glow", { width: 980, height: 700, fill: "#f59e0b", opacity: 0.12, blur: 130,
    at: { x: 960, y: 470 } });
  // asset.add the file first; always declare width/height (default is the full canvas)
  s.image("logo", "assets/logo.png", { width: 520, height: 520, at: { x: 960, y: 470 } });
  s.rect("mask", { width: 1300, height: 700, fill: "#0a0a12", at: { x: 2600, y: 470 },
    enter: { effect: "slide-right", duration: 1.0, easing: "easeOutCubic", params: { distance: 1640 } } });
  s.rect("sweep-bar", { width: 130, height: 10, fill: "#f59e0b", radius: 5,
    at: { x: 2480, y: 760 },
    enter: { effect: "slide-right", duration: 0.9, easing: "easeOutCubic", params: { distance: 1560 } } });
});
```

## QA gates

- `expect(frame(0)).not.toBeBlack()` — sweep bar and glow are on screen at frame 0 (motion-first).
- `expect(frame(90)).toContainText("ACME")` — proves the wordmark content; note the semantic check reads layer commands, not pixels, so it cannot see the mask (see the human gate).
- `expect(scene("reveal")).toHaveLayers("wordmark", "mask", "sweep-bar", "light-pass", "tagline")` — structure survives edits.
- `expect(scene("reveal")).toHaveBeat("lockup")` with lockup at ≤ duration − 1; `durationBetween(2.5, 4)`.
- `noTextOverflow()` — a 190px wordmark with letterSpacing 18 is the overflow-est element in this genre; also run `check.overflow`.
- Human gate (QA cannot check painter's order): `render.preview` one frame at local 0.5s — the mark must be half-uncovered behind the moving mask edge. Fully visible at frame 0 means the mask is declared before the mark.

## Anti-patterns

- `wipe` on rect layers — text-only (`EFFECT_UNSUPPORTED`, the animation is ignored); rects sweep with `slide-right` and an explicit `distance`.
- A camera push-in "for life" — the camera runs the whole scene, so the lockup is never actually still; reveal scenes stay camera-free.
- Declaring the mask before the mark — painter's order breaks the trick; the mark paints over the mask and is visible from frame 0.
- Enter effects on the wordmark itself — the mask-erase IS the reveal; layering blur-up on top gives two competing reveals.
- Sweep bars parked on-canvas — the bar's final position must be off-screen, or a stray rectangle sits in the lockup.
- Cropping the lockup outside title-safe — keep the mark clear of the 5% margins; v1 has no safe-area assertion, so verify in `render.preview`.
