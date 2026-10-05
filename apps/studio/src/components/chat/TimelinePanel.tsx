// TimelinePanel (S5 补全 · v0.2 §6): 时间线 —— 右栏第四页签。
// 规格原文（v0.2 §6）：「时间线：场景/beat 轨道，点击跳帧」。S5 首发交付了
// 预览/管线/用量三页签，本组件补齐缺失的时间线页签。
//
// 数据流：与 ChatPreview 同源 —— store.compile（VIR 场景轨道 + fps + 帧数 +
// 时长），探针 GET /api/project 判定空态；刷新触发（挂载/会话切换、run 落库
// 且含帧相关工具、live 工具 ok）复用 ChatPreview 的三触发模式，帧相关工具
// 判定共用 viz-data.FRAME_TOOLS_RE，编译刷新复用 store.runCompile()（echo
// 守卫防双编译；两页签互斥渲染，不会产生并发重复请求）。
//
// 交互：本面板不渲染帧 —— 点击标尺/场景/转场/beat 通过 onSeek 委托给预览
// 播放器（ContextPanel 持有 seekRequest，并切回「预览」页签展示目标帧）。
// 光标 = 最近一次时间线跳帧位置（预览播放器的帧状态是组件内部状态，且两
// 页签互斥挂载，无法直接读取 —— 取最近一次本面板发起的跳帧位置）。
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import * as api from "../../api";
import { basename } from "../../api";
import { useStudio } from "../../store";
import { Button } from "../ui";
import { fmtMs, FRAME_TOOLS_RE } from "./viz-data";

/** 超过该场景数时 beat 行默认折叠（点击场景名展开）；不超过则全部平铺 */
const MAX_SHOWN_SCENES = 8;

/** 路径粗归一（尾斜杠）后比较 —— 与 ChatPreview.sameRoot 相同的判定 */
function sameRoot(a: string, b: string): boolean {
  const norm = (p: string): string => (p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p);
  return norm(a) === norm(b);
}

/** 转场类型 → 中文短标签（未知类型原样显示） */
function transitionLabel(type: string): string {
  const t = type.toLowerCase();
  if (t === "cut") return "切";
  if (t === "crossfade" || t === "cross-fade" || t === "xfade") return "叠化";
  if (t === "fade" || t === "fadein" || t === "fadeout") return "淡变";
  if (t === "slide") return "滑动";
  if (t === "wipe") return "擦除";
  if (t === "zoom") return "缩放";
  return type;
}

export interface TimelinePanelProps {
  /** 最近一次跳帧位置（帧号；null = 尚未跳过）—— 渲染为光标竖线 */
  cursorFrame: number | null;
  /** 点击跳帧：由 ContextPanel 转发给 ChatPreview 并切换到「预览」页签 */
  onSeek: (frame: number) => void;
}

export function TimelinePanel({ cursorFrame, onSeek }: TimelinePanelProps): JSX.Element {
  // ---- store ----
  const compile = useStudio((s) => s.compile);
  const currentSession = useStudio((s) => s.currentSession);
  const currentSessionId = useStudio((s) => s.currentSessionId);
  const messages = useStudio((s) => s.messages);
  const activeRun = useStudio((s) => s.activeRun);
  const setUiMode = useStudio((s) => s.setUiMode);

  const liveRun = activeRun !== null && activeRun.sessionId === currentSessionId ? activeRun : null;

  // ---- beat 行展开态（> MAX_SHOWN_SCENES 时默认全部折叠） ----
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggleScene = (id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ---- 探针 + 编译刷新（与 ChatPreview 相同的机制与触发） ----
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
      // 复用 store action 刷新编译摘要：compileInFlight echo 守卫 → 无双编译
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

  // 触发 1：挂载 / 会话切换 → 绑定会话项目的时间线
  useEffect(() => {
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

  // 触发 3：live 工具 ok（编译/渲染类）→ 去抖刷新（run 中途即可见轨道变化）
  const liveRelevant = useMemo(() => {
    if (liveRun === null) return 0;
    return liveRun.toolCalls.filter((tc) => tc.status === "ok" && FRAME_TOOLS_RE.test(tc.name)).length;
  }, [liveRun]);
  useEffect(() => {
    if (liveRelevant === 0) return;
    scheduleRefresh(400);
  }, [liveRelevant, scheduleRefresh]);

  // ---- 派生数据（与 ChatPreview 同源的播放参数） ----
  const vir = compile?.vir ?? null;
  const scenes = vir?.scenes ?? [];
  const transitions = vir?.transitions ?? [];
  const total = compile !== null && compile.ok ? Math.max(0, compile.totalFrames) : 0;
  const fps = compile?.fps ?? vir?.meta.fps ?? 30;
  const durationSec = Math.max(compile?.durationSeconds ?? vir?.meta.duration ?? 0, 1e-6);
  const sessionRoot = currentSession?.projectRoot ?? null;
  const mismatch = probe === "open" && sessionRoot !== null && openRoot !== null && !sameRoot(sessionRoot, openRoot);

  const pct = (sec: number): string => `${Math.min(100, Math.max(0, (sec / durationSec) * 100))}%`;
  const frameAt = (sec: number): number => Math.max(0, Math.min(Math.round(sec * fps), Math.max(0, total - 1)));
  const many = scenes.length > MAX_SHOWN_SCENES;

  // 时间标尺刻度（自适应步长：>60s 每 10s，>20s 每 5s，否则每 1s）
  const tickStep = durationSec > 60 ? 10 : durationSec > 20 ? 5 : 1;
  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let t = 0; t <= Math.floor(durationSec); t += tickStep) out.push(t);
    return out;
  }, [durationSec, tickStep]);

  // 光标位置（秒）—— 仅在已有跳帧记录时渲染
  const cursorTime =
    cursorFrame !== null && total > 0
      ? Math.min(durationSec, Math.max(0, cursorFrame / Math.max(fps, 1)))
      : null;
  const cursorInScene = (start: number, duration: number): boolean =>
    cursorTime !== null && cursorTime >= start && cursorTime < start + duration;

  // ---- 标尺交互：点击任意位置跳帧；键盘 ←/→（Shift=±1 秒）/Home/End ----
  const seekFromPointer = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (total <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / Math.max(1, rect.width)));
    onSeek(Math.round(frac * (total - 1)));
  };
  const onRulerKey = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (total <= 0) return;
    const base = cursorFrame !== null && cursorFrame < total ? cursorFrame : 0;
    const coarse = Math.max(1, Math.round(fps)); // Shift+方向键 = ±1 秒
    let next: number | null = null;
    switch (e.key) {
      case "ArrowLeft":
        next = Math.max(0, base - (e.shiftKey ? coarse : 1));
        break;
      case "ArrowRight":
        next = Math.min(total - 1, base + (e.shiftKey ? coarse : 1));
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = total - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    onSeek(next);
  };

  // ---- 空态 / 错误态（视觉与文案对齐 ChatPreview / TaskPipeline） ----
  if (probe === "probing") {
    return (
      <div className="timeline-empty">
        <span className="spinner" aria-hidden="true" />
        <span>正在检查项目…</span>
      </div>
    );
  }
  if (probe === "closed") {
    return (
      <div className="timeline-empty">
        <span className="timeline-empty-glyph" aria-hidden="true">
          ▤
        </span>
        <span className="timeline-empty-title">暂无时间线 — 没有打开的项目</span>
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
  }
  if (compile === null) {
    return (
      <div className="timeline-empty">
        <span className="timeline-empty-glyph" aria-hidden="true">
          ▤
        </span>
        <span className="timeline-empty-title">项目已打开，但尚未编译</span>
        <span className="ctx-hint">让 Agent 编译项目（compile.run）后，此处显示场景与 beat 轨道。</span>
      </div>
    );
  }
  if (!compile.ok) {
    return (
      <div className="timeline-empty">
        <span className="timeline-empty-glyph err" aria-hidden="true">
          ▤
        </span>
        <span className="timeline-empty-title">编译失败 — 时间线不可用</span>
        {compile.error !== undefined ? (
          <span className="timeline-err" title={compile.error}>
            编译错误：{compile.error.slice(0, 90)}
          </span>
        ) : null}
        <span className="ctx-hint">修复编译错误后，时间线会随编译结果自动更新。</span>
      </div>
    );
  }
  if (total <= 0 || scenes.length === 0) {
    return (
      <div className="timeline-empty">
        <span className="timeline-empty-glyph" aria-hidden="true">
          ▤
        </span>
        <span className="timeline-empty-title">{total <= 0 ? "编译成功但没有帧" : "编译成功但 VIR 无场景"}</span>
        <span className="ctx-hint">让 Agent 添加场景（scene.* 工具）后即可查看时间线。</span>
      </div>
    );
  }

  // ---- 时间线主体 ----
  return (
    <div className="timeline-wrap">
      {mismatch && openRoot !== null ? (
        <div className="cp-mismatch" title={`会话项目 ${sessionRoot ?? ""}；当前打开 ${openRoot}`}>
          当前打开的项目（{basename(openRoot)}）与会话不一致，时间线对应当前打开的项目
        </div>
      ) : null}

      {/* 1. 统计头：时长 / 帧数 / fps / 场景 / 转场 */}
      <div className="timeline-stats" aria-label="时间线统计">
        <span className="timeline-stat">
          <span className="timeline-stat-k">总时长</span>
          <span className="timeline-stat-v mono">{fmtMs(durationSec * 1000)}</span>
        </span>
        <span className="timeline-stat">
          <span className="timeline-stat-k">帧数</span>
          <span className="timeline-stat-v mono">{total}</span>
        </span>
        <span className="timeline-stat">
          <span className="timeline-stat-k">帧率</span>
          <span className="timeline-stat-v mono">{fps} fps</span>
        </span>
        <span className="timeline-stat">
          <span className="timeline-stat-k">场景</span>
          <span className="timeline-stat-v mono">{scenes.length}</span>
        </span>
        <span className="timeline-stat">
          <span className="timeline-stat-k">转场</span>
          <span className="timeline-stat-v mono">{transitions.length}</span>
        </span>
      </div>

      <div className="timeline-tracks">
        {/* 2. 时间标尺：秒刻度自适应，点击任意位置跳帧 */}
        <div
          className="timeline-ruler"
          role="slider"
          aria-label="时间标尺，点击或方向键跳帧"
          aria-valuemin={0}
          aria-valuemax={Math.max(0, total - 1)}
          aria-valuenow={cursorFrame !== null && cursorFrame < total ? cursorFrame : 0}
          aria-valuetext={cursorTime !== null ? `${cursorTime.toFixed(1)} 秒` : undefined}
          tabIndex={0}
          onPointerDown={seekFromPointer}
          onKeyDown={onRulerKey}
        >
          {ticks.map((t, i) => (
            <span key={t} className="timeline-tick" style={{ left: pct(t) }} aria-hidden="true">
              <span className={`timeline-tick-label${i === 0 ? " first" : i === ticks.length - 1 ? " last" : ""}`}>
                {t}s
              </span>
            </span>
          ))}
        </div>

        {/* 3. 场景轨道：比例宽度色块（调色板按序号循环取主题色变体） */}
        <div className="timeline-scene-row" role="group" aria-label="场景轨道">
          {scenes.map((scene) => {
            const active = cursorInScene(scene.start, scene.duration);
            return (
              <button
                key={scene.id}
                type="button"
                className={`timeline-scene${active ? " active" : ""}`}
                style={{ flexGrow: Math.max(scene.duration, 0.05) }}
                title={`${scene.name} — ${scene.duration.toFixed(2)}s @ ${scene.start.toFixed(2)}s（${scene.layers.length} 层 · ${scene.beats.length} 拍）`}
                aria-label={`跳到场景 ${scene.name} 开头（${scene.start.toFixed(1)} 秒，第 ${frameAt(scene.start) + 1} 帧）`}
                onClick={() => onSeek(frameAt(scene.start))}
              >
                <span className="timeline-scene-name">{scene.name}</span>
                <span className="timeline-scene-dur mono">{scene.duration.toFixed(1)}s</span>
              </button>
            );
          })}
        </div>

        {/* 5. 转场标记：场景边界（进入场景的起点）处的小 ◆ + 类型标签 */}
        {transitions.length > 0 ? (
          <div className="timeline-trans-row" role="group" aria-label="转场标记">
            {transitions.map((t, i) => {
              const target = scenes.find((s) => s.name === t.between[1]);
              if (target === undefined) return null;
              const label = transitionLabel(t.type);
              return (
                <button
                  key={`${t.type}-${t.between[1]}-${i}`}
                  type="button"
                  className="timeline-trans"
                  style={{ left: pct(target.start) }}
                  title={`${label}（${t.type} ${t.duration}s）— ${t.between[0]} → ${t.between[1]} @ ${target.start.toFixed(2)}s`}
                  aria-label={`跳到转场 ${label}（${t.between[0]} → ${t.between[1]}，${target.start.toFixed(1)} 秒）`}
                  onClick={() => onSeek(frameAt(target.start))}
                >
                  <span className="timeline-trans-glyph" aria-hidden="true">
                    ◆
                  </span>
                  <span className="timeline-trans-kind">{label}</span>
                </button>
              );
            })}
          </div>
        ) : null}

        {/* 4. beat 行：每场景一行，beat 药丸定位在其时刻；点击跳帧 */}
        {scenes.map((scene) => {
          const open = !many || expanded.has(scene.id);
          return (
            <div className={`timeline-beat-row${open ? "" : " collapsed"}`} key={scene.id}>
              {many ? (
                <button
                  type="button"
                  className="timeline-beat-gutter"
                  onClick={() => toggleScene(scene.id)}
                  aria-expanded={open}
                  aria-label={`${open ? "收起" : "展开"}场景 ${scene.name} 的 beat`}
                  title={`${scene.name} — ${scene.duration.toFixed(2)}s · ${scene.beats.length} 拍`}
                >
                  <span className="timeline-beat-caret" aria-hidden="true">
                    {open ? "▾" : "▸"}
                  </span>
                  <span className="timeline-beat-gname">{scene.name}</span>
                </button>
              ) : (
                <span
                  className="timeline-beat-gutter"
                  title={`${scene.name} — ${scene.duration.toFixed(2)}s · ${scene.beats.length} 拍`}
                >
                  <span className="timeline-beat-gname">{scene.name}</span>
                </span>
              )}
              {open ? (
                <div className="timeline-beat-track">
                  {scene.beats.map((beat) => {
                    const at = scene.start + beat.at;
                    const frac = Math.min(1, Math.max(0, at / durationSec));
                    const flip = frac > 0.82; // 尾部 beat 反向锚定，避免标签溢出
                    const frame = frameAt(at);
                    return (
                      <button
                        key={beat.id}
                        type="button"
                        className={`timeline-beat${flip ? " flip" : ""}`}
                        style={flip ? { right: `${(1 - frac) * 100}%` } : { left: `${frac * 100}%` }}
                        title={`${beat.name} @ ${at.toFixed(2)}s（${scene.name}）${beat.description !== undefined ? ` — ${beat.description}` : ""}`}
                        aria-label={`跳到 beat ${beat.name}（${at.toFixed(1)} 秒，第 ${frame + 1} 帧）`}
                        onClick={() => onSeek(frame)}
                      >
                        <span className="timeline-beat-dot" aria-hidden="true" />
                        <span className="timeline-beat-name">{beat.name}</span>
                      </button>
                    );
                  })}
                  {scene.beats.length === 0 ? <span className="timeline-beat-none">无 beat</span> : null}
                </div>
              ) : null}
            </div>
          );
        })}

        {/* 6. 当前帧光标：最近一次时间线跳帧位置 */}
        {cursorTime !== null ? (
          <span className="timeline-cursor" style={{ left: pct(cursorTime) }} aria-hidden="true" />
        ) : null}
      </div>

      {many ? (
        <div className="ctx-hint">场景较多（{scenes.length} 个）— 默认折叠 beat 行，点击左侧场景名展开。</div>
      ) : (
        <div className="ctx-hint">点击标尺 / 场景 / beat 跳帧，并自动切到「预览」查看该帧。</div>
      )}
    </div>
  );
}
