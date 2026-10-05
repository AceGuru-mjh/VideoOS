// TestsPanel: run visual QA suites, per-suite/per-test tree, golden diff images
// (golden + diff paths arrive absolute; images are served under /renders/<basename>).
import { useState } from "react";
import * as api from "../api";
import { useI18n } from "../i18n";
import { useApiErrorMessage } from "../i18n/errors";
import { useStudio } from "../store";
import { Button, Chip, ErrorText, Spinner } from "./ui";

function detailString(details: Record<string, unknown> | undefined, key: string): string | undefined {
  const v = details?.[key];
  return typeof v === "string" ? v : undefined;
}

function detailNumber(details: Record<string, unknown> | undefined, key: string): number | undefined {
  const v = details?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** Image that hides itself when the server can't serve the path. */
function GoldenImage({ absPath, caption }: { absPath: string; caption: string }): JSX.Element | null {
  const base = api.basename(absPath);
  if (!base.endsWith(".png")) return null;
  return (
    <figure className="golden-figure">
      <img src={`/renders/${encodeURIComponent(base)}`} alt={`${caption}: ${base}`} onError={(e) => {
        const el = e.currentTarget.parentElement;
        if (el !== null) el.style.display = "none";
      }} />
      <figcaption>
        {caption}: {base}
      </figcaption>
    </figure>
  );
}

export function TestsPanel(): JSX.Element {
  const { t } = useI18n();
  const errText = useApiErrorMessage();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const tests = useStudio((s) => s.tests);
  const testsRunning = useStudio((s) => s.testsRunning);
  const testsError = useStudio((s) => s.testsError);
  const updateGolden = useStudio((s) => s.updateGolden);
  const setUpdateGolden = useStudio((s) => s.setUpdateGolden);
  const runTests = useStudio((s) => s.runTests);
  const project = useStudio((s) => s.project);

  return (
    <div className="tests-panel">
      <div className="tests-toolbar">
        <Button variant="primary" small disabled={project === null || testsRunning} onClick={() => void runTests()}>
          {testsRunning ? <Spinner /> : null} {t("tests.run")}
        </Button>
        <label title={t("tests.updateGoldenTitle")}>
          <input type="checkbox" checked={updateGolden} onChange={(e) => setUpdateGolden(e.target.checked)} /> {t("tests.updateGolden")}
        </label>
        {tests !== null ? (
          <>
            <Chip tone={tests.totalFailed === 0 ? "ok" : "err"}>
              {t("tests.summary", { passed: tests.totalPassed, failed: tests.totalFailed })}
            </Chip>
            <Chip>{(tests.durationMs / 1000).toFixed(2)}s</Chip>
            {tests.virHash !== undefined ? <Chip tone="info" title={tests.virHash}>vir {tests.virHash.slice(0, 8)}</Chip> : null}
          </>
        ) : null}
      </div>

      <ErrorText>{errText(testsError)}</ErrorText>

      {tests === null ? (
        <div className="empty-note">{t("tests.empty")}</div>
      ) : (
        tests.suites.map((suite) => (
          <div key={suite.suite} className="test-suite">
            <div className="test-suite-header">
              <strong>{suite.suite}</strong>
              <Chip tone={suite.failed > 0 ? "err" : "ok"}>
                {suite.passed}✓ / {suite.failed}✗{suite.skipped > 0 ? ` / ${suite.skipped}⊘` : ""}
              </Chip>
              <span style={{ color: "var(--faint)", marginLeft: "auto", fontSize: 10 }}>{suite.durationMs}ms</span>
            </div>
            {suite.results.map((tr) => {
              const key = `${suite.suite}::${tr.name}`;
              const isOpen = expanded[key] ?? false;
              const golden = detailString(tr.details, "golden");
              const diff = detailString(tr.details, "diff");
              const similarity = detailNumber(tr.details, "similarity");
              const threshold = detailNumber(tr.details, "threshold");
              return (
                <div key={key} className={`test-row ${tr.status}`}>
                  <span className="status">{tr.status === "pass" ? "✓" : tr.status === "fail" ? "✗" : "⊘"}</span>
                  <span className="name">{tr.name}</span>
                  {similarity !== undefined ? <Chip tone="warn">sim {similarity}</Chip> : null}
                  {threshold !== undefined ? <Chip>thr {threshold}</Chip> : null}
                  {tr.message !== undefined ? (
                    <span className="msg" title={tr.message}>
                      {tr.message.length > 140 && !isOpen ? `${tr.message.slice(0, 140)}…` : tr.message}
                    </span>
                  ) : null}
                  {tr.message !== undefined && tr.message.length > 140 ? (
                    <Button
                      ghost
                      small
                      onClick={() => setExpanded((prev) => ({ ...prev, [key]: !isOpen }))}
                      aria-expanded={isOpen}
                    >
                      {isOpen ? t("tests.less") : t("tests.more")}
                    </Button>
                  ) : null}
                  {tr.status === "fail" && (golden !== undefined || diff !== undefined) ? (
                    <div className="golden-compare" style={{ width: "100%" }}>
                      {golden !== undefined ? <GoldenImage absPath={golden} caption="golden" /> : null}
                      {diff !== undefined ? <GoldenImage absPath={diff} caption="diff" /> : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}
