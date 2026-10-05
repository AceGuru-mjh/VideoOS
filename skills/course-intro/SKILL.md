---
name: course-intro
version: 0.1.0
description: Open a course or workshop with a chapter-preview reveal (01–05) and an instructor credit scene, ending in an enroll CTA.
trigger: The user asks for a course / training / workshop intro, trailer, or preview that lists what gets taught and who teaches it.
---

# Course Intro

Goal: a 15–25s 16:9 open (1920×1080, 30fps) that sells the syllabus in one glance: course title, 4–6 numbered chapters revealed in teaching order, then an instructor sign-off — the "what + who" contract of the course in three acts.

## Workflow

1. Collect: course title, 4–6 REAL chapter titles (≤ 22 chars) + one-line descriptors (≤ 24 chars), instructor name + credit line, enroll CTA. Chapters must be the actual syllabus — ask; never draft chapters on the user's behalf.
2. `storyboard.plan { intent: "course intro · <title>", durationSeconds }` → remap onto open → chapters → instructor (CTA rides the instructor scene).
3. Write `src/video.ts`: chapter rows on a fixed grid (11% apart), reveal stagger 0.4s in teaching order; instructor credit in muted `weight: 400` — v1 has no italic, so muted + light weight IS the aside voice.
4. `compile.run` → 0 errors → `check.overflow` (chapter titles at size 56: over 22 chars and the three-column row grid collides).
5. `render.preview { scene, beat }` — the reveal must read in order; if a descriptor fights its title for attention, kill the descriptor.
6. QA gates (below) → `test.run` → repair ≤ `maxRepairLoops` → `transaction.rollback`; `render.final` + the chapter list.

| Act | Window | Scene | Job | Dominant element |
| --- | --- | --- | --- | --- |
| Open | 0–5s | `open` | course title + promise | title blur-up ≥ 120 |
| Chapters | 5–15s | `chapters` | the syllabus at a glance | numbered rows 01–06 |
| Instructor | 15–22s | `instructor` | who teaches + enroll CTA | name + muted credit |

## Recipes

Open — title blur-up over a violet glow, camera breathing in:

```ts
v.scene("open", { duration: 5, background: "#0a0a12" }, (s) => {
  s.beat("title", { at: 0.2, description: "Course title blur-up" });
  s.rect("glow", { width: 700, height: 700, fill: "#6d28d9", opacity: 0.25, blur: 120, at: { x: 960, y: 410 } });
  s.text("title", "Ship Video with Code", { size: 120, weight: 800, color: "#ffffff",
    at: { x: 960, y: 410 }, enter: { effect: "blur-up", duration: 0.8 } });
  s.text("sub", "A hands-on course in 5 chapters", { size: 44, color: "#8b8ba7", at: { x: 960, y: 562 },
    enter: { effect: "fade", duration: 0.6, delay: 0.5 } });
  s.camera("push-in", { from: 1.0, to: 1.06 });
});
```

Chapter reveal — the signature: three fixed columns (number, title, descriptor) sliding in on one row grid, teaching order:

```ts
const chapters = [
  { n: "01", t: "Your first defineVideo", d: "scenes, layers, beats" },
  { n: "02", t: "Kinetic type", d: "the stagger patterns" },
  { n: "03", t: "Charts from rects", d: "the mask trick" },
  { n: "04", t: "Camera grammar", d: "push, pan, rest" },
  { n: "05", t: "Visual QA", d: "assert every frame" },
];
for (const [i, c] of chapters.entries()) {
  const y = 367 + i * 119; // row grid on 1080: 34%–78%, 11% apart
  s.beat(`chapter-${i + 1}`, { at: 0.4 + i * 0.4, description: `Chapter ${c.n} reveal` });
  s.text(`num-${i}`, c.n, { size: 44, weight: 700, font: "monospace", color: "#f59e0b",
    at: { x: 520, y }, enter: { effect: "slide-right", duration: 0.4, delay: 0.4 + i * 0.4, params: { distance: 60 } } });
  s.text(`title-${i}`, c.t, { size: 56, weight: 700, color: "#e2e8f0", maxWidth: 700, at: { x: 940, y },
    enter: { effect: "slide-up", duration: 0.45, delay: 0.45 + i * 0.4, params: { distance: 50 } } });
  s.text(`desc-${i}`, c.d, { size: 34, color: "#8b8ba7", maxWidth: 420, at: { x: 1500, y },
    enter: { effect: "fade", duration: 0.4, delay: 0.55 + i * 0.4 } });
}
```

Instructor sign-off — initials avatar, the name, then the muted credit and the enroll line; end still:

```ts
v.scene("instructor", { duration: 7 }, (s) => {
  s.beat("credit", { at: 0.3, description: "Instructor sign-off" });
  s.ellipse("avatar", { width: 160, height: 160, fill: "#6d28d9", opacity: 0.35, at: { x: 960, y: 367 },
    enter: { effect: "scale-pop", duration: 0.5, easing: "easeOutBack" } });
  s.text("initials", "MC", { size: 56, weight: 700, color: "#ffffff", at: { x: 960, y: 361 },
    enter: { effect: "fade", duration: 0.4, delay: 0.3 } });
  s.text("name", "Maya Chen", { size: 88, weight: 800, color: "#ffffff", at: { x: 960, y: 540 },
    enter: { effect: "slide-up", duration: 0.5, delay: 0.4, params: { distance: 70 } } });
  s.text("credit", "Your instructor · ex-RenderX platform lead", { size: 40, weight: 400, color: "#8b8ba7",
    at: { x: 960, y: 648 }, enter: { effect: "fade", duration: 0.5, delay: 0.9 } });
  s.text("cta", "Start Chapter 01 →", { size: 56, weight: 700, color: "#f59e0b", at: { x: 960, y: 799 },
    enter: { effect: "fade", duration: 0.5, delay: 1.5 } });
});
```

Join acts with `v.transition("crossfade", { duration: 0.5, between: ["open", "chapters"] })` and chapters → instructor.

## QA gates

- `toContainText` for the course title, EVERY chapter number and title, instructor name, credit, and CTA — the last chapter settles at 0.45 + 4 × 0.4 + 0.45 ≈ 2.5s local; assert after that.
- `expect(scene("chapters")).toHaveLayers("num-0", "title-0", "desc-0", "num-4")` — the reveal survives edits.
- `durationBetween`: open 4–6, chapters 8–12, instructor 5–8; `noTextOverflow()` on all three; `not.toBeBlack()` frame 0 (glow, no `enter`).
- Order gate by eye in `render.preview`: chapters must appear 01 → 05; a shuffled reveal is a broken promise even if every layer exists.

## Anti-patterns

- Inventing or "improving" chapters — the syllabus is a contract with the student; ship exactly what the instructor teaches.
- More than 6 chapters — the glance dies; fold chapters into modules or cut to the arc.
- Descriptors longer than titles — the descriptor decorates, the title informs; when they fight, the descriptor loses.
- Reveal order ≠ teaching order — viewers plan against this list; order is information, not style.
- Skipping the instructor scene — courses sell on the person as much as the syllabus.
- Hunting for italic — v1 has none; muted color + `weight: 400` is the aside voice. Do not fake it with a lighter font name.
