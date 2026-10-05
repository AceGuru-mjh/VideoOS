// AgentPanel: chat exec (long-running), live VAP audit log (tool-call /
// tool-result via WS), provider hint, direct tool invoker (/api/tools).
// Rendered in the right column and inside the bottom dock — state lives in
// the store so both views stay in sync.
import { useEffect, useRef, useState } from "react";
import * as api from "../api";
import { useStudio } from "../store";
import { useApiErrorMessage } from "../i18n/errors";
import { useI18n } from "../i18n";
import { Button, Chip, Spinner } from "./ui";

function VapRow({ e }: { e: api.VapEvent }): JSX.Element {
  const errText = useApiErrorMessage();
  if (e.kind === "tool-call") {
    let args = "";
    const detail = e.detail;
    if (detail !== null && typeof detail === "object" && "args" in (detail as Record<string, unknown>)) {
      args = JSON.stringify((detail as { args: unknown }).args) ?? "";
    }
    return (
      <div className="vap-row call" title={args}>
        → {e.tool ?? "?"} <span style={{ color: "var(--faint)" }}>{args.length > 90 ? `${args.slice(0, 90)}…` : args}</span>
      </div>
    );
  }
  if (e.kind === "tool-result") {
    const detail = e.detail;
    const ok = detail !== null && typeof detail === "object" && (detail as { ok?: unknown }).ok === true;
    const errorText = !ok && detail !== null && typeof detail === "object" && typeof (detail as { error?: unknown }).error === "string"
      ? (detail as { error: string }).error
      : "";
    const shownError = errorText.length > 0 ? (errText(errorText) ?? "") : "";
    return (
      <div className={`vap-row ${ok ? "ok" : "err"}`} title={shownError}>
        {ok ? "✓" : "✗"} {e.tool ?? "?"}
        {!ok && shownError.length > 0 ? <span style={{ color: "var(--err)" }}> — {shownError.slice(0, 80)}</span> : null}
      </div>
    );
  }
  return <div className="vap-row">{e.kind}{e.tool !== undefined ? ` · ${e.tool}` : ""}</div>;
}

export function AgentPanel({ dockMode = false }: { dockMode?: boolean }): JSX.Element {
  const { t } = useI18n();
  const errText = useApiErrorMessage();
  const [prompt, setPrompt] = useState("");
  const [toolName, setToolName] = useState("");
  const [toolArgs, setToolArgs] = useState("{}");
  const logRef = useRef<HTMLDivElement | null>(null);

  const agentConfig = useStudio((s) => s.agentConfig);
  const agentMessages = useStudio((s) => s.agentMessages);
  const agentRunning = useStudio((s) => s.agentRunning);
  const vapLog = useStudio((s) => s.vapLog);
  const tools = useStudio((s) => s.tools);
  const toolsOpen = useStudio((s) => s.toolsOpen);
  const toolResult = useStudio((s) => s.toolResult);
  const toolError = useStudio((s) => s.toolError);
  const project = useStudio((s) => s.project);
  const execAgent = useStudio((s) => s.execAgent);
  const loadTools = useStudio((s) => s.loadTools);
  const setToolsOpen = useStudio((s) => s.setToolsOpen);
  const invokeTool = useStudio((s) => s.invokeTool);

  useEffect(() => {
    if (tools === null) void loadTools();
  }, [tools, loadTools]);

  useEffect(() => {
    const el = logRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [vapLog]);

  const submit = (): void => {
    const text = prompt.trim();
    if (text.length === 0 || agentRunning) return;
    setPrompt("");
    void execAgent(text);
  };

  const configured = agentConfig?.configured === true;

  return (
    <section className={`agent-panel panel${dockMode ? " dock-mode" : ""}`} aria-label={t("agent.aria")}>
      {agentConfig !== null && !configured ? (
        <div className="agent-hint">
          {t("agent.hintStart")}
          <code>VIDEOOS_PROVIDERS</code>
          {t("agent.hintMid")}
          <code>VIDEOOS_PROVIDER_&lt;ID&gt;_KEY</code>
          {t("agent.hintEnd")}
        </div>
      ) : null}

      <div className="agent-messages">
        {agentMessages.length === 0 ? (
          <div className="empty-note">{configured ? t("agent.emptyReady") : t("agent.emptyNoProvider")}</div>
        ) : (
          agentMessages.map((m) => (
            <div key={m.id} className={`agent-msg ${m.role}${m.error === true ? " error" : ""}`}>
              {m.text}
              {m.toolCallCount !== undefined ? <span className="meta">{t("agent.toolCalls", { n: m.toolCallCount })}</span> : null}
            </div>
          ))
        )}
        {agentRunning ? <Spinner label={t("agent.working")} /> : null}
      </div>

      <div className="agent-input-row">
        <input
          value={prompt}
          placeholder={configured ? t("agent.placeholder") : t("agent.placeholderDisabled")}
          disabled={!configured || agentRunning}
          spellCheck={false}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
        <Button variant="primary" disabled={!configured || agentRunning || project === null} onClick={submit}>
          {agentRunning ? t("agent.running") : t("agent.run")}
        </Button>
      </div>

      <div className="vap-log" ref={logRef} role="log" aria-label={t("agent.vapAria")}>
        {vapLog.length === 0 ? <div className="vap-row">{t("agent.noVap")}</div> : vapLog.map((e, i) => <VapRow key={i} e={e} />)}
      </div>

      <details className="tool-invoker" open={toolsOpen} onToggle={(e) => setToolsOpen(e.currentTarget.open)}>
        <summary>
          {t("agent.directTools")} {tools !== null ? <Chip>({tools.length})</Chip> : null}
        </summary>
        <div className="tool-invoker-body">
          <div className="row">
            <select
              value={toolName}
              onChange={(e) => setToolName(e.target.value)}
              aria-label={t("agent.toolSelectAria")}
              disabled={tools === null || tools.length === 0}
            >
              <option value="">{tools === null ? t("agent.loadingTools") : t("agent.selectTool")}</option>
              {tools?.map((tool) => (
                <option key={tool.name} value={tool.name} title={tool.description}>
                  {tool.name}
                </option>
              ))}
            </select>
            <Button small disabled={toolName.length === 0} onClick={() => void invokeTool(toolName, toolArgs)}>
              {t("agent.invoke")}
            </Button>
          </div>
          <textarea
            value={toolArgs}
            spellCheck={false}
            onChange={(e) => setToolArgs(e.target.value)}
            aria-label={t("agent.argsAria")}
            placeholder='{"scene": "intro"}'
          />
          {toolError !== null ? (
            <div className="error-text" role="alert">
              {errText(toolError)}
            </div>
          ) : null}
          {toolResult !== null ? (
            <pre className="tool-result">
              {toolResult.name} → {toolResult.json}
            </pre>
          ) : null}
        </div>
      </details>
    </section>
  );
}
