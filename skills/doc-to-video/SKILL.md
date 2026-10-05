---
name: doc-to-video
version: 0.1.0
description: Convert a markdown document into a 15-30s video walkthrough - outline to storyboard, capped list entrances, ranked table rows, and a source-linked tail frame.
trigger: The user has a README, spec, blog post, or any markdown/notes document and wants a short video walkthrough, summary, or "doc tour" of it.
---

# Doc To Video

Goal: a 15-30s walkthrough where the document's own structure is the storyboard: H1 becomes the title scene, H2s become section scenes, lists enter item by item (max 5 per scene), tables become ranked rows, and the tail frame cites the source. The document is the only content source - clipping is allowed, paraphrase into new claims is not.

## Workflow

1. Ingest: read the doc text, then run the mcp-markdown server's `md.outline` tool on it - it returns the heading skeleton (levels, verbatim text, line numbers, code-fence-aware). That outline IS the storyboard draft.
2. Map structure to scenes: H1 -> title scene (2-3s); each H2 -> one section scene (3-6s); bullet lists under an H2 -> staggered item entrances capped at 5 (density rule); code blocks -> a walk-through scene in monospace `typewriter` (linear). For docs with 4+ H2 sections, the first content scene is a TOC (numbered chapter list) - the viewer needs the map before the territory.
3. Density clipping: > 5 bullets in a section -> keep the 5 the reader needs (lead bullets win; trailing detail collapses into one "more in the doc" line). > 8 H2s -> group into 3-4 chapters. A 15-30s video holds 5-9 scenes total.
4. Extract tables with `md.tables` (headers + rows per table); a table becomes top-N rows ranked by the first numeric column, each row a label + value card row - never all rows on screen at once.
5. Write `src/video.ts` (Recipes): verbatim heading text for title and section scenes (trust the outline's own words), clipped bullets for items, `font: "monospace"` for code content.
6. `compile.run` -> 0 errors; then `check.overflow` (section headings at display size are the overflow case here).
7. `render.preview` one settled frame per scene; `test.run` with the gates below; repair loop <= 3; `render.final` - the last scene is always the source tail frame.

## Recipes

Title scene (H1 verbatim) plus the TOC line - from `md.outline` output:

```ts
// md.outline says: H1 "Flowcast API"; H2s: Quickstart, Auth, Limits, SDKs
v.scene("title", { duration: 2.5, background: "#0a0a12" }, (s) => {
  s.beat("doc-open", { at: 0.2, description: "H1 verbatim; chapter count promised" });
  s.ellipse("halo", { width: 900, height: 480, fill: "#6d28d9", opacity: 0.14, blur: 140,
    at: { x: "50%", y: "42%" } });
  s.text("doc-title", "Flowcast API", { size: 110, weight: 800, color: "#f8fafc",
    at: { x: "50%", y: "40%" }, enter: { effect: "blur-up", duration: 0.5, easing: "easeOutCubic" } });
  s.text("toc", "4 chapters - 25 seconds", { size: 40, color: "#94a3b8", letterSpacing: 2,
    at: { x: "50%", y: "56%" }, enter: { effect: "fade", duration: 0.5, delay: 0.5 } });
});
```

Section scene - H2 verbatim, capped list, 0.4s stagger, then the source tail:

```ts
v.scene("sec-quickstart", { duration: 5, background: "#0a0a12" }, (s) => {
  s.beat("h2-land", { at: 0.2, description: "H2 verbatim; <= 5 items, 0.4s stagger" });
  s.rect("rail", { width: 6, height: 420, fill: "#22d3ee", radius: 3,
    at: { x: "18%", y: "50%" } });                      // frame-0 ink
  s.text("h2", "Quickstart", { size: 72, weight: 800, color: "#f8fafc", align: "left",
    at: { x: "22%", y: "24%" }, enter: { effect: "slide-up", duration: 0.4, params: { distance: 50 } } });
  const ITEMS = ["npm i flowcast", "export FLOW_KEY", "render({ fps: 30 })"];
  for (const [i, item] of ITEMS.entries()) {
    s.text(`item-${i + 1}`, item, { size: 44, weight: 600, color: "#e2e8f0", font: "monospace",
      align: "left", at: { x: "22%", y: `${42 + i * 14}%` },
      enter: { effect: "slide-up", duration: 0.4, delay: 0.6 + i * 0.4, params: { distance: 45 } } });
  }
});
// last scene of every doc-to-video - the source citation (still final 0.8s):
v.scene("source", { duration: 2, background: "#0a0a12" }, (s) => {
  s.beat("cite", { at: 0.3, description: "Where to read the full doc" });
  s.text("label", "FULL DOCS", { size: 34, weight: 700, letterSpacing: 4, color: "#94a3b8",
    at: { x: "50%", y: "42%" }, enter: { effect: "fade", duration: 0.4 } });
  s.text("link", "github.com/acme/flowcast#readme", { size: 46, color: "#22d3ee",
    at: { x: "50%", y: "52%" }, enter: { effect: "fade", duration: 0.4, delay: 0.2 } });
});
```

## QA gates

- Structure fidelity: title scene text = H1 verbatim, every section heading = its H2 verbatim (`toContainText` per scene) - the `md.outline` output is the assertion source.
- Density cap: no scene carries more than 5 item layers (`toHaveLayers` counts them); a TOC scene exists when the doc has 4+ H2 sections.
- Timing: total `durationBetween(15, 30)`; section scenes 3-6s; the source tail frame is last, >= 2s with >= 0.8s still.
- Tables: if `md.tables` found tables, the on-screen rows come from that output, top-N <= 4, ranked (review the ranking choice in the delivery note).
- Readability: item entrances complete by 1.2s before scene end; `noTextOverflow()` plus `check.overflow`; `expect(frame(0)).not.toBeBlack()` (halo / rail ink).

## Anti-patterns

- One scene per paragraph - the H2 is the scene unit, not the paragraph; 20 scenes in 25s is a flipbook.
- Dumping full bullet lists - over 5 items per scene defeats staggered entrances (items overlap or rush); clip and link.
- Paraphrasing headings - the heading is the doc's own navigation; a "punchier" rewrite breaks the map between video and doc.
- Dropping the source tail - the walkthrough's job is to send readers to the doc; without the link it summarizes nothing.
- Rendering every table row - tables are ranked top-N; a 12-row table at 3s is illegible.
- Inventing chapter counts, stats, or claims - the doc is the only source (same rule as meeting-recap): placeholders over guesses.
