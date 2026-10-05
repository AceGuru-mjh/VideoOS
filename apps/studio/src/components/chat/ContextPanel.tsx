// ContextPanel (v0.2 §3): the right column — minimal context for now:
// bound project (basename + open hint), 本会话 stats (messages, tokens from
// usages) and a mini list of recent tool calls. The full visualization panel
// arrives in S5.
import { useMemo } from "react";
import { basename } from "../../api";
import { useStudio } from "../../store";
import { useI18n } from "../../i18n";
import { Button } from "../ui";
import { fmtDuration, fmtTokens } from "./util";

export function ContextPanel(): JSX.Element {
  const { t } = useI18n();
  const currentSession = useStudio((s) => s.currentSession);
  const messages = useStudio((s) => s.messages);
  const setUiMode = useStudio((s) => s.setUiMode);

  const stats = useMemo(() => {
    let tokens = 0;
    let toolCount = 0;
    for (const m of messages) {
      if (m.usage !== undefined) tokens += m.usage.promptTokens + m.usage.completionTokens;
      if (m.toolCalls !== undefined) toolCount += m.toolCalls.length;
    }
    return { tokens, toolCount };
  }, [messages]);

  const recentTools = useMemo(() => {
    const rows: Array<{ name: string; status: string; durationMs: number; key: string }> = [];
    for (const m of messages) {
      if (m.toolCalls === undefined) continue;
      for (const tc of m.toolCalls) {
        rows.push({ name: tc.name, status: tc.status, durationMs: tc.durationMs, key: `${m.id}:${tc.name}:${rows.length}` });
      }
    }
    return rows.slice(-8).reverse();
  }, [messages]);

  return (
    <aside className="chat-context" aria-label={t("context.panelLabel")}>
      <div className="ctx-sec">
        <span className="ctx-title">{t("context.project")}</span>
        {currentSession !== null && currentSession.projectRoot !== null ? (
          <>
            <div className="ctx-row">
              <span className="ctx-k">{t("context.boundProject")}</span>
              <span className="ctx-v" title={currentSession.projectRoot}>
                {basename(currentSession.projectRoot)}
              </span>
            </div>
            <div className="ctx-hint">{t("context.switchHint")}</div>
          </>
        ) : (
          <>
            <div className="ctx-hint">{t("context.noProject")}</div>
            <Button small onClick={() => setUiMode("ide")}>
              {t("context.openProject")}
            </Button>
          </>
        )}
      </div>
      <div className="ctx-sec">
        <span className="ctx-title">{t("context.sessionStats")}</span>
        <div className="ctx-row">
          <span className="ctx-k">{t("context.messages")}</span>
          <span className="ctx-v">{t("context.msgCount", { n: messages.length })}</span>
        </div>
        <div className="ctx-row">
          <span className="ctx-k">{t("context.toolCalls")}</span>
          <span className="ctx-v">{t("context.toolCallCount", { n: stats.toolCount })}</span>
        </div>
        <div className="ctx-row">
          <span className="ctx-k">{t("context.usage")}</span>
          <span className="ctx-v">{stats.tokens > 0 ? fmtTokens(stats.tokens) : "—"}</span>
        </div>
      </div>
      <div className="ctx-sec">
        <span className="ctx-title">{t("context.recentTools")}</span>
        {recentTools.length === 0 ? (
          <div className="ctx-empty">{t("context.noTools")}</div>
        ) : (
          <div className="ctx-tools">
            {recentTools.map((tool) => (
              <div className="ctx-tool" key={tool.key}>
                <span className="ctx-tool-name">{tool.name}</span>
                <span className="ctx-tool-dur">{fmtDuration(tool.durationMs)}</span>
                <span className={`st ${tool.status}`} aria-label={tool.status}>
                  {tool.status === "ok" ? "✓" : tool.status === "error" ? "✕" : "■"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
