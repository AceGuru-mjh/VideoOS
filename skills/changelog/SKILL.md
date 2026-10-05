---
name: changelog
version: 0.1.0
description: Release-notes video - version banner drops from the top, then entries stagger in color-coded by type (BREAKING amber, FEATURE white, FIX gray).
trigger: The user supplies release notes, a version bump, a Git log excerpt, or a "what's new" list and asks to turn it into a changelog or release video.
---

# Changelog

Goal: a 12-20s 1920x1080 release note (also strong in 9:16 for social release posts): one version per scene, banner slides DOWN, entries stagger UP 0.3s apart, color codes the entry type, newest version first, ending on the upgrade command. Entries are verbatim from the user's notes - a changelog that invents a line is a lie with a version number.

## Workflow

1. Normalize the source: one version = { number, date, entries[] }, each entry classified BREAKING / FEATURE / FIX (ask when ambiguous - the class picks the color). Trim each entry to <= 52 chars; <= 5 entries per version (link the release page for the rest).
2. `storyboard.plan { intent: "<project> · v<x.y.z> release note", durationSeconds: 15 }` - one scene per version plus a signoff scene; the act table is the contract.
3. Write `src/video.ts`: banner `slide-down` (from the top), entries `slide-up` - opposite directions are the counterpoint that makes the genre read. Version numbers and commands in monospace.
4. `compile.run` -> 0 errors; `check.overflow` (52-char entries at 44px are the limit - shorten the copy, never the size).
5. `render.preview` at the banner beat and the last-entry beat - banner text must clear the rule, entries must clear each other (11% rows).
6. QA gates (below) -> `test.run` -> repair loop (<= maxRepairLoops, then `transaction.rollback`) -> `render.final`.

| Act | Window | Scene | Job | Dominant element |
| --- | --- | --- | --- | --- |
| Banner | 0-2s | `v2-4-0` | version + date lands from the top | version number, >= 110, mono |
| Entries | 2-6s | `v2-4-0` | <= 5 entries stagger up | entry list, 44px |
| Next version | 6-12s | `v2-5-0` | repeat per version | banner |
| Signoff | last 3s | `signoff` | upgrade command + release link | the command, mono |

## Recipes

Banner + rule + date - slides down 120px (from above), amber rule wipes under it:

```ts
v.scene("v2-4-0", { duration: 6, background: "#0a0a12" }, (s) => {
  s.beat("banner", { at: 0.2, description: "Version banner drops from the top" });
  s.beat("entries", { at: 1.4, description: "Entries stagger up, one per 0.3s" });
  s.text("version", "v2.4.0", { size: 120, weight: 800, font: "monospace", color: "#ffffff",
    at: { x: "50%", y: "22%" },
    enter: { effect: "slide-down", duration: 0.6, easing: "easeOutCubic", params: { distance: 120 } } });
  s.rect("rule", { width: 260, height: 4, fill: "#f59e0b", radius: 2, at: { x: "50%", y: "31%" },
    enter: { effect: "wipe", duration: 0.4, delay: 0.5 } });
  s.text("date", "2025-10-24", { size: 34, color: "#8b8ba7", at: { x: "50%", y: "37%" },
    enter: { effect: "fade", duration: 0.4, delay: 0.7 } });
```

Tagged entries - the type prefix rides INSIDE the string (no separate dot layers to collide with ragged line lengths); color = type:

```ts
  const ENTRIES = [
    { type: "BREAKING", text: "render.final now requires a scene list", color: "#f59e0b" },
    { type: "FEATURE", text: "9:16 presets with platform-safe guides", color: "#e2e8f0" },
    { type: "FEATURE", text: "beat-grid snapping for kinetic text", color: "#e2e8f0" },
    { type: "FIX", text: "cache misses after transaction.rollback", color: "#8b8ba7" },
  ];
  for (const [i, e] of ENTRIES.entries()) {
    s.text(`entry-${i}`, `${e.type} · ${e.text}`, { size: 44, weight: 600, color: e.color, maxWidth: 1500,
      at: { x: "50%", y: `${47 + i * 11}%` },
      enter: { effect: "slide-up", duration: 0.5, delay: 1.4 + i * 0.3, easing: "easeOutCubic", params: { distance: 50 } } });
  }
});
```

Signoff - upgrade command types in, release link under it; versions join with `fade-black` (release boundaries feel heavier than scene cuts):

```ts
v.scene("signoff", { duration: 3 }, (s) => {
  s.beat("upgrade", { at: 0.2, description: "Upgrade command types itself" });
  s.text("cmd", "npm i @videoos/dsl@2.4.0", { size: 52, weight: 600, font: "monospace", color: "#e2e8f0",
    at: { x: "50%", y: "44%" }, enter: { effect: "typewriter", duration: 0.8, easing: "linear" } });
  s.text("notes", "Full notes -> github.com/AceGuru-mjh/VideoOS/releases", { size: 36, color: "#8b8ba7",
    at: { x: "50%", y: "58%" }, enter: { effect: "fade", duration: 0.5, delay: 1.1 } });
});
v.transition("fade-black", { duration: 0.5, between: ["v2-4-0", "signoff"] });
```

## QA gates

- `expect(frame(30)).toContainText("v2.4.0")` - banner settles at 0.8s (frame >= 24).
- Entries land at 1.4 + i*0.3 + 0.5; the last at 3.1s: `expect(frame(105)).toContainText("FIX · cache misses after transaction.rollback")`.
- `expect(scene("v2-4-0")).toHaveLayers("version", "rule", "date", "entry-0", "entry-3")`.
- `expect(scene("v2-4-0")).durationBetween(4, 7)` per version; `noTextOverflow()` - entries are the longest strings in the genre.
- Copy gate by hand: diff every on-screen entry against the user's source notes before `render.final` - QA proves presence, not verbatim truth.

## Anti-patterns

- Inventing or padding entries ("various bug fixes") - verbatim from the notes or nothing; a release video is a contract.
- > 5 entries in a scene - split the scene or link the release page; walls of text at 44px are unreadable.
- Two versions in one scene - the banner is a chapter heading; give each version its own scene.
- Every entry amber - color MEANS type: BREAKING only. A wall of amber says nothing.
- Entries longer than ~52 chars at 44px - shorten the copy (drop articles, keep the verb-noun core), never the size.
- No signoff - a changelog without the upgrade command ends on a list; the command is the CTA.
