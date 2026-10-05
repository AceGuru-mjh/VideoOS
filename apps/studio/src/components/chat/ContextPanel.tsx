// ContextPanel (v0.2 §3): the right column — minimal context for now:
// bound project (basename + open hint), 本会话 stats (messages, tokens from
// usages) and a mini list of recent tool calls. The full visualization panel
// arrives in S5.
import { useMemo } from "react";
import { basename } from "../../api";
import { useStudio } from "../../store";
import { Button } from "../ui";
import { fmtDuration, fmtTokens } from "./util";

export function ContextPanel(): JSX.Element {
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
    <aside className="chat-context" aria-label="上下文面板">
      <div className="ctx-sec">
        <span className="ctx-title">项目</span>
        {currentSession !== null && currentSession.projectRoot !== null ? (
          <>
            <div className="ctx-row">
              <span className="ctx-k">绑定项目</span>
              <span className="ctx-v" title={currentSession.projectRoot}>
                {basename(currentSession.projectRoot)}
              </span>
            </div>
            <div className="ctx-hint">Agent 执行时会自动切换到该项目的打开状态。</div>
          </>
        ) : (
          <>
            <div className="ctx-hint">本会话未绑定项目 — 发送任务前需要在高级模式中打开一个项目。</div>
            <Button small onClick={() => setUiMode("ide")}>
              高级模式中打开项目
            </Button>
          </>
        )}
      </div>
      <div className="ctx-sec">
        <span className="ctx-title">本会话</span>
        <div className="ctx-row">
          <span className="ctx-k">消息</span>
          <span className="ctx-v">{messages.length} 条</span>
        </div>
        <div className="ctx-row">
          <span className="ctx-k">工具调用</span>
          <span className="ctx-v">{stats.toolCount} 次</span>
        </div>
        <div className="ctx-row">
          <span className="ctx-k">用量</span>
          <span className="ctx-v">{stats.tokens > 0 ? fmtTokens(stats.tokens) : "—"}</span>
        </div>
      </div>
      <div className="ctx-sec">
        <span className="ctx-title">最近工具</span>
        {recentTools.length === 0 ? (
          <div className="ctx-empty">暂无工具调用</div>
        ) : (
          <div className="ctx-tools">
            {recentTools.map((t) => (
              <div className="ctx-tool" key={t.key}>
                <span className="ctx-tool-name">{t.name}</span>
                <span className="ctx-tool-dur">{fmtDuration(t.durationMs)}</span>
                <span className={`st ${t.status}`} aria-label={t.status}>
                  {t.status === "ok" ? "✓" : t.status === "error" ? "✕" : "■"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
