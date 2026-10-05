---
name: interview-clip
version: 0.1.0
description: Interview pull-quotes: left-anchored speaker bar, a line that fades out into an enlarged hero quote, and a 0.4s silent-frame pause.
trigger: The user asks to cut an interview, podcast, or testimonial into a short quotable clip with speaker attribution.
---

# Interview Clip

Goal: a 6–10s (1920×1080, 30fps) single-quote cut: the sentence appears first as a readable subtitle under a LEFT-anchored speaker bar, a 0.4s silent black frame resets the eye, then the key fragment returns big (weight 800, ≥ 110px) with attribution. One clip = one quote. Zero-asset.

## Workflow

1. Collect the exact quote (verbatim — never paraphrase a quote), the speaker name and role, and which fragment (≤ 8 words) is the hero. Ask for anything missing; use bracketed placeholders ("[Speaker name]", "[Role, Team]") rather than inventing.
2. `storyboard.plan { intent: "interview clip · <speaker>", durationSeconds }` → two scenes: `context` (3–3.6s) → `quote` (3.2–4s), joined by a 0.4s `fade-black` silent frame.
3. Write `src/video.ts` (Recipes). The speaker bar is left-anchored lower-third geometry (accent bar + flush-left text) — interview clips are conversational, not broadcast-branded; centered bars belong to news-brief.
4. `compile.run` → 0 errors; then `compile.diagnostics` — the hero quote at ≥ 110px is the overflow-est line here; any `OVERFLOW_RISK` is a hard fail (shorten the fragment or drop one size step).
5. `render.preview { scene: "context", beat: "sub" }` and `{ scene: "quote", beat: "hero" }` — exactly one reading target per beat.
6. QA gates (below) → `test.run` → repair loop ≤ 3 (`scene.modify`; wrap quote-length changes in `transaction.begin` / `transaction.rollback`).
7. `render.final` → deliver, noting which fragment was chosen as the hero.

Silent-frame rule: the 0.4s black beat between the scenes is the skill's signature — it separates hearing the sentence from seeing it. Keep it empty; the pause IS the emphasis.

## Recipes

Context scene — left speaker bar + verbatim sentence (one line per layer — v1 text is single-line), sentence exits before the hero returns:

```ts
v.scene("context", { duration: 3.2, background: "#0a0a12" }, (s) => {
  s.beat("sub", { at: 0.2, description: "Sentence readable by 1s" });
  // left-anchored speaker bar: accent edge + flush-left name and role
  s.rect("bar", { width: 6, height: 120, fill: "#f59e0b", radius: 3, at: { x: 176, y: 830 },
    enter: { effect: "slide-up", duration: 0.4, delay: 0.1, params: { distance: 40 } } });
  s.text("speaker", "[Speaker name]", { size: 44, weight: 700, color: "#f8fafc", align: "left",
    at: { x: 210, y: 806 }, enter: { effect: "fade", duration: 0.4, delay: 0.2 } });
  s.text("role", "[Role, Team]", { size: 30, color: "#8b8ba7", align: "left",
    at: { x: 210, y: 858 }, enter: { effect: "fade", duration: 0.4, delay: 0.35 } });
  // the sentence, verbatim, as two single-line layers (never edit the words)
  s.text("line-1", "We stopped guessing what broke", { size: 48, weight: 600, color: "#e2e8f0",
    maxWidth: 1400, at: { x: 960, y: 470 }, enter: { effect: "blur-up", duration: 0.6, delay: 0.3 },
    exit: { effect: "fade", duration: 0.5 } });
  s.text("line-2", "and started reading the diff.", { size: 48, weight: 600, color: "#e2e8f0",
    maxWidth: 1400, at: { x: 960, y: 545 }, enter: { effect: "blur-up", duration: 0.6, delay: 0.5 },
    exit: { effect: "fade", duration: 0.5 } });
});
v.transition("fade-black", { duration: 0.4, between: ["context", "quote"] });
```

Quote scene — hero fragment at weight 800, attribution below, still ending:

```ts
v.scene("quote", { duration: 3.6, background: "#0a0a12" }, (s) => {
  s.beat("hero", { at: 0.15, description: "Hero fragment lands" });
  s.rect("glow", { width: 900, height: 420, fill: "#f59e0b", opacity: 0.12, blur: 140, at: { x: 960, y: 450 } });
  s.text("hero", "Read the diff.", { size: 150, weight: 800, color: "#f8fafc", at: { x: 960, y: 450 },
    enter: { effect: "scale-pop", duration: 0.55, easing: "easeOutCubic" } });
  s.text("attribution", "— [Speaker name], [Role]", { size: 36, color: "#8b8ba7", at: { x: 960, y: 660 },
    enter: { effect: "fade", duration: 0.5, delay: 0.9 } });
});
```

Hero size ladder: ≤ 3 words → 150px; 4–6 words → 110px; 7–8 words → 84px. Below 84px it is a subtitle, not a hero — pick a shorter fragment. The hero holds ≥ 2.5s (entrance ≤ 0.6s, attribution by 1.4s, then ≥ 0.8s of stillness); that hold is the whole point of the clip.

## QA gates

- `expect(frame(30)).not.toBeBlack()` — the bar and subtitle supply ink within 1s.
- `toContainText` for both sentence lines (context, settled frame) and the hero fragment + attribution (quote, frame ≥ 1.5s in).
- `expect(scene("context")).toHaveLayers("bar", "speaker", "role", "line-1", "line-2")`; `expect(scene("quote")).toHaveLayers("hero", "attribution")`.
- `expect(scene("quote")).toHaveBeat("hero")` — the two-beat structure survives edits.
- `noTextOverflow()` on both scenes + `check.overflow` (`maxWidth: 1400` on subtitle lines; hero at its ladder size).
- `durationBetween`: context 2.8–3.6s, quote 3.2–4s, total 6–10s with the fade-black overlap counted.
- Verbatim gate (manual): the hero fragment must be a substring of the context sentence — paraphrasing a quote is misquotation.

## Anti-patterns

- Paraphrasing or trimming words inside the quote — pull-quotes are verbatim by definition; pick a shorter fragment instead of editing the speaker.
- Inventing speaker names or roles — placeholders until the user supplies them; a wrong attribution is worse than a blank one.
- Centering the speaker bar — this genre anchors left; a centered broadcast bar reads as news-brief and kills the conversational tone.
- Keeping the subtitle visible under the hero — the original must fully fade before the big version lands, or the screen shows the same words twice.
- Skipping the silent frame (straight crossfade) — without the 0.4s black beat the hero lands on a busy frame and loses the emphasis the pause creates.
- Two quotes in one clip — 6–10s holds one sentence; a second quote is a second clip (or news-brief for lists).
