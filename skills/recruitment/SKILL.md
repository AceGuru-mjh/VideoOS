---
name: recruitment
version: 0.1.0
description: Create a vertical 9:16 hiring video — employer hook, a role-card deck with requirement chips, and an apply CTA tail frame.
trigger: The user wants a "we're hiring" post, careers video, open-role announcement, or job ad built for social platforms.
---

# Recruitment

Goal: a 25–35s vertical 9:16 hiring post (1080×1920, 30fps): a 3s employer hook, one card per open role (title + 3–5 requirement chips), and a still apply-frame tail — energetic enough to stop a thumb, honest enough to filter. Vertical safe zone per the short-video skill: centers inside x ∈ [12%, 88%], y ∈ [14%, 80%].

## Workflow

1. Collect: company name + one-line employer pitch, roles (title ≤ 26 chars, team, 3–5 must-have requirements ≤ 16 chars each), apply URL/email. Show compensation ONLY if the user handed you numbers — invented salaries are a legal problem, not just a style one.
2. `storyboard.plan { intent: "hiring · <company> · <N> roles", durationSeconds }` → remap onto hook → role-1..N (5–7s each; more than 3 roles = one deck scene or separate videos) → cta.
3. Write `src/video.ts`: cards slide up as a deck (0.25s stagger, painter's order — deepest card declared first so role-1 lands on TOP), chips are pill rects sized to their labels, CTA tail holds still ≥ 0.8s.
4. `compile.run` → 0 errors → `check.overflow` — chips are the risk: fixed widths, short labels, no wrapping allowed inside a pill.
5. `render.preview { scene, beat }` and read each card in under 3s; if you cannot, cut a chip (the card is a filter, not a job description).
6. QA gates (below) → `test.run` → repair ≤ `maxRepairLoops` → `transaction.rollback`; `render.final` + the role list.

## Recipes

Hook — company blur-up, "We're hiring" pops in amber (the whole video's job is these 3 seconds):

```ts
v.scene("hook", { duration: 3, background: "#0a0a12" }, (s) => {
  s.beat("hook", { at: 0.15, description: "We're hiring" });
  s.rect("glow", { width: 560, height: 560, fill: "#6d28d9", opacity: 0.25, blur: 120, at: { x: 540, y: 730 } });
  s.text("co", "RENDERX", { size: 96, weight: 800, letterSpacing: 6, color: "#ffffff",
    at: { x: 540, y: 653 }, enter: { effect: "blur-up", duration: 0.6 } });
  s.text("hire", "We're hiring", { size: 108, weight: 800, color: "#f59e0b", at: { x: 540, y: 922 },
    enter: { effect: "scale-pop", duration: 0.5, delay: 0.4, easing: "easeOutBack" } });
});
```

Role-card deck — the signature: cards stack into a fan (deepest declared first, dimmer and lower), the featured role arrives last and on top:

```ts
const deck = [ // painter's order: index 0 is the DEEPEST card; role-1 ends up on top
  { name: "Design Engineer", y: 1037, opacity: 0.3 },
  { name: "Platform Engineer", y: 902, opacity: 0.55 },
  { name: "Senior Frontend Engineer", y: 768, opacity: 1.0 },
];
for (const [i, r] of deck.entries()) {
  s.rect(`card-${i}`, { width: 820, height: 640, fill: "#12121e", radius: 20, opacity: r.opacity,
    at: { x: 540, y: r.y },
    enter: { effect: "slide-up", duration: 0.55, delay: i * 0.25, params: { distance: 180 }, easing: "easeOutCubic" } });
  s.text(`role-${i}`, r.name, { size: 64, weight: 800, color: "#ffffff", opacity: r.opacity,
    maxWidth: 700, lineHeight: 1.1, align: "center", at: { x: 540, y: r.y - 180 },
    enter: { effect: "slide-up", duration: 0.55, delay: 0.1 + i * 0.25, params: { distance: 120 } } });
}
```

Requirement chips on the featured card — pill rects sized to label, popping 0.25s apart:

```ts
const chips = ["TypeScript", "React", "Canvas/WebGL", "Remote (EU)"];
for (const [i, chip] of chips.entries()) {
  const w = 60 + chip.length * 26; // pill width fits the label — no wrapping inside a chip
  s.rect(`chip-${i}`, { width: w, height: 84, fill: "#0a0a12", radius: 42, at: { x: 540, y: 760 + i * 130 },
    enter: { effect: "scale-pop", duration: 0.45, delay: 0.8 + i * 0.25, easing: "easeOutBack" } });
  s.text(`chip-label-${i}`, chip, { size: 40, weight: 600, color: "#e2e8f0", at: { x: 540, y: 760 + i * 130 },
    enter: { effect: "fade", duration: 0.3, delay: 0.85 + i * 0.25 } });
}
```

CTA tail — still frame: imperative, destination, referrer line, then nothing moves:

```ts
v.scene("cta", { duration: 4 }, (s) => {
  s.beat("cta", { at: 0.2, description: "Apply tail frame" });
  s.rect("panel", { width: 820, height: 700, fill: "#12121e", radius: 20, at: { x: 540, y: 845 } });
  s.text("apply", "Apply now", { size: 104, weight: 800, color: "#ffffff", at: { x: 540, y: 730 },
    enter: { effect: "scale-pop", duration: 0.5, easing: "easeOutBack" } });
  s.text("where", "renderx.com/careers", { size: 48, color: "#f59e0b", at: { x: 540, y: 960 },
    enter: { effect: "fade", duration: 0.5, delay: 0.5 } });
  s.text("ref", "Mention this video", { size: 36, color: "#8b8ba7", at: { x: 540, y: 1114 },
    enter: { effect: "fade", duration: 0.5, delay: 0.8 } });
});
```

## QA gates

- `toContainText` for company, every role title, every chip label, and the apply destination — each after its entrance completes.
- `expect(scene("role-1")).toHaveLayers("card-0", "card-1", "card-2", "chip-0", "chip-3")` — deck and chips survive edits.
- `durationBetween`: hook 2–4, role scenes 5–8, cta 3–5; `noTextOverflow()` everywhere; `not.toBeBlack()` frame 0 (glow, no `enter`).
- CTA stillness: nothing animates in the last 0.8s — an exit mid-fade makes the loop point feel broken when platforms replay it.

## Anti-patterns

- Inventing salary, perks, or "remote-friendly" claims — show only what the user provided; hiring posts are contract-adjacent documents.
- More than 5 chips — the card is a filter; the full JD lives behind the apply link.
- Cutesy titles ("Ninja", "Rockstar") — say the job; the deck's job is to be searchable and screenable.
- Deck cards declared in reading order — painter's order buries role-1 under the stack; declare deepest first.
- Role cards longer than 7s or hook longer than 3s — the audience is swiping, not reading.
- CTA without stillness — see the QA gate; replays are where these videos live.
