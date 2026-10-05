// 消息渲染（#51）：user 右对齐琥珀气泡；assistant 全宽块 = markdown 正文 +
// 任务卡行 + 内联展开的卡产物 + 产物区 + 错误横幅 + 页脚元信息（usage/工具数/stopped/时间）。
import { useState } from "react";
import type * as api from "../api";
import { useI18n } from "../i18n";
import { ArtifactView } from "./ArtifactView";
import { MarkdownLite } from "./MarkdownLite";
import { TaskCardView } from "./TaskCardView";
import { Badge, fmtClock, localizeError } from "./ui";

export function MessageView({ message, running }: { message: api.SessionMessage; running: boolean }): JSX.Element {
  const { t } = useI18n();
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);

  if (message.role === "user") {
    return (
      <article className="msg msg-user">
        <div className="msg-bubble">{message.content}</div>
        <div className="msg-meta">{fmtClock(message.createdAt)}</div>
      </article>
    );
  }

  const cards = message.taskCards ?? [];
  const artifacts = message.artifacts ?? [];
  const hasBody = message.content.trim().length > 0 || cards.length > 0 || artifacts.length > 0;
  const expandedCard = cards.find((c) => c.id === expandedCardId) ?? null;
  const toolCallCount = message.toolCalls?.length ?? 0;

  return (
    <article className="msg msg-assistant">
      {running && !hasBody ? (
        <div className="msg-skeleton" aria-hidden="true">
          <span className="sk" />
          <span className="sk" />
          <span className="sk" />
        </div>
      ) : null}
      {message.content.trim().length > 0 ? (
        <div className="md-content">
          <MarkdownLite content={message.content} />
        </div>
      ) : null}
      {cards.length > 0 ? (
        <div className="task-cards">
          {cards.map((card) => (
            <TaskCardView
              key={card.id}
              card={card}
              expanded={card.id === expandedCardId}
              onToggleExpand={(c) => setExpandedCardId((cur) => (cur === c.id ? null : c.id))}
            />
          ))}
        </div>
      ) : null}
      {expandedCard !== null && (expandedCard.artifacts?.length ?? 0) > 0 ? (
        <div className="artifacts card-artifacts">
          {(expandedCard.artifacts ?? []).map((a, i) => (
            <ArtifactView key={`${expandedCard.id}-${i}`} artifact={a} />
          ))}
        </div>
      ) : null}
      {artifacts.length > 0 ? (
        <div className="artifacts">
          {artifacts.map((a, i) => (
            <ArtifactView key={`msg-art-${i}`} artifact={a} />
          ))}
        </div>
      ) : null}
      {message.error !== undefined && message.error.length > 0 ? (
        <div className="error-text" role="alert">
          {localizeError(t, message.error)}
        </div>
      ) : null}
      <div className="msg-meta">
        {message.usage !== undefined ? (
          <span>{t("chat.usage", { p: message.usage.promptTokens, c: message.usage.completionTokens })}</span>
        ) : null}
        {toolCallCount > 0 ? <span>{t("chat.toolCalls", { n: toolCallCount })}</span> : null}
        {message.stopped === true ? <Badge tone="warn">{t("chat.stopped")}</Badge> : null}
        <span>{fmtClock(message.createdAt)}</span>
      </div>
    </article>
  );
}
