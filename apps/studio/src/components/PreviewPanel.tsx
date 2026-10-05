// PreviewPanel: 16:9 letterboxed canvas playback of /api/frame/:n PNGs.
// - ImageBitmap LRU cache (64) + prefetch of the next 8 frames
// - rAF play loop paced to the compiled fps, loop toggle
// - bounds debugger: /api/frame/:n/ops overlay (rect/ellipse boxes, text crosshairs)
import { useEffect, useRef } from "react";
import * as api from "../api";
import { useStudio } from "../store";
import { Button, fmtTime } from "./ui";

const CACHE_MAX = 64;
const PREFETCH_AHEAD = 8;
const OPS_CACHE_MAX = 32;

interface DrawState {
  bitmap: ImageBitmap;
  ops: api.FrameOps | null;
}

/** Read an active-theme CSS custom property (fallback for pre-hydration draws). */
function cssToken(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v.length > 0 ? v : fallback;
}

export function PreviewPanel(): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dprRef = useRef(1);
  const cacheRef = useRef(new Map<number, ImageBitmap>());
  const inFlightRef = useRef(new Set<number>());
  const opsCacheRef = useRef(new Map<number, api.FrameOps>());
  const drawTokenRef = useRef(0);
  const lastDrawRef = useRef<DrawState | null>(null);

  const compile = useStudio((s) => s.compile);
  const currentFrame = useStudio((s) => s.currentFrame);
  const playing = useStudio((s) => s.playing);
  const loop = useStudio((s) => s.loop);
  const boundsEnabled = useStudio((s) => s.boundsEnabled);
  const setPlaying = useStudio((s) => s.setPlaying);
  const seekFrame = useStudio((s) => s.seekFrame);
  const toggleLoop = useStudio((s) => s.toggleLoop);
  const toggleBounds = useStudio((s) => s.toggleBounds);

  const vir = compile?.vir ?? null;
  const totalFrames = compile?.totalFrames ?? 0;
  const fps = compile?.fps ?? vir?.meta.fps ?? 30;
  const videoWidth = compile?.width ?? vir?.meta.width ?? 1920;
  const videoHeight = compile?.height ?? vir?.meta.height ?? 1080;
  const hasVideo = compile !== null && compile.ok && totalFrames > 0;

  // ---- frame bitmap cache (LRU) ----
  const getBitmap = async (n: number): Promise<ImageBitmap> => {
    const cached = cacheRef.current.get(n);
    if (cached !== undefined) {
      cacheRef.current.delete(n);
      cacheRef.current.set(n, cached); // bump recency
      return cached;
    }
    const bmp = await api.fetchFrameBitmap(n);
    cacheRef.current.set(n, bmp);
    while (cacheRef.current.size > CACHE_MAX) {
      const oldest = cacheRef.current.keys().next().value;
      if (oldest === undefined) break;
      const b = cacheRef.current.get(oldest);
      cacheRef.current.delete(oldest);
      b?.close();
    }
    return bmp;
  };

  const getOps = async (n: number): Promise<api.FrameOps | null> => {
    const cached = opsCacheRef.current.get(n);
    if (cached !== undefined) return cached;
    try {
      const ops = await api.getFrameOps(n);
      opsCacheRef.current.set(n, ops);
      while (opsCacheRef.current.size > OPS_CACHE_MAX) {
        const oldest = opsCacheRef.current.keys().next().value;
        if (oldest === undefined) break;
        opsCacheRef.current.delete(oldest);
      }
      return ops;
    } catch {
      return null;
    }
  };

  // ---- drawing ----
  const draw = (state: DrawState): void => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (canvas === null || container === null) return;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;
    const dpr = dprRef.current;
    const cw = canvas.width / dpr;
    const ch = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = cssToken("--bg", "#0b0f16");
    ctx.fillRect(0, 0, cw, ch);
    // letterbox fit
    const scale = Math.min(cw / videoWidth, ch / videoHeight);
    const dw = videoWidth * scale;
    const dh = videoHeight * scale;
    const dx = (cw - dw) / 2;
    const dy = (ch - dh) / 2;
    ctx.drawImage(state.bitmap, dx, dy, dw, dh);

    if (state.ops === null) return;
    // bounds overlay (accent at 90%) in the same transform space — follows the
    // active theme so light themes get a readable accent instead of amber
    const overlayColor = cssToken("--accent", "#ffb224");
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = overlayColor;
    ctx.fillStyle = overlayColor;
    ctx.lineWidth = 1;
    ctx.font = "10px ui-monospace, Consolas, monospace";
    for (const cmd of state.ops.commands) {
      const label = cmd.layerId;
      if (cmd.op === "draw-rect" || cmd.op === "draw-image") {
        const x = cmd.x ?? 0;
        const y = cmd.y ?? 0;
        const w = cmd.width ?? 0;
        const h = cmd.height ?? 0;
        ctx.strokeRect(dx + x * scale, dy + y * scale, w * scale, h * scale);
        ctx.fillText(label, dx + x * scale, dy + y * scale - 3);
      } else if (cmd.op === "draw-ellipse") {
        const cx = cmd.cx ?? 0;
        const cy = cmd.cy ?? 0;
        const rx = cmd.rx ?? 0;
        const ry = cmd.ry ?? 0;
        ctx.strokeRect(dx + (cx - rx) * scale, dy + (cy - ry) * scale, rx * 2 * scale, ry * 2 * scale);
        ctx.fillText(label, dx + (cx - rx) * scale, dy + (cy - ry) * scale - 3);
      } else if (cmd.op === "draw-text") {
        // x,y is the CENTER of the text block; no width available (v1) → crosshair
        const x = cmd.x ?? 0;
        const y = cmd.y ?? 0;
        const px = dx + x * scale;
        const py = dy + y * scale;
        ctx.beginPath();
        ctx.moveTo(px - 8, py);
        ctx.lineTo(px + 8, py);
        ctx.moveTo(px, py - 8);
        ctx.lineTo(px, py + 8);
        ctx.stroke();
        const content = cmd.content ?? "";
        ctx.fillText(`${label}${content.length > 0 ? `: ${content.slice(0, 24)}` : ""}`, px + 10, py - 4);
      }
    }
    ctx.globalAlpha = 1;
  };

  // ---- render the current frame ----
  const renderFrame = async (n: number): Promise<void> => {
    if (!hasVideo) return;
    const token = ++drawTokenRef.current;
    try {
      const bitmap = await getBitmap(n);
      if (token !== drawTokenRef.current) return;
      const ops = boundsEnabled ? await getOps(n) : null;
      if (token !== drawTokenRef.current) return;
      const state: DrawState = { bitmap, ops };
      lastDrawRef.current = state;
      draw(state);
    } catch {
      // frame fetch failed — the previous frame stays on the canvas
    }
  };

  // canvas sizing + redraw on resize (canvas mounts when hasVideo flips true)
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (canvas === null || container === null) return;
    const resize = (): void => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      dprRef.current = dpr;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w <= 0 || h <= 0) return;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      if (lastDrawRef.current !== null) draw(lastDrawRef.current);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draw depends on refs only
  }, [hasVideo]);

  // new compile → invalidate every cached frame, clamp position
  useEffect(() => {
    for (const bmp of cacheRef.current.values()) bmp.close();
    cacheRef.current.clear();
    inFlightRef.current.clear();
    opsCacheRef.current.clear();
    lastDrawRef.current = null;
    if (hasVideo && useStudio.getState().currentFrame > totalFrames - 1) seekFrame(totalFrames - 1);
    if (hasVideo) void renderFrame(useStudio.getState().currentFrame);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run on compile identity only
  }, [compile]);

  // frame changed → draw (+ prefetch ahead)
  useEffect(() => {
    if (!hasVideo) return;
    void renderFrame(currentFrame);
    void (async () => {
      for (let i = 1; i <= PREFETCH_AHEAD; i++) {
        const f = currentFrame + i;
        if (f >= totalFrames) break;
        if (cacheRef.current.has(f) || inFlightRef.current.has(f)) continue;
        inFlightRef.current.add(f);
        try {
          await getBitmap(f);
        } catch {
          // prefetch failure is non-fatal — playback will retry on demand
        } finally {
          inFlightRef.current.delete(f);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- renderFrame/getBitmap are ref-stable
  }, [currentFrame, hasVideo, totalFrames]);

  // bounds toggle → redraw current frame with/without overlay
  useEffect(() => {
    if (!hasVideo) return;
    void renderFrame(useStudio.getState().currentFrame);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ref-stable helpers
  }, [boundsEnabled]);

  // play loop (rAF paced to fps)
  useEffect(() => {
    if (!playing || !hasVideo || fps <= 0) return;
    const st = useStudio.getState();
    let anchorFrame = st.currentFrame >= totalFrames - 1 ? 0 : st.currentFrame;
    let anchorTime = performance.now();
    let raf = 0;
    const tick = (): void => {
      const now = performance.now();
      const frameFloat = anchorFrame + ((now - anchorTime) / 1000) * fps;
      if (frameFloat >= totalFrames) {
        if (useStudio.getState().loop) {
          anchorFrame = 0;
          anchorTime = now;
          useStudio.getState().seekFrame(0);
        } else {
          useStudio.getState().setPlaying(false);
          useStudio.getState().seekFrame(totalFrames - 1);
          return;
        }
      } else {
        useStudio.getState().seekFrame(Math.floor(frameFloat));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, hasVideo, fps, totalFrames, loop]);

  const step = (delta: number): void => {
    setPlaying(false);
    seekFrame(useStudio.getState().currentFrame + delta);
  };

  const currentTime = currentFrame / fps;
  const totalTime = totalFrames / fps;

  return (
    <section className="preview-panel panel" aria-label="Video preview">
      <div className="preview-body" ref={containerRef}>
        {hasVideo ? (
          <canvas ref={canvasRef} className="preview-canvas" aria-label={`Video frame ${currentFrame} of ${totalFrames}`} />
        ) : (
          <div className="preview-empty">
            {compile === null ? "compile the project to see the preview" : "no frames to preview — fix compile errors first"}
          </div>
        )}
      </div>
      <div className="transport">
        <Button className="icon" small disabled={!hasVideo} onClick={() => step(-1)} title="Step back one frame">
          −1
        </Button>
        {playing ? (
          <Button className="icon" small disabled={!hasVideo} onClick={() => setPlaying(false)} title="Pause">
            ❚❚
          </Button>
        ) : (
          <Button className="icon" small disabled={!hasVideo} onClick={() => setPlaying(true)} title="Play">
            ▶
          </Button>
        )}
        <Button className="icon" small disabled={!hasVideo} onClick={() => step(1)} title="Step forward one frame">
          +1
        </Button>
        <Button className={`icon${loop ? " toggled" : ""}`} small disabled={!hasVideo} onClick={toggleLoop} title="Loop playback">
          ↻
        </Button>
        <Button className={`icon${boundsEnabled ? " toggled" : ""}`} small disabled={!hasVideo} onClick={toggleBounds} title="Toggle element bounds overlay">
          ⬚ bounds
        </Button>
        <span className="time-readout">
          {fmtTime(currentTime)} / {fmtTime(totalTime)} (frame {currentFrame}/{Math.max(0, totalFrames - 1)})
        </span>
      </div>
    </section>
  );
}
