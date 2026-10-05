---
name: ad-remix
version: 0.1.0
description: One master, three cuts - 30s / 15s / 6s ad variants with a fixed keep-order (hook, CTA, compress middle), per-variant QA suites, and a cut log.
trigger: One approved ad master must ship as multiple durations (30s / 15s / 6s cutdowns, bumper), or the campaign mix needs long and short variants of the same spot.
---

# Ad Remix

Goal: one approved 30s master re-authored (not trimmed) into 15s and 6s variants, each with its own timing math and its own QA suite. Deliverables: three MP4s in `project-30s/`, `project-15s/`, `project-6s/` directories plus the cut log - what each tier dropped and why.

## Workflow

1. Green master first: the 30s must pass the product-demo skill's QA before any variant exists - variants of a red master are just faster red videos.
2. Build the variant budget with the script-timing skill - word budgets per tier and solution item counts 4 -> 2 -> 1. The table below is the contract.
3. Cut in the fixed keep-order; log every cut. Hook (1-3s; the 6s keeps a 1s hook) -> CTA (2s+ and still) -> middle compression (merge problem lines, shrink solution items) -> proof numbers survive ONLY in the 30s.
4. Author each tier as its own project directory with a full `defineVideo` - the 6s hook is a 1s hook with its own enter math, never the 30s 3s hook squeezed. Never `render.range` the master and call it a cut.
5. Per variant: `compile.run` -> 0 errors -> `check.overflow` -> `render.preview` every beat (the 6s previews in three beats: hook, value, CTA).
6. Per variant: `test.run` with its OWN suite - a green 15s proves nothing about frame 24 of the 6s. Repair loop of at most 3 per variant via `scene.modify`.
7. `render.final` all three. Every tier ends on the end-card pattern (load the end-card skill: fade-in only, 0.8-1.2s stillness, matched background). Deliver paths plus the cut log.

Variant budget table:

| Tier | Total | Hook | Problem | Solution | Proof | CTA |
| --- | --- | --- | --- | --- | --- | --- |
| 30s | 30 | 3 | 5 | 12 (4 items) | 7 | 3 |
| 15s | 15 | 2 | 3 | 7 (2 items) | - (fold one number into an item) | 3 |
| 6s | 6 | 1 | - | 2.5 (1 item = the value prop) | - | 2.5 |

Keep-order rationale: the hook is why anyone watches (drop it and the rest is unwatched), the CTA is why the ad exists, the middle compresses gracefully, and a proof number without 5s of context is a claim without evidence - so proof is the first thing cut and lives only in the 30s.

## Recipes

The 6s bumper, complete - 1s hook, 2.5s value, 2.5s CTA, hard cuts between:

```ts
v.scene("hook", { duration: 1 }, (s) => {
  s.beat("stop", { at: 0, description: "Readable by 0.8s or the ad already lost" });
  s.rect("ink", { width: 700, height: 260, fill: "#f59e0b", opacity: 0.2, blur: 120,
    at: { x: "50%", y: "42%" } });
  s.text("claim", "Renders break.", { size: 96, weight: 800, color: "#f8fafc",
    at: { x: "50%", y: "42%" }, enter: { effect: "blur-up", duration: 0.35, easing: "easeOutCubic" } });
});
v.transition("cut", { between: ["hook", "value"] });
v.scene("value", { duration: 2.5 }, (s) => {
  s.beat("item-1", { at: 0.5, description: "The one item that survived the cut" });
  s.text("item-1", "Every frame, tested.", { size: 88, weight: 700, color: "#e2e8f0",
    at: { x: "50%", y: "45%" },
    enter: { effect: "slide-up", duration: 0.4, delay: 0.1, params: { distance: 70 } } });
});
v.transition("cut", { between: ["value", "cta"] });
v.scene("cta", { duration: 2.5 }, (s) => {
  s.beat("cta", { at: 0.5, description: "CTA + URL, then still" });
  s.text("cta", "Try it free", { size: 88, weight: 800, color: "#ffffff",
    at: { x: "50%", y: "44%" }, enter: { effect: "fade", duration: 0.5, delay: 0.1 } });
  s.text("url", "videoos.dev", { size: 44, color: "#8b8ba7",
    at: { x: "50%", y: "58%" }, enter: { effect: "fade", duration: 0.5, delay: 0.4 } });
});
```

The 15s middle compression - 4 items become 2 merged items in the same solution scene (each merged item absorbs its neighbor's claim; the big proof number lives in the 30s only):

```ts
v.scene("solution", { duration: 7 }, (s) => {
  s.beat("item-1", { at: 0.5 }); s.beat("item-2", { at: 3.2 });
  s.text("heading", "BUILT FOR AGENTS", { size: 72, weight: 800, letterSpacing: 4, color: "#ffffff",
    at: { x: "50%", y: "24%" }, enter: { effect: "blur-in", duration: 0.5 } });
  s.text("item-1", "1. Scenes as code - diffable, reviewable", { size: 56, weight: 600,
    color: "#e2e8f0", at: { x: "50%", y: "48%" },
    enter: { effect: "slide-up", duration: 0.45, delay: 0.3, params: { distance: 70 } } });
  s.text("item-2", "2. Gates on every frame - QA as video", { size: 56, weight: 600,
    color: "#e2e8f0", at: { x: "50%", y: "64%" },
    enter: { effect: "slide-up", duration: 0.45, delay: 3.0, params: { distance: 70 } } });
});
```

## QA gates

- `durationBetween`: 30s within 1s / 15s within 0.5s / 6s within 0.3s of target.
- Hook contract per tier: the 6s hook `durationBetween(0.8, 1.5)` with the dominant claim readable by 0.8s - `expect(frame(24)).toContainText("Renders break.")`.
- CTA intact: every tier ends with a CTA scene of at least 2s and a still final 0.8s; no `exit` on any layer in any tier.
- Item counts are structure: `toHaveLayers("item-1", ..., "item-4")` in the 30s, two items in the 15s, one in the 6s - the budget table is the contract.
- Proof confinement: no big-number proof layer outside the 30s project.
- Per variant: `noTextOverflow()` plus `check.overflow`, `expect(frame(0)).not.toBeBlack()` on the hook, and `toContainText` for every surviving line at a frame at or past its entrance completion (script-timing budgets).

## Anti-patterns

- `render.range` the 30s master and calling it a 15s - entrances timed for 3s beats flash past at 15s pacing; a cutdown is a re-authored timeline, not a sub-range.
- Speed-ramping the master (0.8x) - motion smears and the voice reads as broken, not shorter; re-time instead.
- Dropping the hook to save the proof number - keep-order exists because attention is earned before it is informed; a 6s with proof and no hook never gets watched.
- Sharing one `test.run` across tiers - each duration has its own readability math; a green 15s says nothing about the 6s.
- Keeping 4 items at 6s - 1.5s per item is under any word budget (script-timing); pick the single strongest item.
- Ending the 6s mid-pop - feed loops freeze the final frame; the bumper's CTA holds still for at least 0.8s (end-card rule).
