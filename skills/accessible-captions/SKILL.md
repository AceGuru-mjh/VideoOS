---
name: accessible-captions
version: 0.1.0
description: Accessibility gates for captions: WCAG 4.5:1 contrast, 20 CPS reading speed, 42px@1080p floor, no sub-0.1s flashes, bracketed sound cues.
trigger: Captions must be accessible - contrast, reading speed, font size, or flash safety is questioned, deaf or hard-of-hearing viewers are in scope, or a11y / WCAG gates are requested.
---

# Accessible Captions

Goal: caption layers that pass five gates - contrast at least 4.5:1, reading speed at most 20 CPS, font floor 42px at 1080p, no sub-0.1s high-contrast flashes, and bracketed cues for key non-speech audio. Deliverables: the gate table (per cue: contrast ratio, CPS, size, pass/fail) and the repaired DSL. Muted autoplay is the default view - captions are not an accessory, they are the script.

## Workflow

1. Draft cues from the narration or script: one cue = one breath (at most 2 lines, at most 42 chars per line). If the user has an SRT/VTT, import through the MCP `subtitle.parse` tool and align with `subtitle.shift`.
2. Reading-speed gate: run the MCP `subtitle.info` tool on the cue text - it reports chars-per-second and warns above 20. Over the cap -> split the cue at a natural pause or extend its window with the script-timing budget; never shrink the font to "fit" it.
3. Contrast gate: for every caption color pair, run the MCP `color.contrast` tool (`foreground` vs `background`). Under 4.5:1 -> darken the text or add a scrim rect (opacity 0.55-0.7) behind cues and re-check against the scrim's blended color - footage varies per frame, so gate the worst case, not the average.
4. Place the cues: low-center but clear of platform UI (aspect-reframe safe zones - bottom 250px band in 9:16, 5% edges in 16:9) and at or above the font floor: 42px x (canvasHeight / 1080), so 75px on a 1920-tall vertical.
5. Flash audit: no layer visible for fewer than 3 frames (0.1s at 30fps); enter and exit animations on large high-contrast layers are at least 0.1s; no strobe alternation anywhere. Caption cues may hard-switch at cue boundaries (standard broadcast behavior) - the ban is on rapid luminance flipping.
6. Sound cues: add bracketed cues for key non-speech moments - [applause], [music fades], [keys clacking] - styled smaller and muted so speech stays dominant.
7. Write the caption layers (Recipes) -> `compile.run` -> `render.preview` one settled frame per cue -> `test.run` with the gates; repair loop of at most 3 via `scene.modify`. Full SRT alignment and burn-in is the subtitle-burn skill's job - this skill is the gate layer that runs first.

## Recipes

A compliant cue - scrim rect as contrast floor, floor-size text, window from the word budget:

```ts
v.scene("line-1", { duration: 2.8, background: "#0a0a12" }, (s) => {
  s.beat("cue", { at: 0.3, description: "Cue readable through its whole window" });
  s.rect("scrim", { width: 1500, height: 130, fill: "#000000", opacity: 0.6, radius: 8,
    at: { x: "50%", y: "84%" } });                  // contrast floor under any footage
  s.text("cue-1", "Every frame is asserted", { size: 48, weight: 600, color: "#f8fafc",
    at: { x: "50%", y: "84%" },
    enter: { effect: "fade", duration: 0.15, delay: 0.1 } });
});
```

Speech plus a bracketed sound cue - the [sfx] line is smaller and muted, timed into the gap after the spoken cue:

```ts
v.scene("line-2", { duration: 4.8 }, (s) => {
  s.beat("cue-2", { at: 1.0, description: "Speech cue window" });
  s.beat("sfx", { at: 3.6, description: "Non-speech moment gets its bracketed cue" });
  s.text("cue-2", "and it renders like this -", { size: 48, weight: 600, color: "#f8fafc",
    at: { x: "50%", y: "80%" }, in: 0.9, out: 3.4,
    enter: { effect: "fade", duration: 0.15 } });
  s.text("sfx-1", "[keys clacking]", { size: 34, color: "#a5b4fc",
    at: { x: "50%", y: "88%" }, in: 3.4, out: 4.6,
    enter: { effect: "fade", duration: 0.15 } });
});
```

## QA gates

- Contrast: every caption pair at least 4.5:1, measured with the `color.contrast` MCP tool - log the ratios in the gate table; scrim-backed cues re-checked against the blended scrim color.
- Reading speed: `subtitle.info` reports no "fast >20 cps" warning and no "long >84 chars" cue.
- Size floor: no caption under 42px at 1080p, scaled by canvasHeight/1080; `noTextOverflow()` plus `check.overflow`.
- Flash: no layer visible under 3 frames; no full-screen high-contrast flip inside 3 frames; enter/exit at least 0.1s on large high-contrast layers.
- Speaker identification: when a scene has multiple voices, prefix or color-code cues per speaker - who says what is content, not decoration.
- Windows: `toContainText` for every cue at a frame inside [in + 0.2, out]; no cue spans a scene cut.
- Deaf pass: every key non-speech moment carries a bracketed cue; watching muted in `render.preview`, the message survives - that is the meta-gate.
- Placement: cue blocks clear the 250px bottom band (9:16) and the 5% edges (16:9) - aspect-reframe safe zones.

## Anti-patterns

- Bare white text over unstabilized footage - contrast varies per frame; the scrim makes the WORST-case frame pass, which is the only frame that matters.
- Beating CPS by shrinking the font - reading speed is chars per second; smaller type slows scanning and fails the size floor too (two gates, one mistake).
- Cues spanning scene cuts - the caption claims the previous scene's words over the new one; split at the cut.
- Decorative entrances on captions (typewriter per cue) - the entrance eats the reading window and the CPS budget; captions fade, content dances.
- Skipping sound cues because "they will hear it" - feeds autoplay muted; [applause] often IS the punchline's timing.
- Strobe "energy" cuts - sub-0.1s high-contrast alternation is a photosensitive epilepsy trigger (WCAG 2.3.1), not a style choice.
