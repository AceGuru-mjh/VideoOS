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
import { useI18n } from "../../i18n";
import { useApiErrorMessage } from "../../i18n/errors";
import { AUTONOMY_LEVELS, DECISION_LABEL_KEYS, PERMISSION_DECISIONS, TOOL_GROUPS, resolvePermission, toolGroupKey, toolGroupLabelKey } from "../../agent-permissions";
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
  const { t } = useI18n();
  const open = useStudio((s) => s.permissionsOpen);
  const close = useStudio((s) => s.closePermissions);
  const values = useStudio((s) => s.settings.values);
  const updateAgent = useStudio((s) => s.updateAgent);
  const setToolPermission = useStudio((s) => s.setToolPermission);
  const error = useStudio((s) => s.permissionsError);
  const errText = useApiErrorMessage();

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
      ...(vapTools ?? []).map((tool) => ({ name: tool.name, description: tool.description })),
      ...(mcpTools ?? []).map((tool) => ({ name: `mcp_${tool.serverId}_${tool.name}`, description: tool.description })),
    ];
    const out: Array<{ key: string; labelKey: string; rows: MatrixRow[] }> = [];
    for (const g of TOOL_GROUPS) {
      const rows = all.filter((r) => toolGroupKey(r.name) === g.key);
      if (rows.length > 0) out.push({ key: g.key, labelKey: toolGroupLabelKey(g.key), rows });
    }
    const other = all.filter((r) => toolGroupKey(r.name) === "other");
    if (other.length > 0) out.push({ key: "other", labelKey: toolGroupLabelKey("other"), rows: other });
    return out;
  }, [vapTools, mcpTools]);

  const overrideCount = Object.keys(agent.toolPermissions).length;

  // blacklist validation (client-side; server skips invalid regexes with a warn)
  const patternsText = patternDraft ?? agent.dangerousPatterns.join("\n");
  const patternErrors = useMemo<PatternError[]>(() => {
    const out: PatternError[] = [];
    patternsText.split("\n").forEach((raw, i) => {
      const trimmed = raw.trim();
      if (trimmed.length === 0) return;
      try {
        new RegExp(trimmed);
      } catch (err) {
        out.push({ line: i + 1, text: trimmed, message: err instanceof Error ? err.message : String(err) });
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
    <Modal title={t("permissions.title")} wide onClose={close}>
      <ErrorText>{errText(error)}</ErrorText>

      <section className="perm-sec" aria-label={t("permissions.autonomyAria")}>
        <header className="perm-sec-head">
          <span className="perm-sec-title">{t("permissions.autonomyTitle")}</span>
          <span className="perm-sec-sub">{t("permissions.autonomySub")}</span>
        </header>
        <div className="perm-levels" role="radiogroup" aria-label={t("permissions.autonomyAria")}>
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
                <span className="perm-level-name">{t(meta.nameKey)}</span>
              </span>
              <span className="perm-level-hint">{t(meta.hintKey)}</span>
            </label>
          ))}
        </div>
        <div className="perm-row">
          <Switch
            checked={agent.confirmRender}
            onChange={(v) => void updateAgent({ confirmRender: v })}
            label={t("permissions.confirmRender")}
          />
          <span className="perm-row-text">{t("permissions.confirmRender")}</span>
          <span className="perm-row-hint">{t("permissions.confirmRenderHint")}</span>
        </div>
      </section>

      <section className="perm-sec" aria-label={t("permissions.matrixAria")}>
        <header className="perm-sec-head">
          <span className="perm-sec-title">{t("permissions.matrixTitle")}</span>
          <span className="perm-sec-sub">
            {overrideCount > 0 ? t("permissions.overridesCount", { n: overrideCount }) : t("permissions.followAll")}
            <span className="perm-legend">{t("permissions.matrixLegend")}</span>
          </span>
        </header>
        <div className="perm-matrix-scroll">
          {vapTools === null ? (
            <div className="s4-empty">
              <Spinner label={t("permissions.loadingTools")} />
            </div>
          ) : (
            <table className="perm-matrix">
              <thead>
                <tr>
                  <th className="pm-name">{t("permissions.colTool")}</th>
                  <th className="pm-desc">{t("permissions.colDesc")}</th>
                  <th className="pm-seg">{t("permissions.colPermission")}</th>
                  <th className="pm-clear" aria-label={t("permissions.colClearAria")} />
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <MatrixGroup key={g.key} labelKey={g.labelKey} rows={g.rows} agent={agent} onSet={setToolPermission} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="perm-sec" aria-label={t("permissions.patternsAria")}>
        <header className="perm-sec-head">
          <span className="perm-sec-title">{t("permissions.patternsTitle")}</span>
          <span className="perm-sec-sub">{t("permissions.patternsSub")}</span>
        </header>
        <textarea
          className="perm-patterns"
          rows={3}
          spellCheck={false}
          value={patternsText}
          placeholder={t("permissions.patternsPlaceholder")}
          aria-label={t("permissions.patternsInputAria")}
          onChange={(e) => setPatternDraft(e.target.value)}
        />
        {patternErrors.length > 0 ? (
          <div className="perm-pattern-errors" role="alert">
            {patternErrors.map((p) => (
              <div key={p.line} className="perm-pattern-err">
                {t("permissions.patternInvalid", { line: p.line, text: p.text, message: p.message })}
              </div>
            ))}
          </div>
        ) : null}
        <div className="perm-patterns-foot">
          <button type="button" className="btn small" disabled={!canSavePatterns} onClick={savePatterns}>
            {t("permissions.savePatterns")}
          </button>
          {canSavePatterns ? <span className="perm-sec-sub">{t("permissions.ruleCount", { n: patternsText.split("\n").filter((l) => l.trim().length > 0).length })}</span> : null}
        </div>
      </section>

      <div className="perm-foot-hint">{t("permissions.effectiveNote")}</div>
    </Modal>
  );
}

function MatrixGroup({
  labelKey,
  rows,
  agent,
  onSet,
}: {
  labelKey: string;
  rows: MatrixRow[];
  agent: ReturnType<typeof normalizeAgentSection>;
  onSet: (name: string, value: PermissionDecision | null) => Promise<void>;
}): JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);
  return (
    <>
      <tr className="pm-group">
        <td colSpan={4}>
          <button type="button" className="pm-group-btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <span className={`mcp-caret${open ? " open" : ""}`} aria-hidden="true">
              ▸
            </span>
            {t(labelKey)}
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
                  <span className="perm-seg" role="group" aria-label={t("permissions.toolPermAria", { name: r.name })}>
                    {PERMISSION_DECISIONS.map((d) => (
                      <button
                        key={d}
                        type="button"
                        className={`perm-seg-btn d-${d}${shown === d ? (override !== undefined ? " on" : " ghost") : ""}`}
                        aria-pressed={override !== undefined && override === d}
                        title={
                          override !== undefined
                            ? t(DECISION_LABEL_KEYS[d])
                            : t("permissions.followLevelTitle", { level: agent.autonomy, decision: t(DECISION_LABEL_KEYS[preset]) })
                        }
                        onClick={() => void onSet(r.name, d)}
                      >
                        {t(DECISION_LABEL_KEYS[d])}
                      </button>
                    ))}
                  </span>
                </td>
                <td className="pm-clear">
                  {override !== undefined ? (
                    <button
                      type="button"
                      className="pm-clear-btn"
                      aria-label={t("permissions.clearOverrideAria", { name: r.name })}
                      title={t("permissions.clearOverrideTitle")}
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
