---
name: kinetic-typography
version: 0.1.0
description: Text-as-picture motion piece (6-12s): per-character wave stagger, 3x keyword scale, same-position word swaps, line-relay slide-ups. No footage needed.
trigger: The user wants a text-only / typography / kinetic type video, an animated headline or word sting, or says the words themselves should be the visual.
---

# Kinetic Typography

Goal: a 6-12s piece where type is the only picture: one hero word landing as a per-character wave, keywords at 3x scale, same-position word swaps for contrast, lines relaying upward - every word readable the moment it settles, and a still final 0.8s. No images, no footage; rects only as ink and accent. This piece is self-paced text - beat-locked lyrics belong to the kinetic-lyrics skill.

## Workflow

1. Draft the copy under the line rules first: one line is at most 6 words; mark ONE keyword per line to blow up to 3x; mark swap slots (two or three words that will alternate in one position).
2. Price the copy with the script-timing skill (2-3 words/sec) - a wave of n characters costs (n - 1) x 0.04s + enter duration; total must land in 6-12s. Cut copy, never read speed.
3. If the first line must stop the scroll, apply the hook-forge motion-first pattern: first character delay 0, whole line readable within 1s.
4. Write `src/video.ts` from the Recipes: hero word as per-character layers (`delay: i * 0.04`), swap slots as stacked layers sharing one `at`, relay lines as `slide-up` with 0.3s stagger.
5. `compile.run` -> 0 errors; then `compile.diagnostics` - any `OVERFLOW_RISK` on a 3x keyword is a hard fail (shrink the keyword, never the line count). Run `check.overflow` too.
6. `render.preview { scene, beat }` per beat - one wave at a time on screen; two simultaneous staggers read as noise. Muted check: the piece must land with sound off (that is how feeds play it).
7. `test.run` -> gates below; repair loop of at most 3 via `scene.modify`. `render.final`. If a CTA tail is wanted, hand off to the end-card skill (fade-in, 0.8-1.2s of stillness).

Rules: per-character delay 0.03-0.05s, enter `slide-up` or `scale-pop` at 0.35s or less; keyword swap = same `at`, previous layer's `out` equals the next layer's `in`, enter `wipe` at 0.3s or less, two swaps max per slot; size ladder body 52-64, keyword 3 x body; relay stagger 0.3s (next line enters as the previous settles).

## Recipes

Hero word as a per-character wave, plus a 3x keyword contrast line (x centers computed: bold-cap advance is about size x 0.72):

```ts
v.scene("hero", { duration: 4, background: "#05070d" }, (s) => {
  s.beat("wave", { at: 0, description: "Wave completes by 0.6s; body lands by 1.1s" });
  s.rect("ink", { width: 900, height: 420, fill: "#22d3ee", opacity: 0.12, blur: 120,
    at: { x: "50%", y: "40%" } });                    // frame-0 ink: no enter on this rect
  const word = "RENDER";
  const size = 168, advance = size * 0.72;
  const startX = 960 - ((word.length - 1) * advance) / 2;
  for (const [i, ch] of word.split("").entries()) {
    s.text(`ch-${i}`, ch, { size, weight: 800, color: "#f8fafc",
      at: { x: startX + i * advance, y: "40%" },
      enter: { effect: "slide-up", duration: 0.35, delay: 0.05 + i * 0.04,
        easing: "easeOutCubic", params: { distance: 70 } } });
  }
  s.text("body", "your video, as code", { size: 56, color: "#7dd3fc", letterSpacing: 2,
    at: { x: "50%", y: "60%" }, enter: { effect: "fade", duration: 0.4, delay: 0.7 } });
});
```

Keyword swap slot - words alternate in ONE position: wipe in, hard `out` cut, winner stays (no exit anywhere in the piece):

```ts
v.scene("swap", { duration: 3.5 }, (s) => {
  s.beat("slot-1", { at: 1.0, description: "slow readable" });
  s.beat("slot-3", { at: 2.6, description: "yours readable, then still" });
  s.text("lead", "pipelines are", { size: 56, weight: 600, color: "#94a3b8",
    at: { x: "50%", y: "34%" }, enter: { effect: "fade", duration: 0.3, delay: 0.2 } });
  const slot = { x: "50%", y: "55%" };
  s.text("word-1", "slow", { size: 180, weight: 800, color: "#f8fafc", at: slot,
    in: 0.7, out: 1.3, enter: { effect: "wipe", duration: 0.3 } });
  s.text("word-2", "fragile", { size: 180, weight: 800, color: "#f59e0b", at: slot,
    in: 1.3, out: 2.3, enter: { effect: "wipe", duration: 0.3 } });
  s.text("word-3", "yours", { size: 180, weight: 800, color: "#22d3ee", at: slot,
    in: 2.3, enter: { effect: "wipe", duration: 0.3 } });
});
```

Line relay - lines of at most 6 words relay upward, 0.3s apart (in 9:16 follow the short-video skill's margins and 12% row pitch):

```ts
const lines = ["write the scene", "compile the cut", "test every frame"];
for (const [i, line] of lines.entries()) {
  s.text(`line-${i + 1}`, line, { size: 64, weight: 700,
    color: i === 2 ? "#22d3ee" : "#e2e8f0",
    at: { x: "50%", y: `${38 + i * 14}%` },
    enter: { effect: "slide-up", duration: 0.45, delay: i * 0.3,
      easing: "easeOutCubic", params: { distance: 80 } } });
}
```

## QA gates

- `expect(frame(0)).not.toBeBlack()` - the `ink` rect with no enter covers the frame-0 rule.
- Wave gate: `render.preview` at 0.7s - all characters settled; per-character layers hold no contiguous string, so `toContainText` applies to the body and relay lines only.
- `expect(frame(33)).toContainText("your video, as code")` - body landed by 1.1s.
- Swap slots: `expect(frame(30)).toContainText("slow")`, `expect(frame(48)).toContainText("fragile")`, `expect(frame(81)).toContainText("yours")`; `toHaveLayers("lead", "word-1", "word-2", "word-3")`.
- `noTextOverflow()` on every scene plus `check.overflow` - the 3x keyword (180px) is the overflow-est layer in the genre.
- Stillness: final 0.8s free of new entrances; no layer declares `exit` (loops freeze the last frame mid-fade).
- `durationBetween`: total 6-12s; one wave visible at a time (self-review per beat in `render.preview`).

## Anti-patterns

- Whole sentences as one text layer - nothing can stagger, and the genre IS the animation; a static sentence is a slide, not kinetic type.
- Two staggered groups at once - the eye tracks exactly one wave; the second reads as noise, not emphasis.
- Keywords at 1.5-2x - below about 2.5x the size contrast does not register in peripheral vision; 3x is the default, not the maximum.
- Lines longer than 6 words - at wave speed the eye restarts the line mid-piece and the relay rhythm breaks.
- Exit animations on the final word - autoplay loops freeze the last frame; a mid-exit freeze looks like a dropped frame.
- Using this skill for music-synced lyrics - if timing must follow a beat map, that is the kinetic-lyrics skill; this piece is self-paced.
