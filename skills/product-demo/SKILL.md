---
name: product-demo
version: 0.1.0
description: Structure a product demo/marketing video as hook → problem → solution → proof → CTA with kinetic text and optional data proof.
trigger: The user asks to make a promo/demo/launch/intro video for a product, feature, or open-source project (marketing narrative, not tutorial footage).
---

# Product Demo

Goal: a 20–30s marketing cut (shrink to 8–12s when asked for "short") where every scene answers one buyer question, ending in a CTA. Zero-asset by default: everything is text + shapes you fully control.

## Workflow

1. Extract the facts first: product name, one-line value prop, 2–4 concrete capabilities, one proof point (number/metric), CTA (URL or action). If any are missing, ask — never invent metrics.
2. `storyboard.plan { intent: "<product> · <value prop>", durationSeconds }` → template shots; remap them onto the canonical structure below (rename shots, adjust durations in your head, then write DSL directly — `storyboard.toScenes` output is a draft, the structure is the contract).
3. Write `src/video.ts` with the five acts (Recipes). 30fps, 1920×1080 (16:9) unless the user says otherwise.
4. `compile.run` → 0 errors required; fix `OVERFLOW_RISK`/`noTextOverflow` before proceeding.
5. `render.preview { scene, beat }` on every beat still — check hierarchy: one dominant element per scene.
6. QA gates (below) → `test.run` → repair loop (≤ `maxRepairLoops`, then `transaction.rollback` if you began one).
7. `render.final` → deliver the MP4 path + a one-line summary of the narrative.

Canonical structure (30s cut; halve for 12–15s by merging proof into solution):

| Act | Window | Scene | Job | Dominant element |
| --- | --- | --- | --- | --- |
| Hook | 0–3s | `hook` | name + one-liner, grab attention | product name, size ≥ 120 |
| Problem | 3–8s | `problem` | the pain, in the buyer's words | 2–3 short pain lines (staggered) |
| Solution | 8–20s | `solution` | 2–4 capabilities as kinetic list | numbered items + heading |
| Proof | 20–27s | `proof` | ONE metric or social proof | big number (data-motion pattern) |
| CTA | 27–30s | `cta` | single action + URL | imperative verb + URL |

## Recipes

Hook — big name, blur-up, camera push, static glow for frame-0 ink:

```ts
v.scene("hook", { duration: 3, background: "#0a0a12" }, (s) => {
  s.beat("name-enter", { at: 0.2, description: "Product name reveal" });
  s.rect("glow", { width: 700, height: 700, fill: "#6d28d9", opacity: 0.25, blur: 120, at: { x: "50%", y: "38%" } });
  s.text("name", "VideoOS", { size: 150, weight: 800, color: "#ffffff", at: { x: "50%", y: "38%" },
    enter: { effect: "blur-up", duration: 0.8 } });
  s.text("tagline", "The agent-native video IDE", { size: 44, color: "#8b8ba7", at: { x: "50%", y: "54%" },
    enter: { effect: "fade", duration: 0.6, delay: 0.5 } });
  s.camera("push-in", { from: 1.0, to: 1.08 });
});
```

Problem — three short pain lines, same effect, 0.45s stagger:

```ts
v.scene("problem", { duration: 5 }, (s) => {
  s.beat("pain-1", { at: 0.2 }); s.beat("pain-2", { at: 0.65 }); s.beat("pain-3", { at: 1.1 });
  const lines = ["Rendering breaks silently", "Reviews can't see regressions", "Fixes lose history"];
  for (const [i, line] of lines.entries()) {
    s.text(`pain-${i + 1}`, line, { size: 52, weight: 600, color: "#e2e8f0",
      at: { x: "50%", y: `${34 + i * 14}%` },
      enter: { effect: "slide-up", duration: 0.5, delay: 0.2 + i * 0.45, easing: "easeOutCubic", params: { distance: 60 } } });
  }
});
```

Solution — numbered kinetic list (the signature pattern of this skill):

```ts
s.text("heading", "BUILT FOR AGENTS", { size: 76, weight: 800, letterSpacing: 4, color: "#ffffff",
  at: { x: "50%", y: "24%" }, enter: { effect: "blur-in", duration: 0.6 } });
s.rect("accent", { width: 240, height: 6, fill: "#f59e0b", radius: 3, at: { x: "50%", y: "31%" },
  enter: { effect: "fade", duration: 0.5, delay: 0.2 } });
// then item-1..N slide-up, delay 0.3 apart (see cinematic-video skill)
```

Proof — one big number, `scale-pop` + `easeOutBack`; pair with a count-up label via `typewriter` (`easeOutCubic`) underneath. For a real bar chart, switch to the **data-motion** skill pattern (rect bars + mask). Data-story integration rule: the chart lives in its own scene, one takeaway sentence after it — never mix chart + marketing copy in one scene.

CTA — imperative verb ≥ 88px, URL in muted gray, fade; end hold ≥ 0.8s of stillness:

```ts
v.scene("cta", { duration: 3 }, (s) => {
  s.beat("cta-enter", { at: 0.2 });
  s.text("cta", "Start shipping today", { size: 88, weight: 800, color: "#ffffff", at: { x: "50%", y: "44%" },
    enter: { effect: "fade", duration: 0.8, delay: 0.2 } });
  s.text("url", "github.com/AceGuru-mjh/VideoOS", { size: 44, color: "#8b8ba7", at: { x: "50%", y: "58%" },
    enter: { effect: "fade", duration: 0.6, delay: 0.8 } });
});
```

Join acts with `v.transition("crossfade", { duration: 0.5, between: ["hook", "problem"] })` etc. — adjacent scenes only. Total = Σ durations − 0.5×(scenes−1).

## QA gates

- `expect(frame(0)).not.toBeBlack()` (hook glow).
- `toContainText` for the product name, every problem line, every solution item, the metric, and the URL — each at a frame ≥ its entrance completion (`sceneStart + in + delay + duration`), computed from the crossfade-overlap timeline.
- `expect(scene("solution")).toHaveLayers("heading", "item-1", "item-2", "item-3")` — structure survives edits.
- `durationBetween` per act: hook ≤ 4, proof 4–8, cta 2–4.
- `noTextOverflow()` on every scene (marketing copy is the overflow-est genre; check `check.overflow` too).
- Structure gates: `toHaveBeat` for the first beat of each act — proves the act wasn't dropped by a later edit.

## Anti-patterns

- Inventing metrics ("99% faster") without a user-provided source — fabricate nothing; use qualitative proof instead.
- Two messages per scene — if a scene needs two headings, split it.
- Feature-dump solution acts (>5 items): pick the top 3–4; link a doc for the rest.
- Logos/screenshots as image layers by default — v1 examples are zero-asset; only add `s.image` when the user supplies files (`asset.add`), and declare width/height explicitly.
- Speed-run pacing: all acts 2s → nothing reads. Respect the table's windows.
- CTA without stillness: an exit-animation on the final frame makes the video end mid-fade — leave the last 0.5–1s settled.
