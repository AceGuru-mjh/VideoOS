---
name: subtitle-burn
version: 0.1.0
description: Burn SRT/VTT captions into a video as timed text layers with plates: cue-to-layer mapping, bottom-safe styling, CPS-first fixing via MCP tools.
trigger: The user has an SRT or VTT subtitle file plus a video project and wants the captions burned into the frames - aligned, styled, readable.
---

# Subtitle Burn

Goal: captions that are part of the picture: every cue becomes an `s.text` layer (`subtitle-0001`, ...) timed by `in`/`out` on a semi-transparent plate at the bottom-safe line. Fix readability (CPS) before styling - the MCP subtitle server (`subtitle.parse` / `subtitle.info` / `subtitle.shift` / `subtitle.stringify`) does the timeline math; the DSL does the pixels. Demo scale: ~10s, 3-4 cues.

Cue-to-layer mapping (the whole contract):

| SRT cue | Layer | `in` (s) | `out` (s) | Content |
| --- | --- | --- | --- | --- |
| 1 (00:00:00,400 -> 00:00:02,800) | `subtitle-0001` + `subtitle-0001-plate` | 0.40 | 2.80 | cue text, unchanged |
| 2 (00:00:03,000 -> 00:00:05,900) | `subtitle-0002` + plate | 3.00 | 5.90 | ... |
| N | `subtitle-` + 4-digit index + plate | startMs/1000 | endMs/1000 | ... |

Rules: NO enter effects - subtitles cut like broadcast captions (a 0.4s slide on a 2s cue burns 20% of the reading time); plate and text share identical `in`/`out`; text is never rewritten after step 2 below.

Style spec (16:9, 1920x1080):

| Property | Value |
| --- | --- |
| Position | plate + text center at y 92% (bottom 4% survives player overscan) |
| Size | 46 default; 42 when the line exceeds 44 chars |
| Color | `#ffffff` on plate `#000000` at opacity 0.55 |
| Plate | height = size x 1.9, width = chars x 0.52 x size + 64, radius 8 |
| 9:16 variant | plate center at y 78% - the bottom 20% is platform UI (short-video safe band) |

## Workflow

1. Read the file's text, then `subtitle.parse { text }` -> cues + count, and `subtitle.info { text }` -> avgCps, maxCps, warnings. Any warning blocks styling until fixed.
2. Fix fast cues (CPS > 20) by rewriting the TEXT first: split compound sentences, drop filler. Still fast -> extend the cue end into the gap before the next cue (keep >= 0.12s gap). Long cues (> 84 chars) split into two. Re-emit with `subtitle.stringify { cues, format }` and re-run `subtitle.info` until warnings is empty.
3. If the base video changed (intro added, head trimmed): `subtitle.shift { text, offsetMs }` (negative values clamp to 0), then re-parse for layer times. Never `subtitle.scale` for a per-cue problem - it stretches the whole timeline.
4. Write the project: cues become layers per the mapping table (Recipes). `in`/`out` carry the timing; the scene carries the content.
5. `compile.run` -> 0 errors -> `check.overflow` (a 48-char cue at size 46 is the overflow-est string in any project).
6. `render.preview` at each cue's midpoint - the plate must wrap its text with visible padding on both sides and no edge clipping.
7. QA gates (below) -> `test.run` -> `render.final`; deliver the MP4 and the fixed subtitle file side by side.

## Recipes

Demo project (10s, three clean cues over a plain scene) - the full burn pattern:

```ts
// times come from subtitle.parse, after subtitle.shift (offsetMs 400) and a clean subtitle.info pass
v.scene("demo", { duration: 10, background: "#0a0a12" }, (s) => {
  s.beat("title", { at: 0.2, description: "Context title (not a subtitle)" });
  s.text("title", "Agent Kit · burn demo", { size: 64, weight: 700, color: "#e2e8f0",
    at: { x: "50%", y: "24%" }, enter: { effect: "blur-up", duration: 0.6 } });

  const CUES = [                                  // hoist to module scope so QA reuses the numbers
    { in: 0.4, out: 2.8, text: "Every frame here is code." },          // 25 chars / 2.4s = 10 cps
    { in: 3.0, out: 5.9, text: "Subtitles are just timed layers." },   // 32 / 2.9 = 11 cps
    { in: 6.1, out: 9.5, text: "No animation - they cut, like broadcast captions." },  // 49 / 3.4 = 14 cps
  ];
  CUES.forEach((c, i) => {
    const id = String(i + 1).padStart(4, "0");
    const size = c.text.length > 44 ? 42 : 46;    // the 44-char threshold from the spec table
    const plateW = Math.round(c.text.length * 0.52 * size) + 64;
    s.rect(`subtitle-${id}-plate`, { width: plateW, height: Math.round(size * 1.9),
      fill: "#000000", opacity: 0.55, radius: 8, at: { x: "50%", y: "92%" }, in: c.in, out: c.out });
    s.text(`subtitle-${id}`, c.text, { size, weight: 500, color: "#ffffff",
      at: { x: "50%", y: "92%" }, in: c.in, out: c.out });
  });
});
```

Wrapped-cue variant - a line that still runs wide after CPS fixing wraps with `\n`; the plate grows with the line count and the center lifts so it stays inside 1080:

```ts
const wrapped = 2;                                 // line count after wrapping
s.rect("subtitle-0007-plate", { width: 980, height: Math.round(46 * 1.9 * wrapped),
  fill: "#000000", opacity: 0.55, radius: 8, at: { x: "50%", y: "90%" }, in: 12.2, out: 15.1 });
s.text("subtitle-0007", "Measure the exact pixel width with font.measure\nbefore you shrink the type.", {
  size: 46, lineHeight: 1.35, color: "#ffffff", at: { x: "50%", y: "90%" }, in: 12.2, out: 15.1 });
```

When a cue flirts with the width limit, ask the font MCP (`font.measure`, `font.best`) for the exact pixel width instead of shrinking type on a guess.

## QA gates

```ts
const mid = (i: number) => Math.round(((CUES[i]!.in + CUES[i]!.out) / 2) * 30);  // midpoint frames
expect(frame(mid(0))).toContainText("Every frame here is code.");
expect(frame(mid(1))).toContainText("Subtitles are just timed layers.");
expect(frame(mid(1))).not.toContainText("Every frame here is code.");  // cue 1 cut, not stacked
expect(frame(280)).toContainText("broadcast captions");                // 9.33s: last cue still on (out 9.5s)
expect(scene("demo")).toHaveLayers("subtitle-0001", "subtitle-0002", "subtitle-0003", "subtitle-0003-plate");
expect(scene("demo")).noTextOverflow();
```

- Timing fidelity: each layer's `out - in` equals its cue duration +/- 0.02s (verify with `layer.inspect` after `compile.run`).
- Reading window: every cue >= 1.2s on screen (below that, even 15 cps text cannot be read).
- No cue overlaps its neighbor: `out + 0.12 <= next.in` - the 0.12s gap rule from step 2.

## Anti-patterns

- Styling before CPS fixing - a pretty unreadable cue is still unreadable; `subtitle.info` first, always.
- Enter animations on cues - the cut IS the subtitle idiom; if the user insists on softness, one fade of 0.12s max, and it comes out of reading time.
- One full-width plate for all cues - each plate hugs its own cue (same `in`/`out`); a constant wide bar occludes the picture between words.
- Plates at y > 94% - the bottom rows get cropped by TV overscan and some players; a 92% center keeps a size-46 plate fully inside 1080.
- Forgetting the 9:16 variant - at 1920 tall, y 92% lands inside the platform caption zone (bottom 20%); move the plate to 78% per short-video's safe band.
- `subtitle.scale` to fix one late cue - it re-times every cue and desyncs the rest; per-cue edits re-emitted with `subtitle.stringify` keep sync.
