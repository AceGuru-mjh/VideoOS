// ProjectPanel (left): Scenes (from last VIR), Assets grid, Tests list, Agent/MCP info.
import { useState } from "react";
import * as api from "../api";
import { useStudio } from "../store";
import { useI18n } from "../i18n";
import { Button, Chip, Section, fmtBytes } from "./ui";

export function ProjectPanel(): JSX.Element {
  const { t } = useI18n();
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
    <aside className="project-panel" aria-label={t("project.aria")}>
      <Section title={t("project.scenes")}>
        {vir === null ? (
          <div className="empty-note">{t("project.noVir")}</div>
        ) : (
          vir.scenes.map((scene) => {
            const active = frameTime >= scene.start && frameTime < scene.start + scene.duration;
            const bg = scene.background ?? vir.meta.background;
            return (
              <button
                key={scene.id}
                type="button"
                className={`scene-row${active ? " active" : ""}`}
                title={t("project.seekTo", { name: scene.name, sec: scene.start.toFixed(2) })}
                onClick={() => seekFrame(Math.round(scene.start * fps))}
              >
                <span className="bg-chip" style={{ background: bg }} aria-hidden="true" />
                <span className="name">{scene.name}</span>
                <span className="meta">
                  {t("project.sceneMeta", { d: scene.duration.toFixed(1), layers: scene.layers.length, beats: scene.beats.length })}
                </span>
              </button>
            );
          })
        )}
      </Section>

      <Section
        title={t("project.assets")}
        actions={
          <Button ghost small disabled={assetsLoading} onClick={() => void loadAssets()} title={t("project.rescanTitle")}>
            {assetsLoading ? "…" : t("project.refresh")}
          </Button>
        }
      >
        {assets === null || assets.length === 0 ? (
          <div className="empty-note">{t("project.noAssets")}</div>
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

      <Section title={t("project.tests")}>
        {project.testFiles.length === 0 ? (
          <div className="empty-note">{t("project.noTests")}</div>
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

      <Section title={t("project.agentMcp")}>
        {mcpInfo === null ? (
          <div className="empty-note">{t("project.mcpUnavailable")}</div>
        ) : (
          <div className="mcp-box">
            <div className="mcp-command" title={t("project.copyCommand")}>
              <span className="cmd">{mcpInfo.command}</span>
              <Button ghost small onClick={copyCommand}>
                {copied ? t("project.copied") : t("project.copy")}
              </Button>
            </div>
            {mcpInfo.cwd !== null ? <span className="mcp-cwd">{t("project.cwd", { dir: mcpInfo.cwd })}</span> : null}
            <span className="mcp-cwd">{mcpInfo.hint}</span>
          </div>
        )}
      </Section>

      <Section title={t("project.project")}>
        <div className="mcp-box">
          <span className="mcp-cwd">{project.root}</span>
          <div>
            <Chip title={project.entry}>{t("project.entry", { path: project.entry })}</Chip>
          </div>
        </div>
      </Section>
    </aside>
  );
}
