// ConfirmCard (v0.2 §6 issue #54): in-chat permission confirm card rendered
// under the live TaskCard. On the WS agent-confirm event the gate suspends the
// tool call — this card surfaces it with the tool name, pretty-printed args
// (mono, ≤200px scroll), a 120s countdown bar and three actions: 允许本次 /
// 总是允许 (persists an allow override server-side) / 拒绝 → POST
// /api/agent/resolve. The agent-resolved broadcast (or the 120s server
// timeout, which resolves deny) finalizes the card; multiple confirms queue
// vertically.
import { useEffect, useState } from "react";
import { useStudio, type ActiveRun, type PendingConfirm } from "../../store";
import { CONFIRM_TIMEOUT_MS } from "../../agent-permissions";
import { Button, Spinner } from "../ui";

/** ticking clock while any relevant card is still pending */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [active]);
  return now;
}

function prettyArgs(args: unknown): string {
  try {
    return JSON.stringify(args ?? {}, null, 2) ?? "{}";
  } catch {
    return String(args);
  }
}

function ConfirmCardView({ confirm, now }: { confirm: PendingConfirm; now: number }): JSX.Element {
  const resolveConfirm = useStudio((s) => s.resolveConfirm);
  const pending = confirm.status === "pending";
  const remaining = Math.max(0, CONFIRM_TIMEOUT_MS - (now - confirm.createdAt));
  const expired = pending && remaining <= 0;

  let statusLine: JSX.Element;
  if (pending) {
    statusLine = (
      <span className="cf-status run" role="status">
        <Spinner /> 等待确认
      </span>
    );
  } else if (confirm.stale === true) {
    statusLine = <span className="cf-status dim">已失效</span>;
  } else if (confirm.decision === "allow") {
    statusLine = <span className="cf-status ok">已允许 ✓</span>;
  } else if (confirm.decision === "always") {
    statusLine = <span className="cf-status ok">总是允许 ✓</span>;
  } else if (confirm.timeout === true) {
    statusLine = <span className="cf-status dim">超时已拒绝</span>;
  } else {
    statusLine = <span className="cf-status dim">已拒绝</span>;
  }

  const pct = pending ? Math.max(0, Math.min(100, (remaining / CONFIRM_TIMEOUT_MS) * 100)) : 0;

  return (
    <section
      className={`confirm-card${pending ? "" : " done"}${!pending && (confirm.decision === "allow" || confirm.decision === "always") ? " ok" : ""}`}
      aria-label="权限确认"
    >
      <header className="cf-head">
        <span className="cf-title">Agent 请求执行工具</span>
        {statusLine}
      </header>
      <div className="cf-tool">
        <span className="cf-tool-name">{confirm.tool.name}</span>
        <pre className="cf-args" aria-label="工具参数">{prettyArgs(confirm.tool.args)}</pre>
      </div>
      {pending ? (
        <>
          <div
            className="cf-bar"
            role="progressbar"
            aria-label="确认倒计时"
            aria-valuenow={Math.ceil(remaining / 1000)}
            aria-valuemin={0}
            aria-valuemax={Math.round(CONFIRM_TIMEOUT_MS / 1000)}
          >
            <div className="cf-bar-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="cf-count">{expired ? "已超时 — 等待服务端结算…" : `${Math.ceil(remaining / 1000)}s 后自动拒绝`}</div>
          <div className="cf-actions">
            <Button ghost small disabled={expired} onClick={() => void resolveConfirm(confirm.confirmId, "allow")}>
              允许本次
            </Button>
            <Button variant="primary" small disabled={expired} onClick={() => void resolveConfirm(confirm.confirmId, "always")}>
              总是允许
            </Button>
            <Button className="danger" small disabled={expired} onClick={() => void resolveConfirm(confirm.confirmId, "deny")}>
              拒绝
            </Button>
          </div>
        </>
      ) : null}
    </section>
  );
}

/** All confirm cards of the live run (rendered under its TaskCard). */
export function ConfirmCards({ run }: { run: ActiveRun }): JSX.Element {
  const confirms = useStudio((s) => s.pendingConfirms);
  const list = confirms.filter((c) => c.runId === run.runId && c.sessionId === run.sessionId);
  const anyPending = list.some((c) => c.status === "pending");
  const now = useNow(anyPending);
  if (list.length === 0) return <></>;
  return (
    <div className="confirm-stack">
      {list.map((c) => (
        <ConfirmCardView key={c.confirmId} confirm={c} now={now} />
      ))}
    </div>
  );
}
