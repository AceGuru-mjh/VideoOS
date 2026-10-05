---
name: api-explainer
version: 0.1.0
description: API explainer (~10s): endpoint card, request params sliding in, response fields fading on, then a one-line takeaway.
trigger: The user asks to explain, demo, or pitch an API endpoint or request/response flow as a short dev-facing video (not a product ad).
---

# API Explainer

Goal: a ~10s (1920×1080, 30fps) dev-facing explainer — endpoint card 2s → request 3s → response 3s → summary 2s, hard cuts between scenes, monospace for anything code, one takeaway, ending in ≥ 0.8s of stillness. Zero-asset.

## Workflow

1. Collect the REAL contract: method + path, ≤ 3 request params (name, type, one-phrase purpose), ≤ 3 response fields, the success status code, one takeaway sentence, a docs URL. Source it from the user's spec/docs/code (`asset.add` the OpenAPI file if offered) — never invent fields.
2. `storyboard.plan { intent: "api explainer · <METHOD path>", durationSeconds }` → remap onto the fixed four-scene structure below; the timing IS the skill. Fix method colors once (GET green, POST amber, DELETE red) and reuse them in every scene.
3. Write `src/video.ts`: four scenes, `font: "monospace"` on every path/key/value, hard `cut` transitions, then `compile.run` → 0 errors → `check.overflow` (a 60px monospace path is the overflow case; set `maxWidth` or drop to 56px).
4. `render.preview` one settled frame per scene — one card per scene, the badge the only saturated color block, ≤ 3 rows visible → `test.run` → QA gates → repair ≤ 3 (`scene.modify`; `transaction.begin` / `transaction.rollback` around risky edits) → `render.final`.

Timing (hard cuts; scene starts 0 / 2 / 5 / 8; total 10s):

| Scene | Window | Job | Motion |
| --- | --- | --- | --- |
| endpoint | 0–2s | method badge + path + one-liner | card slide-up, badge pop, path typewriter |
| request | 2–5s | ≤ 3 param rows | rows `slide-left` in, 0.4s stagger |
| response | 5–8s | status chip + ≤ 3 fields | fields `fade` on, 0.5s stagger |
| summary | 8–10s | one takeaway + docs URL | blur-up, then still |

## Recipes

Endpoint card — badge pops, path types:

```ts
v.scene("endpoint", { duration: 2, background: "#0a0a12" }, (s) => {
  s.beat("card-in", { at: 0, description: "Card rises, badge pops, path types" });
  s.rect("card", { width: 1160, height: 420, fill: "#111827", radius: 18, at: { x: 960, y: 480 },
    enter: { effect: "slide-up", duration: 0.4, easing: "easeOutCubic", params: { distance: 50 } } });
  s.rect("badge-box", { width: 130, height: 56, fill: "#f59e0b", radius: 10, at: { x: 470, y: 400 },
    enter: { effect: "scale-pop", duration: 0.35, delay: 0.25, easing: "easeOutCubic" } });
  s.text("badge", "POST", { size: 32, weight: 800, letterSpacing: 2, color: "#0a0a12", at: { x: 470, y: 400 },
    enter: { effect: "scale-pop", duration: 0.35, delay: 0.25, easing: "easeOutCubic" } });
  s.text("path", "/v1/renders", { size: 64, weight: 700, color: "#f8fafc", font: "monospace", maxWidth: 900,
    at: { x: 575, y: 400 }, align: "left", enter: { effect: "typewriter", duration: 0.6, delay: 0.35, easing: "linear" } });
  s.text("one-liner", "Compile a video definition into an MP4", { size: 34, color: "#94a3b8", align: "left",
    at: { x: 410, y: 505 }, enter: { effect: "fade", duration: 0.4, delay: 0.9 } });
});
```

Request — param rows slide in from the right (`slide-left`), 0.4s stagger:

```ts
v.scene("request", { duration: 3, background: "#0a0a12" }, (s) => {
  s.beat("rows-in", { at: 0.2, description: "Param rows start sliding" });
  s.rect("glow", { width: 900, height: 640, fill: "#22d3ee", opacity: 0.05, blur: 110, at: { x: 960, y: 540 } });
  s.text("heading", "REQUEST BODY", { size: 40, weight: 800, letterSpacing: 4, color: "#7dd3fc",
    at: { x: "50%", y: "22%" }, enter: { effect: "fade", duration: 0.4 } });
  const PARAMS = [                                        // key + "type · purpose" per row
    { key: "title", detail: "string · video title" }, { key: "scenes", detail: "Scene[] · the shot list" },
    { key: "fps", detail: "number · default 30" },
  ];
  for (const [i, p] of PARAMS.entries()) {
    const y = 340 + i * 130;                              // rows at y 340 / 470 / 600
    const ride = { effect: "slide-left", duration: 0.4, easing: "easeOutCubic", params: { distance: 120 } };
    s.rect(`row-${i + 1}`, { width: 1000, height: 96, fill: "#111827", radius: 12, at: { x: 960, y },
      enter: { ...ride, delay: 0.2 + i * 0.4 } });
    s.text(`key-${i + 1}`, p.key, { size: 40, weight: 700, color: "#f8fafc", font: "monospace",
      at: { x: 510, y }, align: "left", enter: { ...ride, delay: 0.28 + i * 0.4 } });
    s.text(`detail-${i + 1}`, p.detail, { size: 34, color: "#f59e0b", font: "monospace",
      at: { x: 730, y }, align: "left", enter: { ...ride, delay: 0.34 + i * 0.4 } });
  }
});
```

Response + summary — fields fade on one by one, then the takeaway:

```ts
v.scene("response", { duration: 3, background: "#0a0a12" }, (s) => {
  s.beat("fields-in", { at: 0.2, description: "Fields fade on one by one" });
  s.rect("glow", { width: 900, height: 640, fill: "#22c55e", opacity: 0.05, blur: 110, at: { x: 960, y: 540 } });
  const pop = { effect: "scale-pop", duration: 0.35, easing: "easeOutCubic" };
  s.rect("status-chip", { width: 190, height: 56, fill: "#22c55e", radius: 28, at: { x: 960, y: 216 }, enter: pop });
  s.text("status", "200 OK", { size: 32, weight: 800, color: "#0a0a12", at: { x: 960, y: 216 }, enter: pop });
  const FIELDS = [                                        // hot = the field to highlight
    { key: "id", value: '"vid_9f27c1"', hot: false }, { key: "status", value: '"rendering"', hot: true },
    { key: "output", value: '"renders/9f27c1.mp4"', hot: false },
  ];
  for (const [i, f] of FIELDS.entries()) {
    const y = 360 + i * 120;                              // rows at y 360 / 480 / 600
    s.text(`fkey-${i + 1}`, f.key, { size: 40, weight: 700, color: "#f8fafc", font: "monospace",
      at: { x: 640, y }, align: "left", enter: { effect: "fade", duration: 0.35, delay: 0.5 + i * 0.5 } });
    s.text(`fval-${i + 1}`, f.value, { size: 36, font: "monospace", color: f.hot ? "#22c55e" : "#94a3b8",
      at: { x: 900, y }, align: "left", enter: { effect: "fade", duration: 0.35, delay: 0.6 + i * 0.5 } });
  }
});
v.scene("summary", { duration: 2, background: "#0a0a12" }, (s) => {
  s.beat("takeaway", { at: 0.2, description: "One sentence, then still" });
  s.rect("glow", { width: 700, height: 360, fill: "#22d3ee", opacity: 0.12, blur: 120, at: { x: 960, y: 475 } });
  s.text("takeaway", "One call in,\none MP4 out.", { size: 88, weight: 800, color: "#f8fafc", lineHeight: 1.15,
    at: { x: "50%", y: "44%" }, enter: { effect: "blur-up", duration: 0.5, delay: 0.2, easing: "easeOutCubic" } });
  s.text("docs", "docs.videoos.dev", { size: 38, color: "#7dd3fc", font: "monospace", at: { x: "50%", y: "64%" }, enter: { effect: "fade", duration: 0.4, delay: 0.7 } });
});
v.transition("cut", { between: ["endpoint", "request"] });
v.transition("cut", { between: ["request", "response"] });
v.transition("cut", { between: ["response", "summary"] });
```

## QA gates

- `expect(frame(0)).not.toBeBlack()` — the card is already rising at frame 0.
- `expect(frame(33)).toContainText("/v1/renders")` — 1.1s: path typed out (0.35 + 0.6); `expect(frame(93)).toContainText("scenes")` — 3.1s: row 2 in (2 + 0.28 + 0.4 + 0.4).
- `expect(frame(150)).not.toContainText("200 OK")` — 5.0s: chip still at opacity 0; `expect(frame(162)).toContainText("200 OK")` — 5.4s, popped.
- `expect(frame(198)).toContainText("rendering")` — 6.6s: the hot field faded on (5 + 0.6 + 0.5 + 0.35); `expect(frame(261)).toContainText("One call in,")` — 8.7s: takeaway landed; `expect(frame(273)).toContainText("docs.videoos.dev")`.
- `toHaveLayers` per scene (e.g. `("card", "badge-box", "path", "one-liner")`, `("row-1", "row-2", "row-3")`); `toHaveBeat("rows-in")`, `toHaveBeat("fields-in")`; `durationBetween` endpoint 1.5–2.5 / request 2.5–3.5 / response 2.5–3.5 / summary 1.5–2.5; `noTextOverflow()` on all four.

## Anti-patterns

- Dumping the whole schema — more than 3 rows per scene and nothing gets read; the video teases, the docs explain.
- Proportional fonts on code — paths, keys, and values must be `font: "monospace"` or they stop reading as code.
- Inventing endpoint details — wrong field names propagate into users' code; source from the real spec.
- Reordering the flow (response before the endpoint card) — the request/response sequence IS the explanation.
- Cutting into a scene with no frame-0 ink — hard cuts expose black frames when every layer enters at 0.2s+; keep one enter-less glow per scene (or crossfade 0.4s instead of cuts).
