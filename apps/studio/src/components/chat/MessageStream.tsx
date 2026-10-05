// MessageStream (v0.2 §3): the center column — persisted messages plus the
// live agent run card. User messages are right-aligned accent-tinted bubbles;
// assistant messages render a ▶ avatar, TaskCard (tool calls) and safe
// markdown. Auto-scrolls while pinned to the bottom, stops when the user
// scrolls up. Empty states: no session / load error / fresh session with
// starter prompt suggestions.
import { useEffect, useRef } from "react";
import { useStudio, type ActiveRun } from "../../store";
import { ErrorText, Spinner } from "../ui";
import { Markdown } from "./Markdown";
import { TaskCard, type TaskCardToolCall } from "./TaskCard";
import { ConfirmCards } from "./ConfirmCard";
import { STARTER_PROMPTS, deriveRunStatus, fmtRelTime, fmtTokens } from "./util";

function liveToolCalls(run: ActiveRun): TaskCardToolCall[] {
  return run.toolCalls.map((tc) => ({ ...tc }));
}

function AssistantMessage({ run }: { run: ActiveRun }): JSX.Element {
  const hasCard = run.toolCalls.length > 0 || run.status !== "running";
  return (
    <div className="msg-row assistant">
      <span className="msg-avatar" aria-hidden="true">▶</span>
      <div className="msg-assistant">
        {hasCard ? (
          <TaskCard toolCalls={liveToolCalls(run)} status={run.status} steps={run.steps} usage={run.usage} error={run.error} />
        ) : null}
        <ConfirmCards run={run} />
        {run.text.length > 0 ? (
          <Markdown text={run.text} />
        ) : run.status === "running" && !hasCard ? (
          <div className="msg-thinking">
            <Spinner /> 思考中…
          </div>
        ) : null}
        {run.text.length === 0 && run.status === "running" && hasCard ? (
          <div className="msg-thinking">
            <Spinner /> 正在执行…
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function MessageStream(): JSX.Element {
  const messages = useStudio((s) => s.messages);
  const currentSession = useStudio((s) => s.currentSession);
  const currentSessionId = useStudio((s) => s.currentSessionId);
  const sessionLoadError = useStudio((s) => s.sessionLoadError);
  const activeRun = useStudio((s) => s.activeRun);
  const sessions = useStudio((s) => s.sessions);
  const sessionsUnavailable = useStudio((s) => s.sessionsUnavailable);
  const setComposerDraft = useStudio((s) => s.setComposerDraft);
  const focusComposer = useStudio((s) => s.focusComposer);
  const pendingConfirms = useStudio((s) => s.pendingConfirms);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);

  const liveRun: ActiveRun | null = activeRun !== null && activeRun.sessionId === currentSessionId ? activeRun : null;
  const liveToolCount = liveRun !== null ? liveRun.toolCalls.length : 0;
  const liveTextLen = liveRun !== null ? liveRun.text.length : 0;
  const liveStatus = liveRun !== null ? liveRun.status : "";
  const confirmCount = pendingConfirms.length;

  useEffect(() => {
    const el = scrollRef.current;
    if (el !== null && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, liveToolCount, liveTextLen, liveStatus, confirmCount]);

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (el === null) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  const usePrompt = (p: string): void => {
    setComposerDraft(p);
    focusComposer();
  };

  const suggestions: JSX.Element = (
    <div className="suggest" aria-label="建议任务">
      {STARTER_PROMPTS.map((p) => (
        <button type="button" key={p} className="suggest-chip" onClick={() => usePrompt(p)}>
          {p}
        </button>
      ))}
    </div>
  );

  let body: JSX.Element;
  if (sessionLoadError !== null) {
    body = (
      <div className="chat-empty">
        <div className="chat-empty-card">
          <div className="chat-empty-title">
            <span className="glyph" aria-hidden="true">▶</span>会话加载失败
          </div>
          <div className="chat-empty-sub">
            <ErrorText>{sessionLoadError}</ErrorText>
          </div>
          <div className="chat-empty-sub">切换到其他对话，或新建一个对话继续。</div>
        </div>
      </div>
    );
  } else if (sessionsUnavailable && sessions.length === 0 && currentSessionId === null) {
    body = (
      <div className="chat-empty">
        <div className="chat-empty-card">
          <div className="chat-empty-title">
            <span className="glyph" aria-hidden="true">▶</span>会话服务不可用
          </div>
          <div className="chat-empty-sub">
            当前服务端尚未提供 /api/sessions（需要 v0.2 S3 及之后的服务端）。重新启动 studio 后端后再试。
          </div>
        </div>
      </div>
    );
  } else if (currentSessionId === null) {
    body = (
      <div className="chat-empty">
        <div className="chat-empty-card">
          <div className="chat-empty-title">
            <span className="glyph" aria-hidden="true">▶</span>开始你的第一段对话
          </div>
          <div className="chat-empty-sub">直接在下方输入框发消息，或从这些任务开始：</div>
          {suggestions}
        </div>
      </div>
    );
  } else if (messages.length === 0 && liveRun === null) {
    body = (
      <div className="chat-empty">
        <div className="chat-empty-card">
          <div className="chat-empty-title">
            <span className="glyph" aria-hidden="true">▶</span>{currentSession !== null ? currentSession.title : "新对话"}
          </div>
          <div className="chat-empty-sub">告诉 Agent 你想做什么 — 例如：</div>
          {suggestions}
        </div>
      </div>
    );
  } else {
    body = (
      <>
        {messages.map((m) =>
          m.role === "user" ? (
            <div className="msg-row user" key={m.id}>
              <div className="msg-user" title={fmtRelTime(m.createdAt)}>
                {m.content}
              </div>
            </div>
          ) : (
            <div className="msg-row assistant" key={m.id}>
              <span className="msg-avatar" aria-hidden="true">▶</span>
              <div className="msg-assistant">
                {m.toolCalls !== undefined && m.toolCalls.length > 0 ? (
                  <TaskCard toolCalls={m.toolCalls} status={deriveRunStatus(m.toolCalls)} />
                ) : null}
                {m.content.length > 0 ? <Markdown text={m.content} /> : null}
                <div className="msg-meta">
                  <span>{fmtRelTime(m.createdAt)}</span>
                  {m.usage !== undefined ? (
                    <span title={`prompt ${m.usage.promptTokens} + completion ${m.usage.completionTokens}`}>
                      {fmtTokens(m.usage.promptTokens + m.usage.completionTokens)}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          ),
        )}
        {liveRun !== null ? <AssistantMessage key="live-run" run={liveRun} /> : null}
      </>
    );
  }

  return (
    <div className="chat-stream" ref={scrollRef} onScroll={onScroll} role="log" aria-label="对话消息流">
      <div className="chat-stream-inner">{body}</div>
    </div>
  );
}
