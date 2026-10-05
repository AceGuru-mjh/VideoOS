// Composer (v0.2 §3): pinned to the bottom of the center column.
// Auto-growing textarea (1–6 rows), Enter sends / Shift+Enter newline
// (IME composition safe), disabled while a run is active for this session,
// subtle char count past 500, 停止 button while running (red ghost), and 409
// error hint cards (PROVIDER_NONE → 去配置 / SESSION_NO_PROJECT → 高级模式 /
// CHAT_RUN_ACTIVE → 等待或停止).
import { useEffect, useRef, type KeyboardEvent } from "react";
import { useStudio } from "../../store";
import { Button, Spinner } from "../ui";

const MAX_HEIGHT = 150;

export function Composer(): JSX.Element {
  const draft = useStudio((s) => s.composerDraft);
  const setDraft = useStudio((s) => s.setComposerDraft);
  const sendMessage = useStudio((s) => s.sendMessage);
  const stopRun = useStudio((s) => s.stopRun);
  const chatError = useStudio((s) => s.chatError);
  const activeRun = useStudio((s) => s.activeRun);
  const currentSessionId = useStudio((s) => s.currentSessionId);
  const sending = useStudio((s) => s.sending);
  const focusToken = useStudio((s) => s.composerFocusToken);
  const setWizardActive = useStudio((s) => s.setWizardActive);
  const setUiMode = useStudio((s) => s.setUiMode);

  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);

  const runHere =
    activeRun !== null && activeRun.sessionId === currentSessionId && activeRun.status === "running";
  const runElsewhere =
    activeRun !== null && activeRun.sessionId !== currentSessionId && activeRun.status === "running";
  const busy = runHere || runElsewhere || sending;
  const canSend = draft.trim().length > 0 && !busy;

  // auto-grow 1→6 rows
  useEffect(() => {
    const el = taRef.current;
    if (el === null) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [draft]);

  // suggestion chips / external focus requests
  useEffect(() => {
    if (focusToken > 0) taRef.current?.focus();
  }, [focusToken]);

  const submit = (): void => {
    const text = draft.trim();
    if (text.length === 0 || busy) return;
    void sendMessage(text);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key !== "Enter" || e.shiftKey) return;
    // IME safety: never send from inside a composition (incl. Safari's
    // post-compositionend Enter, which carries keyCode 229)
    if (composingRef.current || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
    e.preventDefault();
    submit();
  };

  const hint = chatError ?? (runElsewhere ? { code: "CHAT_RUN_ACTIVE", message: "Agent 正在执行任务…" } : null);

  return (
    <div className="chat-composer">
      <div className="composer-inner">
        {hint !== null ? (
          <div className={`chat-err${hint.code === "CHAT_RUN_ACTIVE" ? " warn" : ""}`} role="alert">
            {hint.code === "PROVIDER_NONE" ? (
              <>
                <span>尚未配置模型 — 请先配置一个 LLM 供应商，或使用演示模式。</span>
                <Button small onClick={() => setWizardActive(true)}>
                  去配置
                </Button>
              </>
            ) : hint.code === "SESSION_NO_PROJECT" ? (
              <>
                <span>本会话未绑定项目 — 请先在高级模式中打开一个项目。</span>
                <Button small onClick={() => setUiMode("ide")}>
                  高级模式中打开项目
                </Button>
              </>
            ) : hint.code === "CHAT_RUN_ACTIVE" ? (
              <span>Agent 正在执行任务 — 等待完成或点击停止后再发新消息。</span>
            ) : (
              <span className="chat-err-mono">{hint.message}</span>
            )}
          </div>
        ) : null}
        <div className="composer-box">
          <textarea
            ref={taRef}
            value={draft}
            rows={1}
            disabled={runHere}
            placeholder={runHere ? "Agent 正在执行任务…" : "给 Agent 发消息 — Enter 发送，Shift+Enter 换行"}
            aria-label="消息输入框"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
            }}
          />
          {runHere ? (
            <button type="button" className="composer-stop" onClick={() => void stopRun()} title="停止当前任务">
              <Spinner /> 停止
            </button>
          ) : (
            <button type="button" className="composer-send" onClick={submit} disabled={!canSend} title={canSend ? "发送 (Enter)" : "输入内容后发送"}>
              {sending ? <Spinner /> : "发送"}
            </button>
          )}
        </div>
        <div className="composer-foot">
          <span>Enter 发送 · Shift+Enter 换行</span>
          {draft.length > 500 ? <span className="composer-count">{draft.length} 字</span> : null}
        </div>
      </div>
    </div>
  );
}
