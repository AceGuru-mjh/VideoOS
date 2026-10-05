// ChatPreview (S5 · v0.2 §6, issue #56): 预览 —— 右栏「预览」页签。
// 实现选择（任务书二选一，采用 a）：不复用/不触碰 IDE PreviewPanel 的全局
// 播放状态（currentFrame/playing/loop），而是按其加载模式重实现一个 compact
// 本地播放器 —— /api/frame/:n ImageBitmap LRU 缓存 + 前瞻预取 + rAF 按编译
// fps 走带 + letterbox 绘制；播放状态全部组件本地。
//
// 帧源对齐说明（v0.2 已知限制）：/api/frame/:n 服务于服务端「当前打开」的
// 项目；chat orchestrator 会在 run 开始时把打开项目切换为会话项目，因此帧
// 与会话天然对齐。若用户随后在 IDE 打开了其他项目，本面板帧与会话可能错
// 位 —— 此时显示「项目不一致」提示（探针 GET /api/project 对比）。
//
// 数据流：探针 + store.runCompile()（复用既有 action：echo 守卫防双编译，
// IDE compile 状态顺带同步）→ totalFrames/fps/场景轨道；artifact 帧（工具
// ok 且带 frame）自动 seek + 脉冲高亮；QA 失败帧可一键跳转。
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent as ReactChangeEvent, type PointerEvent as ReactPointerEvent } from "react";
import * as api from "../../api";
import { useStudio, type ActiveRun } from "../../store";
import { Button } from "../ui";
import { basename } from "../../api";
import { parseTestCounts } from "./util";
import { collectRuns, parseQaFailFrame } from "./viz-data";

const CACHE_MAX = 48;
const PREFETCH_AHEAD = 6;

/** 影响帧内容的工具（出现 ok → 刷新编译摘要/帧数） */
const FRAME_TOOLS_RE = /^(compile\.|render\.|scene\.|layer\.|audio\.set|asset\.add|storyboard\.toScenes)/;

/** Read an active-theme CSS custom property (fallback for pre-hydration draws). */
function cssToken(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v.length > 0 ? v : fallback;
}

/** 路径粗归一（尾斜杠）后比较 —— 服务端与记录都是绝对路径 */
function sameRoot(a: string, b: string): boolean {
  const norm = (p: string): string => (p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p);
  return norm(a) === norm(b);
}

/** 最近一个 artifact 帧（工具 ok 且带 frame；live 优先，回退持久化记录） */
function latestArtifactFrame(messages: readonly api.ChatMessageRecord[], liveRun: ActiveRun | null): number | null {
  const scan = (calls: ReadonlyArray<{ status: string; frame?: number }>): number | null => {
    for (let i = calls.length - 1; i >= 0; i -= 1) {
      const tc = calls[i];
      if (tc === undefined) continue;
      if (tc.status !== "start" && tc.frame !== undefined) return tc.frame;
    }
    return null;
  };
  if (liveRun !== null) {
    const f = scan(liveRun.toolCalls);
    if (f !== null) return f;
  }
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m === undefined || m.role !== "assistant" || m.toolCalls === undefined || m.toolCalls.length === 0) continue;
    const f = scan(m.toolCalls);
    if (f !== null) return f;
  }
  return null;
}

export function ChatPreview(): JSX.Element {
  // ---- store ----
  const compile = useStudio((s) => s.compile);
  const currentSession = useStudio((s) => s.currentSession);
  const currentSessionId = useStudio((s) => s.currentSessionId);
  const messages = useStudio((s) => s.messages);
  const activeRun = useStudio((s) => s.activeRun);
  const setUiMode = useStudio((s) => s.setUiMode);

  const liveRun = activeRun !== null && activeRun.sessionId === currentSessionId ? activeRun : null;

  // ---- 本地播放状态 ----
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pulse, setPulse] = useState(0);
  const frameRef = useRef(0);
  useEffect(() => {
    frameRef.current = frame;
  }, [frame]);

  // ---- 探针（服务端当前打开项目） ----
  const [probe, setProbe] = useState<"probing" | "closed" | "open">("probing");
  const [openRoot, setOpenRoot] = useState<string | null>(null);

  const doRefresh = useCallback(async () => {
    let info: api.ProjectInfo | null = null;
    try {
      info = await api.getProject();
    } catch {
      info = null; // 409 SERVER_NO_PROJECT / 网络不可达
    }
    setProbe(info === null ? "closed" : "open");
    setOpenRoot(info?.root ?? null);
    if (info !== null) {
      // 复用 store action 刷新编译摘要：compileInFlight echo 守卫 → 无双编译；
      // 编译失败（无帧）由 compileError/totalFrames 自然降级
      void useStudio.getState().runCompile();
    }
  }, []);

  // 合并去抖的刷新调度（多个触发源在窗口内合并为一次探针+编译）
  const pendingRef = useRef<number | null>(null);
  const scheduleRefresh = useCallback(
    (delayMs = 250) => {
      if (pendingRef.current !== null) window.clearTimeout(pendingRef.current);
      pendingRef.current = window.setTimeout(() => {
        pendingRef.current = null;
        void doRefresh();
      }, delayMs);
    },
    [doRefresh],
  );
  useEffect(() => {
    return () => {
      if (pendingRef.current !== null) window.clearTimeout(pendingRef.current);
    };
  }, []);

  // 触发 1：挂载 / 会话切换 → 绑定会话项目的帧
  useEffect(() => {
    setPlaying(false);
    void doRefresh();
  }, [doRefresh, currentSessionId]);

  // 触发 2：run 落库（messages 变化）且最新任务含帧相关工具 → 刷新
  const lastRunSig = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (m === undefined || m.role !== "assistant" || m.toolCalls === undefined || m.toolCalls.length === 0) continue;
      return m.toolCalls.some((tc) => FRAME_TOOLS_RE.test(tc.name)) ? `${m.id}:${m.toolCalls.length}` : null;
    }
    return null;
  }, [messages]);
  const sigRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastRunSig === null || sigRef.current === lastRunSig) return;
    sigRef.current = lastRunSig;
    scheduleRefresh();
  }, [lastRunSig, scheduleRefresh]);

  // 触发 3：live 工具 ok（编译/渲染类）→ 去抖刷新（run 中途即可见帧数）
  const liveRelevant = useMemo(() => {
    if (liveRun === null) return 0;
    return liveRun.toolCalls.filter((tc) => tc.status === "ok" && FRAME_TOOLS_RE.test(tc.name)).length;
  }, [liveRun]);
  useEffect(() => {
    if (liveRelevant === 0) return;
    scheduleRefresh(400);
  }, [liveRelevant, scheduleRefresh]);

  // ---- 派生播放参数 ----
  const vir = compile?.vir ?? null;
  const total = compile !== null && compile.ok ? Math.max(0, compile.totalFrames) : 0;
  const fps = compile?.fps ?? vir?.meta.fps ?? 30;
  const videoWidth = compile?.width ?? vir?.meta.width ?? 1920;
  const videoHeight = compile?.height ?? vir?.meta.height ?? 1080;
  const ready = probe === "open" && total > 0;
  const sessionRoot = currentSession?.projectRoot ?? null;
  const mismatch = probe === "open" && sessionRoot !== null && openRoot !== null && !sameRoot(sessionRoot, openRoot);

  // ---- 帧位图缓存 + 绘制（PreviewPanel 同款模式，compact 版） ----
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dprRef = useRef(1);
  const cacheRef = useRef(new Map<number, ImageBitmap>());
  const inFlightRef = useRef(new Set<number>());
  const drawTokenRef = useRef(0);
  const lastBitmapRef = useRef<ImageBitmap | null>(null);

  const getBitmap = useCallback(
    async (n: number): Promise<ImageBitmap> => {
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
    },
    [],
  );

  const draw = useCallback(
    (bitmap: ImageBitmap): void => {
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
      const scale = Math.min(cw / videoWidth, ch / videoHeight);
      const dw = videoWidth * scale;
      const dh = videoHeight * scale;
      ctx.drawImage(bitmap, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
    },
    [videoWidth, videoHeight],
  );

  const renderFrame = useCallback(
    async (n: number): Promise<void> => {
      if (!ready) return;
      const token = ++drawTokenRef.current;
      try {
        const bitmap = await getBitmap(n);
        if (token !== drawTokenRef.current) return;
        lastBitmapRef.current = bitmap;
        draw(bitmap);
      } catch {
        // 帧获取失败 —— 画布保留上一帧
      }
    },
    [ready, getBitmap, draw],
  );

  // canvas 尺寸 + 重绘（ready 翻转挂载 canvas 时）
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
      if (lastBitmapRef.current !== null) draw(lastBitmapRef.current);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
  }, [ready, draw]);

  // 编译摘要变化 → 失效缓存 + 钳制位置 + 重绘
  useEffect(() => {
    for (const bmp of cacheRef.current.values()) bmp.close();
    cacheRef.current.clear();
    inFlightRef.current.clear();
    lastBitmapRef.current = null;
    if (ready) {
      if (frameRef.current > total - 1) setFrame(total - 1);
      else void renderFrame(frameRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅依赖 compile 身份
  }, [compile]);

  // 帧变化 → 绘制 + 预取
  useEffect(() => {
    if (!ready) return;
    void renderFrame(frame);
    void (async () => {
      for (let i = 1; i <= PREFETCH_AHEAD; i += 1) {
        const f = frame + i;
        if (f >= total) break;
        if (cacheRef.current.has(f) || inFlightRef.current.has(f)) continue;
        inFlightRef.current.add(f);
        try {
          await getBitmap(f);
        } catch {
          // 预取失败可忽略 —— 播放时按需重试
        } finally {
          inFlightRef.current.delete(f);
        }
      }
    })();
  }, [frame, ready, total, renderFrame, getBitmap]);

  // rAF 走带（按编译 fps；到尾停止 —— compact 版无循环开关）
  useEffect(() => {
    if (!playing || !ready || fps <= 0) return;
    const anchorFrame = frameRef.current >= total - 1 ? 0 : frameRef.current;
    const anchorTime = performance.now();
    let raf = 0;
    const tick = (): void => {
      const now = performance.now();
      const frameFloat = anchorFrame + ((now - anchorTime) / 1000) * fps;
      if (frameFloat >= total) {
        setPlaying(false);
        setFrame(total - 1);
        return;
      }
      setFrame(Math.floor(frameFloat));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, ready, fps, total]);

  // 卸载清空位图
  useEffect(() => {
    return () => {
      for (const bmp of cacheRef.current.values()) bmp.close();
      cacheRef.current.clear();
    };
  }, []);

  // ---- artifact 帧自动 seek + 脉冲 ----
  const artifact = useMemo(() => latestArtifactFrame(messages, liveRun), [messages, liveRun]);
  const lastArtifactRef = useRef<number | null>(null);
  useEffect(() => {
    if (artifact === null || !ready) return;
    if (lastArtifactRef.current === artifact) return;
    lastArtifactRef.current = artifact;
    if (artifact >= 0 && artifact < total) {
      setPlaying(false); // 定格展示产物帧
      setFrame(artifact);
      setPulse((n) => n + 1);
    }
  }, [artifact, ready, total]);

  // ---- QA 失败帧（issue #56：点击 QA 失败跳到相关帧） ----
  const qaFailFrame = useMemo(() => {
    const runs = collectRuns(messages, liveRun, currentSessionId);
    for (let i = runs.length - 1; i >= 0; i -= 1) {
      const run = runs[i];
      for (let j = run.toolCalls.length - 1; j >= 0; j -= 1) {
        const tc = run.toolCalls[j];
        if (tc === undefined || !tc.name.startsWith("test.") || tc.status !== "ok") continue;
        const counts = parseTestCounts(tc.resultSummary ?? "");
        if (counts === null || counts.failed === 0) continue;
        return parseQaFailFrame(tc.resultSummary);
      }
    }
    return null;
  }, [messages, liveRun, currentSessionId]);
  const jumpToQaFrame = (): void => {
    if (qaFailFrame === null || !ready) return;
    setPlaying(false);
    setFrame(Math.max(0, Math.min(qaFailFrame, total - 1)));
    setPulse((n) => n + 1);
  };

  const step = (delta: number): void => {
    setPlaying(false);
    setFrame((f) => Math.max(0, Math.min(f + delta, total - 1)));
  };

  const onScrub = (e: ReactChangeEvent<HTMLInputElement>): void => {
    setPlaying(false);
    setFrame(Number(e.target.value));
  };

  // ---- 迷你时间线（场景块 + beat 刻度 + playhead；点击/拖动跳帧） ----
  const scenes = vir?.scenes ?? [];
  const durationSec = Math.max(compile?.durationSeconds ?? vir?.meta.duration ?? 0, 1e-6);
  const frameTime = frame / Math.max(fps, 1);
  const pct = (sec: number): string => `${Math.min(100, Math.max(0, (sec / durationSec) * 100))}%`;

  const seekFromPointer = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (total <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / Math.max(1, rect.width)));
    setPlaying(false);
    setFrame(Math.round(frac * (total - 1)));
  };
  const draggingRef = useRef(false);

  const scrubPct = total > 1 ? (frame / (total - 1)) * 100 : 0;

  // ---- 空态 ----
  let body: JSX.Element;
  if (probe === "probing") {
    body = (
      <div className="cp-stage-empty">
        <span className="spinner" aria-hidden="true" />
        <span>正在检查项目…</span>
      </div>
    );
  } else if (probe === "closed") {
    body = (
      <div className="cp-stage-empty">
        <span className="cp-empty-glyph" aria-hidden="true">
          ▶
        </span>
        <span className="cp-empty-title">尚无可预览的帧 — 让 Agent 渲染一帧试试</span>
        {sessionRoot === null ? (
          <>
            <span className="ctx-hint">本会话未绑定项目 — 在高级模式打开项目后再发任务。</span>
            <Button small onClick={() => setUiMode("ide")}>
              高级模式中打开项目
            </Button>
          </>
        ) : (
          <span className="ctx-hint">服务端当前没有打开的项目 — 发送任务后 Agent 会自动打开会话项目。</span>
        )}
      </div>
    );
  } else if (!ready) {
    body = (
      <div className="cp-stage-empty">
        <span className="cp-empty-glyph" aria-hidden="true">
          ▶
        </span>
        <span className="cp-empty-title">项目已打开，但尚无可预览的帧</span>
        <span className="ctx-hint">让 Agent 编译并渲染一帧（compile.run + render.preview）后即可播放。</span>
        {compile !== null && compile.error !== undefined ? (
          <span className="cp-compile-err" title={compile.error}>
            编译错误：{compile.error.slice(0, 90)}
          </span>
        ) : null}
      </div>
    );
  } else {
    body = (
      <>
        <div className="cp-stage" ref={containerRef}>
          <canvas ref={canvasRef} className="cp-canvas" aria-label={`视频预览 第 ${frame + 1} 帧，共 ${total} 帧`} />
        </div>
        <div className="cp-transport" role="group" aria-label="播放控制">
          <Button className="icon" small disabled={!ready} onClick={() => step(-1)} title="上一帧">
            −1
          </Button>
          {playing ? (
            <Button className="icon" small disabled={!ready} onClick={() => setPlaying(false)} title="暂停">
              ❚❚
            </Button>
          ) : (
            <Button className="icon" small disabled={!ready} onClick={() => setPlaying(true)} title="播放">
              ▶
            </Button>
          )}
          <Button className="icon" small disabled={!ready} onClick={() => step(1)} title="下一帧">
            +1
          </Button>
          <span className="cp-counter mono" aria-live="off">
            {frame + 1} / {total}
          </span>
          <span className="cp-fps mono" title="编译帧率">
            {fps} fps
          </span>
        </div>
        <div className="cp-scrub-row">
          <input
            type="range"
            className="cp-scrub"
            min={0}
            max={Math.max(0, total - 1)}
            step={1}
            value={Math.min(frame, Math.max(0, total - 1))}
            onChange={onScrub}
            disabled={!ready}
            aria-label="帧进度"
          />
          {pulse > 0 ? (
            <span className="cp-pulse" key={pulse} style={{ left: `${scrubPct}%` }} aria-hidden="true" />
          ) : null}
        </div>
        {scenes.length > 0 ? (
          <div
            className="cp-timeline"
            role="slider"
            aria-label="场景时间线"
            aria-valuemin={0}
            aria-valuemax={Math.max(0, total - 1)}
            aria-valuenow={frame}
            onPointerDown={(e) => {
              draggingRef.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              seekFromPointer(e);
            }}
            onPointerMove={(e) => {
              if (draggingRef.current) seekFromPointer(e);
            }}
            onPointerUp={(e) => {
              draggingRef.current = false;
              e.currentTarget.releasePointerCapture(e.pointerId);
            }}
            onPointerCancel={() => {
              draggingRef.current = false;
            }}
          >
            {scenes.map((scene) => {
              const active = frameTime >= scene.start && frameTime < scene.start + scene.duration;
              return (
                <div
                  key={scene.id}
                  className={`cp-scene${active ? " active" : ""}`}
                  style={{ left: pct(scene.start), width: `calc(${(scene.duration / durationSec) * 100}% - 2px)` }}
                  title={`${scene.name} — ${scene.duration.toFixed(2)}s @ ${scene.start.toFixed(2)}s（${scene.layers.length} 层 · ${scene.beats.length} 拍）`}
                >
                  <span className="cp-scene-name">{scene.name}</span>
                </div>
              );
            })}
            {scenes.flatMap((scene) =>
              scene.beats.map((beat) => (
                <span
                  key={beat.id}
                  className="cp-beat"
                  style={{ left: pct(scene.start + beat.at) }}
                  title={`${beat.name} @ ${(scene.start + beat.at).toFixed(2)}s（${scene.name}）`}
                />
              )),
            )}
            <span className="cp-playhead" style={{ left: pct(frameTime) }} />
          </div>
        ) : null}
        {qaFailFrame !== null && ready ? (
          <button type="button" className="cp-qa-jump" onClick={jumpToQaFrame} title={`QA 失败关联帧 ${qaFailFrame}`}>
            跳到失败帧（第 {qaFailFrame + 1} 帧）
          </button>
        ) : null}
      </>
    );
  }

  return (
    <div className="cp-wrap">
      {mismatch && openRoot !== null ? (
        <div className="cp-mismatch" title={`会话项目 ${sessionRoot ?? ""}；当前打开 ${openRoot}`}>
          当前打开的项目（{basename(openRoot)}）与会话不一致，预览帧可能有出入
        </div>
      ) : null}
      {body}
    </div>
  );
}
