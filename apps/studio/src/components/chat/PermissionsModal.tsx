// PermissionsModal (v0.2 §6 issue #54): the Agent 权限 modal (chat left
// footer 「权限」 chip). 自主级别 L1-L4 radio cards (PATCH agent.autonomy),
// 渲染前确认 switch (agent.confirmRender), the per-tool permission matrix
// (31 VAP tools from GET /api/tools + mcp_<server>_<tool> rows when the MCP
// host is present; ghost preset derived from the autonomy level via the
// client-side mirror of server gate.ts resolvePermission; explicit overrides
// highlight + 清除覆盖 via GET→PUT key deletion) and the 危险命令黑名单
// (one RegExp per line, client-side validation).
import { useEffect, useMemo, useState } from "react";
import * as api from "../../api";
import { useStudio } from "../../store";
import { AUTONOMY_LEVELS, DECISION_LABELS, PERMISSION_DECISIONS, TOOL_GROUPS, resolvePermission, toolGroupKey, toolGroupLabel } from "../../agent-permissions";
import { normalizeAgentSection, type AutonomyLevel, type PermissionDecision } from "../../settings";
import { ErrorText, Modal, Spinner, Switch } from "../ui";

interface MatrixRow {
  name: string;
  description: string;
}

interface PatternError {
  line: number;
  text: string;
  message: string;
}

export function PermissionsModal(): JSX.Element {
  const open = useStudio((s) => s.permissionsOpen);
  const close = useStudio((s) => s.closePermissions);
  const values = useStudio((s) => s.settings.values);
  const updateAgent = useStudio((s) => s.updateAgent);
  const setToolPermission = useStudio((s) => s.setToolPermission);
  const error = useStudio((s) => s.permissionsError);

  const [vapTools, setVapTools] = useState<api.ToolInfo[] | null>(null);
  const [mcpTools, setMcpTools] = useState<api.McpAggregatedTool[] | null>(null);
  /** null = follow the store value (agent.dangerousPatterns) */
  const [patternDraft, setPatternDraft] = useState<string | null>(null);

  // tool rosters: VAP always, MCP only when the host package is present
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setVapTools(null);
    setMcpTools(null);
    api
      .getTools()
      .then((r) => {
        if (alive) setVapTools(r.tools);
      })
      .catch(() => {
        if (alive) setVapTools([]);
      });
    (async () => {
      const status = await api.getMcpStatus();
      if (!alive) return;
      if (status === null) {
        setMcpTools([]);
        return;
      }
      const tools = await api.getMcpTools();
      if (alive) setMcpTools(tools ?? []);
    })().catch(() => {
      if (alive) setMcpTools([]);
    });
    return () => {
      alive = false;
    };
  }, [open]);

  // reset the blacklist draft whenever the modal reopens / settings reload
  useEffect(() => {
    if (open) setPatternDraft(null);
  }, [open, values?.agent?.dangerousPatterns]);

  const agent = useMemo(() => normalizeAgentSection(values?.agent), [values?.agent]);

  const groups = useMemo(() => {
    const all: MatrixRow[] = [
      ...(vapTools ?? []).map((t) => ({ name: t.name, description: t.description })),
      ...(mcpTools ?? []).map((t) => ({ name: `mcp_${t.serverId}_${t.name}`, description: t.description })),
    ];
    const out: Array<{ key: string; label: string; rows: MatrixRow[] }> = [];
    for (const g of TOOL_GROUPS) {
      const rows = all.filter((r) => toolGroupKey(r.name) === g.key);
      if (rows.length > 0) out.push({ key: g.key, label: g.label, rows });
    }
    const other = all.filter((r) => toolGroupKey(r.name) === "other");
    if (other.length > 0) out.push({ key: "other", label: toolGroupLabel("other"), rows: other });
    return out;
  }, [vapTools, mcpTools]);

  const overrideCount = Object.keys(agent.toolPermissions).length;

  // blacklist validation (client-side; server skips invalid regexes with a warn)
  const patternsText = patternDraft ?? agent.dangerousPatterns.join("\n");
  const patternErrors = useMemo<PatternError[]>(() => {
    const out: PatternError[] = [];
    patternsText.split("\n").forEach((raw, i) => {
      const t = raw.trim();
      if (t.length === 0) return;
      try {
        new RegExp(t);
      } catch (err) {
        out.push({ line: i + 1, text: t, message: err instanceof Error ? err.message : String(err) });
      }
    });
    return out;
  }, [patternsText]);
  const patternsDirty = patternsText !== agent.dangerousPatterns.join("\n");
  const canSavePatterns = patternsDirty && patternErrors.length === 0;

  if (!open) return <></>;

  const savePatterns = (): void => {
    const lines = patternsText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    void updateAgent({ dangerousPatterns: lines }).then(() => setPatternDraft(null));
  };

  return (
    <Modal title="Agent 权限" wide onClose={close}>
      <ErrorText>{error}</ErrorText>

      <section className="perm-sec" aria-label="自主级别">
        <header className="perm-sec-head">
          <span className="perm-sec-title">自主级别</span>
          <span className="perm-sec-sub">默认权限表预设 — 切换后逐工具显式覆盖仍然保留</span>
        </header>
        <div className="perm-levels" role="radiogroup" aria-label="自主级别">
          {AUTONOMY_LEVELS.map((meta) => (
            <label key={meta.level} className={`perm-level${agent.autonomy === meta.level ? " active" : ""}`}>
              <input
                type="radio"
                name="autonomy-level"
                value={meta.level}
                checked={agent.autonomy === meta.level}
                onChange={() => void updateAgent({ autonomy: meta.level as AutonomyLevel })}
              />
              <span className="perm-level-head">
                <span className="perm-level-code">{meta.level}</span>
                <span className="perm-level-name">{meta.name}</span>
              </span>
              <span className="perm-level-hint">{meta.hint}</span>
            </label>
          ))}
        </div>
        <div className="perm-row">
          <Switch
            checked={agent.confirmRender}
            onChange={(v) => void updateAgent({ confirmRender: v })}
            label="渲染前确认"
          />
          <span className="perm-row-text">渲染前确认</span>
          <span className="perm-row-hint">L3 下 render.final（最终渲染）执行前弹出确认卡</span>
        </div>
      </section>

      <section className="perm-sec" aria-label="工具权限矩阵">
        <header className="perm-sec-head">
          <span className="perm-sec-title">工具权限矩阵</span>
          <span className="perm-sec-sub">
            {overrideCount > 0 ? `${overrideCount} 项显式覆盖` : "全部跟随级别预设"}
            <span className="perm-legend">· 点击状态设为显式覆盖 · 「×」清除覆盖恢复跟随级别</span>
          </span>
        </header>
        <div className="perm-matrix-scroll">
          {vapTools === null ? (
            <div className="s4-empty">
              <Spinner label="加载工具清单…" />
            </div>
          ) : (
            <table className="perm-matrix">
              <thead>
                <tr>
                  <th className="pm-name">工具</th>
                  <th className="pm-desc">说明</th>
                  <th className="pm-seg">权限</th>
                  <th className="pm-clear" aria-label="清除覆盖" />
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <MatrixGroup key={g.key} label={g.label} rows={g.rows} agent={agent} onSet={setToolPermission} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="perm-sec" aria-label="危险命令黑名单">
        <header className="perm-sec-head">
          <span className="perm-sec-title">危险命令黑名单</span>
          <span className="perm-sec-sub">每行一个正则，匹配工具参数 JSON 即硬拒绝（优先于一切许可）</span>
        </header>
        <textarea
          className="perm-patterns"
          rows={3}
          spellCheck={false}
          value={patternsText}
          placeholder={"例如：rm -rf\n（每行一个正则表达式）"}
          aria-label="危险命令黑名单（每行一个正则）"
          onChange={(e) => setPatternDraft(e.target.value)}
        />
        {patternErrors.length > 0 ? (
          <div className="perm-pattern-errors" role="alert">
            {patternErrors.map((p) => (
              <div key={p.line} className="perm-pattern-err">
                第 {p.line} 行无效正则 <span className="mono">{p.text}</span> — {p.message}
              </div>
            ))}
          </div>
        ) : null}
        <div className="perm-patterns-foot">
          <button type="button" className="btn small" disabled={!canSavePatterns} onClick={savePatterns}>
            保存黑名单
          </button>
          {canSavePatterns ? <span className="perm-sec-sub">{patternsText.split("\n").filter((l) => l.trim().length > 0).length} 条规则</span> : null}
        </div>
      </section>

      <div className="perm-foot-hint">权限与黑名单变更自下一次运行起生效。</div>
    </Modal>
  );
}

function MatrixGroup({
  label,
  rows,
  agent,
  onSet,
}: {
  label: string;
  rows: MatrixRow[];
  agent: ReturnType<typeof normalizeAgentSection>;
  onSet: (name: string, value: PermissionDecision | null) => Promise<void>;
}): JSX.Element {
  const [open, setOpen] = useState(true);
  return (
    <>
      <tr className="pm-group">
        <td colSpan={4}>
          <button type="button" className="pm-group-btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <span className={`mcp-caret${open ? " open" : ""}`} aria-hidden="true">
              ▸
            </span>
            {label}
            <span className="pm-group-count">{rows.length}</span>
          </button>
        </td>
      </tr>
      {open
        ? rows.map((r) => {
            const override = agent.toolPermissions[r.name];
            const preset = resolvePermission(r.name, agent);
            const shown = override ?? preset;
            return (
              <tr key={r.name} className={override !== undefined ? "pm-override" : ""}>
                <td className="pm-name">
                  <span className="mono">{r.name}</span>
                </td>
                <td className="pm-desc">
                  <span title={r.description}>{r.description}</span>
                </td>
                <td className="pm-seg">
                  <span className="perm-seg" role="group" aria-label={`${r.name} 权限`}>
                    {PERMISSION_DECISIONS.map((d) => (
                      <button
                        key={d}
                        type="button"
                        className={`perm-seg-btn d-${d}${shown === d ? (override !== undefined ? " on" : " ghost") : ""}`}
                        aria-pressed={override !== undefined && override === d}
                        title={override !== undefined ? DECISION_LABELS[d] : `跟随级别（${agent.autonomy}）：${DECISION_LABELS[preset]}`}
                        onClick={() => void onSet(r.name, d)}
                      >
                        {DECISION_LABELS[d]}
                      </button>
                    ))}
                  </span>
                </td>
                <td className="pm-clear">
                  {override !== undefined ? (
                    <button
                      type="button"
                      className="pm-clear-btn"
                      aria-label={`清除 ${r.name} 的覆盖`}
                      title="清除覆盖 — 恢复跟随自主级别"
                      onClick={() => void onSet(r.name, null)}
                    >
                      ×
                    </button>
                  ) : null}
                </td>
              </tr>
            );
          })
        : null}
    </>
  );
}
