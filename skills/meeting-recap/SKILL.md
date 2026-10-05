---
name: meeting-recap
version: 0.1.0
description: Turn meeting minutes into a 10-15s recap video - one info class per scene: decision cards, an action checklist (owner + due + verb), and a dates bar.
trigger: The user pastes meeting notes or minutes and wants a short recap video of what was decided, who owns what, and when things are due.
---

# Meeting Recap

Goal: a 10-15s recap (16:9 default) where each scene carries exactly ONE class of information from the minutes: decisions, actions, or dates. Every action row ships as verb + [OWNER] + [DUE]. Nothing is invented: fields the minutes do not record appear as explicit placeholders, never as guesses (same honesty rule as news-brief and meeting sources).

## Workflow

1. Bucket the minutes into three classes: decisions (what was agreed), actions (who does what by when), dates (calendar milestones). Unrecorded fields become placeholders - [OWNER], [DUE TBD] - never invented names or dates.
2. Order scenes by what the viewer needs first: decisions -> actions -> dates. Caps: 3 decisions, 4 actions, 4 dates on screen. Minutes that exceed the caps take the top N by importance, and the tail frame says "full minutes: <link>".
3. Map to scenes: decision card scene (Recipe 1), action checklist scene (Recipe 2), dates bar scene (a horizontal strip: milestone name + date left to right). One class per scene - a decision never lives inside the action list.
4. Write `src/video.ts`; action rows use the strict format "verb the thing [OWNER] [DUE]" - the verb first, the attribution always present.
5. `compile.run` -> 0 errors; then `check.overflow` - action rows are the longest strings in this genre.
6. `render.preview` each scene at its settled frame (all rows in); then `test.run` with the gates below; repair loop <= 3 via `scene.modify`; `render.final`.

## Recipes

Decision cards - decisions only, nothing actionable in this scene:

```ts
const DECISIONS = [
  { n: "01", text: "Ship the beta on the 14th" },
  { n: "02", text: "API v2 stays JSON-only" },
];
v.scene("decisions", { duration: 4.5, background: "#0a0a12" }, (s) => {
  s.beat("decided", { at: 0.2, description: "Decisions only - no actions in this scene" });
  s.rect("rail", { width: 8, height: 300, fill: "#22d3ee", radius: 4,
    at: { x: "26%", y: "50%" } });                      // frame-0 ink
  s.text("heading", "WHAT WE DECIDED", { size: 44, weight: 700, letterSpacing: 4,
    color: "#94a3b8", at: { x: "50%", y: "24%" }, enter: { effect: "fade", duration: 0.4 } });
  for (const [i, d] of DECISIONS.entries()) {
    s.text(`d${i + 1}-n`, d.n, { size: 60, weight: 800, color: "#22d3ee",
      at: { x: "32%", y: `${44 + i * 18}%` },
      enter: { effect: "scale-pop", duration: 0.35, delay: 0.4 + i * 0.6, easing: "easeOutCubic" } });
    s.text(`d${i + 1}`, d.text, { size: 52, weight: 600, color: "#e2e8f0", align: "left",
      at: { x: "38%", y: `${44 + i * 18}%` },
      enter: { effect: "slide-up", duration: 0.4, delay: 0.5 + i * 0.6, params: { distance: 50 } } });
  }
});
```

Action checklist - every row: verb, owner, due:

```ts
const ACTIONS = [
  { verb: "Write the migration guide", owner: "[OWNER]", due: "[DUE 05-21]" },
  { verb: "Cut the beta trailer", owner: "Mara", due: "[DUE 05-12]" },
  { verb: "Book the launch room", owner: "Jonas", due: "[DUE TBD]" },
];
v.scene("actions", { duration: 5.5, background: "#0a0a12" }, (s) => {
  s.beat("who-what-when", { at: 0.2, description: "Every row: verb + owner + due" });
  s.text("heading", "WHO OWNS WHAT", { size: 44, weight: 700, letterSpacing: 4,
    color: "#94a3b8", at: { x: "50%", y: "20%" }, enter: { effect: "fade", duration: 0.4 } });
  for (const [i, a] of ACTIONS.entries()) {
    const y = `${36 + i * 16}%`;
    s.rect(`row-${i + 1}`, { width: 1240, height: 96, fill: "#141422", radius: 12,
      at: { x: "50%", y } });                           // card lands with the row
    s.text(`a${i + 1}-verb`, a.verb, { size: 42, weight: 600, color: "#f8fafc", align: "left",
      at: { x: "22%", y }, enter: { effect: "slide-up", duration: 0.35, delay: 0.3 + i * 0.5,
        params: { distance: 40 } } });
    s.text(`a${i + 1}-meta`, `${a.owner}  ${a.due}`, { size: 32, color: "#22d3ee", align: "left",
      at: { x: "70%", y }, enter: { effect: "fade", duration: 0.35, delay: 0.45 + i * 0.5 } });
  }
});
```

Dates bar (third class): a horizontal strip scene - milestone names above, dates below, evenly spaced, `slide-up` 0.4s staggered 0.4s apart; the tail frame (last 2s, still) carries "full minutes: <link>" when anything was clipped.

## QA gates

- Class purity: each scene's layers belong to one class - `toHaveLayers("d1", "d1-n", "d2", "d2-n")`, `toHaveLayers("row-1", "row-2", "row-3", ...)`; verify no cross-class layers via `scene.inspect`.
- Action format: at settle frames, every action row asserts its verb AND its meta - `expect(frame(N)).toContainText("[DUE 05-21]")` or the real recorded value; a row missing any of the three parts fails.
- Placeholder honesty: [OWNER] / [DUE TBD] placeholders allowed and asserted as-is; a fabricated name or date is a hard fail - the minutes are the only source.
- Caps: <= 3 decision cards, <= 4 action rows, <= 4 dates on screen; overflow is linked, never crammed.
- Total `durationBetween(10, 15)`; scenes 3-6s; final 0.8s still; `expect(frame(0)).not.toBeBlack()` (rail / heading ink).
- `noTextOverflow()` plus `check.overflow` on the action rows (longest strings).

## Anti-patterns

- Mixing classes (an action row inside the decisions scene) - the viewer answers one question per scene ("what was agreed?"); mixing halves both answers.
- Inventing owners or dates to fill the format - a made-up owner is worse than [OWNER]: the placeholder invites the follow-up, the guess buries it.
- Reciting the minutes - the recap is the residue (decisions, actions, dates); discussion that decided nothing gets cut.
- More than 4 action rows - rows under ~1s each cannot be read (script-timing word budgets); take the top 4 and link the rest.
- Skipping the dates scene when dates exist - dates drive the next meeting; if none were recorded, one line saying so is the honest move.
- Verbs without owners ("finalize the spec") - an unattributed action is a wish; the owner field is the difference between a recap and a poem.
