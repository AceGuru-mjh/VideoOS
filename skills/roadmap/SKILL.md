---
name: roadmap
version: 0.1.0
description: Milestone timeline video (10-15s): horizontal axis with nodes lighting up, per-milestone focus carousel, shipped/in-progress/planned states.
trigger: The user asks to turn a roadmap, milestone plan, or product timeline into a video, or wants "what ships when" visualized.
---

# Roadmap

Goal: a 10-15s (1920x1080, 30fps) horizontal timeline: the axis builds and 3-5 nodes light up, then each milestone takes a focus turn (current node big and bright, siblings dim and small) before a full-lit outro holds >= 0.8s. Dates must be real commitments (quarter or month) - a roadmap with "soon" in it is a wish, not a roadmap.

## Workflow

1. Collect 3-5 milestones, each with title (<= 26 chars), date ("Q3 2025" or "Sept 2025"), and state shipped / in-progress / planned. More than 5 -> cut the ones without dates; a 6-node axis collides date labels at size 24.
2. `storyboard.plan { intent: "roadmap · <product> <year>", durationSeconds }` -> collapse to: one timeline scene + one focus scene per milestone + one outro; delete everything else the template suggests.
3. Write `src/video.ts` (Recipes). Nodes are `ellipse` layers `node-1..N`; positions come from one even-spread array computed once - never hand-tweaked per node or per scene.
4. `compile.run` -> 0 errors -> `check.overflow` (date labels under dim nodes are the classic violation in this genre).
5. `render.preview` one settled frame per scene - the axis geometry must be IDENTICAL across scenes; drifting nodes turn the carousel into a jump cut.
6. QA gates (below) -> `test.run` -> repair loop <= 3 (`layer.modify` for geometry drift; `transaction.rollback` if you batched edits), then `render.final` -> deliver the MP4 + milestone count and state mix.

State palette - fill carries state, the date label carries it too (never color alone):

| State | Node fill | Reads as |
| --- | --- | --- |
| shipped | `#22c55e` | done, reference-able |
| in-progress | `#f59e0b` | committed, this quarter |
| planned | `#475569`, opacity 0.6 | intended, not promised |

## Recipes

Timeline - axis wipes in, nodes pop 0.4s apart; the halo (no enter) gives frame-0 ink:

```ts
const MILESTONES = [
  { title: "Plugin runtime", date: "Q1 2025", state: "shipped" },
  { title: "25 MCP servers", date: "Q2 2025", state: "shipped" },
  { title: "Agent CI cloud", date: "Q3 2025", state: "in-progress" },
  { title: "Realtime collab", date: "Q4 2025", state: "planned" },
];
const STATE: Record<string, string> = { shipped: "#22c55e", "in-progress": "#f59e0b", planned: "#475569" };
const X = MILESTONES.map((_, i) => 22 + (i * 56) / (MILESTONES.length - 1));   // even spread 22%..78%

v.scene("timeline", { duration: 3, background: "#0a0a12" }, (s) => {
  s.beat("axis", { at: 0, description: "Heading readable by 1s" });
  s.ellipse("halo", { width: 1400, height: 520, fill: "#22d3ee", opacity: 0.06, blur: 150,
    at: { x: "50%", y: "40%" } });
  s.text("heading", "VIDEOOS · 2025", { size: 64, weight: 800, letterSpacing: 4, color: "#f8fafc",
    at: { x: "50%", y: "20%" }, enter: { effect: "blur-up", duration: 0.6 } });
  s.rect("axis", { width: 1220, height: 3, fill: "#334155", at: { x: "50%", y: "74%" },
    enter: { effect: "wipe", duration: 1.0, delay: 0.3, easing: "easeOutCubic" } });
  MILESTONES.forEach((m, i) => {
    s.ellipse(`node-${i + 1}`, { width: 22, height: 22, fill: STATE[m.state]!,
      at: { x: `${X[i]}%`, y: "74%" },
      enter: { effect: "scale-pop", duration: 0.35, delay: 0.7 + i * 0.4, easing: "easeOutBack" } });
    s.text(`date-${i + 1}`, m.date, { size: 24, color: "#94a3b8",
      at: { x: `${X[i]}%`, y: "81%" }, enter: { effect: "fade", duration: 0.3, delay: 0.85 + i * 0.4 } });
  });
});
```

Focus - one scene per milestone; siblings dim to opacity 0.35 and shrink, the active node gets a glow + the story (this is focus-3):

```ts
const active = 2;                                   // bump per focus scene
const m = MILESTONES[active]!;
v.scene(`focus-${active + 1}`, { duration: 2.6, background: "#0a0a12" }, (s) => {
  s.beat("focus", { at: 0.15, description: "Milestone readable by 1s" });
  s.rect("axis", { width: 1220, height: 3, fill: "#334155", at: { x: "50%", y: "74%" } });
  MILESTONES.forEach((ms, i) => {
    const now = i === active;                       // the carousel emphasis delta
    s.ellipse(`node-${i + 1}`, { width: now ? 34 : 20, height: now ? 34 : 20,
      fill: STATE[ms.state]!, opacity: now ? 1 : 0.35, at: { x: `${X[i]}%`, y: "74%" } });
    s.text(`date-${i + 1}`, ms.date, { size: 24, color: now ? "#e2e8f0" : "#475569",
      at: { x: `${X[i]}%`, y: "81%" } });
  });
  s.ellipse("active-glow", { width: 130, height: 130, fill: STATE[m.state]!, opacity: 0.22, blur: 40,
    at: { x: `${X[active]}%`, y: "74%" } });
  s.text("milestone", m.title, { size: 72, weight: 800, color: "#f8fafc",
    at: { x: "50%", y: "40%" },
    enter: { effect: "slide-up", duration: 0.5, easing: "easeOutCubic", params: { distance: 60 } } });
  s.text("status", `${m.date} · ${m.state}`, { size: 30, weight: 700, letterSpacing: 2,
    color: m.state === "planned" ? "#94a3b8" : STATE[m.state]!,
    at: { x: "50%", y: "54%" }, enter: { effect: "fade", duration: 0.4, delay: 0.5 } });
});
```

Outro - all nodes full-lit (no enter effects), one line of intent, then stillness:

```ts
v.scene("outro", { duration: 2.4, background: "#0a0a12" }, (s) => {
  s.beat("all-lit", { at: 0.2, description: "No new motion after 1.2s" });
  s.rect("axis", { width: 1220, height: 3, fill: "#334155", at: { x: "50%", y: "74%" } });
  MILESTONES.forEach((ms, i) => {
    s.ellipse(`node-${i + 1}`, { width: 22, height: 22, fill: STATE[ms.state]!,
      opacity: ms.state === "planned" ? 0.6 : 1, at: { x: `${X[i]}%`, y: "74%" } });
    s.text(`date-${i + 1}`, ms.date, { size: 24, color: "#94a3b8", at: { x: `${X[i]}%`, y: "81%" } });
  });
  s.text("tagline", "The road to agent-native video", { size: 48, color: "#94a3b8",
    at: { x: "50%", y: "40%" }, enter: { effect: "fade", duration: 0.5, delay: 0.3 } });
});
```

Join every adjacent pair with `v.transition("crossfade", { duration: 0.4, between: [...] })` - the crossfade IS the carousel motion; never `cut` (pops) or `fade-black` (resets the world). Budget: 4 milestones = 3.0 + 4 x 2.6 + 2.4 - 0.4 x 5 = 13.8s; a 5th means focus scenes at 2.4s + outro 2.0s (14.6s) - or drop the weakest milestone, never speed up the reads.

## QA gates

- `expect(frame(0)).not.toBeBlack()` (timeline halo) and `expect(frame(30)).toContainText("VIDEOOS · 2025")` - the 1s hook.
- Every focus scene: `toContainText` for its milestone title and date at >= 1.0s scene-local, plus `toHaveLayers("node-1", "node-2", "node-3", "node-4", "axis")` - the geometry contract, asserted per scene.
- Outro: `toHaveBeat("all-lit")` and nothing entering after `outro.duration - 0.8` (tagline settles at 0.8s).
- `noTextOverflow()` on every scene; `check.overflow` catches wide date labels near the edges.
- `durationBetween`: focus scenes 2.4-2.8s; total 10-15s. Muted rule: state colors + date text carry everything with sound off.

## Anti-patterns

- Vertical timelines in 16:9 - horizontal spends the wide axis; if the target is 9:16, restack as a vertical ladder inside the short-video safe margins instead of rotating the layout.
- Every node equally bright in focus scenes - the carousel reads BECAUSE of the emphasis delta (34px / opacity 1 vs 20px / opacity 0.35); uniform nodes make a static diagram.
- "Planned" milestones in bright color - the future is dim gray; bright is reserved for what shipped or is in flight (over-promising is this genre's cardinal sin).
- Hand-tweaked node positions per scene - nodes must sit at identical x in every scene or the crossfade reads as a jump; compute `X` once and reuse it everywhere.
- Dates without quarter granularity - "coming soon" fails the honesty bar; a milestone without a date is marketing, not roadmap.
- A camera push in every focus scene - one push per video (timeline or outro); focus scenes stay static so the axis holds still while the story changes.
