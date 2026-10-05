// TopBar: wordmark, project name, mode switch (chat ⇄ IDE), language toggle (中/EN),
// Compile + Render actions, agent/ws indicators, MCP chip. All strings via i18n.
import { useI18n } from "../i18n";
import { useStudio } from "../store";
import { Button, Chip } from "./ui";

export function TopBar(): JSX.Element {
  const { t, locale, setLocale } = useI18n();
  const project = useStudio((s) => s.project);
  const mode = useStudio((s) => s.mode);
  const setMode = useStudio((s) => s.setMode);
  const compiling = useStudio((s) => s.compiling);
  const compile = useStudio((s) => s.compile);
  const renderStatus = useStudio((s) => s.renderStatus);
  const agentConfig = useStudio((s) => s.agentConfig);
  const mcpInfo = useStudio((s) => s.mcpInfo);
  const wsConnected = useStudio((s) => s.wsConnected);
  const runCompile = useStudio((s) => s.runCompile);
  const openRenderDialog = useStudio((s) => s.openRenderDialog);

  const renderDisabled = project === null || compile?.ok !== true || renderStatus?.running === true;
  const renderTooltip = renderDisabled
    ? project === null
      ? t("topbar.renderNeedProject")
      : compile?.ok !== true
        ? t("topbar.renderNeedCompile")
        : t("topbar.renderBusy")
    : t("topbar.renderHint");

  return (
    <header className="topbar">
      <span className="logo" aria-label="VideoOS Studio">
        <span className="glyph">▶</span>
        <span>VideoOS</span>
      </span>
      {project !== null ? (
        <span className="proj-name" title={project.root}>
          {project.name}
        </span>
      ) : (
        <span className="proj-name">{t("topbar.noProject")}</span>
      )}
      <div className="topbar-right">
        <div className="seg-toggle" role="group" aria-label={t("topbar.modeSwitcher")}>
          <button
            className={`seg-btn${mode === "chat" ? " active" : ""}`}
            aria-pressed={mode === "chat"}
            onClick={() => setMode("chat")}
          >
            {t("topbar.modeChat")}
          </button>
          <button
            className={`seg-btn${mode === "ide" ? " active" : ""}`}
            aria-pressed={mode === "ide"}
            onClick={() => setMode("ide")}
          >
            {t("topbar.modeIde")}
          </button>
        </div>
        <div className="seg-toggle" role="group" aria-label={t("topbar.languageSwitcher")}>
          <button
            className={`seg-btn${locale === "zh" ? " active" : ""}`}
            aria-pressed={locale === "zh"}
            onClick={() => setLocale("zh")}
          >
            {t("topbar.langZh")}
          </button>
          <button
            className={`seg-btn${locale === "en" ? " active" : ""}`}
            aria-pressed={locale === "en"}
            onClick={() => setLocale("en")}
          >
            {t("topbar.langEn")}
          </button>
        </div>
        <Button variant="primary" disabled={project === null || compiling} onClick={() => void runCompile()}>
          {compiling ? t("topbar.compiling") : t("topbar.compile")}
        </Button>
        <Button disabled={renderDisabled} title={renderTooltip} onClick={() => openRenderDialog(true)}>
          {t("topbar.render")}
        </Button>
        <span
          className="indicator"
          title={
            agentConfig === null
              ? t("topbar.agentUnknown")
              : agentConfig.configured
                ? t("topbar.agentProviders", { list: agentConfig.providers.join(", ") })
                : t("topbar.agentNotConfigured")
          }
        >
          <span className={`dot${agentConfig?.configured === true ? " ok" : ""}`} />
          {t("topbar.agentLabel")}
        </span>
        {mcpInfo !== null ? <Chip tone="accent" title={t("topbar.mcpRunIn", { dir: mcpInfo.cwd ?? "?" })}>MCP · {mcpInfo.command}</Chip> : null}
        <span className="indicator" title={wsConnected ? t("topbar.wsConnected") : t("topbar.wsDisconnected")}>
          <span className={`dot${wsConnected ? " ok" : " err"}`} />
          {t("topbar.wsLabel")}
        </span>
      </div>
    </header>
  );
}
