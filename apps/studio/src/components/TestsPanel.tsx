// TestsPanel: run visual QA suites, per-suite/per-test tree, golden diff images
// (golden + diff paths arrive absolute; images are served under /renders/<basename>).
import { useState } from "react";
import * as api from "../api";
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
          {testsRunning ? <Spinner /> : null} Run tests
        </Button>
        <label title="regenerate golden baselines where they are missing or mismatched">
          <input type="checkbox" checked={updateGolden} onChange={(e) => setUpdateGolden(e.target.checked)} /> update golden
        </label>
        {tests !== null ? (
          <>
            <Chip tone={tests.totalFailed === 0 ? "ok" : "err"}>
              {tests.totalPassed} passed / {tests.totalFailed} failed
            </Chip>
            <Chip>{(tests.durationMs / 1000).toFixed(2)}s</Chip>
            {tests.virHash !== undefined ? <Chip tone="info" title={tests.virHash}>vir {tests.virHash.slice(0, 8)}</Chip> : null}
          </>
        ) : null}
      </div>

      <ErrorText>{testsError}</ErrorText>

      {tests === null ? (
        <div className="empty-note">run the visual QA suite to see results here</div>
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
            {suite.results.map((t) => {
              const key = `${suite.suite}::${t.name}`;
              const isOpen = expanded[key] ?? false;
              const golden = detailString(t.details, "golden");
              const diff = detailString(t.details, "diff");
              const similarity = detailNumber(t.details, "similarity");
              const threshold = detailNumber(t.details, "threshold");
              return (
                <div key={key} className={`test-row ${t.status}`}>
                  <span className="status">{t.status === "pass" ? "✓" : t.status === "fail" ? "✗" : "⊘"}</span>
                  <span className="name">{t.name}</span>
                  {similarity !== undefined ? <Chip tone="warn">sim {similarity}</Chip> : null}
                  {threshold !== undefined ? <Chip>thr {threshold}</Chip> : null}
                  {t.message !== undefined ? (
                    <span className="msg" title={t.message}>
                      {t.message.length > 140 && !isOpen ? `${t.message.slice(0, 140)}…` : t.message}
                    </span>
                  ) : null}
                  {t.message !== undefined && t.message.length > 140 ? (
                    <Button
                      ghost
                      small
                      onClick={() => setExpanded((prev) => ({ ...prev, [key]: !isOpen }))}
                      aria-expanded={isOpen}
                    >
                      {isOpen ? "less" : "more"}
                    </Button>
                  ) : null}
                  {t.status === "fail" && (golden !== undefined || diff !== undefined) ? (
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
