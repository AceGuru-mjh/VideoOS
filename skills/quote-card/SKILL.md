---
name: quote-card
version: 0.1.0
description: Quote cards (square 1:1) - giant quote mark, typewriter reveal of the quote, one amber keyword pops, attribution settles last.
trigger: The user asks to turn a quote, testimonial, pull-quote, or aphorism into a shareable animated card video for social feeds.
---

# Quote Card

Goal: a 1080x1080 square card, 6-9s (swap meta to 1080x1920 for stories): giant quote mark -> quote types itself -> ONE keyword pops amber -> attribution settles into a still card. The quote is verbatim from the user with its author cited; cards never paraphrase.

## Workflow

1. Collect: the quote (verbatim, with source), author, optional context line. If the quote has no obvious keyword, ask which 1-3 words to emphasize - never choose silently (misquotes go viral).
2. `storyboard.plan { intent: "quote card · <author>", durationSeconds: 7 }` - one scene, four beats (mark / type / pop / credit). Single-scene is the point: a card is one composition.
3. Write `src/video.ts`: static glow (frame-0 ink), quote mark at low opacity, 2-3 typed lines (<= 17 chars per line at size 76 on a 1080 card - split longer text), the keyword as its OWN amber layer popping after typing completes, attribution last.
4. `compile.run` -> 0 errors; `check.overflow` - maxWidth 820 at 1080 wide is half the room of 16:9.
5. `render.preview` at every beat - a mid-typewriter frame (chars visible) and the post-pop frame are the two looks that matter.
6. QA gates (below) -> `test.run` -> repair loop (<= maxRepairLoops, then `transaction.rollback`) -> `render.final`.

| Beat | Window | Job | Dominant element |
| --- | --- | --- | --- |
| Mark | 0-0.9s | giant quotation mark opens the card | quote mark, opacity <= 0.4 |
| Type | 0.9-2.6s | quote lines type in sequence | the typed quote, size >= 64 |
| Pop | 2.9-3.5s | keyword pops amber with halo | keyword + halo |
| Credit | 4.2-7s | attribution settles; card holds still | attribution, gray |

## Recipes

Mark + typed lines - typewriter at 0.05s per character, lines chained (each starts when the previous finishes plus a 0.25s breath):

```ts
export default defineVideo(
  { title: "Quote - Kent Beck", width: 1080, height: 1080, fps: 30, background: "#0a0a12", seed: 42 },
  (v) => {
    v.scene("quote", { duration: 7 }, (s) => {
      s.beat("mark", { at: 0.1, description: "Giant quote mark opens the card" });
      s.beat("type", { at: 0.9, description: "Quote types itself, line by line" });
      s.rect("glow", { width: 640, height: 640, fill: "#6d28d9", opacity: 0.18, blur: 130, at: { x: "50%", y: "42%" } });
      s.text("mark", "\u201C", { size: 340, weight: 800, color: "#6d28d9", opacity: 0.35,
        at: { x: 220, y: 190 }, enter: { effect: "fade", duration: 0.5 } });
      const LINES = ["Make it work,", "make it right,"]; // 13 + 14 chars
      let cursor = 0.9;
      for (const [i, line] of LINES.entries()) {
        s.text(`line-${i + 1}`, line, { size: 76, weight: 600, color: "#e2e8f0", maxWidth: 820,
          at: { x: 540, y: 400 + i * 120 },
          enter: { effect: "typewriter", duration: 0.05 * line.length, delay: cursor, easing: "linear" } });
        cursor += 0.05 * line.length + 0.25;
      }
```

Keyword pop + halo + credit - the keyword is the quote's last phrase as its OWN layer, popping after typing completes; the halo (blurred amber rect, declared BEFORE the keyword so it paints behind) fades in and stays. v1 has no pulsing loop animation - the halo plus the pop IS the breathing emphasis:

```ts
      s.beat("pop", { at: 2.9, description: "Keyword pops in amber with a halo" });
      s.beat("credit", { at: 4.2, description: "Attribution settles; card goes still" });
      s.rect("halo", { width: 560, height: 140, fill: "#f59e0b", opacity: 0.28, blur: 60,
        at: { x: 540, y: 620 }, in: 2.9, enter: { effect: "fade", duration: 0.5 } });
      s.text("keyword", "MAKE IT FAST", { size: 92, weight: 800, color: "#f59e0b", letterSpacing: 2,
        at: { x: 540, y: 620 },
        enter: { effect: "scale-pop", duration: 0.5, delay: 3.0, easing: "easeOutBack" } });
      s.text("credit", "- Kent Beck", { size: 36, color: "#8b8ba7", at: { x: 540, y: 810 },
        enter: { effect: "fade", duration: 0.6, delay: 4.2 } });
    });
  },
);
```

Vertical variant - same composition, remap y only (feed-safe band is y 14-80%):

```ts
{ title: "Quote - Kent Beck", width: 1080, height: 1920, fps: 30, background: "#0a0a12", seed: 42 }
// mark at y 16%, lines at y 38% + i*12%, keyword y 64%, credit y 74% - x stays 50%
```

## QA gates

- `expect(frame(0)).not.toBeBlack()` - glow is static ink.
- Typing completes at 0.9 + 0.65 + 0.25 + 0.7 = 2.5s: `expect(frame(75)).toContainText("make it right,")`.
- Pop gate: `expect(frame(80)).not.toContainText("MAKE IT FAST")` (pops at 3.0s = frame 90) then `expect(frame(120)).toContainText("MAKE IT FAST")` (settled at 3.5s).
- `expect(frame(150)).toContainText("- Kent Beck")` - credit settles at 4.8s.
- `expect(scene("quote")).toHaveLayers("mark", "line-1", "line-2", "keyword", "credit")`.
- `expect(scene("quote")).durationBetween(6, 9.5)`; `noTextOverflow()` - a 1080 card has half the 16:9 width.
- Verbatim check by hand: diff the rendered quote against the user's source string before `render.final` - QA asserts presence, not accuracy.

## Anti-patterns

- Two emphasized words - one pop per card; two pops halve each other.
- Typing faster than 0.03s/char (flicker) or slower than 0.06s/char (a slog); 0.05 is the default.
- Paraphrasing, trimming, or "fixing" the quote - verbatim plus author, or ask; invented attributions are the genre's cardinal sin.
- The giant mark at full opacity - it is punctuation, not the subject; keep it <= 0.4 opacity.
- More than 3 typed lines - that is a paragraph, not a quote; switch to the subtitle-burn skill.
- Attribution sized like the quote - credit is 36-40px gray, always subordinate.
