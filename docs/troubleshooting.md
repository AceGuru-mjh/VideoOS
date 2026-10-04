# Troubleshooting

> Symptom → cause → fix, ordered by how often each bites: doctor first, then ffmpeg, fonts, cache, render 409, MCP, and a bun variant note for contributors.

## First move: `videoos doctor`

```bash
videoos doctor                # in the project directory (or --project <path>)
```

Checks, in order: runtime (bun/node versions) · **ffmpeg** (path + version) · zod + `@napi-rs/canvas` availability · **current project** (opens, compiles, error count) · model providers (`VIDEOOS_PROVIDERS`). GPU is Phase 2. A failed check prints the fix inline; compile/test work without ffmpeg, render does not.

## ffmpeg not found

`videoos render` fails with `ENCODE_FFMPEG_NOT_FOUND` (the error always suggests `videoos doctor`):

| OS | Install |
| --- | --- |
| Windows | `winget install ffmpeg` (or `choco install ffmpeg`) — reopen the terminal afterwards |
| macOS | `brew install ffmpeg` |
| Linux (Debian/Ubuntu) | `sudo apt-get update && sudo apt-get install -y ffmpeg` |

If ffmpeg is installed but not on `PATH` (or you want a specific build):

```bash
# exact binary override — if set but invalid, detection fails LOUDLY (no silent fallback)
export FFMPEG_PATH=/c/tools/ffmpeg/bin/ffmpeg.exe   # Windows
export FFMPEG_PATH=/opt/homebrew/bin/ffmpeg         # macOS
```

`doctor` prints the resolved binary + version. Render smoke-check: `ffmpeg -version` in the same shell you run `videoos` from.

## Not a VideoOS project (WORKSPACE_NOT_FOUND)

`✗ <path> is not a VideoOS project (video.project.json missing)`

- `cd` into the project root before running commands, or pass `--project <path>`.
- Create one first: `videoos init <name>` (or Studio's welcome screen → Init).
- Corrupt manifest (`WORKSPACE_MANIFEST_INVALID`) — the message lists the offending field; fix the JSON or re-init.

## Font not found / wrong glyphs

Symptoms: text renders **empty** (nothing where text should be), falls back to an unexpected face, or goldens differ between machines.

1. Project fonts live in `assets/fonts/` and are auto-registered by every session surface (CLI test/render, Studio, MCP, agent). The **family name is the filename minus extension** — `Inter-Bold.ttf` → `font: "Inter-Bold"`.
2. The canvas backend does **not** resolve bare CSS generic keywords by itself. The DSL default `font: "sans-serif"` is mapped internally to concrete families (DejaVu Sans / DejaVu Sans Mono / DejaVu Serif with a Liberation/Arial fallback chain) — but a *custom* family string that isn't registered and isn't installed renders empty.
3. System fonts work by concrete family name (e.g. `font: "Arial"`) but make renders **machine-dependent**; for reproducible goldens across machines, ship the font file in `assets/fonts/`.
4. `check.missingAssets` (VAP) and `ASSET_MISSING` diagnostics cover file-level problems; glyph-level problems show up as invisible text — use `inspect.frame` or the Studio bounds overlay to confirm the text command exists with sane geometry, then fix the family.

## Cache issues

All cache state lives in `.video/cache/` (content-addressed; key = SHA-256 of virHash + backend + backendVersion + frame + size).

```bash
videoos cache stats   # entries / bytes / per-namespace breakdown
videoos cache clear   # wipe everything (re-render repopulates)
```

| Symptom | Cause | Fix |
| --- | --- | --- |
| Renders "too fast", changes not visible | stale cache after swapping render-behavior versions | `videoos cache clear` (backend behavior changes bump `BACKEND_VERSION` and invalidate keys automatically — this is for the rare manual case) |
| Disk usage creep | every distinct VIR hashes a new frame set | check `cache stats`, `cache clear`, or delete `.video/` wholesale (fully regenerable) |
| Goldens pass locally, fail on another machine | font/pixel environment differences | ship fonts in `assets/fonts/`, re-generate goldens on the canonical machine |

`.video/` is disposable by design — deleting it never loses source material.

## Render returns 409 busy (Studio API)

`POST /api/render/start` → `409` while another render is running: rendering is a **single background task per server** (one ffmpeg pipeline at a time).

- Wait for the current render (progress is in the StatusBar / Render dialog / `render.status`), or
- cancel your intent and render a **scene range** instead (`--scene <name>`), or
- if the task is stuck (process crash mid-render), restart `videoos serve` — renders are resumable via cache; re-rendering hits all cached frames.

## MCP connection issues

| Symptom | Cause | Fix |
| --- | --- | --- |
| Server exits immediately: `✗ <path> is not a VideoOS project` | `videoos mcp` needs a project context (v1 has no standalone mode) | run with `--project <path>` pointing at a `video.project.json` directory, or set the client's `cwd` to the project root |
| Client can't find `videoos` | not on PATH for the client's environment | use the absolute path to the binary in the server config (`"command": "/usr/local/bin/videoos"`) |
| Tools missing from `tools/list` | connected against a different project than expected | the banner line on stderr prints the project root; verify with `compile.vir` → `data.scenes` |
| `transaction.begin` errors with `TX_ALREADY_ACTIVE` | a previous agent crashed mid-transaction (single active transaction per project) | resolve it: `transaction.list` → find the `active` one → `transaction.rollback` (or commit if the work was good), then begin again |
| Agent edits don't show in Studio | Studio tab was dirty at edit time | Studio skips overwriting dirty editors; save/revert the tab, external changes then load |

## bun variant note (baseline vs modern)

bun ships two build flavors (`baseline` for older CPUs, `modern` for SSE4.2+). Their behavior differs around **same-process `fetch` fast paths** (e.g. a test that starts a `Bun.serve` server and then `fetch`es it from the same process can see a lightweight `Response` whose `ok`/`status` are unreliable on one flavor and fine on the other).

- **End users**: nothing to configure — CLI/Studio/server don't depend on that path.
- **Contributors writing tests for `@videoos/server`**: mock HTTP with `node:http` (real sockets), never same-process `Bun.serve` + `fetch`, or your suite will pass locally and fail on CI's flavor (this bit the repo once; CI now runs the ubuntu flavor with ffmpeg preinstalled).
- If a freshly compiled script behaves differently across machines, check `bun --revision` and whether flavors differ before suspecting your code.

## Non-reproducible renders

Same source, different pixels? In order of likelihood:

1. `Math.random()` or `Date.now()` in video code — replace with `defineVideo({ seed })` + `createRng(seed)` from `@videoos/core` (grep your `src/`).
2. Fonts resolved from the system instead of `assets/fonts/` — see [fonts](#font-not-found--wrong-glyphs).
3. Image assets with the same path but different bytes — cache keys hash the VIR, not file bytes; `videoos cache clear` after swapping an image file.
4. Expect byte-identical output only for identical (VIR, backend version, frame, size, font environment) tuples — that's the determinism contract in [SPEC §4.3](../SPEC.md).

## Common QA failure → fix table

| Failure detail | Meaning | Typical fix |
| --- | --- | --- |
| `visibleTexts: [...]` without your string | text not (yet) on screen at that frame | move the assertion frame past `in + delay + duration`, or fix the layer's window |
| `overflows: [{ measuredWidth, limit }]` | real-font width exceeds the bound | smaller `size`, shorter copy, or set `maxWidth` |
| `similarity: 0.91 < threshold 0.98` + `diff` path | golden mismatch | intended change → `videoos test --update-golden`; unintended → inspect the diff PNG |
| `missing: ["item-2"]` | layer renamed/removed | update the assertion or restore the layer |
| `darkRatio ≥ 0.98` on `not.toBeBlack` | frame really is (nearly) black | add visible chrome at t=0 or assert a later frame |

Still stuck? `videoos doctor` output + the failing `test.run` JSON report is the ideal bug report.
