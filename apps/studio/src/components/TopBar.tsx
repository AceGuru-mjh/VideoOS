// TopBar: wordmark, project name, Compile + Render actions, agent/ws indicators, MCP chip.
import { useStudio } from "../store";
import { Button, Chip } from "./ui";

export function TopBar(): JSX.Element {
  const project = useStudio((s) => s.project);
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
      ? "Open a project first"
      : compile?.ok !== true
        ? "Compile must succeed before rendering"
        : "A render is already running"
    : "Render the compiled video to MP4/WebM";

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
        <span className="proj-name">no project</span>
      )}
      <div className="topbar-right">
        <Button variant="primary" disabled={project === null || compiling} onClick={() => void runCompile()}>
          {compiling ? "Compiling…" : "Compile"}
        </Button>
        <Button disabled={renderDisabled} title={renderTooltip} onClick={() => openRenderDialog(true)}>
          Render ▾
        </Button>
        <span
          className="indicator"
          title={
            agentConfig === null
              ? "agent config unknown"
              : agentConfig.configured
                ? `agent providers: ${agentConfig.providers.join(", ")}`
                : "agent not configured (VIDEOOS_PROVIDERS / VIDEOOS_PROVIDER_<ID>_KEY)"
          }
        >
          <span className={`dot${agentConfig?.configured === true ? " ok" : ""}`} />
          agent
        </span>
        {mcpInfo !== null ? <Chip tone="accent" title={`run in: ${mcpInfo.cwd ?? "?"}`}>MCP · {mcpInfo.command}</Chip> : null}
        <span className="indicator" title={wsConnected ? "websocket connected" : "websocket disconnected"}>
          <span className={`dot${wsConnected ? " ok" : " err"}`} />
          ws
        </span>
      </div>
    </header>
  );
}
