// ProjectPanel (left): Scenes (from last VIR), Assets grid, Tests list, Agent/MCP info.
import { useState } from "react";
import * as api from "../api";
import { useStudio } from "../store";
import { Button, Chip, Section, fmtBytes } from "./ui";

export function ProjectPanel(): JSX.Element {
  const project = useStudio((s) => s.project);
  const compile = useStudio((s) => s.compile);
  const currentFrame = useStudio((s) => s.currentFrame);
  const assets = useStudio((s) => s.assets);
  const assetsLoading = useStudio((s) => s.assetsLoading);
  const mcpInfo = useStudio((s) => s.mcpInfo);
  const seekFrame = useStudio((s) => s.seekFrame);
  const loadFile = useStudio((s) => s.loadFile);
  const loadAssets = useStudio((s) => s.loadAssets);
  const [copied, setCopied] = useState(false);

  if (project === null) return <aside className="project-panel" />;
  const vir = compile?.vir ?? null;
  const fps = compile?.fps ?? vir?.meta.fps ?? 30;
  const frameTime = currentFrame / fps;

  const copyCommand = (): void => {
    if (mcpInfo === null) return;
    navigator.clipboard
      .writeText(mcpInfo.command)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => setCopied(false));
  };

  return (
    <aside className="project-panel" aria-label="Project">
      <Section title="Scenes">
        {vir === null ? (
          <div className="empty-note">no VIR yet — compile the project</div>
        ) : (
          vir.scenes.map((scene) => {
            const active = frameTime >= scene.start && frameTime < scene.start + scene.duration;
            const bg = scene.background ?? vir.meta.background;
            return (
              <button
                key={scene.id}
                type="button"
                className={`scene-row${active ? " active" : ""}`}
                title={`seek to ${scene.name} @ ${scene.start.toFixed(2)}s`}
                onClick={() => seekFrame(Math.round(scene.start * fps))}
              >
                <span className="bg-chip" style={{ background: bg }} aria-hidden="true" />
                <span className="name">{scene.name}</span>
                <span className="meta">
                  {scene.duration.toFixed(1)}s · {scene.layers.length}L · {scene.beats.length}B
                </span>
              </button>
            );
          })
        )}
      </Section>

      <Section
        title="Assets"
        actions={
          <Button ghost small disabled={assetsLoading} onClick={() => void loadAssets()} title="Rescan project assets">
            {assetsLoading ? "…" : "refresh"}
          </Button>
        }
      >
        {assets === null || assets.length === 0 ? (
          <div className="empty-note">no assets (assets/images · audio · fonts)</div>
        ) : (
          <div className="asset-grid">
            {assets.map((a) => (
              <div key={a.rel} className={`asset-tile ${a.kind}`} title={`${a.rel} — ${fmtBytes(a.size)}`}>
                {a.kind === "image" ? (
                  <img src={api.assetUrl(a.rel)} alt={api.basename(a.rel)} loading="lazy" />
                ) : null}
                <span className="kind">{a.kind}</span>
                <span className="label">{api.basename(a.rel)}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Tests">
        {project.testFiles.length === 0 ? (
          <div className="empty-note">no test files found</div>
        ) : (
          project.testFiles.map((f) => {
            const rel = api.toProjectRel(f, project.root);
            return (
              <button key={f} type="button" className="test-file-row" title={f} onClick={() => void loadFile(rel)}>
                <span aria-hidden="true">◇</span>
                {api.basename(f)}
              </button>
            );
          })
        )}
      </Section>

      <Section title="Agent / MCP">
        {mcpInfo === null ? (
          <div className="empty-note">mcp info unavailable</div>
        ) : (
          <div className="mcp-box">
            <div className="mcp-command" title="copy command">
              <span className="cmd">{mcpInfo.command}</span>
              <Button ghost small onClick={copyCommand}>
                {copied ? "copied" : "copy"}
              </Button>
            </div>
            {mcpInfo.cwd !== null ? <span className="mcp-cwd">cwd: {mcpInfo.cwd}</span> : null}
            <span className="mcp-cwd">{mcpInfo.hint}</span>
          </div>
        )}
      </Section>

      <Section title="Project">
        <div className="mcp-box">
          <span className="mcp-cwd">{project.root}</span>
          <div>
            <Chip title={project.entry}>entry: {project.entry}</Chip>
          </div>
        </div>
      </Section>
    </aside>
  );
}
