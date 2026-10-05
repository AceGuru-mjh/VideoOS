---
name: logo-reveal
version: 0.1.0
description: Logo reveal sting (4-6s) - mask wipe uncovers the mark, a light spot sweeps across, then the lockup settles still.
trigger: The user asks for a "logo reveal", brand sting, "animate my logo", animated brand mark, or an outro/ending brand card.
---

# Logo Reveal

Goal: a 4-6s 1920x1080 brand sting (square 1080x1080 for avatars/social): wipe -> light sweep -> lockup settle, one trick per act, single scene, ending perfectly still. Zero-asset default: the "logo" is a monogram set in type until the user supplies a file.

## Workflow

1. Collect: logo file (optional) or monogram letter(s), brand name, optional tagline, accent color. Agree 4-6s. If a file is supplied: `asset.add` it, read its aspect ratio, and size `s.image` with explicit width/height (never distort).
2. `storyboard.plan { intent: "<brand> · logo reveal", durationSeconds: 5.5 }` - the plan is three beats in ONE scene; resist splitting (a sting with a crossfade feels like two stings).
3. Write `src/video.ts` as one `reveal` scene, acts layered by timing: static glow (frame-0 ink), mark with `wipe` enter, light spot as a windowed ellipse (in 1.6 / out 3.0), lockup text after the sweep, one `pull-out` camera for the whole scene.
4. `compile.run` -> 0 errors; `check.overflow` on the lockup (letterSpaced names overflow the heuristic).
5. `render.preview` at beats `wipe` / `sweep` / `settle` plus the final second - verify the spot actually crosses the mark's center and the tail is still.
6. QA gates (below) -> `test.run` -> repair loop (<= maxRepairLoops, then `transaction.rollback`) -> `render.final`.

| Act | Window | Job | Dominant element |
| --- | --- | --- | --- |
| Wipe | 0-1.6s | mark uncovers left to right | mark, monogram >= 200 or image |
| Sweep | 1.6-3.0s | light spot crosses the mark | blurred amber ellipse |
| Settle | 3.0-5.5s | name + tagline lockup, then still | lockup; camera pull-out |

## Recipes

Wipe + sweep - the mark wipes in, then a blurred amber ellipse crosses it: `slide-right` enters from the left offset and `slide-left` exit drives it out the right side - enter and exit meet at the mark's center for a continuous pass:

```ts
v.scene("reveal", { duration: 5.5, background: "#0a0a12" }, (s) => {
  s.beat("wipe", { at: 0.2, description: "Mark uncovers left to right" });
  s.beat("sweep", { at: 1.6, description: "Light spot crosses the mark" });
  s.beat("settle", { at: 3.0, description: "Full lockup settles" });
  s.rect("glow", { width: 700, height: 700, fill: "#6d28d9", opacity: 0.2, blur: 130, at: { x: "50%", y: "42%" } });
  s.text("mark", "V", { size: 220, weight: 800, color: "#ffffff", at: { x: "50%", y: "40%" },
    enter: { effect: "wipe", duration: 0.9, easing: "easeOutCubic" } });
  s.ellipse("spot", { width: 300, height: 300, fill: "#f59e0b", opacity: 0.5, blur: 100,
    in: 1.6, out: 3.0, at: { x: "50%", y: "40%" },
    enter: { effect: "slide-right", duration: 0.7, easing: "easeInOutCubic", params: { distance: 500 } },
    exit: { effect: "slide-left", duration: 0.7, easing: "easeInCubic", params: { distance: 500 } } });
  s.camera("pull-out", { from: 1.06, to: 1.0 });
});
```

Sweep timing law: enter ends at `in + 0.7` and exit starts at `out - 0.7` - set `out = in + 1.4` so the pass never stalls at center; the spot's blur (>= 80) is what makes it read as light, not a ball.

Lockup settle - divider pops, name blurs up, tagline fades; last entrance completes at 4.3s of 5.5:

```ts
s.rect("divider", { width: 3, height: 120, fill: "#8b8ba7", opacity: 0.6, at: { x: "50%", y: "58%" },
  enter: { effect: "scale-pop", duration: 0.5, delay: 3.1, easing: "easeOutBack" } });
s.text("name", "VIDEOOS", { size: 64, weight: 700, letterSpacing: 12, color: "#e2e8f0",
  at: { x: "50%", y: "64%" },
  enter: { effect: "blur-up", duration: 0.7, delay: 3.2, params: { distance: 24, blur: 8 } } });
s.text("tagline", "the agent-native video runtime", { size: 30, color: "#8b8ba7", at: { x: "50%", y: "70%" },
  enter: { effect: "fade", duration: 0.6, delay: 3.7 } });
```

Real logo file - only when the user supplies one (`asset.add` first); wipe clips the image box left to right:

```ts
s.image("logo", "assets/logo.png", { width: 440, height: 440, at: { x: "50%", y: "40%" },
  enter: { effect: "wipe", duration: 0.9, easing: "easeOutCubic" } });
```

## QA gates

- `expect(frame(0)).not.toBeBlack()` - glow is static ink.
- Assert the NAME, not the monogram (single letters match anything): `expect(frame(140)).toContainText("VIDEOOS")` - it settles at 3.2 + 0.7 = 3.9s, so assert at >= frame 117.
- Spoiler gate: `expect(frame(60)).not.toContainText("VIDEOOS")` - the lockup must not exist before the sweep ends.
- `expect(scene("reveal")).toHaveLayers("glow", "mark", "spot", "name", "tagline")`.
- `expect(scene("reveal")).durationBetween(4, 6.5)` - a reveal over 7s is a trailer.
- Stillness: no `exit` on any lockup layer; the last 1.2s contain zero motion (loop-scrub check by hand on `render.preview` of the final frame).

## Anti-patterns

- Revealing with a plain `fade` - that is the "no reveal" of logo reveals; wipe, blur, or pop, but never just fade.
- Two big moves in the same half-second (wipe + sweep + camera all at once) - the acts are sequential by design: 0.2 / 1.6 / 3.0.
- Light spot at opacity > 0.7 or blur < 60 - blowout; light is translucent by definition.
- Monogram AND wordmark both large - the mark is the hero; the wordmark is a caption at <= 1/3 the mark's size.
- Ending mid-motion - outro assets get frozen, looped, and screenshot; freeze on the lockup.
- Distorting the supplied logo's aspect ratio in `s.image` - compute height from the file's real ratio.
