---
name: course-intro
version: 0.1.0
description: Course openers: big course title, a 3-5 chapter preview list entering one by one, instructor credit bar, and a start-date CTA.
trigger: The user asks for an intro or trailer for a course, class, workshop, or training series that previews what it will cover.
---

# Course Intro

Goal: an 8–12s (1920×1080, 30fps) opener: the course name lands big in the first second, 3–5 chapter names preview one by one, an instructor credit bar closes the authority loop, and a start-date CTA ends on stillness. Titles, chapters, instructor, and dates come from the user; dates are never invented.

## Workflow

1. Collect: course name (≤ 6 words), 3–5 chapter names (≤ 5 words each), instructor name + one-line credential, start date or "enrollment open" phrasing, optional link. Ask for missing pieces — "[Start date TBD]" until supplied.
2. `storyboard.plan { intent: "course intro · <course>", durationSeconds }` → three scenes: `title` (2.5–3s) → `chapters` (4–5s) → `instructor-cta` (2.5–3.2s).
3. Write `src/video.ts` (Recipes): chapters enter at 0.4s stagger with running numbers; the instructor bar is left-anchored credit geometry.
4. `compile.run` → 0 errors; then `check.overflow` — chapter rows are single-line by contract (v1 text layers do not wrap).
5. `render.preview { scene: "chapters", beat: "all-in" }` — the preview reads as a table of contents: numbers aligned, rows evenly spaced, no orphan row.
6. QA gates (below) → `test.run` → repair loop ≤ 3 (`scene.modify`; `transaction.begin` / `transaction.rollback` when re-timing the list).
7. `render.final` → deliver with the chapter list as the summary.

## Recipes

Title scene — course name at ≥ 130px, blur-up, glow ink, readable by 1s:

```ts
v.scene("title", { duration: 2.8, background: "#0a0a12" }, (s) => {
  s.beat("name", { at: 0.2, description: "Course name readable by 1s" });
  s.rect("glow", { width: 900, height: 420, fill: "#f59e0b", opacity: 0.14, blur: 140, at: { x: 960, y: 430 } });
  s.text("kicker", "VIDEOOS SCHOOL", { size: 32, weight: 800, letterSpacing: 5, color: "#f59e0b",
    at: { x: 960, y: 260 }, enter: { effect: "fade", duration: 0.4 } });
  s.text("name", "Shipping Video as Code", { size: 130, weight: 800, color: "#f8fafc",
    at: { x: 960, y: 450 }, enter: { effect: "blur-up", duration: 0.55, easing: "easeOutCubic" } });
});
```

Chapters scene — numbered rows, 0.4s stagger, one line per chapter:

```ts
v.scene("chapters", { duration: 4.6, background: "#0a0a12" }, (s) => {
  s.beat("list", { at: 0.2, description: "Chapters enter one by one" });
  s.beat("all-in", { at: 2.2, description: "Full table of contents readable" });
  s.text("heading", "WHAT YOU WILL LEARN", { size: 44, weight: 800, letterSpacing: 3, color: "#f59e0b",
    at: { x: 960, y: "20%" }, enter: { effect: "fade", duration: 0.4 } });
  const CHAPTERS = ["Scenes, beats, and rhythm", "Text and safe areas", "Charts without libraries", "Testing your edit"];
  for (const [i, ch] of CHAPTERS.entries()) {
    s.text(`num-${i + 1}`, `0${i + 1}`, { size: 40, weight: 800, color: "#8b8ba7", at: { x: 520, y: `${34 + i * 13}%` },
      enter: { effect: "fade", duration: 0.35, delay: 0.35 + i * 0.4 } });
    s.text(`chapter-${i + 1}`, ch, { size: 48, weight: 600, color: "#e2e8f0", align: "left",
      at: { x: 600, y: `${34 + i * 13}%` },
      enter: { effect: "slide-up", duration: 0.45, delay: 0.4 + i * 0.4, easing: "easeOutCubic", params: { distance: 40 } } });
  }
});
```

Instructor + CTA scene — left-anchored credit bar, date CTA, still ending:

```ts
v.scene("instructor-cta", { duration: 3, background: "#0a0a12" }, (s) => {
  s.beat("credit", { at: 0.2, description: "Instructor credit + date CTA, then still" });
  s.rect("bar", { width: 6, height: 110, fill: "#f59e0b", radius: 3, at: { x: 570, y: 500 },
    enter: { effect: "slide-up", duration: 0.4, params: { distance: 30 } } });
  s.text("instructor", "Taught by [Instructor name]", { size: 46, weight: 700, color: "#f8fafc", align: "left",
    at: { x: 600, y: 465 }, enter: { effect: "fade", duration: 0.45, delay: 0.25 } });
  s.text("credential", "[One-line credential]", { size: 30, color: "#8b8ba7", align: "left",
    at: { x: 600, y: 545 }, enter: { effect: "fade", duration: 0.45, delay: 0.45 } });
  s.text("date", "Starts [Start date TBD]", { size: 56, weight: 800, color: "#f59e0b",
    at: { x: 960, y: 730 }, enter: { effect: "scale-pop", duration: 0.5, delay: 0.8, easing: "easeOutCubic" } });
});
```

Join scenes with `v.transition("crossfade", { duration: 0.4, between: ["title", "chapters"] })` and the same into `instructor-cta`; total = Σ durations − 0.4 × 2. The date must have its own beat plus ≥ 0.8s of stillness after it.

## QA gates

- `expect(frame(30)).toContainText(<course name>)` — the 1s readability contract.
- `toContainText` for each chapter at a frame ≥ its `delay + duration` (chapters enter 0.4s apart; the last lands ≈ 2.2s in-scene).
- `expect(scene("chapters")).toHaveLayers("heading", "num-1", "chapter-1", "num-4", "chapter-4")` and `toHaveBeat("all-in")` — the TOC structure survives edits.
- `toContainText` for instructor and date at their settled frames; the date shows the user's value or the [TBD] placeholder.
- `noTextOverflow()` on every scene + `check.overflow` — 130px course name and 48px chapter rows.
- `durationBetween`: title 2.5–3.2s, chapters 4–5.2s, instructor-cta 2.5–3.2s, total 8–12s, final 0.8s still.
- Muted rule: name, chapters, and date all carry as text — a spoken-only date gets missed on mute.

## Anti-patterns

- Inventing start dates ("March 1") — dates are commitments people plan around; "[Start date TBD]" until the user supplies one.
- More than 5 chapters — the preview becomes a syllabus; 3–5 named chapters sell the course, the rest live on the landing page.
- Chapter names over ~5 words — rows are single-line (v1 text does not wrap); a long name overflows instead of wrapping.
- Listing credentials the user did not confirm — credentials are verifiable claims; placeholders until confirmed, not embellished.
- Skipping the chapter preview (name straight to CTA) — the TOC is what converts a curious viewer; it tells them what they get.
- A fast tail (date popping in the last 0.3s) — the date CTA needs its own beat plus 0.8s of stillness to be read and acted on.
