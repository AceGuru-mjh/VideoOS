// Timeline: scene blocks (proportional), transition overlap markers, beat
// ticks (click → seek), second ruler, draggable playhead. Time maps linearly
// to [0, totalFrames].
import { useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useStudio } from "../store";

export function Timeline(): JSX.Element {
  const draggingRef = useRef(false);

  const compile = useStudio((s) => s.compile);
  const currentFrame = useStudio((s) => s.currentFrame);
  const seekFrame = useStudio((s) => s.seekFrame);

  const vir = compile?.vir ?? null;
  const fps = compile?.fps ?? vir?.meta.fps ?? 30;
  const totalFrames = compile?.totalFrames ?? 0;
  const totalSec = Math.max(compile?.durationSeconds ?? 0, 1e-6);
  const frameTime = currentFrame / fps;
  const pct = (sec: number): string => `${Math.min(100, Math.max(0, (sec / totalSec) * 100))}%`;

  const seekFromPointer = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const el = e.currentTarget;
    if (totalFrames <= 0) return;
    const rect = el.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / Math.max(1, rect.width)));
    seekFrame(Math.round(frac * (totalFrames - 1)));
  };

  const scenes = vir?.scenes ?? [];
  const transitions = vir?.transitions ?? [];
  const byName = new Map(scenes.map((s) => [s.name, s]));

  const labelStep = totalSec > 60 ? 10 : totalSec > 20 ? 5 : 1;
  const rulerTicks: number[] = [];
  for (let t = 0; t <= Math.floor(totalSec); t += labelStep) rulerTicks.push(t);

  if (compile === null || totalFrames <= 0) {
    return (
      <section className="timeline" aria-label="Timeline">
        <div className="tl-ruler" />
        <div className="tl-scenes" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span className="empty-note" style={{ pointerEvents: "none" }}>
            timeline appears after a successful compile
          </span>
        </div>
      </section>
    );
  }

  return (
    <section className="timeline" aria-label="Timeline">
      <div className="tl-ruler" onPointerDown={seekFromPointer}>
        {rulerTicks.map((t) => (
          <span key={t} className="tl-tick" style={{ left: pct(t) }}>
            {t}s
          </span>
        ))}
      </div>
      <div
        className="tl-scenes"
        onPointerDown={(e) => {
          draggingRef.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          seekFromPointer(e);
        }}
        onPointerMove={(e) => {
          if (draggingRef.current) seekFromPointer(e);
        }}
        onPointerUp={(e) => {
          draggingRef.current = false;
          e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => {
          draggingRef.current = false;
        }}
      >
        {scenes.map((scene) => {
          const active = frameTime >= scene.start && frameTime < scene.start + scene.duration;
          return (
            <div
              key={scene.id}
              className={`tl-scene${active ? " active" : ""}`}
              style={{ left: pct(scene.start), width: `calc(${(scene.duration / totalSec) * 100}% - 3px)` }}
              title={`${scene.name} — ${scene.duration.toFixed(2)}s @ ${scene.start.toFixed(2)}s`}
              onClick={() => seekFrame(Math.round(scene.start * fps))}
            >
              <span className="label">{scene.name}</span>
              <span className="dur">{scene.duration.toFixed(2)}s · {scene.layers.length}L · {scene.beats.length}B</span>
            </div>
          );
        })}

        {transitions.map((t, i) => {
          const target = byName.get(t.between[1]);
          if (target === undefined) return null;
          const overlapStart = target.start;
          const width = Math.max(0.6, (t.duration / totalSec) * 100);
          return (
            <div
              key={`t-${i}-${t.between[1]}`}
              className="tl-transition"
              style={{ left: pct(overlapStart), width: `${width}%` }}
              title={`${t.type} ${t.duration}s — ${t.between[0]} → ${t.between[1]}`}
            />
          );
        })}

        {scenes.flatMap((scene) =>
          scene.beats.map((beat) => {
            const at = scene.start + beat.at;
            return (
              <span
                key={beat.id}
                className="tl-beat"
                style={{ left: pct(at) }}
                title={`${beat.name} @ ${beat.at.toFixed(2)}s (${scene.name})${beat.description !== undefined ? ` — ${beat.description}` : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  seekFrame(Math.round(at * fps));
                }}
              />
            );
          }),
        )}

        <div className="tl-playhead" style={{ left: pct(frameTime) }} />
      </div>
    </section>
  );
}
