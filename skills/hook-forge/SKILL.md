---
name: hook-forge
version: 0.1.0
description: Design the first 1-3 seconds of any video with a hook pattern library (question, big number, motion-first, mismatch) and prove it reads.
trigger: The user wants the opening of a video to grab attention ("hook", "first 3 seconds", "stop the scroll", "retention") or a draft opens with a slow title and needs a stronger cold open.
---

# Hook Forge

Goal: a 1–3s hook scene (any aspect; usually the first scene of a longer video) that states the payoff, a number, or a tension — fully readable at 0.8s, and provably present via QA. The hook is a pattern applied to the FIRST scene, not a separate video.

## Workflow

1. Classify the source material into one hook pattern (pick exactly one; never stack two):
   - **Question** — the viewer's actual problem as one line ("Why does your render silently break?").
   - **Big number** — one metric, ≥ 140px, with a 3–5 word caption ("60% of frames re-render for nothing").
   - **Motion-first** — one element already moving at frame 0 (wipe bar, drifting grid); text lands at ≤ 0.8s.
   - **Mismatch** — a wrong-looking pair ("This video is 100% code / 0% cameras").
2. Write the hook as `scene("hook", { duration: 1–3s })` with a `beat("payoff", { at: 0 })` and the dominant element sized ≥ 120px. Everything else (glow, caption, grid) is support at ≤ 60px or opacity ≤ 0.3.
3. `compile.run` → 0 errors required. Then `render.preview { scene: "hook", beat: "payoff" }` — if the dominant element is not the ONLY thing you notice, shrink the rest or split the scene.
4. `test.run` with the QA gates below (the 0.8s readability gate is the contract). Repair loop ≤ 3 via `scene.modify`; wrap risky edits in `transaction.begin` / `transaction.rollback`.
5. Hand off: the NEXT scene answers the hook. Add `v.transition("crossfade", { duration: 0.4, between: ["hook", "<next>"] })` — never fade-black out of a hook (momentum dies).
6. `render.final` — deliver, and report which hook pattern you chose in one line.

Pattern selection guide: product demos → question or mismatch; data stories → big number; tech intros → motion-first; tutorial → question ("The 2-minute way to X"); lyrics/MV → motion-first. If the user gave a metric, big number wins ties.

## Recipes

Question hook — one line, blur-up, glow ink, hand-off crossfade:

```ts
v.scene("hook", { duration: 2.5, background: "#0a0a12" }, (s) => {
  s.beat("payoff", { at: 0, description: "Question readable by 0.8s" });
  s.rect("glow", { width: 820, height: 360, fill: "#f59e0b", opacity: 0.14, blur: 140,
    at: { x: "50%", y: "44%" } });
  s.text("question", "Why does your render\nsilently break?", { size: 96, weight: 800,
    color: "#f8fafc", lineHeight: 1.15, at: { x: "50%", y: "44%" },
    enter: { effect: "blur-up", duration: 0.5, easing: "easeOutCubic" } });
  s.text("kicker", "debug it like code", { size: 36, color: "#94a3b8", letterSpacing: 3,
    at: { x: "50%", y: "66%" }, enter: { effect: "fade", duration: 0.5, delay: 0.6 } });
});
```

Big number hook — number first at ≥ 140px, caption small and late (0.7s+), count-up via typewriter is allowed on the CAPTION, never the number:

```ts
v.scene("hook", { duration: 3, background: "#05070d" }, (s) => {
  s.beat("payoff", { at: 0, description: "Number lands" });
  s.rect("accent-bar", { width: 260, height: 8, fill: "#22d3ee", radius: 4,
    at: { x: "50%", y: "30%" }, enter: { effect: "wipe", duration: 0.45, easing: "easeOutCubic" } });
  s.text("number", "60%", { size: 220, weight: 800, color: "#f8fafc",
    at: { x: "50%", y: "45%" }, enter: { effect: "scale-pop", duration: 0.5, easing: "easeOutCubic" } });
  s.text("caption", "of frames re-render for nothing", { size: 40, color: "#7dd3fc",
    at: { x: "50%", y: "62%" }, enter: { effect: "fade", duration: 0.5, delay: 0.7 } });
});
```

Motion-first — the wipe bar is moving at frame 0 (no enter delay), text lands on top of it; use when the video itself is about speed:

```ts
v.scene("hook", { duration: 2 }, (s) => {
  s.beat("payoff", { at: 0, description: "Bar already sweeping at frame 0" });
  s.rect("sweep", { width: 1920, height: 14, fill: "#f59e0b", radius: 7,
    at: { x: "50%", y: "50%" }, enter: { effect: "wipe", duration: 0.9, easing: "easeOutCubic" } });
  s.text("mismatch", "100% code\n0% cameras", { size: 110, weight: 800, color: "#f8fafc",
    lineHeight: 1.1, at: { x: "50%", y: "42%" },
    enter: { effect: "blur-up", duration: 0.45, delay: 0.35, easing: "easeOutCubic" } });
});
```

Vertical (9:16) adaptation: swap y-anchoring to safe zones — dominant at `y: 38%`, caption at `y: 54%`, keep ≥ 220px clear at top and bottom for platform UI. Same timing contract.

## QA gates

- `expect(frame(0)).not.toBeBlack()` — glow / accent bar / sweep supplies ink.
- Readability contract: `expect(frame(24)).toContainText(<dominant text>)` on 30fps (0.8s hard limit; motion-first text may relax to frame 30 = 1.0s).
- `expect(frame(48)).toContainText(<kicker/caption>)` — support text landed by 1.6s.
- `expect(scene("hook")).toHaveLayers(...)` — pattern-named layers survive edits (question+glow / number+caption / sweep+mismatch).
- `noTextOverflow()` on the hook — hooks use the largest type in the video; also run `check.overflow`.
- `durationBetween`: hook ≤ 3s. A 4s hook is not a hook; it is an intro scene — hand off to the tech-intro skill.
- One-pattern rule: `expect(frame(12))` must show ONE dominant element (self-review in `render.preview`); stacking number + question + sweep fails review even if assertions pass.

## Anti-patterns

- Brand-first opens (logo before payoff) — the viewer owes you nothing at 0:00; earn attention, then brand in the hold.
- Mystery hooks ("You won't believe…") — clickbait reads as scam; mismatch or number states a checkable claim instead.
- Two patterns stacked (big number AND question) — pick one; the other becomes the second scene's content.
- Slow burns (title fades over 2.5s) — enter duration ≤ 0.6s for the dominant element; blur-up buys gravitas, delay kills it.
- Sound-dependent hooks — assume muted autoplay; the pattern must land visually (see accessible-captions skill for the CPS/contrast rules when captions exist).
