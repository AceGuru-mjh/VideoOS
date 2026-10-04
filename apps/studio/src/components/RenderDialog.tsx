// RenderDialog: codec/CRF/preset/scene options → POST /api/render/start,
// progress via WS render-progress, result video player, error display.
// NOTE: render-done.video is an ABSOLUTE path — only the basename is shown
// and the video is loaded through the static /renders/<basename> mount.
import { useState } from "react";
import * as api from "../api";
import { useStudio } from "../store";
import { Button, Chip, ErrorText, Modal, Spinner } from "./ui";

const PRESETS = ["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"] as const;

const PHASE_LABELS: Record<string, string> = {
  compile: "Preparing (VIR ready)",
  render: "Rendering frames",
  encode: "Encoding (ffmpeg)",
};

export function RenderDialog(): JSX.Element | null {
  const [codec, setCodec] = useState<"h264" | "vp9">("h264");
  const [crf, setCrf] = useState(18);
  const [preset, setPreset] = useState<string>("medium");
  const [scene, setScene] = useState("");

  const open = useStudio((s) => s.renderDialogOpen);
  const openRenderDialog = useStudio((s) => s.openRenderDialog);
  const renderStatus = useStudio((s) => s.renderStatus);
  const renderStarting = useStudio((s) => s.renderStarting);
  const renderError = useStudio((s) => s.renderError);
  const lastRender = useStudio((s) => s.lastRender);
  const compile = useStudio((s) => s.compile);
  const startRender = useStudio((s) => s.startRender);

  if (!open) return null;

  const scenes = compile?.vir?.scenes ?? [];
  const running = renderStatus?.running === true || renderStarting;
  const progress = renderStatus?.progress ?? null;
  const pct = progress !== null && progress.totalFrames > 0 ? Math.round((progress.frame / progress.totalFrames) * 100) : 0;
  const videoBase = lastRender !== null ? api.basename(lastRender.video) : null;
  const playable = videoBase !== null && /\.(mp4|webm)$/i.test(videoBase);

  const submit = (): void => {
    void startRender({
      codec,
      crf,
      preset,
      ...(scene.length > 0 ? { scene } : {}),
    });
  };

  return (
    <Modal title="Render video" onClose={() => openRenderDialog(false)} wide>
      <div className="render-form">
        <span style={{ color: "var(--dim)" }}>Codec</span>
        <div className="radio-row">
          <label>
            <input
              type="radio"
              name="codec"
              value="h264"
              checked={codec === "h264"}
              disabled={running}
              onChange={() => setCodec("h264")}
            />
            h264 (.mp4)
          </label>
          <label>
            <input
              type="radio"
              name="codec"
              value="vp9"
              checked={codec === "vp9"}
              disabled={running}
              onChange={() => setCodec("vp9")}
            />
            vp9 (.webm)
          </label>
        </div>

        <span style={{ color: "var(--dim)" }}>CRF quality</span>
        <div className="crf-row">
          <input
            type="range"
            min={0}
            max={51}
            value={crf}
            disabled={running}
            onChange={(e) => setCrf(Number.parseInt(e.target.value, 10))}
            aria-label="constant rate factor"
          />
          <span className="crf-value">{crf}</span>
          <span style={{ color: "var(--faint)", fontSize: 10 }}>{crf <= 18 ? "high quality" : crf >= 28 ? "small file" : "balanced"}</span>
        </div>

        <span style={{ color: "var(--dim)" }}>Preset</span>
        <select value={preset} disabled={running} onChange={(e) => setPreset(e.target.value)} aria-label="ffmpeg preset">
          {PRESETS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>

        <span style={{ color: "var(--dim)" }}>Scene</span>
        <select value={scene} disabled={running} onChange={(e) => setScene(e.target.value)} aria-label="scene range">
          <option value="">All scenes</option>
          {scenes.map((s) => (
            <option key={s.id} value={s.name}>
              {s.name} ({s.duration.toFixed(1)}s)
            </option>
          ))}
        </select>

        <div className="full" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Button variant="primary" disabled={running || scenes.length === 0} onClick={submit}>
            {running ? <Spinner /> : null} {running ? "Rendering…" : "Start render"}
          </Button>
          <span style={{ color: "var(--faint)", fontSize: 11 }}>
            {scenes.length} scene{scenes.length === 1 ? "" : "s"} · {compile?.totalFrames ?? 0} frames total
          </span>
        </div>
      </div>

      {progress !== null || running ? (
        <div className="progress-wrap">
          <div className="progress-label">
            <span>{PHASE_LABELS[progress?.phase ?? ""] ?? (progress !== null ? progress.phase : "starting…")}</span>
            <span>
              {progress !== null ? `${progress.frame}/${progress.totalFrames}` : ""} {pct}%
            </span>
          </div>
          <div className="progress-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
      ) : null}

      <ErrorText>{renderError}</ErrorText>

      {lastRender !== null && !running ? (
        <div className="progress-wrap">
          <div className="render-stats">
            <Chip tone="ok">✓ rendered</Chip>
            <Chip tone="info" title={lastRender.video}>
              {videoBase}
            </Chip>
            <Chip>{lastRender.frames} frames</Chip>
            <Chip>
              cache {lastRender.cacheHits} hits / {lastRender.cacheMisses} misses
            </Chip>
          </div>
          {playable ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption -- rendered videos carry no captions
            <video className="video-player" controls src={`/renders/${encodeURIComponent(videoBase ?? "")}`} />
          ) : (
            <div className="empty-note">output is not a playable video type: {videoBase}</div>
          )}
        </div>
      ) : null}

      <div className="modal-footer">
        <Button onClick={() => openRenderDialog(false)}>Close</Button>
      </div>
    </Modal>
  );
}
