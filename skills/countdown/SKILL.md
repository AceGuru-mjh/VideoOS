---
name: countdown
version: 0.1.0
description: Event countdown (5s demo, 4+1): digits roll once per second, then a 1s event name + date + CTA lockup that holds still.
trigger: The user asks for a countdown, launch timer, stream-starting-soon sting, event teaser, or a numbered build-up before a reveal.
---

# Countdown

Goal: a 5s (4+1) demo at 1920×1080 — the digits 4-3-2-1 roll once per second (old lifts out, new rises in), then a 1s lockup with event name, date, and CTA. Extend the lockup when this ends a longer event video. Zero-asset.

## Workflow

1. Collect: event name (≤ 12 characters reads best at 110px), date + time + timezone, CTA line, accent color. Never invent an event date — ask; a wrong date does real damage.
2. `storyboard.plan { intent: "countdown · <event>", durationSeconds }` → collapse to TWO scenes: `tick` (4s, four 1s digit windows) and `lockup` (1s), joined by a hard `cut` on the downbeat.
3. Write `src/video.ts` per Recipe 1: digit k owns the window [4−k, 5−k); the departing digit exits `slide-down` (engine: departs upward) while its replacement enters `slide-up` from below — the whole board reads as rolling up.
4. `compile.run` → 0 errors. Watch the window rules: `out` may equal scene duration but never exceed it, and `in` must stay below it — digit windows are computed, not eyeballed.
5. `render.preview` one mid-second frame (digit settled) and one boundary frame (old lifting, new rising) → `test.run` → repair ≤ 3 → `render.final`.
6. For "starting soon" loops, cut back from `lockup` to `tick` and deliver a looping MP4.

Roll mechanics (engine truth): exits retrace the entrance — `exit: slide-down` moves a layer UP as it leaves, `enter: slide-up` brings the next digit from below. Same 0.3s duration on both, fired at the same second boundary. Never pair `exit: slide-up` with `enter: slide-up`: both trace the same offset curve and overlap perfectly mid-flip.

## Recipes

Tick scene — one beat and one roll per second:

```ts
v.scene("tick", { duration: 4, background: "#0a0a12" }, (s) => {
  s.ellipse("halo", { width: 900, height: 900, fill: "#22d3ee", opacity: 0.14, blur: 140,
    at: { x: "50%", y: "42%" } });                        // static frame-0 ink
  for (let k = 4; k >= 1; k--) {
    const start = 4 - k;                                  // digit 4 -> 0s, 3 -> 1s, 2 -> 2s, 1 -> 3s
    s.beat(`tick-${k}`, { at: start, description: `Digit ${k} lands` });
    // one pulse per second — the visible heartbeat of the tick
    s.ellipse(`pulse-${k}`, { width: 560, height: 560, fill: "#22d3ee", opacity: 0.15,
      at: { x: "50%", y: "42%" }, in: start, out: start + 1,
      enter: { effect: "scale-pop", duration: 0.4, easing: "easeOutCubic" } });
    s.text(`digit-${k}`, String(k), { size: 360, weight: 800, color: "#f8fafc",
      at: { x: "50%", y: "42%" }, in: start, out: start + 1,
      enter: { effect: "slide-up", duration: 0.3, easing: "easeOutCubic", params: { distance: 220 } },
      exit: { effect: "slide-down", duration: 0.3, easing: "easeInQuad" } });
  }
});
```

Lockup scene + the cut (everything lands by 0.2s, then 0.8s of stillness):

```ts
v.scene("lockup", { duration: 1, background: "#05070d" }, (s) => {
  s.beat("lockup", { at: 0, description: "Event lockup lands fast, then still" });
  s.ellipse("halo", { width: 1000, height: 640, fill: "#f59e0b", opacity: 0.12, blur: 130,
    at: { x: "50%", y: "44%" } });
  s.text("event", "SHIP CONF", { size: 110, weight: 800, letterSpacing: 6, color: "#f8fafc",
    at: { x: "50%", y: "38%" }, enter: { effect: "scale-pop", duration: 0.15, easing: "easeOutCubic" } });
  s.text("date", "2026-06-06 · 18:00 UTC", { size: 44, color: "#7dd3fc",
    at: { x: "50%", y: "54%" }, enter: { effect: "fade", duration: 0.15 } });
  s.text("cta", "RSVP · videoos.dev/ship", { size: 40, weight: 700, color: "#f59e0b",
    at: { x: "50%", y: "68%" }, enter: { effect: "fade", duration: 0.15, delay: 0.05 } });
});
v.transition("cut", { between: ["tick", "lockup"] });
```

## QA gates

- `expect(frame(0)).not.toBeBlack()` — digit 4 (displaced but on canvas) plus the halo.
- `expect(frame(15)).toContainText("4")` — 0.5s: first second, digit settled.
- `expect(frame(45)).toContainText("3")` — 1.5s: risen by 1.3 (1.0 + 0.3).
- `expect(frame(105)).toContainText("1")` — 3.5s: last digit settled in its window.
- `expect(frame(29)).not.toContainText("3")` — 0.97s: digit 3's window opens at 1.0; windows are `[in, out)`, so assert strictly before the boundary.
- `expect(scene("tick")).toHaveLayers("digit-4", "digit-3", "digit-2", "digit-1", "pulse-1")`; `toHaveBeat("tick-3")`.
- `expect(scene("tick")).durationBetween(3.5, 4.5)`; `expect(scene("lockup")).durationBetween(0.8, 1.5)`.
- `expect(scene("lockup")).noTextOverflow()` — the event name at 110px + letterSpacing 6.

## Anti-patterns

- `exit: slide-up` on the departing digit — engine: it departs downward along the same curve the replacement rises on, so the two overlap perfectly mid-flip. The roll is `exit: slide-down` + `enter: slide-up`.
- Digits under ~240px — a countdown IS the number; at 1080p anything smaller reads as a widget, not an event.
- Inventing the date, time, or timezone — it comes from the user or the video does not ship.
- Slow lockup entrances — at a 1s tail there is no room; land by 0.2s and hold 0.8s (extend the scene for real tails).
- Crossfading tick → lockup — the downbeat wants a hard cut; a crossfade dilutes the tick-to-zero moment.
- Skipping the final "1" — fading straight from "2" to the lockup breaks the once-per-second contract the viewer is counting along with.
