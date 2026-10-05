// 对话流（#51）：滚动消息列表（仅当用户已接近底部时自动跟随，否则浮出
//「回到底部」钮）+ 实时运行指示（Spinner + 最近工具名）+ 可关闭错误条 +
// 底部固定的 ChatInput。
import { useEffect, useRef, useState } from "react";
import { useStudio } from "../store";
import { useI18n } from "../i18n";
import { Button, Spinner } from "../components/ui";
import { ChatInput } from "./ChatInput";
import { MessageView } from "./MessageView";
import { localizeError } from "./ui";

/** 距底阈值（px）—— 之内视为「跟随中」 */
const NEAR_BOTTOM_PX = 80;

export function ChatFlow(): JSX.Element {
  const { t } = useI18n();
  const project = useStudio((s) => s.project);
  const chatMessages = useStudio((s) => s.chatMessages);
  const chatRunning = useStudio((s) => s.chatRunning);
  const activeRunId = useStudio((s) => s.activeRunId);
  const activeTool = useStudio((s) => s.activeTool);
  const chatError = useStudio((s) => s.chatError);
  const setMode = useStudio((s) => s.setMode);
  const clearChatError = useStudio((s) => s.clearChatError);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const nearBottomRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const scrollToBottom = (behavior: ScrollBehavior = "smooth"): void => {
    const el = scrollRef.current;
    if (el !== null) el.scrollTo({ top: el.scrollHeight, behavior });
  };

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (el === null) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    nearBottomRef.current = near;
    setShowJump(!near);
  };

  // 新内容到达：仅在「跟随中」时自动滚底
  useEffect(() => {
    if (nearBottomRef.current) scrollToBottom("auto");
  }, [chatMessages]);

  // 初始 / 切换会话：重置跟随态并立即落底
  useEffect(() => {
    nearBottomRef.current = true;
    setShowJump(false);
    scrollToBottom("auto");
  }, []);

  const empty = chatMessages.length === 0;
  const lastMsg = chatMessages.length > 0 ? chatMessages[chatMessages.length - 1] : null;

  return (
    <div className="chat-center-col">
      <div className="chat-flow-wrap">
        <div className="chat-flow" ref={scrollRef} onScroll={onScroll} role="log" aria-live="polite">
          <div className="chat-flow-inner">
            {project === null ? (
              <div className="chat-hint" role="note">
                <span>{t("chat.openProjectHint")}</span>
                <Button small onClick={() => setMode("ide")} title={t("modes.ideHint")}>
                  {t("chat.openProjectAction")}
                </Button>
              </div>
            ) : null}
            {empty && project !== null ? <div className="chat-empty">{t("chat.emptyFlow")}</div> : null}
            {chatMessages.map((m) => (
              <MessageView
                key={m.id}
                message={m}
                running={
                  chatRunning &&
                  m.role === "assistant" &&
                  m.runId !== undefined &&
                  (m.runId === activeRunId || (activeRunId === null && lastMsg !== null && lastMsg.id === m.id))
                }
              />
            ))}
            {chatRunning ? (
              <div className="chat-live" role="status">
                <Spinner />
                <span>{t("chat.running")}</span>
                {activeTool !== null ? <span className="chat-live-tool">{activeTool}</span> : null}
              </div>
            ) : null}
          </div>
        </div>
        {showJump ? (
          <button type="button" className="jump-latest" onClick={() => scrollToBottom()}>
            ↓ {t("chat.jumpToLatest")}
          </button>
        ) : null}
      </div>
      {chatError !== null && chatError.length > 0 ? (
        <div className="chat-error-bar" role="alert">
          <span>{localizeError(t, chatError)}</span>
          <button type="button" className="icon-btn" title={t("chat.dismiss")} onClick={clearChatError}>
            ✕
          </button>
        </div>
      ) : null}
      <ChatInput />
    </div>
  );
}
