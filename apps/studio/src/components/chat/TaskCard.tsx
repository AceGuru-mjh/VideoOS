// TaskCard (v0.2 §3): the agent run artifact rendered inside/above an
// assistant message — one bordered panel per run, one row per tool call,
// status chip (进行中/完成/出错/已停止), inline artifacts: preview frame
// thumbnails (click to enlarge), final videos, QA pass/fail chips.
import { useState } from "react";
import { useI18n } from "../../i18n";
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
  const { t } = useI18n();
  switch (status) {
    case "running":
      return (
        <span className="tc-chip running" role="status">
          <span className="spinner" aria-hidden="true" />
          {t("taskCard.statusRunning")}
        </span>
      );
    case "ok":
      return <Chip tone="ok">{t("taskCard.statusOk")}</Chip>;
    case "error":
      return <Chip tone="err">{t("taskCard.statusError")}</Chip>;
    case "stopped":
      return <Chip tone="default">{t("taskCard.statusStopped")}</Chip>;
  }
}

function ToolRow({ tc }: { tc: TaskCardToolCall }): JSX.Element {
  const { t } = useI18n();
  const args = argsCompact(tc.args);
  // S4: denied/failed calls carry the readable error on the live event; the
  // persisted trail only keeps resultSummary ("{"tool":…,"ok":false,"error":…}")
  // — fall back to parsing it so a finalized PERMISSION_DENIED row keeps its
  // message (server-side trail does not persist the error field yet).
  let errText = tc.error;
  if (errText === undefined && tc.status === "error" && tc.resultSummary !== undefined) {
    try {
      const parsed: unknown = JSON.parse(tc.resultSummary);
      const e = (parsed as { error?: unknown }).error;
      if (typeof e === "string" && e.length > 0) errText = e;
    } catch {
      // not a JSON summary — no fallback text
    }
  }
  return (
    <>
      <div className={`tc-row${tc.status === "error" ? " err" : ""}`} title={args.full}>
        <span className="tc-cat">{toolCategory(tc.name, t)}</span>
        <span className="tc-name">{tc.name}</span>
        <span className="tc-args">{args.short}</span>
        <span className="tc-dur">{tc.status === "start" ? "—" : fmtDuration(tc.durationMs)}</span>
        <span className={`tc-st ${tc.status === "start" ? "run" : tc.status}`} aria-label={tc.status} role="img">
          {tc.status === "start" ? <span className="spinner" /> : tc.status === "ok" ? "✓" : tc.status === "error" ? "✕" : "■"}
        </span>
      </div>
      {tc.status === "error" && errText !== undefined && errText.length > 0 ? (
        <div className="tc-err-line" title={errText}>
          {errText}
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
  const { t } = useI18n();
  const [zoom, setZoom] = useState(false);
  return (
    <div className="tc-art">
      <button type="button" className="tc-thumb-btn" onClick={() => setZoom(true)} aria-label={t("taskCard.frameZoomAria", { n: frame })}>
        <img className="tc-thumb" src={`/api/frame/${frame}`} alt={t("taskCard.frameAlt", { n: frame })} loading="lazy" />
      </button>
      {zoom ? (
        <Modal title={t("taskCard.frameModalTitle", { n: frame })} onClose={() => setZoom(false)} wide>
          <img className="frame-large" src={`/api/frame/${frame}`} alt={t("taskCard.frameModalAlt", { n: frame })} />
        </Modal>
      ) : null}
    </div>
  );
}

function TestArtifact({ name, ok, summary }: { name: string; ok: boolean; summary: string }): JSX.Element {
  const { t } = useI18n();
  const counts = parseTestCounts(summary);
  return (
    <div className="tc-art flat">
      {counts !== null ? (
        <Chip tone={ok && counts.failed === 0 ? "ok" : "err"}>{t("taskCard.qaCounts", { passed: counts.passed, failed: counts.failed })}</Chip>
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
  const { t } = useI18n();
  const done = status !== "running";
  const usageNotNull = usage ?? null;
  return (
    <section className={`task-card ${status}`} aria-label={t("taskCard.taskAria")}>
      <header className="tc-head">
        <span className="tc-title">{t("taskCard.taskTitle")}</span>
        {done && steps !== undefined && steps > 0 ? <span className="tc-steps">{t("taskCard.stepsCount", { n: steps })}</span> : null}
        {usageNotNull !== null ? (
          <span className="tc-tokens" title={t("chatStream.usageTitle", { prompt: usageNotNull.promptTokens, completion: usageNotNull.completionTokens })}>
            {fmtTokens(usageNotNull.promptTokens + usageNotNull.completionTokens)}
          </span>
        ) : null}
        <span className="tc-head-right">
          <StatusChip status={status} />
        </span>
      </header>
      <div className="tc-rows">
        {toolCalls.length === 0 ? (
          <div className="tc-row empty">{t("taskCard.waitingTools")}</div>
        ) : (
          toolCalls.map((tc, i) => <ToolRow key={i} tc={tc} />)
        )}
      </div>
      {status === "error" && error !== null && error !== undefined && error.length > 0 ? (
        <div className="tc-err-line card" role="alert">
          {error}
        </div>
      ) : null}
      {status === "stopped" ? <div className="tc-stopped-line">{t("taskCard.stoppedNote")}</div> : null}
    </section>
  );
}
