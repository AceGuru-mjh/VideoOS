---
name: ab-variants
version: 0.1.0
description: Two-video A/B experiments isolating ONE variable (hook copy, primary color, or pacing) in parallel project dirs, with a diff manifest and a decision procedure.
trigger: The user wants to A/B test a video - two versions to compare, "which opening works better", "try two colors", or asks for variant A and B of the same cut.
---

# AB Variants

Goal: two variants of one video that differ by exactly ONE variable, so any performance gap is attributable. Deliverables: `project-a/` and `project-b/` (parallel full projects) plus a diff manifest naming the variable, the hypothesis, and the frozen choices. This is not ad-remix - that skill re-authors one master into 30s / 15s / 6s durations; this skill holds duration constant and changes one thing.

## Workflow

1. Pick ONE variable with the user: hook copy (most common), primary color, or pacing (scene durations). Everything else is frozen - if two things change, the result is unattributable.
2. Freeze the reproducibility discipline: v1 exposes no per-variant content seeding, so NO randomness at all - every creative choice (delays, positions, palette) is written literally in both projects and listed in the manifest's frozen section. Identical literals, copy-pasted between dirs.
3. Author `project-a/` to green first: `compile.run` -> 0 errors, `test.run` all green, `render.preview` signed off. Variant A is the CONTROL - a finished video, not a draft.
4. Fork to `project-b/` (copy the whole directory), then apply the single change (Recipes). The edit should touch one declaration, one object, or one timing table - nothing else.
5. QA project-b with the SAME suite - only assertions that touch the changed variable may differ (the hook text gate, the contrast ledger, or the duration gates). Diff the two `test.run` result sets: every difference must trace to the one variable.
6. `render.preview` A then B, side by side: confirm the only visible difference is the variable, and log that review line in the manifest.
7. Ship the pair plus the manifest - the skill never picks a winner on its own: the assertion diff and the preview are the decision package; real judgments come from the human and from publication metrics.

## Recipes

project-a - the control hook (question pattern, hook-forge):

```ts
// project-a/src/video.ts - control: question hook
v.scene("hook", { duration: 2.5, background: "#0a0a12" }, (s) => {
  s.beat("payoff", { at: 0, description: "Control copy - question hook" });
  s.rect("ink", { width: 820, height: 340, fill: "#f59e0b", opacity: 0.14, blur: 130,
    at: { x: "50%", y: "44%" } });
  s.text("hook-1", "Why does your render", { size: 92, weight: 800, color: "#f8fafc",
    at: { x: "50%", y: "40%" }, enter: { effect: "blur-up", duration: 0.5, easing: "easeOutCubic" } });
  s.text("hook-2", "silently break?", { size: 92, weight: 800, color: "#f8fafc",
    at: { x: "50%", y: "50%" }, enter: { effect: "blur-up", duration: 0.5, easing: "easeOutCubic" } });
});
```

project-b - ONLY the copy changed (same structure, timings, palette):

```ts
// project-b/src/video.ts - treatment: big-number hook; the diff is the two
// text contents and nothing else - same beats, sizes, enters, and ink rect
v.scene("hook", { duration: 2.5, background: "#0a0a12" }, (s) => {
  s.beat("payoff", { at: 0, description: "Treatment copy - number hook" });
  s.rect("ink", { width: 820, height: 340, fill: "#f59e0b", opacity: 0.14, blur: 130,
    at: { x: "50%", y: "44%" } });
  s.text("hook-1", "60% of frames", { size: 92, weight: 800, color: "#f8fafc",
    at: { x: "50%", y: "40%" }, enter: { effect: "blur-up", duration: 0.5, easing: "easeOutCubic" } });
  s.text("hook-2", "render for nothing", { size: 92, weight: 800, color: "#f8fafc",
    at: { x: "50%", y: "50%" }, enter: { effect: "blur-up", duration: 0.5, easing: "easeOutCubic" } });
});
```

Variable menu (pick exactly one row; commit `DIFF.md` next to the two dirs):

| Variable | project-a (control) | project-b (treatment) | Gates allowed to differ |
| --- | --- | --- | --- |
| Hook copy | question | big-number claim | the hook `toContainText` pair |
| Primary color | #6366f1 | #22d3ee | contrast-ledger ratios |
| Pacing | item stagger 0.45s | item stagger 0.25s | `durationBetween` + landing frames |

DIFF.md, four mandatory fields: `variable`, `hypothesis`, `frozen` (every literal choice both share), `changed gates`.

## QA gates

- Both projects: `compile.run` 0 errors and `test.run` all green - a red variant is not a variant, it is a bug.
- Assertion diff = variable scope: diffing the two `test.run` result sets shows differences ONLY in gates the manifest lists as changed - anything else fails the experiment.
- Duration parity: both variants within 0.2s of each other unless pacing IS the variable (duration is a confound otherwise).
- Shared contracts identical in both: hook readable by 0.8s (`expect(frame(24))`, hook-forge), `expect(frame(0)).not.toBeBlack()`, `noTextOverflow()` plus `check.overflow`.
- Manifest completeness: variable, hypothesis, frozen list, changed gates - all four present before `render.final`.
- Side-by-side review logged: `render.preview` of A then B, with the one-line confirmation that the variable is the only visible difference.

## Anti-patterns

- Changing two variables ("new copy AND new colors") - the winner becomes unattributable; run two experiments or state the ambiguity out loud.
- "Random" nudges in B (shifting a position by feel) - v1 has no seed isolation for content, so any nondeterminism is an untracked variable; literals only, copy-pasted.
- B as a redesign - a treatment is one edit applied to a frozen control; a different video tests nothing.
- Different total durations - pacing noise drowns the variable (unless pacing IS the variable).
- Picking a winner from compile diagnostics or gut feel - the deliverable is the pair plus the manifest; the decision needs the preview and real publication metrics.
- Sharing one test file between projects - the diff procedure needs two independent suites; a shared suite hides regressions.
