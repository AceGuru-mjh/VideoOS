---
name: changelog
version: 0.1.0
description: Release-notes video (8-12s): version banner, staggered tagged entries with color dots, red breaking emphasis, upgrade CTA.
trigger: The user asks to turn a changelog, release notes, or a "what's new in vX.Y.Z" list into a short announcement video.
---

# Changelog

Goal: an 8-12s release announcement (1920x1080, 30fps) where the version number is readable at 1s, 3-4 tagged entries land at a 0.35s stagger, and an upgrade CTA holds still for the last 0.8s. Every entry comes from the user's notes - nothing invented, nothing trimmed without asking.

## Workflow

1. Collect: version string, release date, and 3-4 entries, each pre-classified feature / fix / breaking. If the file has more, ask which four ship this release's story - never dump the whole list.
2. `storyboard.plan { intent: "changelog · v<version>", durationSeconds }` -> remap shots onto the three acts below (the structure is the contract; `storyboard.toScenes` output is only a draft).
3. Write `src/video.ts` with the tag palette (Recipes). 30fps, 1920x1080 unless the user says otherwise.
4. `compile.run` -> 0 errors; then `compile.diagnostics` - any `OVERFLOW_RISK` on an entry line is a hard fail (shrink size 40 -> 36 before trimming words).
5. `render.preview { scene, beat }` per act - the dot/tag taxonomy must read instantly; the breaking row must be the loudest thing on screen.
6. QA gates (below) -> `test.run` -> repair loop <= 3 (`scene.modify` / `layer.modify`; `transaction.rollback` if you opened one).
7. `render.final` -> deliver the MP4 path + which entries made the cut.

Timing contract (10.5s cut, 0.4s crossfades; total = sum of durations - 0.4 x (scenes - 1)):

| Act | Scene | Window | Job |
| --- | --- | --- | --- |
| Banner | `banner` | 0-2.6s | "v2.4.0" >= 130px + date, readable by 1s |
| Entries | `entries` | 2.6-8.0s | 3-4 tagged rows, one row per 0.35s |
| CTA | `cta` | 8.0-10.5s | imperative verb + hold >= 0.8s |

Tag palette - dot AND label, never color alone: feature `#22c55e` "NEW" · fix `#38bdf8` "FIX" · breaking `#ef4444` "BREAKING".

## Recipes

Banner - the version number is the hook; the glow rect (no enter) gives frame-0 ink:

```ts
v.scene("banner", { duration: 2.6, background: "#0a0a12" }, (s) => {
  s.beat("version-lands", { at: 0, description: "Version readable by 1s" });
  s.rect("glow", { width: 900, height: 420, fill: "#22d3ee", opacity: 0.15, blur: 130,
    at: { x: "50%", y: "40%" } });
  s.text("version", "v2.4.0", { size: 150, weight: 800, letterSpacing: 4, color: "#f8fafc",
    at: { x: "50%", y: "40%" }, enter: { effect: "scale-pop", duration: 0.5, easing: "easeOutBack" } });
  s.text("date", "Released March 14, 2025", { size: 38, color: "#94a3b8",
    at: { x: "50%", y: "56%" }, enter: { effect: "fade", duration: 0.5, delay: 0.6 } });
});
```

Entries - one row = dot + tag + text, all staggered 0.35s; the breaking row turns red:

```ts
type EntryType = "feature" | "fix" | "breaking";
const TAG: Record<EntryType, { label: string; color: string }> = {
  feature: { label: "NEW", color: "#22c55e" },
  fix: { label: "FIX", color: "#38bdf8" },
  breaking: { label: "BREAKING", color: "#ef4444" },
};
const ENTRIES: Array<{ type: EntryType; text: string }> = [
  { type: "feature", text: "Scene templates with seeded variations" },
  { type: "fix", text: "Preview cache no longer drops audio" },
  { type: "breaking", text: "v1 layer hooks removed - migrate to plugins" },
  { type: "feature", text: "4x faster timeline seeks" },
];

v.scene("entries", { duration: 5.4, background: "#0a0a12" }, (s) => {
  s.beat("first-entry", { at: 0.15, description: "First row lands" });
  for (const [i, e] of ENTRIES.entries()) {
    const y = 20 + i * 16;                     // rows 16% of height apart
    const t = TAG[e.type];
    const d = 0.15 + i * 0.35;                 // the 0.35s stagger contract
    s.ellipse(`dot-${i + 1}`, { width: 18, height: 18, fill: t.color,
      at: { x: "17%", y: `${y}%` },
      enter: { effect: "scale-pop", duration: 0.35, delay: d, easing: "easeOutBack" } });
    s.text(`tag-${i + 1}`, t.label, { size: 26, weight: 700, color: t.color, letterSpacing: 2,
      at: { x: "22%", y: `${y}%`, align: "left" }, enter: { effect: "fade", duration: 0.3, delay: d + 0.1 } });
    s.text(`entry-${i + 1}`, e.text, { size: 40, weight: 600,
      color: e.type === "breaking" ? "#fca5a5" : "#e2e8f0",
      at: { x: "33%", y: `${y}%`, align: "left" },
      enter: { effect: "slide-left", duration: 0.45, delay: d, easing: "easeOutCubic", params: { distance: 70 } } });
  }
});
```

CTA - imperative verb, install hint in muted monospace, then stillness:

```ts
v.scene("cta", { duration: 2.8 }, (s) => {
  s.beat("cta", { at: 0.2 });
  s.text("headline", "Upgrade now", { size: 88, weight: 800, color: "#ffffff",
    at: { x: "50%", y: "44%" }, enter: { effect: "blur-up", duration: 0.6, delay: 0.2 } });
  s.text("hint", "npm i videoos@2.4.0", { size: 42, color: "#8b8ba7", font: "monospace",
    at: { x: "50%", y: "58%" }, enter: { effect: "fade", duration: 0.5, delay: 0.8 } });
});
```

Join acts with `v.transition("crossfade", { duration: 0.4, between: ["banner", "entries"] })` and `between: ["entries", "cta"]`; `fade-black` into the CTA suits a major (2.0+) release. Last row settles at 0.15 + 3 x 0.35 + 0.45 = 1.65s scene-local - keep `entries` >= 1.65 + 1.2s of reading time.

## QA gates

- `expect(frame(0)).not.toBeBlack()` (banner glow) and `expect(frame(30)).toContainText("v2.4.0")` - the 1s readability contract.
- `toContainText` for every entry text and every tag label, each at a frame >= its entrance completion on the crossfade-overlap timeline (entry-4: global ~2.2 + 1.65 = 3.85s -> frame 116).
- `expect(scene("entries")).toHaveLayers("dot-1", "entry-1", "tag-3")` - the dot/tag/entry triple survives edits.
- `durationBetween`: banner <= 3, entries 4-6, cta 2-3.
- `noTextOverflow()` on every scene; also run `check.overflow` - entry lines are the overflow-est strings in this genre.
- Muted rule: tags + colors carry the taxonomy with sound off; nothing may depend on narration.

## Anti-patterns

- Pasting the whole changelog (8+ rows) - after ~2.5s of stagger viewers read ahead and stop watching; ship the top 3-4 and link the doc for the rest.
- Dots as the only tag signal - color-blind viewers and muted autoplay need the text label too; dot + label, always.
- Breaking changes at body size mid-list - breaking costs users upgrade time; red text + BREAKING tag makes it unmissable (a 4th-row breaking entry is the worst case).
- Version number smaller than entry text - the banner is the hook (>= 130px vs <= 44px); a 60px version reads as a footnote.
- Motion during the CTA's last 0.5s - the video ends mid-fade; the tail is a hold, not an exit.
- Inventing entries to fill the list - fabricated release notes burn more trust than a short list; ask for the source file.
