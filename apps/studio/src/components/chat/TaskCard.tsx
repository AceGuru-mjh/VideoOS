// TaskCard (v0.2 §3): the agent run artifact rendered inside/above an
// assistant message — one bordered panel per run, one row per tool call,
// status chip (进行中/完成/出错/已停止), inline artifacts: preview frame
// thumbnails (click to enlarge), final videos, QA pass/fail chips.
import { useState } from "react";
import { Modal, Chip } from "../ui";
import { argsCompact, fmtDuration, fmtTokens, parseTestCounts, toolCategory } from "./util";

export type TaskCardStatus = "running" | "ok" | "error" | "stopped";

export interface TaskCardToolCall {
  name: string;
  args: unknown;
  /** "start" only appears on live rows before the ok/error event lands */
  status: "start" | "ok" | "error" | "stopped";
  durationMs: number;
  resultSummary?: string;
  frame?: number;
  videoUrl?: string;
  error?: string;
}

function StatusChip({ status }: { status: TaskCardStatus }): JSX.Element {
  switch (status) {
    case "running":
      return (
        <span className="tc-chip running" role="status">
          <span className="spinner" aria-hidden="true" />
          进行中
        </span>
      );
    case "ok":
      return <Chip tone="ok">完成</Chip>;
    case "error":
      return <Chip tone="err">出错</Chip>;
    case "stopped":
      return <Chip tone="default">已停止</Chip>;
  }
}

function ToolRow({ tc }: { tc: TaskCardToolCall }): JSX.Element {
  const args = argsCompact(tc.args);
  return (
    <>
      <div className={`tc-row${tc.status === "error" ? " err" : ""}`} title={args.full}>
        <span className="tc-cat">{toolCategory(tc.name)}</span>
        <span className="tc-name">{tc.name}</span>
        <span className="tc-args">{args.short}</span>
        <span className="tc-dur">{tc.status === "start" ? "—" : fmtDuration(tc.durationMs)}</span>
        <span className={`tc-st ${tc.status === "start" ? "run" : tc.status}`} aria-label={tc.status} role="img">
          {tc.status === "start" ? <span className="spinner" /> : tc.status === "ok" ? "✓" : tc.status === "error" ? "✕" : "■"}
        </span>
      </div>
      {tc.status === "error" && tc.error !== undefined && tc.error.length > 0 ? (
        <div className="tc-err-line" title={tc.error}>
          {tc.error}
        </div>
      ) : null}
      {tc.status !== "start" && tc.frame !== undefined ? <FrameArtifact frame={tc.frame} /> : null}
      {tc.status !== "start" && tc.videoUrl !== undefined && tc.videoUrl.length > 0 ? (
        <video className="tc-video" controls preload="metadata" src={tc.videoUrl} />
      ) : null}
      {tc.status !== "start" && tc.name.startsWith("test.") && tc.resultSummary !== undefined && tc.resultSummary.length > 0 ? (
        <TestArtifact name={tc.name} ok={tc.status === "ok"} summary={tc.resultSummary} />
      ) : null}
    </>
  );
}

function FrameArtifact({ frame }: { frame: number }): JSX.Element {
  const [zoom, setZoom] = useState(false);
  return (
    <div className="tc-art">
      <button type="button" className="tc-thumb-btn" onClick={() => setZoom(true)} aria-label={`查看第 ${frame} 帧大图`}>
        <img className="tc-thumb" src={`/api/frame/${frame}`} alt={`预览帧 ${frame}`} loading="lazy" />
      </button>
      {zoom ? (
        <Modal title={`预览帧 ${frame}`} onClose={() => setZoom(false)} wide>
          <img className="frame-large" src={`/api/frame/${frame}`} alt={`预览帧 ${frame}（大图）`} />
        </Modal>
      ) : null}
    </div>
  );
}

function TestArtifact({ name, ok, summary }: { name: string; ok: boolean; summary: string }): JSX.Element {
  const counts = parseTestCounts(summary);
  return (
    <div className="tc-art flat">
      {counts !== null ? (
        <Chip tone={ok && counts.failed === 0 ? "ok" : "err"}>{`通过 ${counts.passed} / 失败 ${counts.failed}`}</Chip>
      ) : null}
      <span className="tc-test" title={summary}>
        {name}: {summary}
      </span>
    </div>
  );
}

export function TaskCard({
  toolCalls,
  status,
  steps,
  usage,
  error,
}: {
  toolCalls: TaskCardToolCall[];
  status: TaskCardStatus;
  steps?: number;
  usage?: { promptTokens: number; completionTokens: number } | null;
  error?: string | null;
}): JSX.Element {
  const done = status !== "running";
  const usageNotNull = usage ?? null;
  return (
    <section className={`task-card ${status}`} aria-label="任务执行">
      <header className="tc-head">
        <span className="tc-title">任务执行</span>
        {done && steps !== undefined && steps > 0 ? <span className="tc-steps">{steps} 步</span> : null}
        {usageNotNull !== null ? (
          <span className="tc-tokens" title={`prompt ${usageNotNull.promptTokens} + completion ${usageNotNull.completionTokens}`}>
            {fmtTokens(usageNotNull.promptTokens + usageNotNull.completionTokens)}
          </span>
        ) : null}
        <span className="tc-head-right">
          <StatusChip status={status} />
        </span>
      </header>
      <div className="tc-rows">
        {toolCalls.length === 0 ? (
          <div className="tc-row empty">等待工具调用…</div>
        ) : (
          toolCalls.map((tc, i) => <ToolRow key={i} tc={tc} />)
        )}
      </div>
      {status === "error" && error !== null && error !== undefined && error.length > 0 ? (
        <div className="tc-err-line card" role="alert">
          {error}
        </div>
      ) : null}
      {status === "stopped" ? <div className="tc-stopped-line">任务已停止 — 已完成的步骤已保留。</div> : null}
    </section>
  );
}
