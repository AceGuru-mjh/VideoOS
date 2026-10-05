---
name: recruitment
version: 0.1.0
description: Recruiting videos: role cards with title and requirements, multi-role carousel or single-role deep dive, honest salary handling, CTA.
trigger: The user asks for a hiring, recruitment, or job-posting video for one or more open roles (a "we're hiring" or careers spot).
---

# Recruitment

Goal: a 12–20s (1920×1080, 30fps) hiring spot in one of two shapes: a multi-role carousel (one card per role, ~3s each) or a single-role deep dive (responsibilities → requirements → benefits). Every fact — title, requirements, location, salary, apply URL — comes from the user; salary is never invented.

## Workflow

1. Collect per role: title, 2 requirement lines (≤ 9 words each), location, and — only if the user states them — salary range and apply URL. Ask; placeholders beat fabrication in hiring material (job ads are contractual-adjacent claims).
2. Choose the shape: 1 role → deep dive; 2–4 roles → carousel; 5+ → top 3 cards plus a "more roles" line on the CTA frame.
3. `storyboard.plan { intent: "hiring · <company or team>", durationSeconds }` → hook (1.5–2s) → role content → CTA (2.5–3.5s).
4. Write `src/video.ts` (Recipes): the card is a rect + title + two requirement lines + a meta line; the salary line follows the placeholder rule below.
5. `compile.run` → 0 errors; then `compile.diagnostics` — `OVERFLOW_RISK` on a role title is a hard fail (titles are the ad; shorten requirements before shrinking the title).
6. `render.preview { scene, beat }` on every card and section: the title dominates, the card reads as one unit, the meta line is clearly secondary.
7. QA gates (below) → `test.run` → repair loop ≤ 3 (`scene.modify`; `transaction.begin` / `transaction.rollback` when restructuring sections) → `render.final`.

Salary placeholder rule: user gave a range → show it verbatim; user gave none → either omit the line or write "Salary: discussed in interview". Never a plausible-looking range, never "competitive salary" (unfalsifiable).

## Recipes

Multi-role carousel — one role per scene, ~3s, card + title + two requirement lines + meta:

```ts
v.scene("role-1", { duration: 3, background: "#0a0a12" }, (s) => {
  s.beat("card", { at: 0.2, description: "Role title readable by 1s" });
  s.rect("card", { width: 1240, height: 560, fill: "#111527", radius: 18, at: { x: 960, y: 540 },
    enter: { effect: "slide-up", duration: 0.45, easing: "easeOutCubic", params: { distance: 60 } } });
  s.text("title", "Senior Compiler Engineer", { size: 72, weight: 800, color: "#f8fafc",
    at: { x: 960, y: 410 }, enter: { effect: "blur-up", duration: 0.5, delay: 0.25 } });
  s.text("req-1", "TypeScript and graph IRs", { size: 40, color: "#cbd5e1", at: { x: 960, y: 560 },
    enter: { effect: "fade", duration: 0.4, delay: 0.55 } });
  s.text("req-2", "Care about incremental builds", { size: 40, color: "#cbd5e1", at: { x: 960, y: 648 },
    enter: { effect: "fade", duration: 0.4, delay: 0.85 } });
  s.text("meta", "Remote (EU) — Salary: discussed in interview", { size: 30, color: "#8b8ba7",
    at: { x: 960, y: 770 }, enter: { effect: "fade", duration: 0.4, delay: 1.15 } });
});
v.transition("crossfade", { duration: 0.4, between: ["role-1", "role-2"] });
```

Single-role deep dive — three section scenes (responsibilities → requirements → benefits), heading + 2–3 items at 0.4s stagger:

```ts
v.scene("requirements", { duration: 4, background: "#0a0a12" }, (s) => {
  s.beat("section", { at: 0.2, description: "Section heading + items" });
  s.text("heading", "WHAT YOU WILL NEED", { size: 56, weight: 800, letterSpacing: 3, color: "#22d3ee",
    at: { x: 960, y: "26%" }, enter: { effect: "blur-in", duration: 0.5 } });
  const ITEMS = ["Strong TypeScript fundamentals", "Opinions about build speed", "Bonus: compiler or tooling background"];
  for (const [i, item] of ITEMS.entries()) {
    s.text(`item-${i + 1}`, item, { size: 44, color: "#e2e8f0", at: { x: 960, y: `${42 + i * 12}%` },
      enter: { effect: "slide-up", duration: 0.45, delay: 0.3 + i * 0.4, easing: "easeOutCubic", params: { distance: 40 } } });
  }
});
```

CTA end frame — one imperative + the apply URL + stillness:

```ts
v.scene("cta", { duration: 3, background: "#0a0a12" }, (s) => {
  s.beat("cta", { at: 0.2, description: "Apply step readable, then still" });
  s.text("cta", "Apply now", { size: 96, weight: 800, color: "#f8fafc", at: { x: 960, y: 450 },
    enter: { effect: "scale-pop", duration: 0.5, easing: "easeOutCubic" } });
  s.text("url", "[careers URL]", { size: 40, color: "#8b8ba7", at: { x: 960, y: 610 },
    enter: { effect: "fade", duration: 0.5, delay: 0.6 } });
});
```

Hook (1.5–2s): "We're hiring" + team name at ≥ 110px, `scale-pop`, readable by 1s. Total = Σ durations − 0.4 × (scenes − 1); hold the CTA's final ≥ 0.8s still.

## QA gates

- `expect(frame(30)).toContainText("We're hiring")` — the 1s readability contract on the hook.
- `toContainText` for every role title / section heading and every requirement line at a frame ≥ its entrance completion.
- `expect(scene("role-1")).toHaveLayers("card", "title", "req-1", "req-2", "meta")` — the card grammar survives edits.
- `noTextOverflow()` on every scene + `check.overflow` — 72px titles and 40px requirement lines.
- `durationBetween`: carousel roles 2.8–3.4s each; deep-dive sections 3.5–4.5s; CTA 2.5–3.5s; total 12–20s; final 0.8s still.
- Salary gate (manual): no numeric salary anywhere unless the user provided it verbatim; no "competitive salary" phrasing; placeholders intact.
- Muted rule: the apply step must be readable as text — a spoken-only CTA is a dropped CTA.

## Anti-patterns

- Inventing salary ranges, locations, or apply URLs — hiring claims get acted on; "Salary: discussed in interview" or [TBD] until the user supplies the real one.
- Buzzword requirements ("rockstar", "ninja", "10x") — concrete requirements filter candidates; buzzwords filter credibility.
- A third requirement line on a card — cards hold title + 2 lines + meta; a third either overflows the card or shrinks below readable.
- 5+ roles at 3s each — the cut blows past 20s and no role is remembered; top 3 cards plus a "more roles" line.
- Deep-dive benefits the user never confirmed ("unlimited PTO") — a fabricated perk is a broken promise on a legally-adjacent document.
- Animating through the CTA — the whole spot exists to deliver the apply step; end on ≥ 0.8s of stillness on the URL.
