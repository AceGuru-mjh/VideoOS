---
name: style-shorts
version: 0.1.0
description: Three pure-DSL style emulations for 5-8s shorts - paper-cut collage, 8-bit pixel, minimal Swiss - each with a locked palette, type scale, and motion whitelist.
trigger: The user names a visual style for a short video - "paper cutout", "pixel art / 8-bit", "Swiss / International Typographic" - or wants stylized idents or loops.
---

# Style Shorts

Goal: a 5-8s short in ONE of three emulated styles, built only from DSL primitives (rect / ellipse / text). Each style is a ruleset - palette, type, motion whitelist - and the rules ARE the style: one style per short, never mixed. Copy stays under ~8 words: style shorts carry an identity, not an argument.

## Workflow

1. Pick the style with the user from the three rulesets (table below, Recipes for full patterns): paper-cut collage, 8-bit pixel, minimal Swiss. If the user names a style outside the three, this skill does not fake it - say so and fall back to cinematic-video or kinetic-typography.
2. Lock the ruleset into the project before writing scenes: palette literals, type sizes, motion whitelist. Nothing outside the whitelist animates; nothing outside the palette paints - the same token discipline brand-kit enforces.
3. Write a one- or two-scene short (5-8s total): the message is <= 8 words; if a second scene exists, it joins on the style's own transition (cut for pixel, crossfade 0.5s for paper-cut and Swiss).
4. `compile.run` -> 0 errors; then `check.overflow` - pixel type at 130px+ is the overflow case in this genre.
5. `render.preview` the settled frame and run the one-glance review: does it read as the style immediately? A Swiss short with a glow, or a pixel short with eased motion, fails this review even when every assertion is green.
6. `test.run` with the gates below; repair loop <= 3 via `scene.modify`; `render.final`.
7. Chain out: a style short works as the hook scene of a longer video (hook-forge), or as a looping ident (gif-loop); three style shorts of one brand belong in a showreel.

Style rulesets (the contract):

| Rule | Paper-cut | Pixel | Swiss |
| --- | --- | --- | --- |
| Palette | #f5e6d3 paper, #e8a04c, #d94f3d, #2f6f5e, #333333 | #0f380f, #306230, #8bac0f, #9bbc0f | #f8f8f6 paper, #111111 ink, ONE accent #ff3e21 |
| Type | 64-120px, weight 700 | 90-150px, weight 800, monospace optional | 40-170px, weight 700, letterSpacing on labels |
| Motion whitelist | slide-* 0.8-1.2s, fade | hard toggles (`in`/`out`), typewriter linear, cut only | fade 0.4s, slide-up/right 0.5s |
| Forbidden | fast pops, thin lines, blur | ANY easing curve, blur, crossfade | blur, glow, decoration, a second accent |

## Recipes

Paper-cut collage - chunky overlapping shapes, paper palette, slow slides:

```ts
v.scene("papercut", { duration: 6, background: "#f5e6d3" }, (s) => {
  s.beat("layer", { at: 0.4, description: "Paper layers slide in slow, one by one" });
  s.ellipse("sun", { width: 420, height: 420, fill: "#e8a04c", at: { x: "30%", y: "34%" },
    enter: { effect: "slide-right", duration: 1.0, delay: 0.2, easing: "easeOutCubic",
      params: { distance: 90 } } });
  s.rect("hill-1", { width: 900, height: 300, fill: "#2f6f5e", radius: 24,
    at: { x: "38%", y: "72%" }, enter: { effect: "slide-up", duration: 1.0, delay: 0.5,
      params: { distance: 80 } } });
  s.rect("hill-2", { width: 760, height: 240, fill: "#d94f3d", radius: 20,
    at: { x: "72%", y: "78%" }, enter: { effect: "slide-up", duration: 1.0, delay: 0.8,
      params: { distance: 80 } } });
  s.text("word", "slow season", { size: 96, weight: 700, color: "#333333",
    at: { x: "50%", y: "40%" }, enter: { effect: "fade", duration: 0.8, delay: 1.2 } });
});
```

8-bit pixel - blocky backdrop, hard toggles, linear typewriter only:

```ts
v.scene("pixel", { duration: 5, background: "#0f380f" }, (s) => {
  s.beat("boot", { at: 0.2, description: "Blocks toggle in; typewriter runs linear" });
  for (let i = 0; i < 12; i++) {                        // blocky backdrop, no easing
    s.rect(`px-${i + 1}`, { width: 90, height: 90, fill: i % 2 ? "#306230" : "#8bac0f",
      at: { x: 610 + (i % 6) * 140, y: 150 + Math.floor(i / 6) * 140 },
      in: i * 0.1, out: 5 });                            // hard toggle: no animation
  }
  s.text("score", "READY?", { size: 130, weight: 800, color: "#9bbc0f", font: "monospace",
    at: { x: "50%", y: "58%" },
    enter: { effect: "typewriter", duration: 0.8, delay: 0.4, easing: "linear" } });
  s.text("hint", "press start", { size: 48, color: "#8bac0f", font: "monospace",
    at: { x: "50%", y: "72%" }, in: 2.2, out: 5 });      // blinks in, no fade
});
```

Minimal Swiss - grid alignment, huge whitespace, one accent block:

```ts
v.scene("swiss", { duration: 7, background: "#f8f8f6" }, (s) => {
  s.beat("grid-land", { at: 0.3, description: "Grid alignment, huge whitespace, one accent" });
  s.rect("rule", { width: 1080, height: 6, fill: "#111111", at: { x: "50%", y: "30%" },
    enter: { effect: "slide-right", duration: 0.5, params: { distance: 260 } } });
  s.text("kicker", "EXHIBITION 04", { size: 40, weight: 700, color: "#111111", align: "left",
    letterSpacing: 6, at: { x: "22%", y: "40%" }, enter: { effect: "fade", duration: 0.4, delay: 0.4 } });
  s.text("headline", "TYPE", { size: 170, weight: 700, color: "#111111", align: "left",
    at: { x: "22%", y: "52%" }, enter: { effect: "slide-up", duration: 0.5, delay: 0.5,
      params: { distance: 60 } } });
  s.rect("accent-block", { width: 220, height: 220, fill: "#ff3e21",
    at: { x: "78%", y: "52%" }, enter: { effect: "fade", duration: 0.4, delay: 0.9 } });
});
```

## QA gates

- One style per short: every layer's fill/color sits in that style's palette, and every `enter.effect` is on that style's motion whitelist - verify via `scene.inspect` + `layer.inspect` before `render.final`.
- Pixel: every easing is `linear` or absent; scene joins are cuts only; type >= 90px.
- Swiss: exactly ONE accent-colored element; no blur on any layer; margins hold >= 20% whitespace (preview review).
- Paper-cut: all motion is slow (0.8-1.2s) slides/fades; no scale-pop, no blur.
- Duration `durationBetween(5, 8)` per short; final 0.8s still in every style; `expect(frame(0)).not.toBeBlack()` (paper backgrounds count as ink).
- `noTextOverflow()` plus `check.overflow` (130px+ pixel type, 170px Swiss headline).

## Anti-patterns

- Mixing styles (pixel backdrop with Swiss typography) - the ruleset is a contract on every layer; hybrids read as noise, not fusion.
- Eased motion in pixel style - 8-bit hardware had no curves; one easeOutCubic breaks the illusion instantly.
- Glow or blur in Swiss - International Typographic style is flat ink on paper; any blur reads as web chrome, not Zurich.
- Fast motion in paper-cut - paper moves with weight; sub-0.5s slides read as UI, not collage.
- A second accent in Swiss - the red works only while nothing else is red; two accents means no accent.
- Long copy - over ~8 words the short becomes an explainer; that is tech-intro or product-demo territory, in any style.
