// RenderDialog: codec/CRF/preset/scene options → POST /api/render/start,
// progress via WS render-progress, result video player, error display.
// NOTE: render-done.video is an ABSOLUTE path — only the basename is shown
// and the video is loaded through the static /renders/<basename> mount.
import { useState } from "react";
import * as api from "../api";
import { useStudio } from "../store";
import { useApiErrorMessage } from "../i18n/errors";
import { useI18n } from "../i18n";
import { Button, Chip, ErrorText, Modal, Spinner } from "./ui";

const PRESETS = ["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"] as const;

export function RenderDialog(): JSX.Element | null {
  const { t } = useI18n();
  const errText = useApiErrorMessage();
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

  /** 已知渲染阶段查词典，未知阶段回显原始值（与旧回退语义一致） */
  const phaseLabel = (phase: string): string => {
    if (phase === "compile") return t("renderDialog.phaseCompile");
    if (phase === "render") return t("renderDialog.phaseRender");
    if (phase === "encode") return t("renderDialog.phaseEncode");
    return phase;
  };

  return (
    <Modal title={t("renderDialog.title")} onClose={() => openRenderDialog(false)} wide>
      <div className="render-form">
        <span style={{ color: "var(--dim)" }}>{t("renderDialog.codec")}</span>
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

        <span style={{ color: "var(--dim)" }}>{t("renderDialog.crf")}</span>
        <div className="crf-row">
          <input
            type="range"
            min={0}
            max={51}
            value={crf}
            disabled={running}
            onChange={(e) => setCrf(Number.parseInt(e.target.value, 10))}
            aria-label={t("renderDialog.crfAria")}
          />
          <span className="crf-value">{crf}</span>
          <span style={{ color: "var(--faint)", fontSize: 10 }}>
            {crf <= 18 ? t("renderDialog.qualityHigh") : crf >= 28 ? t("renderDialog.qualitySmall") : t("renderDialog.qualityBalanced")}
          </span>
        </div>

        <span style={{ color: "var(--dim)" }}>{t("renderDialog.preset")}</span>
        <select value={preset} disabled={running} onChange={(e) => setPreset(e.target.value)} aria-label={t("renderDialog.presetAria")}>
          {PRESETS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>

        <span style={{ color: "var(--dim)" }}>{t("renderDialog.scene")}</span>
        <select value={scene} disabled={running} onChange={(e) => setScene(e.target.value)} aria-label={t("renderDialog.sceneAria")}>
          <option value="">{t("renderDialog.allScenes")}</option>
          {scenes.map((s) => (
            <option key={s.id} value={s.name}>
              {s.name} ({s.duration.toFixed(1)}s)
            </option>
          ))}
        </select>

        <div className="full" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Button variant="primary" disabled={running || scenes.length === 0} onClick={submit}>
            {running ? <Spinner /> : null} {running ? t("renderDialog.rendering") : t("renderDialog.start")}
          </Button>
          <span style={{ color: "var(--faint)", fontSize: 11 }}>
            {t("renderDialog.scenesSummary", {
              count: scenes.length,
              word: scenes.length === 1 ? "" : "s",
              frames: compile?.totalFrames ?? 0,
            })}
          </span>
        </div>
      </div>

      {progress !== null || running ? (
        <div className="progress-wrap">
          <div className="progress-label">
            <span>{progress !== null ? phaseLabel(progress.phase) : t("renderDialog.starting")}</span>
            <span>
              {progress !== null ? `${progress.frame}/${progress.totalFrames}` : ""} {pct}%
            </span>
          </div>
          <div className="progress-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
      ) : null}

      <ErrorText>{errText(renderError)}</ErrorText>

      {lastRender !== null && !running ? (
        <div className="progress-wrap">
          <div className="render-stats">
            <Chip tone="ok">{t("renderDialog.rendered")}</Chip>
            <Chip tone="info" title={lastRender.video}>
              {videoBase}
            </Chip>
            <Chip>{t("renderDialog.framesCount", { n: lastRender.frames })}</Chip>
            <Chip>{t("renderDialog.cacheStats", { hits: lastRender.cacheHits, misses: lastRender.cacheMisses })}</Chip>
          </div>
          {playable ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption -- rendered videos carry no captions
            <video className="video-player" controls src={`/renders/${encodeURIComponent(videoBase ?? "")}`} />
          ) : (
            <div className="empty-note">{t("renderDialog.notPlayable", { name: videoBase ?? "" })}</div>
          )}
        </div>
      ) : null}

      <div className="modal-footer">
        <Button onClick={() => openRenderDialog(false)}>{t("renderDialog.close")}</Button>
      </div>
    </Modal>
  );
}
