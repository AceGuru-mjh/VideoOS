---
name: comparison
version: 0.1.0
description: Versus video (10-15s): split-screen columns, round-by-round PK with winner dots and a ticking score strip, closing on a "why X wins" verdict.
trigger: The user asks for a head-to-head / versus / "X vs Y" / product PK comparison video that names a winner round by round.
---

# Comparison

Goal: a 10-15s (1920x1080, 30fps) head-to-head: a split screen established in the first second, 3 rounds of item PK (claims slide in, the winner's green dot lands, then a 1.2s reading freeze), a score strip that ticks each round, and a verdict frame with three one-line reasons. Claims are user-sourced - and concede the round you would actually lose: a 3:0 sweep reads as an ad, not a comparison.

## Workflow

1. Collect: names for X and Y, 3 rounds (topic + each side's claim <= 26 chars), the honest winner per round, and 3 verdict reasons. A 4th round gets cut unless the user insists - the budget does not fit it.
2. `storyboard.plan { intent: "versus · <X> vs <Y>", durationSeconds }` -> remap to versus -> round-1..3 -> verdict; nothing else survives.
3. Write `src/video.ts` (Recipes). Geometry is fixed once and reused in every scene: our board x 27%, theirs 73%, both 840px wide - drifting columns are this genre's #1 bug.
4. `compile.run` -> 0 errors -> `check.overflow` (claims are the overflow-est lines; 26 chars at size 40 is the budget that keeps them safe).
5. `render.preview` one freeze frame per round (dot on the winning column - QA has no position matcher in v1, so this check is manual; both claims readable at arm's length), then QA gates (below) -> `test.run` -> repair loop <= 3 (`layer.modify` for drift; `transaction.rollback` if batched) -> `render.final` with the final score and the conceded round.

Round beat sheet (scene-local seconds; the tail is a reading freeze, not dead air):

| Beat | at | What |
| --- | --- | --- |
| topic | 0.15 | round tag fades in top center ("ROUND 1 · SETUP") |
| claim-us | 0.3 | our claim slides up |
| claim-them | 0.6 | their claim slides up |
| dot-land | 1.1 | winner's green dot + check pops; loser gets a dim gray dot |
| score-tick | 1.3 | score strip scale-pops the new tally |
| freeze | 1.65-2.85 | nothing new enters - the read window |

## Recipes

Versus - the hook: boards slide in, both names readable by 1s, VS chip pops center; the glow gives frame-0 ink:

```ts
v.scene("versus", { duration: 2.6, background: "#0a0a12" }, (s) => {
  s.beat("boards-in", { at: 0, description: "Both names readable by 1s" });
  s.ellipse("glow", { width: 700, height: 420, fill: "#f59e0b", opacity: 0.12, blur: 140,
    at: { x: "50%", y: "42%" } });
  s.rect("board-us", { width: 840, height: 760, fill: "#0d1a14", radius: 20,
    at: { x: "27%", y: "52%" }, enter: { effect: "slide-right", duration: 0.5, easing: "easeOutCubic", params: { distance: 120 } } });
  s.rect("board-them", { width: 840, height: 760, fill: "#16161f", radius: 20,
    at: { x: "73%", y: "52%" }, enter: { effect: "slide-left", duration: 0.5, easing: "easeOutCubic", params: { distance: 120 } } });
  s.text("name-us", "VideoOS", { size: 84, weight: 800, color: "#f8fafc",
    at: { x: "27%", y: "24%" }, enter: { effect: "blur-up", duration: 0.5, delay: 0.3 } });
  s.text("name-them", "LegacyTool", { size: 84, weight: 800, color: "#94a3b8",
    at: { x: "73%", y: "24%" }, enter: { effect: "blur-up", duration: 0.5, delay: 0.45 } });
  s.text("vs", "VS", { size: 46, weight: 800, letterSpacing: 2, color: "#f59e0b",
    at: { x: "52%", y: "42%" }, enter: { effect: "scale-pop", duration: 0.4, delay: 0.9, easing: "easeOutBack" } });
});
```

Round - data-driven; duplicate per round bumping `r` and the score string (this is round-1, us winning):

```ts
const ROUNDS = [
  { topic: "SETUP", us: "3 min, one command", them: "Half a day of YAML", winner: "us" },
  { topic: "SPEED", us: "Seek in 1.9s", them: "Full re-render", winner: "us" },
  { topic: "PRICE", us: "From $20/mo", them: "Free tier", winner: "them" },   // conceded honestly
];
const r = ROUNDS[0]!;
v.scene("round-1", { duration: 2.85, background: "#0a0a12" }, (s) => {
  s.beat("topic", { at: 0.15, description: "Round topic lands" });
  s.rect("board-us", { width: 840, height: 760, fill: "#0d1a14", radius: 20, at: { x: "27%", y: "52%" } });
  s.rect("board-them", { width: 840, height: 760, fill: "#16161f", radius: 20, at: { x: "73%", y: "52%" } });
  s.text("topic", `ROUND 1 · ${r.topic}`, { size: 30, weight: 700, letterSpacing: 4, color: "#94a3b8",
    at: { x: "50%", y: "12%" }, enter: { effect: "fade", duration: 0.3, delay: 0.15 } });
  s.text("claim-us", r.us, { size: 40, weight: 600, color: "#e2e8f0",
    at: { x: "27%", y: "42%" }, enter: { effect: "slide-up", duration: 0.45, delay: 0.3, easing: "easeOutCubic", params: { distance: 60 } } });
  s.text("claim-them", r.them, { size: 40, weight: 600, color: "#94a3b8",
    at: { x: "73%", y: "42%" }, enter: { effect: "slide-up", duration: 0.45, delay: 0.6, easing: "easeOutCubic", params: { distance: 60 } } });
  const winUs = r.winner === "us";
  s.ellipse("dot-win", { width: 44, height: 44, fill: "#22c55e",
    at: { x: winUs ? "27%" : "73%", y: "60%" },
    enter: { effect: "scale-pop", duration: 0.4, delay: 1.1, easing: "easeOutBack" } });
  s.text("check", "✓", { size: 34, weight: 800, color: "#0a0a12",
    at: { x: winUs ? "27%" : "73%", y: "60%" }, enter: { effect: "fade", duration: 0.2, delay: 1.35 } });
  s.ellipse("dot-lose", { width: 26, height: 26, fill: "#475569", opacity: 0.7,
    at: { x: winUs ? "73%" : "27%", y: "60%" }, enter: { effect: "fade", duration: 0.3, delay: 1.25 } });
  s.text("score", "1 : 0", { size: 36, weight: 800, font: "monospace", color: "#f59e0b",
    at: { x: "88%", y: "12%" }, enter: { effect: "scale-pop", duration: 0.35, delay: 1.3, easing: "easeOutBack" } });
});
```

Verdict - why X wins, three reasons staggered 0.4s, final score, then stillness >= 0.8s:

```ts
v.scene("verdict", { duration: 3.4, background: "#0a0a12" }, (s) => {
  s.beat("verdict", { at: 0.2 });
  s.text("headline", "Why VideoOS wins", { size: 84, weight: 800, color: "#f8fafc",
    at: { x: "50%", y: "28%" }, enter: { effect: "blur-up", duration: 0.6, delay: 0.2 } });
  s.text("final-score", "2 : 1", { size: 44, weight: 800, font: "monospace", color: "#f59e0b",
    at: { x: "50%", y: "44%" }, enter: { effect: "scale-pop", duration: 0.4, delay: 0.8, easing: "easeOutBack" } });
  const REASONS = ["Setup in minutes, not days", "Preview speed you can feel", "Open roadmap, honest pricing"];
  REASONS.forEach((reason, i) => {
    s.text(`reason-${i + 1}`, reason, { size: 42, weight: 600, color: "#e2e8f0",
      at: { x: "50%", y: `${58 + i * 11}%` },
      enter: { effect: "slide-up", duration: 0.45, delay: 1.2 + i * 0.4, easing: "easeOutCubic", params: { distance: 50 } } });
  });
});
```

Join scenes with `v.transition("crossfade", { duration: 0.35, between: ["versus", "round-1"] })` etc. - `cut` between rounds also works when the user wants a harder, boxing-bell pace. Budget: 2.6 + 3 x 2.85 + 3.4 - 0.35 x 4 = 13.15s.

## QA gates

- `expect(frame(0)).not.toBeBlack()` (versus glow) and `expect(frame(30)).toContainText("VideoOS")` + the competitor name - the 1s hook.
- Every round at its freeze frame (scene start + 1.7s on the crossfade-overlap timeline): `toContainText` for the topic, both claims, and the score string ("1 : 0", "2 : 0", "2 : 1").
- `expect(scene(r)).toHaveLayers("board-us", "board-them", "dot-win", "score")` in EVERY scene - the split is the format; losing a board is a layout regression.
- `noTextOverflow()` on every scene; claims <= 26 chars at size 40 is the budget that keeps it true.
- `durationBetween`: versus <= 3, rounds 2.4-3, verdict 2.8-3.5, total 10-15; nothing enters during a round's final 1.2s.

## Anti-patterns

- Sweeping 3:0 - credibility is this genre's currency; concede the round you would lose (price, a niche feature) or make an honest ad instead of a fake comparison.
- Claim lines longer than 26 chars - they wrap or overflow the 840px boards; supporting detail belongs in the verdict reasons.
- Boards that drift between scenes - same x (27% / 73%), same size, every scene; crossfading misaligned boards reads as a glitch (assert `toHaveLayers` and preview).
- Invented benchmark numbers - the same no-fabrication rule as product-demo; user-sourced claims only, source named in the delivery note.
- New elements entering during the 1.2s freeze - the freeze is the reading window; a late pop steals it and the score tick stops reading as a tally.
- Both sides getting a green dot to "be fair" - the format needs a winner per round; ties belong in the verdict copy, not in duplicated dots.
