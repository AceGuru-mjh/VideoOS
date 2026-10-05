// StatusBar: compile / tests / render state (left), canvas·fps / ws / version (right).
import * as api from "../api";
import { useI18n } from "../i18n";
import { useApiErrorMessage } from "../i18n/errors";
import { useStudio } from "../store";

export function StatusBar(): JSX.Element {
  const { t } = useI18n();
  const errText = useApiErrorMessage();
  const compile = useStudio((s) => s.compile);
  const compiling = useStudio((s) => s.compiling);
  const compileError = useStudio((s) => s.compileError);
  const tests = useStudio((s) => s.tests);
  const testsRunning = useStudio((s) => s.testsRunning);
  const renderStatus = useStudio((s) => s.renderStatus);
  const lastRender = useStudio((s) => s.lastRender);
  const wsConnected = useStudio((s) => s.wsConnected);
  const wsCount = useStudio((s) => s.wsCount);
  const serverVersion = useStudio((s) => s.serverVersion);
  const setDockTab = useStudio((s) => s.setDockTab);
  const openRenderDialog = useStudio((s) => s.openRenderDialog);

  const errorCount = (compile?.diagnostics ?? []).filter((d) => d.level === "error").length;
  const warningCount = (compile?.diagnostics ?? []).filter((d) => d.level === "warning").length;

  let compileItem: JSX.Element;
  if (compiling) {
    compileItem = <span className="status-item">{t("statusbar.compiling")}</span>;
  } else if (compile !== null && compile.ok) {
    compileItem = (
      <span
        className="status-item ok"
        title={t("statusbar.diagTitle", { errors: errorCount, warnings: warningCount })}
      >
        {t("statusbar.compiled", { frames: compile.totalFrames, dur: compile.durationSeconds.toFixed(1) })}
      </span>
    );
  } else if (compile !== null || compileError !== null) {
    compileItem = (
      <button
        type="button"
        className="status-item err"
        title={compileError !== null ? (errText(compileError) ?? "") : t("statusbar.compileFailed")}
        onClick={() => setDockTab("diagnostics")}
      >
        ✗ {errorCount > 0 ? t("statusbar.errorCount", { n: errorCount }) : t("statusbar.compileFailed")}
      </button>
    );
  } else {
    compileItem = <span className="status-item">{t("statusbar.notCompiled")}</span>;
  }

  let testsItem: JSX.Element;
  if (testsRunning) {
    testsItem = <span className="status-item">{t("statusbar.testsRunning")}</span>;
  } else if (tests !== null) {
    const total = tests.totalPassed + tests.totalFailed;
    testsItem = (
      <button
        type="button"
        className={`status-item${tests.totalFailed > 0 ? " err" : " ok"}`}
        title={t("statusbar.testsTitle", { passed: tests.totalPassed, failed: tests.totalFailed })}
        onClick={() => setDockTab("tests")}
      >
        {t("statusbar.testsSummary", { passed: tests.totalPassed, total })}
      </button>
    );
  } else {
    testsItem = <span className="status-item">{t("statusbar.testsNone")}</span>;
  }

  let renderItem: JSX.Element;
  if (renderStatus?.running === true && renderStatus.progress !== null) {
    const pct = renderStatus.progress.totalFrames > 0 ? Math.round((renderStatus.progress.frame / renderStatus.progress.totalFrames) * 100) : 0;
    renderItem = (
      <button type="button" className="status-item" onClick={() => openRenderDialog(true)}>
        {t("statusbar.renderProgress", { pct })}
      </button>
    );
  } else if (renderStatus?.running === true) {
    renderItem = (
      <button type="button" className="status-item" onClick={() => openRenderDialog(true)}>
        {t("statusbar.renderStarting")}
      </button>
    );
  } else if (lastRender !== null) {
    renderItem = (
      <button type="button" className="status-item ok" title={lastRender.video} onClick={() => openRenderDialog(true)}>
        ▶ {api.basename(lastRender.video)}
      </button>
    );
  } else {
    renderItem = <span className="status-item">{t("statusbar.renderIdle")}</span>;
  }

  const geom =
    compile?.width !== undefined && compile?.height !== undefined && compile?.fps !== undefined
      ? `${compile.width}×${compile.height} · ${compile.fps}fps`
      : "—";

  return (
    <footer className="statusbar">
      {compileItem}
      {testsItem}
      {renderItem}
      <span className="right">
        <span>{geom}</span>
        <span className={wsConnected ? "status-item ok" : "status-item err"}>
          {wsConnected ? "●" : "○"} {wsConnected ? t("statusbar.connected", { n: wsCount }) : t("statusbar.disconnected")}
        </span>
        <span>videoos {serverVersion.length > 0 ? serverVersion : "0.1.0"}</span>
      </span>
    </footer>
  );
}
