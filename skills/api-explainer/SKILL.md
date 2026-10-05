---
name: api-explainer
version: 0.1.0
description: API explainer - endpoint card, then a two-column CLIENT-to-API flow: request packet crosses, response returns, 200 OK pops.
trigger: The user asks to explain, document, or demo an API, endpoint, SDK call, or interface - request/response walkthrough, parameter tour, or "how to call X" video.
---

# API Explainer

Goal: a 12-18s 1920x1080 explainer in three scenes: endpoint card (method + path + params), flow (two columns, request packet crosses left-to-right, response returns, status pops), wrap (auth + docs CTA). Paths and payloads are monospace; facts come from the user's real API docs - never invent a parameter.

## Workflow

1. Extract the contract first: method, path, purpose line, 2-4 params (name + type/enum), success response, docs URL. If the user has an OpenAPI file or docs, read them; missing fields get asked, not guessed.
2. `storyboard.plan { intent: "<API> · <method> <path> explainer", durationSeconds: 16 }` - remap shots onto the three acts below; the flow act is non-negotiable (an API video without a round trip is a poster).
3. Write `src/video.ts`: monospace for every path/param/payload (font: "monospace"), sans for labels. Remember `at` is the layer CENTER - when stacking badge + path side by side, estimate width with the renderer heuristic (chars x size x 0.62) before choosing x.
4. `compile.run` -> 0 errors; `check.overflow` (paths with long version prefixes overflow).
5. `render.preview` at every beat AND at one mid-flight frame - the packet must ride the connector line (same y), and the sequence request -> process -> response must read as causality.
6. QA gates -> `test.run` -> repair loop (<= maxRepairLoops, then `transaction.rollback`) -> `render.final`.

| Act | Window | Scene | Job | Dominant element |
| --- | --- | --- | --- | --- |
| Endpoint | 0-4.5s | `endpoint` | method + path + params | the path, monospace >= 56 |
| Flow | 4.5-11.5s | `flow` | round trip: request, process, response, 200 | the moving packet |
| Wrap | 11.5-15s | `wrap` | auth shape + docs CTA | docs URL |

## Recipes

Endpoint card - badge pops, path types in (typewriter, linear), params stagger:

```ts
v.scene("endpoint", { duration: 4.5, background: "#0a0a12" }, (s) => {
  s.beat("badge", { at: 0.2, description: "Method badge pops" });
  s.beat("path", { at: 0.5, description: "Path types itself, params stagger after" });
  s.rect("card", { width: 1400, height: 560, fill: "#12121f", radius: 16, at: { x: 960, y: 520 },
    enter: { effect: "fade", duration: 0.4 } });
  s.rect("badge", { width: 150, height: 64, fill: "#f59e0b", radius: 8, at: { x: 380, y: 390 },
    enter: { effect: "scale-pop", duration: 0.4, easing: "easeOutBack" } });
  s.text("method", "POST", { size: 34, weight: 800, color: "#0a0a12", at: { x: 380, y: 392 },
    enter: { effect: "fade", duration: 0.3, delay: 0.15 } });
  s.text("path", "/v1/videos", { size: 62, weight: 700, font: "monospace", color: "#ffffff",
    at: { x: 720, y: 392 }, enter: { effect: "typewriter", duration: 0.9, delay: 0.5, easing: "linear" } });
  s.text("purpose", "Render a video definition to MP4", { size: 40, color: "#8b8ba7", at: { x: 960, y: 480 },
    enter: { effect: "fade", duration: 0.5, delay: 1.2 } });
  const PARAMS = ["fps    ·  30 | 60", "aspect ·  16:9 | 9:16 | 1:1", "scenes ·  list of scene ids"];
  for (const [i, p] of PARAMS.entries()) {
    s.text(`param-${i}`, p, { size: 34, font: "monospace", color: "#e2e8f0", at: { x: 760, y: 580 + i * 70 },
      enter: { effect: "slide-up", duration: 0.4, delay: 1.6 + i * 0.25, params: { distance: 30 } } });
  }
});
```

Flow - two columns and the round trip. The request packet's `at` is its ARRIVAL point; `slide-right` starts it `distance` px left (at the client's edge) - so distance = server.x - client edge. The response is the mirror: `slide-left` from the server edge:

```ts
v.scene("flow", { duration: 8 }, (s) => {
  s.beat("request", { at: 0.3, description: "Request packet crosses to the API" });
  s.beat("process", { at: 1.5, description: "API processes (pulse at the server)" });
  s.beat("response", { at: 2.6, description: "Response packet returns" });
  s.beat("ok", { at: 3.8, description: "200 OK pops above the client" });
  s.rect("client-box", { width: 360, height: 360, fill: "#12121f", radius: 16, at: { x: 400, y: 560 } });
  s.text("client-label", "CLIENT", { size: 40, weight: 700, letterSpacing: 3, color: "#8b8ba7", at: { x: 400, y: 330 } });
  s.rect("server-box", { width: 360, height: 360, fill: "#12121f", radius: 16, at: { x: 1520, y: 560 } });
  s.text("server-label", "API", { size: 40, weight: 700, letterSpacing: 3, color: "#8b8ba7", at: { x: 1520, y: 330 } });
  s.rect("connector", { width: 760, height: 6, fill: "#8b8ba7", opacity: 0.5, radius: 3, at: { x: 960, y: 560 },
    enter: { effect: "wipe", duration: 0.8, delay: 0.3, easing: "easeInOutCubic" } });
  s.ellipse("packet", { width: 64, height: 64, fill: "#6d28d9", at: { x: 1340, y: 560 }, in: 0.3, out: 1.5,
    enter: { effect: "slide-right", duration: 0.8, easing: "easeInOutCubic", params: { distance: 760 } },
    exit: { effect: "fade", duration: 0.3 } });
  s.ellipse("pulse", { width: 90, height: 90, fill: "#6d28d9", opacity: 0.5, blur: 40, at: { x: 1520, y: 560 },
    in: 1.5, out: 2.5, enter: { effect: "scale-pop", duration: 0.5, easing: "easeOutBack" } });
  s.ellipse("packet-back", { width: 64, height: 64, fill: "#f59e0b", at: { x: 580, y: 560 }, in: 2.6, out: 3.8,
    enter: { effect: "slide-left", duration: 0.8, easing: "easeInOutCubic", params: { distance: 760 } },
    exit: { effect: "fade", duration: 0.3 } });
  s.rect("ok-badge", { width: 240, height: 70, fill: "#f59e0b", radius: 8, at: { x: 400, y: 300 },
    enter: { effect: "scale-pop", duration: 0.4, delay: 3.8, easing: "easeOutBack" } });
  s.text("ok", "200 OK", { size: 38, weight: 800, color: "#0a0a12", at: { x: 400, y: 302 },
    enter: { effect: "fade", duration: 0.3, delay: 3.95 } });
});
```

Wrap - auth shape in gray mono (placeholder ONLY), docs URL as CTA:

```ts
v.scene("wrap", { duration: 3.5 }, (s) => {
  s.beat("wrap", { at: 0.2, description: "Auth shape + docs CTA" });
  s.text("auth", "Authorization: Bearer <your-token>", { size: 38, font: "monospace", color: "#8b8ba7", at: { x: "50%", y: "44%" },
    enter: { effect: "fade", duration: 0.5 } });
  s.text("docs", "Full reference -> docs.example.dev/render", { size: 48, weight: 600, color: "#ffffff", at: { x: "50%", y: "58%" },
    enter: { effect: "blur-up", duration: 0.6, delay: 0.5, params: { distance: 30, blur: 10 } } });
});
v.transition("crossfade", { duration: 0.4, between: ["endpoint", "flow"] });
v.transition("crossfade", { duration: 0.4, between: ["flow", "wrap"] });
```

## QA gates

- `expect(frame(45)).toContainText("/v1/videos")` - typewriter completes at 0.5 + 0.9 = 1.4s (frame >= 42).
- `expect(scene("flow")).toHaveLayers("client-box", "server-box", "connector", "packet", "packet-back", "ok")`.
- Sequencing: `expect(frame(90)).not.toContainText("200 OK")` (flow starts at 4.1s global; the badge pops at flow-local 3.8s = 7.9s global, settling by 8.4s) and `expect(frame(300)).toContainText("200 OK")` (10.0s global).
- `expect(scene("flow")).durationBetween(6, 9)`; `noTextOverflow()` on all three scenes.
- Packet-on-line check is a preview gate: `render.preview` at flow-local 0.7s - packet y (560) must equal connector y (560).

## Anti-patterns

- Real keys or tokens on screen - placeholders only (`<your-token>`); credentials never enter a video.
- Both packets in flight at once - sequence IS the explanation: request -> process -> response -> status.
- Non-mono paths - a path in the display font reads as a tagline; monospace signals "literal string".
- A 404/500 example without labeling it as an error case - status colors carry meaning; say "error" in words if you show one.
- Inventing endpoints/params - every identifier verbatim from the user's docs, or asked for.
