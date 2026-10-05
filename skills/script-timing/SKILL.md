---
name: script-timing
version: 0.1.0
description: Word-rate budgeting: price script copy into a scene/beat timing table (2-3 words/sec plus punctuation pauses) and trim overruns by fixed priority.
trigger: A script, voiceover, or caption copy must fit a fixed video length, a draft overruns its slot, or pacing feels rushed before any scene is written.
---

# Script Timing

Goal: a budget table that prices copy in seconds BEFORE scenes exist, a beat table derived from it, and - when the sum overruns - cuts made in a fixed priority order. The deliverable is the table plus the cut log; the DSL comes last. Budget beats words: no scene exists without a paid-for duration.

## Workflow

1. Split the copy into units (one future scene each): a sentence or a sentence pair. Count words per unit - numbers, versions, and URLs count as words.
2. Price every unit with the budget table below: duration = words / rate + punctuation pauses. Default rate 2.5 words/s; 3.0 for an energetic read (bumpers), 2.0 for a technical read (API names, dense nouns).
3. Sum the units; compare to the target length. Over budget -> trim by the priority order below, re-price after every pass, and stop the moment the sum fits - never trim into under-budget.
4. Derive the beat table: one beat per unit at the second its reading window starts (entrance completes first: enter duration + 0.1s delay is paid inside the budget, not on top of it). This table is the deliverable the user reviews.
5. Write `src/video.ts` with scene durations = unit budgets (rounded to 0.1s) and beats at the table's seconds. Copy is frozen here: any later word edit re-opens the budget.
6. `compile.run` -> 0 errors; then `render.preview { scene, beat }` on every beat - every word must be readable when its beat fires. If the eye lags the beat, the beat table lied: re-price the unit, do not nudge the beat.
7. `test.run` with the gates below; repair loop of at most 3 via `scene.modify`. If narration or captions exist, run the MCP `subtitle.info` tool on the cue text too (it warns above 20 cps). Deliver the MP4 plus the budget table and cut log.

Budget table:

| Item | Cost |
| --- | --- |
| Word | 0.40s (2.5 words/s default) |
| Comma or colon | +0.3s |
| Period or question mark | +0.5s |
| Paragraph / scene break | +0.8s |
| Entrance animation | enter duration + 0.1s |

Worked example: "Ship faster, with confidence. Every frame, tested." = 7 words (2.8s) + 2 commas (0.6s) + 2 periods (1.0s) = 4.4s -> one 4.4s scene, two beats.

Trim priority (run in order; stop as soon as the sum fits):
1. Drop modifiers - "really", "very", "just", most adverbs. Meaning survives, rhythm improves.
2. Merge sentences - two short sentences sharing a subject become one with a comma; saves a period plus words.
3. Drop an example or proof unit whole - never a half example; a truncated example is worse than none.

## Recipes

A budget-proven scene - 4.4s priced from the worked example, beats at the table's seconds, entrance paid inside the budget:

```ts
v.scene("value", { duration: 4.4, background: "#0a0a12" }, (s) => {
  s.beat("claim", { at: 0.5, description: "Ship faster, with confidence - readable here" });
  s.beat("proof", { at: 2.5, description: "Every frame, tested - readable here" });
  s.rect("ink", { width: 820, height: 320, fill: "#6d28d9", opacity: 0.18, blur: 120,
    at: { x: "50%", y: "44%" } });
  s.text("claim", "Ship faster,\nwith confidence.", { size: 72, weight: 700, color: "#f8fafc",
    lineHeight: 1.2, at: { x: "50%", y: "40%" },
    enter: { effect: "blur-up", duration: 0.4, delay: 0.1, easing: "easeOutCubic" } });
  s.text("proof", "Every frame, tested.", { size: 52, color: "#7dd3fc",
    at: { x: "50%", y: "58%" }, enter: { effect: "fade", duration: 0.4, delay: 2.0 } });
});
```

Gate sample - the densest unit rendered at its own budget to prove readability (drop the scene after the check, or keep it as a CTA under the end-card skill's rules). Energetic rate 3.0 applies:

```ts
v.scene("dense-check", { duration: 3.5 }, (s) => {
  s.beat("read", { at: 0.4, description: "6 words at 3.0 wps + 3 periods = 3.5s budget" });
  s.text("dense", "Faster builds.\nFewer regressions.\nZero drama.", { size: 64,
    weight: 700, color: "#e2e8f0", lineHeight: 1.3, at: { x: "50%", y: "46%" },
    enter: { effect: "slide-up", duration: 0.3, delay: 0.1, params: { distance: 60 } } });
});
```

## QA gates

- Budget parity: every scene `durationBetween` equals its unit budget within 0.1s - computed from the table, asserted per scene.
- `toContainText` for every unit's text at a frame at or after (beat time + a small margin) - readability is proven, not assumed.
- `noTextOverflow()` plus `check.overflow` on every scene; `expect(frame(0)).not.toBeBlack()` wherever a scene carries an ink rect.
- `toHaveBeat` for every unit's beat - a dropped beat means a dropped budget row.
- Reading speed: `subtitle.info` (MCP) on the cue export reports no "fast >20 cps" warning.
- Fit check: sum of scene durations lands within 0.5s of the target - under-budget padding (slow fades, held empties) is as much a failure as overruns.

## Anti-patterns

- Shrinking scene durations to force a fit - the budget prices the copy; when it does not fit, the copy changes (trim priority), not the read speed.
- Padding to fill the slot - every second must be paid for by a unit; "breathing room" b-roll is a broadcast-era habit that reads as dead air on feeds.
- Pricing by feel - "that reads in about 3s" is wrong roughly half the time; the table exists because eyeball estimates systematically undershoot.
- Beats at entrance start - a beat marks the moment content is readable, not the moment the animation begins; fire it after the enter completes.
- Ignoring pauses - six commas cost 1.8s; a comma-heavy list is longer than it looks, and the overrun lands exactly on the CTA.
- Trimming examples first because they feel expendable - modifiers go first; examples often carry the only proof, and proof is the last thing to cut.
