# DSL Reference

> Complete reference for the VideoOS DSL (`@videoos/dsl`): `defineVideo` meta, scene/layer/audio/transition/beat options, the named effect and easing libraries, position/color/animation-window semantics, fonts, and the determinism rules.

Source of truth for the types: [`packages/dsl/src/types.ts`](../packages/dsl/src/types.ts) (options), [`builder.ts`](../packages/dsl/src/builder.ts) (validation + defaults), [`effects.ts`](../packages/dsl/src/effects.ts) (effect names), [`packages/core/src/easing.ts`](../packages/core/src/easing.ts) (easings). The compiler resolves animations into per-frame commands in [`packages/compiler/src/frame-plan.ts`](../packages/compiler/src/frame-plan.ts).

## Table of contents

1. [defineVideo](#1-definevideo)
2. [Scenes](#2-scenes)
3. [Layers](#3-layers) — [common options](#31-common-layer-options) · [text](#32-text) · [rect](#33-rect) · [ellipse](#34-ellipse) · [image](#35-image)
4. [Animation windows & named effects](#4-animation-windows--named-effects)
5. [Easings](#5-easings)
6. [Camera](#6-camera)
7. [Beats](#7-beats)
8. [Transitions](#8-transitions)
9. [Audio](#9-audio)
10. [Position syntax](#10-position-syntax)
11. [Color rules](#11-color-rules)
12. [Fonts](#12-fonts)
13. [Determinism rules](#13-determinism-rules)
14. [Naming rules & derived ids](#14-naming-rules--derived-ids)
15. [Compile diagnostics](#15-compile-diagnostics)

---

## 1. defineVideo

```ts
import { defineVideo } from "@videoos/dsl";

export default defineVideo(meta, (v) => {
  v.scene("intro", { duration: 4 }, (s) => { /* layers, beats, camera */ });
  v.transition("crossfade", { duration: 0.5, between: ["intro", "outro"] });
  v.audio("bgm", "assets/audio/launch.mp3", { volume: 0.8 });
});
```

| `meta` field | Type | Default | Constraint |
| --- | --- | --- | --- |
| `title` | `string` | — (required) | non-empty |
| `width` | `number` | `1920` | positive integer |
| `height` | `number` | `1080` | positive integer |
| `fps` | `number` | `30` | positive finite |
| `background` | `string` | `"#0a0a12"` | see [color rules](#11-color-rules) |
| `seed` | `number` | `42` | finite; feeds `createRng` for seeded randomness |

The builder callback runs immediately; validation errors throw `DslError` (`DSL_*` codes) at build time — illegal names, unknown effects/easings, invalid time windows, non-adjacent transitions, etc.

## 2. Scenes

```ts
v.scene(name, { duration, background }, (s) => { ... });
```

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `duration` | `number` | — (required) | seconds, `> 0` |
| `background` | `string` | inherit `meta.background` | per-scene override |

- Scenes play **in declaration order**. `start` is derived: scene *N* starts at `prev.end`, **minus** the incoming crossfade/fade-black duration (transitions overlap).
- Total duration = last scene's `end` − first scene's `start`; `totalFrames = round(duration × fps)`.
- One `camera` per scene at most (see [§6](#6-camera)).

## 3. Layers

Layers draw in **declaration order** (painter's order — later layers on top). There is no z-index.

### 3.1 Common layer options

Every layer constructor (`s.text` / `s.rect` / `s.ellipse` / `s.image`) accepts:

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `at` | `{ x, y }` | `{ x: "50%", y: "50%" }` | position of the layer **center**; see [§10](#10-position-syntax) |
| `in` | `number` | `0` | scene-local seconds; must be `< scene.duration` |
| `out` | `number` | `scene.duration` | scene-local seconds; `> in`, `≤ scene.duration`. The layer is visible on `[in, out)` |
| `opacity` | `number` | `1` | `0–1` |
| `scale` | `number` | `1` | uniform scale (`> 0`); v1 has no separate x/y scale from the DSL |
| `rotation` | `number` | `0` | degrees, around the layer center |
| `enter` | `AnimInput` | — | entrance animation, starts at `in + delay` |
| `exit` | `AnimInput` | — | exit animation, ends at `out` |

```ts
s.text("title", "Hello", { at: { x: "50%", y: "40%" }, in: 0.2, out: 3.8, enter: { effect: "fade", duration: 0.6 } });
```

### 3.2 text

```ts
s.text(name, content, opts);
```

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `size` | `number` | `64` | px, `> 0` |
| `font` | `string` | `"sans-serif"` | family name; see [fonts](#12-fonts) |
| `weight` | `number` | `400` | CSS weight (400/700/800…) |
| `color` | `string` | `"#ffffff"` | [color rules](#11-color-rules) |
| `align` | `"left" \| "center" \| "right"` | `"center"` | line alignment inside the text block |
| `letterSpacing` | `number` | `0` | px **added after each character except the last** |
| `lineHeight` | `number` | `1.2` | multiplier of `size` |
| `maxWidth` | `number` | — | overflow-check bound; drives the `OVERFLOW_RISK` diagnostic and the `noTextOverflow()` QA assertion |

Text layout contract (SPEC 附录 A): `at` is the **bounding-box center of the whole (multi-line) block**; wrapping only happens with `maxWidth` (word-based, character-based for CJK); without `maxWidth` long text overflows and gets diagnosed. `typewriter`/`wipe` are only representable on text layers (warning `EFFECT_UNSUPPORTED` elsewhere).

### 3.3 rect

```ts
s.rect(name, { width, height, fill, radius?, blur?, ...common });
```

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `width` / `height` | `number` | — (required) | px, `> 0` |
| `fill` | `string` | — (required) | [color rules](#11-color-rules) |
| `radius` | `number` | `0` | corner radius |
| `blur` | `number` | `0` | gaussian blur px (great for glow backdrops) |

### 3.4 ellipse

```ts
s.ellipse(name, { width, height, fill, blur?, ...common });
```

`width`/`height` are the ellipse **diameter** on each axis (rendered as center + radii).

### 3.5 image

```ts
s.image(name, src, { width?, height?, radius?, blur?, ...common });
```

- `src` is a **local file path only** (http/data URLs are rejected) — relative paths resolve against the project root.
- Omitted `width`/`height` default to the canvas size (declare both to preserve aspect ratio).
- Compile-time existence is checked when `assetRoot` is provided (missing → `ASSET_MISSING` error).

## 4. Animation windows & named effects

```ts
enter: { effect, duration?, delay?, easing?, params? }
exit:  { effect, duration?, delay?, easing?, params? }
```

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `effect` | `string` | — (required) | one of the table below |
| `duration` | `number` | `0.5` | seconds, `> 0` |
| `delay` | `number` | `0` | seconds, `≥ 0` |
| `easing` | `string` | `"easeOutCubic"` | see [§5](#5-easings) |
| `params` | `Record<string, number>` | — | numeric params (e.g. `distance`, `blur`) |

**Windows** (scene-local time, from [`frame-plan.ts`](../packages/compiler/src/frame-plan.ts)):

- `enter`: progresses `p = (t − (in + delay)) / duration` clamped to `[0,1]`, so it **completes at `in + delay + duration`**.
- `exit`: ends exactly at the layer's `out`; it **starts at `out − delay − duration`** and the eased value runs `1 → 0`.

Named effects (`VIDEO_EFFECTS`, [`packages/dsl/src/effects.ts`](../packages/dsl/src/effects.ts)):

| Effect | Behavior during the animation | Params |
| --- | --- | --- |
| `fade` | opacity × e | — |
| `slide-up` | rises from below; `offsetY += (1−e)·distance` | `distance` (default `40`) |
| `slide-down` | drops from above; `offsetY −= (1−e)·distance` | `distance` (default `40`) |
| `slide-left` | travels in from the right; `offsetX += (1−e)·distance` | `distance` (default `40`) |
| `slide-right` | travels in from the left; `offsetX −= (1−e)·distance` | `distance` (default `40`) |
| `blur-up` | rises **and** defocuses; opacity × e, blur `(1−e)·blur` | `distance` (40), `blur` (12) |
| `blur-in` | focus pull; opacity × e, blur `(1−e)·blur` | `blur` (12) |
| `scale-pop` | scale × (0.6 + 0.4e), opacity ramps ×2 speed | — |
| `typewriter` | **text only** — content sliced to `ceil(len · e)` chars | — |
| `wipe` | **text only** — horizontal clip box growing left→right | — |

Notes:

- The `typewriter` slice means semantic QA (`toContainText`) sees the *partial* string mid-animation — assert the full string only after `delay + duration`.
- `fade`/`blur-*`/`scale-pop` multiply opacity; `slide-*` do not (text stays readable mid-flight).
- A `loop` animation kind exists in the internal AST but is not exposed by the DSL builder in v1 (planned: opacity sine with `params.period` / `params.phase`).

## 5. Easings

From [`packages/core/src/easing.ts`](../packages/core/src/easing.ts) — the only legal `easing` values:

`linear`, `easeInQuad`, `easeOutQuad`, `easeInOutQuad`, `easeInCubic`, `easeOutCubic`, `easeInOutCubic`, `easeOutExpo`, `easeOutBack`, `spring`, `bounce`

| Easing | Feel | Gotchas |
| --- | --- | --- |
| `linear` | constant speed; best for `typewriter` | pairs with `wipe` for mechanical reveals |
| `easeInQuad`/`easeInCubic` | slow start | rarely right for entrances |
| `easeOutQuad`/`easeOutCubic`/`easeInOutCubic` | the workhorses | `easeOutCubic` is the DSL default |
| `easeOutExpo` | very fast start, hard settle | great for bars flying up |
| `easeOutBack` | overshoots past 1, settles back | scale-pops, snappy titles |
| `spring` | damped spring simulation (480 Hz, deterministic) | can overshoot; parameterizable via `params.stiffness`/`params.damping` |
| `bounce` | ball-drop bounces at the target | never exceeds target value (safe for bar growth) |

Input is clamped to `[0,1]`; output may overshoot (`easeOutBack`, `spring`).

## 6. Camera

```ts
s.camera("push-in", { from: 1.0, to: 1.08 });   // inside one scene, at most once
```

| Type | Params | Semantics |
| --- | --- | --- |
| `static` | — | identity (default) |
| `push-in` | `from` (1), `to` (1.05) | zoom in over the whole scene, `easeOutCubic`, centered |
| `pull-out` | `from` (1.05), `to` (1) | zoom out |
| `pan` | `fromX`, `toX`, `fromY`, `toY` (all default 0) | translate, px |

Camera applies to the whole scene (all layers), around the canvas center. During a transition overlap the main (earlier) scene's camera is used.

## 7. Beats

```ts
s.beat("title-enter", { at: 0.2, description: "Main title entrance" });
```

| Option | Type | Notes |
| --- | --- | --- |
| `at` | `number` | scene-local seconds, `0 ≤ at ≤ duration` |
| `description` | `string` | optional, shown in Studio timeline tooltips |

Beats are **named semantic anchors** — QA (`toHaveBeat`), the timeline UI, and VAP tools (`render.preview { scene, beat }`) all address frames through them. Use them to mark every narrative event; a beat every 0.8–1.5s reads well.

## 8. Transitions

```ts
v.transition("crossfade", { duration: 0.5, between: ["intro", "features"] });
```

| Type | Semantics |
| --- | --- |
| `cut` | hard cut; scenes do **not** overlap |
| `crossfade` | later scene starts `duration` earlier; it fades in over the earlier scene |
| `fade-black` | later scene starts `duration` earlier; earlier scene fades to black while the later fades in |

Rules (enforced by `builder.finish()`):

- `between` must reference **adjacent** scenes (declaration order), else `DSL_NON_ADJACENT_TRANSITION`.
- One transition per pair; duplicate → `DSL_DUPLICATE_TRANSITION`.
- `duration` (default `0.5`) must be **shorter than both** scenes, else `DSL_INVALID_TRANSITION`.
- Unmatched transitions compile but warn `TRANSITION_UNMATCHED`.

During crossfade, the later scene's background materializes as a full-canvas rect (`layerId = "<sceneId>:bg"`) so it fades in over the earlier scene's content.

## 9. Audio

```ts
v.audio("bgm", "assets/audio/launch.mp3", { start: 0, volume: 0.8, fadeIn: 1, fadeOut: 2, loop: true });
```

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `start` | `number` | `0` | global seconds, `≥ 0` |
| `volume` | `number` | `1` | `0–1` |
| `fadeIn` / `fadeOut` | `number` | — | seconds |
| `loop` | `boolean` | — | |

Audio files must exist at render time (`ASSET_MISSING` error otherwise); v1's encode pipeline muxes the audio track via ffmpeg.

## 10. Position syntax

`at: { x, y }` positions the layer **center** (anchor is fixed at `0.5, 0.5` in v1):

| Value | Meaning | Example |
| --- | --- | --- |
| number | absolute px from the top-left | `{ x: 640, y: 88 }` |
| `"50%"` | percentage of canvas width/height | `{ x: "50%", y: "42%" }` |
| `"-10%"` | negative percentages allowed | off-canvas start positions |

Percentages must match `/^[+-]?(\d+\.?\*|\.\d+)%$/` — quotes required. Mixing is fine: `{ x: "50%", y: 88 }`.

## 11. Color rules

Anywhere a color is accepted (backgrounds, `fill`, text `color`):

| Format | Example | Notes |
| --- | --- | --- |
| `#rgb` | `#f00` | expanded to `#ff0000` |
| `#rrggbb` | `#0a0a12` | canonical form used in VIR |
| `#rrggbbaa` | `#6d28d980` | alpha multiplies with layer `opacity` |

Anything else throws `DSL_INVALID_COLOR` at build time. Alpha compositing is multiplicative; `isDark` (used by QA's black detection) uses Rec.601 luma < 0.5.

## 12. Fonts

1. Drop font files into `assets/fonts/` (`.ttf` / `.otf` / `.woff`).
2. The **family name = filename minus extension** — `assets/fonts/Inter-Bold.ttf` registers as family `Inter-Bold`; reference it with `font: "Inter-Bold"`.
3. Session surfaces (`videoos test/render`, Studio, MCP, agent) auto-scan and register the directory; the bare `createRenderer` API takes `options.fonts: [{ family, path }]`.
4. Default `font: "sans-serif"` maps to a concrete system family in the canvas backend (`DejaVu Sans` on Linux; `serif`→`DejaVu Serif`, `monospace`→`DejaVu Sans Mono`) with a `DejaVu/Liberation/Arial` fallback chain. **Bare generic keywords render as empty in raw @napi-rs/canvas** — always go through the DSL defaults or registered families.
5. Same VIR + same font environment → byte-identical PNGs. Changing machine fonts can change pixels (see [troubleshooting](./troubleshooting.md#font-not-found--wrong-glyphs)).

## 13. Determinism rules

Rendering is a pure function `(project, frameIndex) → Frame`:

1. **No wall clock, no `Math.random`** in video code — both break reproducibility and defeat the cache. Grep your project if renders differ between runs.
2. **Seeded randomness only**: `defineVideo({ seed: 42 })` + `import { createRng } from "@videoos/core"` (xoshiro128\*\* / splitmix32). Same seed → same sequence, forever.
3. Same DSL input → byte-identical `vir.json` (canonical JSON, sorted keys) → byte-identical PNGs → content-addressed cache hits.
4. Float arithmetic is stable within a platform; do not derive timing from runtime values (`Date.now`), only from literals and `seed`.

```ts
import { createRng } from "@videoos/core";
const rng = createRng(42);
rng.next();          // uniform [0, 1)
rng.int(10, 20);     // uniform integer, closed interval
rng.pick(["#f00", "#0f0", "#00f"]); // uniform element
```

## 14. Naming rules & derived ids

Scene / layer / beat / audio names must match `^[letter|number][letter|number|_-]*$` (Unicode letters allowed, no spaces — `DSL_INVALID_NAME` otherwise). Derived ids (stable, diff-friendly):

| Entity | id |
| --- | --- |
| scene | `scene_<name>` |
| layer | `layer_<scene>_<name>` |
| beat | `beat_<scene>_<name>` |
| audio | `audio_<name>` |
| font asset | `asset_font_<sanitized-family>` |

Layer ids are globally unique (`DSL_DUPLICATE_ID` on collision — e.g. scene `a_b` + layer `c` vs scene `a` + layer `b_c`).

## 15. Compile diagnostics

| Code | Level | Trigger |
| --- | --- | --- |
| `OVERFLOW_RISK` | warning | heuristic width (chars × size × 0.62) exceeds `maxWidth` |
| `UNUSED_ASSET` | info | registered asset never referenced |
| `DUPLICATE_ID` | error | colliding scene/layer/beat/audio/asset id |
| `INVALID_TIME_WINDOW` | error | `out ≤ in` |
| `LAYER_BEYOND_SCENE` | warning | window exceeds scene duration (clipped) |
| `ASSET_MISSING` | error | image/audio file not found (with `assetRoot`) |
| `INVALID_COLOR` / `INVALID_POSITION` | error | malformed color/position |
| `UNKNOWN_EASING` / `UNKNOWN_EFFECT` | warning | falls back to linear / ignored |
| `EFFECT_UNSUPPORTED` | warning | `typewriter`/`wipe` on non-text layers |
| `TRANSITION_UNMATCHED` / `TRANSITION_TOO_LONG` | warning / error | transition referencing nothing / longer than a scene |
| `AUDIO_OUT_OF_RANGE` | warning | audio `start` beyond total duration |
| `NO_SCENES` | error | empty video (also `DSL_EMPTY_VIDEO` at build time) |

Error diagnostics make `videoos compile` exit 1; warnings don't.
