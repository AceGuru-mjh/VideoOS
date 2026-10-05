---
name: brand-kit
version: 0.1.0
description: Define a brand once as one BRAND token object (palette, type scale, weights) that every scene consumes - contrast-gated, with a one-line reskin flow.
trigger: The user supplies brand colors or a style guide for a video, asks for on-brand consistency across scenes, or wants the same video reskinned to another brand.
---

# Brand Kit

Goal: one `const BRAND = {...}` at the top of `src/video.ts` is the only place a hex, a font size, or a weight may live. Every scene consumes tokens; consistency is gated (text contrast via the mcp-color server's `color.contrast`, palette harmony via `color.harmonize`); and a reskin is editing the object, never the scenes.

## Workflow

1. Collect the brand contract: primary / secondary / accent hexes, background, text color, a 5-step type scale, and weights. Given only ONE hex, derive candidates with the mcp-color `color.palette` tool (base + scheme "analogous" or "monochrome" + count) and confirm the pick with the user before any scene exists.
2. Author the token object (Recipe 1) at the top of `src/video.ts` - palette, `scale` array, `weight` map. Nothing below it in the file may contain a hex literal or a raw font size.
3. Gate the palette BEFORE writing scenes: `color.contrast { foreground, background }` on every text-on-surface pair - 4.5:1 or better for body sizes, 3:1 for display; then `color.harmonize { colors }` on the ordered palette. Fix flagged pairs by editing tokens, never by patching one scene.
4. Consume tokens everywhere: scene backgrounds, fills, text colors, sizes, and weights all read `BRAND.*` (Recipes). For a 9:16 deliverable, sizes pass through the aspect-reframe compensation - the scale itself never changes.
5. `compile.run` -> 0 errors, then `check.overflow` (display sizes off the scale are the overflow case) and `render.preview` on one scene per token role (display, body, accent).
6. `test.run` with the gates below; repair loop <= 3 via `scene.modify`, risky edits inside `transaction.begin` / `transaction.rollback`.
7. Reskin flow: duplicate the project, edit BRAND ONLY, re-run `compile.run` + `test.run` - both must stay green with zero scene edits. If a reskin needs a scene edit, a literal leaked; fix the leak, not the scene.

## Recipes

The token object plus a consuming scene - the pattern every scene repeats:

```ts
const BRAND = {
  bg: "#0a0a12", surface: "#141422",
  text: "#f8fafc", muted: "#94a3b8",
  primary: "#6366f1", secondary: "#22d3ee", accent: "#f59e0b",
  scale: [120, 84, 60, 44, 32],          // display, h1, h2, body, caption
  weight: { display: 800, body: 600 },
};
v.scene("title", { duration: 3, background: BRAND.bg }, (s) => {
  s.beat("brand-in", { at: 0, description: "Size from scale[0], colors from tokens" });
  s.rect("ink", { width: 760, height: 300, fill: BRAND.primary, opacity: 0.16, blur: 130,
    at: { x: "50%", y: "42%" } });                       // frame-0 ink, token fill
  s.text("title", "Northwind", { size: BRAND.scale[0], weight: BRAND.weight.display,
    color: BRAND.text, letterSpacing: 4, at: { x: "50%", y: "42%" },
    enter: { effect: "blur-up", duration: 0.5, easing: "easeOutCubic" } });
  s.text("kicker", "ship on friday", { size: BRAND.scale[4], color: BRAND.muted,
    letterSpacing: 3, at: { x: "50%", y: "56%" },
    enter: { effect: "fade", duration: 0.5, delay: 0.4 } });
});
```

A second scene, and the entire reskin edit - scene bodies never change between brands:

```ts
// reskin = ONE edit at the top of the forked project, scenes untouched:
// const BRAND = { ...BASE, bg: "#f8fafc", surface: "#eef2f7", text: "#0a0a12",
//   muted: "#64748b", primary: "#0f766e", secondary: "#0e7490", accent: "#dc2626" };
v.scene("feature", { duration: 3.5, background: BRAND.surface }, (s) => {
  s.beat("value-land", { at: 0.3, description: "Accent on one element per scene, max" });
  s.rect("card", { width: 920, height: 420, fill: BRAND.bg, radius: 24,
    at: { x: "50%", y: "46%" } });
  s.text("value", "0 regressions this quarter", { size: BRAND.scale[1],
    weight: BRAND.weight.display, color: BRAND.text, at: { x: "50%", y: "42%" },
    enter: { effect: "slide-up", duration: 0.45, delay: 0.3, params: { distance: 70 } } });
  s.text("proof", "verified on 12,847 frames", { size: BRAND.scale[3], color: BRAND.accent,
    at: { x: "50%", y: "58%" }, enter: { effect: "fade", duration: 0.5, delay: 0.8 } });
});
```

## QA gates

- Contrast ledger: every text-on-surface pair measured with `color.contrast`, ratios logged in the gate table - body pairs >= 4.5:1, display pairs >= 3:1 (the accessible-captions bar).
- Token discipline: `scene.inspect` every scene - no fill/color outside the palette, no size outside `scale`, accent on at most one element per scene.
- Pattern stability: `toHaveLayers("title", "ink", "kicker")`-style assertions keep layer names stable, so a reskin cannot break tests.
- Reskin proof: the duplicated project with a different BRAND passes `test.run` untouched - the reskin gate IS the consistency gate.
- `expect(frame(0)).not.toBeBlack()` (the ink rect wears a token fill); `noTextOverflow()` plus `check.overflow` at display sizes.

## Anti-patterns

- Hex literals inside scene bodies - the reskin flow silently misses them, and the next brand ships with the old color.
- More than 3 palette colors on screen at once - `color.harmonize` flags low adjacent contrast, and viewers read the palette as noise rather than identity.
- Off-scale sizes ("this headline felt like 104px") - the scale is the hierarchy; one-off sizes break the rhythm across scenes.
- Accent as body color - the accent signals importance only while ordinary text never wears it.
- Editing scenes during a reskin - a reskin that needs scene edits proves a literal leaked somewhere; fix the leak, not the scene.
- Scene-local brand forks ("just this scene, darker") - the object is global by contract; forks fork the brand.
