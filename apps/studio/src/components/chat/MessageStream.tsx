// MessageStream (v0.2 §3): the center column — persisted messages plus the
// live agent run card. User messages are right-aligned accent-tinted bubbles;
// assistant messages render a ▶ avatar, TaskCard (tool calls) and safe
// markdown. Auto-scrolls while pinned to the bottom, stops when the user
// scrolls up. Empty states: no session / load error / fresh session with
// starter prompt suggestions.
import { useEffect, useRef } from "react";
import { useStudio, type ActiveRun } from "../../store";
import { useApiErrorMessage } from "../../i18n/errors";
import { useI18n } from "../../i18n";
import { ErrorText, Spinner } from "../ui";
import { Markdown } from "./Markdown";
import { TaskCard, type TaskCardToolCall } from "./TaskCard";
import { ConfirmCards } from "./ConfirmCard";
import { deriveRunStatus, fmtRelTime, fmtTokens, starterPrompts } from "./util";

function liveToolCalls(run: ActiveRun): TaskCardToolCall[] {
  return run.toolCalls.map((tc) => ({ ...tc }));
}

function AssistantMessage({ run }: { run: ActiveRun }): JSX.Element {
  const { t } = useI18n();
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
            <Spinner /> {t("chatStream.thinking")}
          </div>
        ) : null}
        {run.text.length === 0 && run.status === "running" && hasCard ? (
          <div className="msg-thinking">
            <Spinner /> {t("chatStream.executing")}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function MessageStream(): JSX.Element {
  const { t } = useI18n();
  const errText = useApiErrorMessage();
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
    <div className="suggest" aria-label={t("chatStream.suggestAria")}>
      {starterPrompts(t).map((p) => (
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
            <span className="glyph" aria-hidden="true">▶</span>{t("chatStream.loadFailedTitle")}
          </div>
          <div className="chat-empty-sub">
            <ErrorText>{errText(sessionLoadError)}</ErrorText>
          </div>
          <div className="chat-empty-sub">{t("chatStream.loadFailedSub")}</div>
        </div>
      </div>
    );
  } else if (sessionsUnavailable && sessions.length === 0 && currentSessionId === null) {
    body = (
      <div className="chat-empty">
        <div className="chat-empty-card">
          <div className="chat-empty-title">
            <span className="glyph" aria-hidden="true">▶</span>{t("chatStream.unavailableTitle")}
          </div>
          <div className="chat-empty-sub">
            {t("chatStream.unavailableSub")}
          </div>
        </div>
      </div>
    );
  } else if (currentSessionId === null) {
    body = (
      <div className="chat-empty">
        <div className="chat-empty-card">
          <div className="chat-empty-title">
            <span className="glyph" aria-hidden="true">▶</span>{t("chatStream.firstChatTitle")}
          </div>
          <div className="chat-empty-sub">{t("chatStream.firstChatSub")}</div>
          {suggestions}
        </div>
      </div>
    );
  } else if (messages.length === 0 && liveRun === null) {
    body = (
      <div className="chat-empty">
        <div className="chat-empty-card">
          <div className="chat-empty-title">
            <span className="glyph" aria-hidden="true">▶</span>{currentSession !== null ? currentSession.title : t("chatStream.newChat")}
          </div>
          <div className="chat-empty-sub">{t("chatStream.sessionSub")}</div>
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
              <div className="msg-user" title={fmtRelTime(m.createdAt, t)}>
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
                  <span>{fmtRelTime(m.createdAt, t)}</span>
                  {m.usage !== undefined ? (
                    <span title={t("chatStream.usageTitle", { prompt: m.usage.promptTokens, completion: m.usage.completionTokens })}>
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
    <div className="chat-stream" ref={scrollRef} onScroll={onScroll} role="log" aria-label={t("chatStream.streamAria")}>
      <div className="chat-stream-inner">{body}</div>
    </div>
  );
}
