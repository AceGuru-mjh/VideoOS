---
name: quote-card
version: 0.1.0
description: Quote card (4-6s, 1:1): giant open-quote mark, typewriter quote, breathing key-phrase pop, author byline fade.
trigger: The user asks to turn a quote, testimonial, pull-quote, or saying into a short animated card for social feeds, decks, or slides.
---

# Quote Card

Goal: a 4–6s square (1080×1080, 30fps) card — the quote types itself, the payoff phrase pops as the only accent, the author settles in last, then ≥ 0.8s of stillness. Zero-asset: type only.

## Workflow

1. Collect the quote VERBATIM plus its source (ask; never paraphrase or "improve" a quote), the author, and an optional role line. Split the text into `lead` (setup, typed) and `key` (payoff, popped). No natural split? The whole quote is the key and the lead is empty.
2. `storyboard.plan { intent: "quote card · <author>", durationSeconds }` → collapse to ONE scene with four beats: mark, lead typed, key popped, byline.
3. Write `src/video.ts` with `width: 1080, height: 1080` in defineVideo. Layout: quote block centered, `maxWidth: 840` (v1 has no auto-wrap — split long text into layers with `\n`); the giant U+201C open-quote sits top-left of the block at opacity 0.10–0.15.
4. `compile.run` → 0 errors; `check.overflow` — the 420px mark is the biggest glyph in the library, and the key line at 80px+ is the overflow case.
5. `render.preview { scene: "quote", beat: "key-pop" }` — the key phrase must be the only accent-colored element on screen.
6. `test.run` → QA gates → repair ≤ 3 (`scene.modify`) → `render.final`.

Timing contract (5s cut):

| t | Layer | Effect | Params |
| --- | --- | --- | --- |
| 0.00 | quote-mark | none — static, opacity 0.12 | size 420, frame-0 ink |
| 0.15 | quote-lead | typewriter | duration = chars × 0.045, linear |
| 1.90 | quote-key | scale-pop (the breathing emphasis) | 0.5s, easeOutCubic, accent color |
| 2.50 | rule | fade | 0.4s |
| 2.80 | author | fade | 0.5s |
| 4.20+ | — | stillness | ≥ 0.8s |

## Recipes

The card — mark, typed lead, popped key, byline:

```ts
v.scene("quote", { duration: 5, background: "#0a0a12" }, (s) => {
  s.beat("mark", { at: 0, description: "Quote-mark ink on screen" });
  s.beat("key-pop", { at: 1.9, description: "Key phrase pops" });
  // giant open-quote (U+201C) — furniture, never brighter than the quote itself
  s.text("quote-mark", "\u201C", { size: 420, weight: 800, color: "#f8fafc", opacity: 0.12,
    at: { x: 170, y: 260 }, align: "left" });
  // lead — types itself; linear easing keeps the char cadence human
  s.text("quote-lead", "The best way to predict", { size: 56, weight: 600, color: "#e2e8f0",
    maxWidth: 840, at: { x: "50%", y: "42%" },
    enter: { effect: "typewriter", duration: 1.7, delay: 0.15, easing: "linear" } });
  // key — the payoff lands whole and breathes in (scale-pop), the only accent color
  s.text("quote-key", "the future is\nto invent it.", { size: 80, weight: 800, color: "#f59e0b",
    lineHeight: 1.15, maxWidth: 840, at: { x: "50%", y: "56%" },
    enter: { effect: "scale-pop", duration: 0.5, delay: 1.9, easing: "easeOutCubic" } });
  s.rect("rule", { width: 120, height: 3, fill: "#94a3b8", radius: 1.5,
    at: { x: "50%", y: "70%" }, enter: { effect: "fade", duration: 0.4, delay: 2.5 } });
  s.text("author", "Alan Kay", { size: 44, weight: 700, color: "#f8fafc",
    at: { x: "50%", y: "76%" }, enter: { effect: "fade", duration: 0.5, delay: 2.8 } });
});
```

Long quote — stacked typewriters, the key line pops last (6s cut):

```ts
const LINES = [
  { id: "q1", text: "People think that", dur: 0.9 },
  { id: "q2", text: "stories are shaped", dur: 1.0 },
  { id: "q3", text: "by people.", dur: 0.6 },
  { id: "q4", text: "It's the other\nway around.", dur: 0.5, key: true },
];
let t = 0.15;                                             // typing cursor clock; 0.05s gap between lines
for (const [i, line] of LINES.entries()) {
  const start = t;
  t += line.dur + 0.05;
  s.beat(`${line.id}-in`, { at: start, description: "Line starts" });
  s.text(line.id, line.text, {
    size: line.key ? 80 : 64, weight: line.key ? 800 : 600,
    color: line.key ? "#22d3ee" : "#e2e8f0", maxWidth: 840, lineHeight: 1.2,
    at: { x: "50%", y: `${33 + i * 12}%` },
    enter: line.key
      ? { effect: "scale-pop", duration: 0.5, delay: start, easing: "easeOutCubic" }
      : { effect: "typewriter", duration: line.dur, delay: start, easing: "linear" },
  });
}
s.text("author", "Terry Pratchett", { size: 44, weight: 700, color: "#f8fafc",
  at: { x: "50%", y: "82%" }, enter: { effect: "fade", duration: 0.5, delay: t + 0.4 } });
```

## QA gates

- `expect(frame(0)).not.toBeBlack()` — the giant mark is on screen from frame 0.
- `expect(frame(66)).toContainText("The best way to predict")` — 2.2s: typed out (0.15 + 1.7 < 2.2).
- `expect(frame(45)).not.toContainText("to invent it.")` — 1.5s: key not yet popped (scale-pop at opacity 0 before its delay).
- `expect(frame(78)).toContainText("to invent it.")` — 2.6s: pop settled (1.9 + 0.5).
- `expect(frame(105)).toContainText("Alan Kay")` — 3.5s: byline in (2.8 + 0.5).
- `expect(scene("quote")).toHaveLayers("quote-mark", "quote-lead", "quote-key", "author")`; `toHaveBeat("key-pop")`.
- `durationBetween(4, 6)`; `noTextOverflow()` — the key line at 80px is the case that bites.

## Anti-patterns

- Paraphrasing or "tightening" a quote — misquotation is the cardinal sin of this genre; verbatim or don't ship.
- Typing the key phrase — the payoff lands whole (pop); typing everything flatlines the emphasis.
- A quote mark brighter than the quote — it is furniture: opacity ≤ 0.15 or it competes with the type.
- `easeOutCubic` on the typewriter — chars land back-loaded (a burst at the end); linear keeps the cadence.
- The byline entering before the quote finishes — author before payoff reads wrong; the byline is always last.
- Asserting full text mid-typewriter — only the typed prefix exists at that frame (visual-qa skill).
