---
name: countdown
version: 0.1.0
description: Countdown and event teaser - numbers swap exactly on whole seconds, the final GO frame pops with easeOutBack, then a still CTA lockup.
trigger: The user asks for a countdown, "3-2-1", launch or event teaser, stream "starting soon" clip, webinar open, or deadline reminder video.
---

# Countdown

Goal: a 6-10s 1920x1080 countdown (vertical 1080x1920 for stories - same numbers, remap y): number swaps land EXACTLY on whole seconds, one overshoot (easeOutBack) is saved for the final frame, and the last act is a dead-still event lockup. The beat grid IS the video.

## Workflow

1. Collect: start number (default 3; 10 for launches), the blast word (GO / LIVE / the event name), event name, date-time (with timezone), URL. Nothing invented: no date, no countdown - ask.
2. `storyboard.plan { intent: "<event> · countdown", durationSeconds: 8 }` - two scenes: `ticks` (N+1 s) and `event` (~4s); a hard `cut` between them lands the lockup on a clean second.
3. Write `src/video.ts` from the tick law (Recipes): number N occupies the whole second before N's boundary; the GO layer owns everything after the last tick. One `s.beat` per tick at integer seconds - the beats are the grid.
4. `compile.run` -> 0 errors; `check.overflow` (320px numerals are the widest content you will ever center).
5. `render.preview` at each tick beat AND at one mid-swap frame (0.5s after a boundary) - the swap must read as a flip: outgoing gone before incoming settles.
6. QA gates (below) -> `test.run` -> repair loop (<= maxRepairLoops, then `transaction.rollback`) -> `render.final`.

| Act | Window | Scene | Job | Dominant element |
| --- | --- | --- | --- | --- |
| Ticks | 0-3s | `ticks` | 3-2-1, one swap per whole second | the number, size >= 280 |
| Blast | 3-4s | `ticks` | GO pops - the only overshoot | GO, amber |
| Lockup | 4-8s | `event` | event + when + where, then still | event name, >= 88 |

## Recipes

The tick grid - one text layer per number with `in`/`out` windows on whole seconds; enter blur-up 0.35s reads as the flip-in, exit fade 0.25s ends 0.05s BEFORE the next `in` so numbers never coexist:

```ts
v.scene("ticks", { duration: 4, background: "#0a0a12" }, (s) => {
  const TICKS = [3, 2, 1]; // number N owns [i, i+0.95] - swaps land on whole seconds
  for (const [i, n] of TICKS.entries()) {
    s.beat(`tick-${n}`, { at: i, description: `${n} - swap on the whole second` });
    s.text(`num-${n}`, String(n), { size: 320, weight: 800, color: "#ffffff", at: { x: "50%", y: "42%" },
      in: i, out: i + 0.95,
      enter: { effect: "blur-up", duration: 0.35, easing: "easeOutCubic", params: { distance: 60, blur: 10 } },
      exit: { effect: "fade", duration: 0.25 } });
  }
  s.beat("go", { at: 3.0, description: "GO pops - the only overshoot in the video" });
  s.ellipse("halo", { width: 700, height: 700, fill: "#6d28d9", opacity: 0.22, blur: 130, at: { x: "50%", y: "42%" } });
  s.text("go", "GO", { size: 300, weight: 800, color: "#f59e0b", at: { x: "50%", y: "42%" },
    in: 3, enter: { effect: "scale-pop", duration: 0.45, easing: "easeOutBack" } });
  s.camera("push-in", { from: 1.0, to: 1.05 });
});
```

Event lockup - hard `cut` from the blast; name first, when in amber, where in gray; last 1.5s perfectly still (countdowns get frozen on projector screens):

```ts
v.scene("event", { duration: 4 }, (s) => {
  s.beat("lockup", { at: 0.2, description: "Event lockup settles and holds still" });
  s.text("name", "SHIP CONF 2025", { size: 96, weight: 800, letterSpacing: 4, color: "#ffffff",
    at: { x: "50%", y: "38%" }, enter: { effect: "blur-up", duration: 0.6, params: { distance: 40, blur: 12 } } });
  s.text("when", "OCT 24 · 09:00 UTC", { size: 44, weight: 600, letterSpacing: 3, color: "#f59e0b",
    at: { x: "50%", y: "52%" }, enter: { effect: "fade", duration: 0.5, delay: 0.5 } });
  s.text("where", "shipconf.dev/stage", { size: 40, color: "#8b8ba7", at: { x: "50%", y: "62%" },
    enter: { effect: "fade", duration: 0.5, delay: 0.9 } });
});
v.transition("cut", { duration: 0.1, between: ["ticks", "event"] }); // cut never overlaps; duration is a formality
```

Variants (same tick law, different grids):

| Variant | Numbers | Per-tick | Total | Notes |
| --- | --- | --- | --- | --- |
| Event opener | 3-2-1 | 1.0s | 7-8s | the default |
| Launch teaser | 10-1 | 0.8s | 12-14s | sub-second ticks: window = 0.75s, swap gap 0.05s |
| Stream loop | 60-10 (tens) | 5s | ~40s | add `v.audio` tick sound if the user supplies one |

## QA gates

- `expect(frame(15)).toContainText("3")` - numeral 3 settles at 0.35s (frame >= 12).
- `expect(frame(30)).not.toContainText("3")` (the layer is not drawn after its `out` at 0.95s) and `expect(frame(45)).toContainText("2")` - the swap at 1.0s actually exchanged numbers.
- `expect(frame(105)).toContainText("GO")` - pops at 3.0s, settles at 3.45s (frame >= 104).
- `expect(scene("ticks")).toHaveLayers("num-3", "num-2", "num-1", "go")`.
- `expect(scene("ticks")).durationBetween(3.5, 4.5)` and `expect(scene("event")).durationBetween(3, 5)`.
- Lockup stillness: last entrance ends at 1.4s of 4; assert `expect(frame(210)).toContainText("shipconf.dev/stage")` and hand-check the final second is motionless in `render.preview`.

## Anti-patterns

- Off-second swaps (in: 0.9 / out: 1.87) - the audience counts along out loud; drift is audible.
- Overshoot on every number - easeOutBack is budgeted for ONE frame (the blast); ticks stay easeOutCubic.
- Numbers coexisting (out >= next in) - a crossfade between digits reads as a typo, not a flip.
- A moving final frame - the lockup is a poster; stillness >= 1.5s.
- Tick duration > 1.2s - anticipation decays; 10-counts use 0.8s, not 2s.
- Vague "coming soon" lockups - a countdown without a real date and URL is a trailer for nothing; ask.
