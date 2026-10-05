---
name: aspect-reframe
version: 0.1.0
description: Re-anchor a 16:9 video to 9:16 (or back): y% remap table, safe-zone gates, 0.82x font compensation, and move-vs-relayout rules per composition type.
trigger: An existing 16:9 video must ship as 9:16 vertical (or the reverse), or a cut must survive TikTok / Reels / Shorts platform UI zones.
---

# Aspect Reframe

Goal: the same video, honestly rebuilt at the other aspect ratio - not "just swap width and height". Deliverables: the re-anchor table (every layer, old anchor -> new anchor, decision) and the safe-zone gate results. Vertical is a different medium: half the width, platform UI eating both ends, faster pacing.

## Workflow

1. Inventory the source: `scene.list`, then `layer.inspect` per scene - record every layer's `at` anchor, size, and type into the re-anchor table (deliverable 1). Rows are layers, not scenes.
2. Classify every scene with the move-vs-relayout rules below - splits and pans are re-layouts, and re-anchors alone will not save them.
3. Apply: new `defineVideo` at 1080x1920 (one project per aspect ratio - never mix in one meta), remap y% per the table, sizes per the compensation rule, re-wrap and split long lines into stacked layers.
4. `compile.run` -> 0 errors; then `check.overflow` - vertical doubles overflow risk (half the horizontal room for the same words).
5. `render.preview` every beat of BOTH variants; run the safe-zone gate on each settled frame. Deliverable 2 is the gate table: per layer, pass / clamped / re-laid-out.
6. `test.run` with the gates below; repair loop of at most 3 via `scene.modify`. Content parity is the contract: anything readable in 16:9 must exist in 9:16.
7. Deliver both MP4s plus the two tables. Captions get the extra accessible-captions gates; pacing follows the short-video skill (a beat every 1.0-1.8s).

Re-anchor table (16:9 y% -> 9:16 y%, 1920x1080 -> 1080x1920):

| Element | 16:9 y% | 9:16 y% | Why |
| --- | --- | --- | --- |
| Headline / hero | 45% | 38% | optical center rises in 9:16; clears the 220px top band |
| Kicker / subline | 58% | 50% | pairs tighten under the hero |
| Stack / list rows | 34-72%, pitch 14% | 30-74%, pitch 12% | stack stays central, rows compress |
| Caption / subtitle | 85% | 90% | lower-third habit - GATED, see checklist |
| CTA verb / URL | 44% / 58% | 40% / 52% | end-card layout compresses upward |

Font compensation: display text (over 100px in 16:9) x 0.82 - a 170px hero becomes 139px; readable body and support text do NOT shrink - raise them to the vertical minimum 56px+ and re-wrap (maxWidth 1600 -> 880, at most 18 chars per line at 96px).

Move vs re-layout: centered symmetric (one dominant, centered stack) -> MOVE (re-anchor only). Left/right split (heading beside list, two columns) -> RE-LAYOUT (stack heading above list - 1080px cannot hold columns). Full-width rules and bars -> RE-WIDTH (1920px rect becomes 1080px). Lateral camera pans -> RE-DIRECT (swap `pan` for `push-in`; a narrow frame pans into nothing).

Safe-zone checklist (9:16 1080x1920): top 220px (y < 11.5%) is username / follow UI; bottom 250px (y > 86.9%) is caption / description / engagement rail - no text block may enter either band. The caption row's 90% anchor is a starting habit, not a pass: a 64px one-liner centered at 90% puts its block bottom at ~1760px, inside the band - the gate wins, so raise the anchor until the whole block clears 1670px (about 85% for one-liners, 83% for two-line blocks). Horizontal: centers stay within x 12-88%. In 16:9: 5% margin on all four sides (progress bar bottom-right, corner marks).

## Recipes

16:9 source scene (the input being reframed):

```ts
v.scene("hero", { duration: 3, background: "#05070d" }, (s) => {
  s.beat("land", { at: 0, description: "Wordmark readable by 1s" });
  s.rect("glow", { width: 760, height: 420, fill: "#22d3ee", opacity: 0.16, blur: 130,
    at: { x: "50%", y: "45%" } });
  s.text("wordmark", "VideoOS", { size: 170, weight: 800, letterSpacing: 6, color: "#f8fafc",
    at: { x: "50%", y: "45%" }, enter: { effect: "blur-up", duration: 0.7 } });
  s.text("kicker", "the agent-native video IDE", { size: 44, color: "#7dd3fc",
    at: { x: "50%", y: "58%" }, enter: { effect: "fade", duration: 0.5, delay: 0.6 } });
});
```

9:16 MOVE result (same scene: y 45 -> 38 and 58 -> 50; display text 170 -> 139; support text raised to 56 and split into two lines):

```ts
v.scene("hero", { duration: 3, background: "#05070d" }, (s) => {
  s.beat("land", { at: 0, description: "Same beat, re-anchored" });
  s.rect("glow", { width: 520, height: 620, fill: "#22d3ee", opacity: 0.16, blur: 130,
    at: { x: "50%", y: "38%" } });
  s.text("wordmark", "VideoOS", { size: 139, weight: 800, letterSpacing: 5, color: "#f8fafc",
    at: { x: "50%", y: "38%" }, enter: { effect: "blur-up", duration: 0.7 } });
  s.text("kicker", "the agent-native\nvideo IDE", { size: 56, color: "#7dd3fc", lineHeight: 1.3,
    at: { x: "50%", y: "50%" }, enter: { effect: "fade", duration: 0.5, delay: 0.6 } });
});
```

9:16 RE-LAYOUT result (the 16:9 two-column "heading left, list right" became a centered stack - rows 12% apart):

```ts
v.scene("split-to-stack", { duration: 4, background: "#0a0a12" }, (s) => {
  s.beat("stacked", { at: 0.3, description: "Heading above list, rows at 12% pitch" });
  s.text("heading", "BUILT FOR AGENTS", { size: 72, weight: 800, letterSpacing: 4, color: "#f8fafc",
    at: { x: "50%", y: "30%" }, enter: { effect: "blur-in", duration: 0.5 } });
  const rows = ["scenes as code", "gates on every frame", "one timeline, all cuts"];
  for (const [i, row] of rows.entries()) {
    s.text(`row-${i + 1}`, row, { size: 56, weight: 600, color: "#e2e8f0",
      at: { x: "50%", y: `${44 + i * 12}%` },
      enter: { effect: "slide-up", duration: 0.45, delay: 0.2 + i * 0.3, params: { distance: 70 } } });
  }
});
```

## QA gates

- Safe zone: every text layer center inside y 13-85% and x 12-88% (9:16), and block edges clear of the 220px / 250px bands - `noTextOverflow` uses full canvas width, so the bands are a manual `render.preview` gate (v1 has no safe-area assertion).
- Compensation: display text x 0.82 applied; nothing readable below 56px in 9:16.
- Content parity: `toContainText` for every 16:9 readable string in the 9:16 render at matched beats - a re-layout that drops a line is data loss, not a remix.
- `noTextOverflow()` plus `check.overflow` on every vertical scene; no rect wider than 1080 in the vertical project.
- `expect(frame(0)).not.toBeBlack()` in both variants; `toHaveLayers` parity for named structure in re-laid-out scenes.
- `diff.frames` between the two variants at matched beats - hierarchy must match (one dominant element per scene in both).

## Anti-patterns

- Swapping width/height in `defineVideo` and shipping - percentage anchors survive the swap, but pixel sizes, bar widths, and letter spacing do not; the result overflows or strands tiny type.
- Uniform x 0.5625 shrink (the width ratio) - preserves geometry, destroys arm's-length readability; compensate per the two-branch rule instead.
- Squeezing two columns to fit 1080px - 500px-wide columns put nothing readable on a phone; splits re-layout into stacks.
- Keeping lateral camera pans - a narrow frame pans into nothing; swap to `push-in` so the movement survives even though the composition cannot.
- Anchoring captions at 90% and skipping the 250px check - tall blocks land inside the platform caption UI; the gate overrides the table every time.
- Copying 16:9 pacing - vertical churns faster (short-video: a beat every 1.0-1.8s); re-time the edit, do not just re-place it.
