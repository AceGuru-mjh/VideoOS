// TaskPipeline (S5 · v0.2 §6, issue #55): 任务管线 —— 右栏「管线」页签。
// 6 步流水线（规划→DSL→编译→预览→QA→渲染）竖排展示：pending 灰 / active
// 转圈+已用时间 / done ✓+耗时 / failed 红显错误；范围切换「本条任务」（最近
// 一次运行）/「全会话」（聚合：任一 ok 即点亮 + 运行计数）；完成后显示各
// 步耗时条。数据源 = 持久化消息 toolCalls + 实时 activeRun 事件流。
import { useEffect, useMemo, useRef, useState } from "react";
import { useStudio } from "../../store";
import {
  PIPELINE_STEPS,
  aggregateStepStates,
  collectRuns,
  deriveStepStates,
  fmtMs,
  type StepState,
} from "./viz-data";

type Scope = "latest" | "session";

/** 活跃步骤的已用时间（ms）：无时间戳事件 → 用客户端到达时间估算 */
function elapsedSince(at: number | undefined): number {
  return at === undefined ? 0 : Math.max(0, Date.now() - at);
}

function StepNode({ state }: { state: StepState }): JSX.Element {
  if (state.status === "active") return <span className="spinner pl-spin" aria-hidden="true" />;
  return (
    <span className="pl-node-glyph" aria-hidden="true">
      {state.status === "done" ? "✓" : state.status === "failed" ? "✕" : "○"}
    </span>
  );
}

function StepMeta({ state, elapsed }: { state: StepState; elapsed: number | null }): JSX.Element {
  if (state.status === "active") {
    return (
      <span className="pl-dur live" title="进行中（客户端估算）">
        {elapsed !== null && elapsed > 0 ? fmtMs(elapsed) : "…"}
      </span>
    );
  }
  if (state.status === "done") {
    return (
      <span className="pl-dur" title={state.timed ? "该步骤工具调用耗时合计" : "规划文本，无工具耗时"}>
        {state.timed ? fmtMs(state.durationMs) : "—"}
      </span>
    );
  }
  return <span className="pl-dur dim">待执行</span>;
}

function DurationBars({ states }: { states: StepState[] }): JSX.Element | null {
  const total = states.reduce((m, s) => m + s.durationMs, 0);
  if (total <= 0) return null;
  return (
    <div className="pl-bars" aria-label="各步骤耗时">
      <div className="pl-bars-title">耗时分布</div>
      {PIPELINE_STEPS.map((meta, i) => {
        const st = states[i];
        if (st === undefined) return null;
        // 占比相对总计（issue #55），最小 3% 宽保证可读
        const pct = Math.max(3, Math.round((st.durationMs / total) * 100));
        return (
          <div className="pl-bar-row" key={meta.id}>
            <span className="pl-bar-label">{meta.label}</span>
            <span className="pl-bar-track">
              <span
                className={`pl-bar-fill${st.status === "failed" ? " err" : ""}`}
                style={{ width: `${st.durationMs > 0 ? pct : 0}%` }}
              />
            </span>
            <span className="pl-bar-dur">{st.timed && st.durationMs > 0 ? fmtMs(st.durationMs) : "—"}</span>
          </div>
        );
      })}
      <div className="pl-bars-total">
        总计 <span className="mono">{fmtMs(total)}</span>
      </div>
    </div>
  );
}

export function TaskPipeline(): JSX.Element {
  const messages = useStudio((s) => s.messages);
  const activeRun = useStudio((s) => s.activeRun);
  const currentSessionId = useStudio((s) => s.currentSessionId);
  const [scope, setScope] = useState<Scope>("latest");

  const runs = useMemo(
    () => collectRuns(messages, activeRun, currentSessionId),
    [messages, activeRun, currentSessionId],
  );
  const liveRunning = activeRun !== null && activeRun.status === "running" && activeRun.sessionId === currentSessionId;

  // ---- 客户端到达时间记账（activeRun 事件不带时间戳） ----
  const runStartRef = useRef<{ runId: string; at: number } | null>(null);
  const toolStartRef = useRef<Map<string, number>>(new Map());
  const [, tick] = useState(0);

  useEffect(() => {
    if (activeRun === null || activeRun.status !== "running") return;
    if (runStartRef.current?.runId !== activeRun.runId) {
      runStartRef.current = { runId: activeRun.runId, at: Date.now() };
    }
    for (const tc of activeRun.toolCalls) {
      if (tc.status === "start" && !toolStartRef.current.has(tc.name)) {
        toolStartRef.current.set(tc.name, Date.now());
      }
    }
  }, [activeRun]);

  // 记账清理：run 结束后丢弃旧工具起点
  useEffect(() => {
    if (activeRun === null) {
      runStartRef.current = null;
      toolStartRef.current.clear();
    }
  }, [activeRun]);

  useEffect(() => {
    if (!liveRunning) return;
    const t = window.setInterval(() => tick((n) => n + 1), 500);
    return () => window.clearInterval(t);
  }, [liveRunning]);

  // ---- 步骤状态（范围切换） ----
  const derived = useMemo(() => {
    if (runs.length === 0) return null;
    if (scope === "session") {
      const agg = aggregateStepStates(runs);
      return { states: agg.steps, runCount: agg.runCount, latest: runs[runs.length - 1] ?? null, running: liveRunning };
    }
    const latest = runs[runs.length - 1];
    if (latest === undefined) return null;
    return { states: deriveStepStates(latest), runCount: 1, latest, running: latest.status === "running" };
  }, [runs, scope, liveRunning]);

  // 活跃步骤的估算已用时间（start 行 → 工具到达时间；规划思考 → run 起始）
  const elapsedFor = (i: number): number | null => {
    if (derived === null || !derived.running) return null;
    const st = derived.states[i];
    if (st === undefined || st.status !== "active") return null;
    if (derived.latest !== null) {
      const inFlight = derived.latest.toolCalls.find(
        (tc) => tc.status === "start" && toolStartRef.current.get(tc.name) !== undefined,
      );
      if (inFlight !== undefined) {
        const at = toolStartRef.current.get(inFlight.name);
        if (at !== undefined) return elapsedSince(at);
      }
    }
    const t0 = runStartRef.current;
    return t0 === null ? null : elapsedSince(t0.at);
  };

  if (derived === null) {
    return (
      <div className="pl-empty">
        <div className="pl-empty-title">尚无任务</div>
        <div className="ctx-hint">给 Agent 发送第一条消息，管线会随工具调用逐步点亮。</div>
      </div>
    );
  }

  const { states, runCount } = derived;
  const showBars = !liveRunning && states.some((s) => s.timed && s.durationMs > 0);

  return (
    <div className="pl-wrap">
      <div className="pl-scope" role="group" aria-label="统计范围">
        <button
          type="button"
          className={`pl-scope-btn${scope === "latest" ? " on" : ""}`}
          aria-pressed={scope === "latest"}
          onClick={() => setScope("latest")}
        >
          本条任务
        </button>
        <button
          type="button"
          className={`pl-scope-btn${scope === "session" ? " on" : ""}`}
          aria-pressed={scope === "session"}
          onClick={() => setScope("session")}
        >
          全会话
        </button>
        {scope === "session" ? (
          <span className="pl-scope-count" title="会话内任务次数">
            {runCount} 次
          </span>
        ) : null}
      </div>

      <ol className="pl-steps" aria-label="任务管线">
        {PIPELINE_STEPS.map((meta, i) => {
          const st = states[i];
          if (st === undefined) return null;
          return (
            <li key={meta.id} className={`pl-step ${st.status}`}>
              <span className="pl-node">
                <StepNode state={st} />
              </span>
              <span className="pl-name">
                {meta.label}
                {scope === "session" && st.calls > 0 ? <span className="pl-call-count"> · {st.calls}</span> : null}
              </span>
              <StepMeta state={st} elapsed={elapsedFor(i)} />
              {st.status === "failed" && st.errorText !== null ? (
                <div className="pl-err" title={st.errorText} role="alert">
                  {st.errorText}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      {showBars ? <DurationBars states={states} /> : null}
    </div>
  );
}
