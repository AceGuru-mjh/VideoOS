// 场景时序派生：顺序排列；crossfade/fade-black 使后一场景 start 提前 transition.duration 秒
import type { VirTransition } from "@videoos/vir";
import type { ParsedProgram, ParsedScene } from "./parse";
import type { Diagnostic } from "./diagnostics";
import { findAnyTransition, findIncomingTransition } from "./transition";
import type { IncomingTransition } from "./transition";

export interface SceneTiming {
  scene: ParsedScene;
  start: number;
  end: number;
  /** 该场景作为“后场景”入场时的过渡（首个匹配） */
  incoming?: IncomingTransition;
}

export function deriveSceneTiming(program: ParsedProgram, diagnostics: Diagnostic[]): SceneTiming[] {
  const applied = new Set<VirTransition>();
  const timings: SceneTiming[] = [];
  for (let i = 0; i < program.scenes.length; i++) {
    const scene = program.scenes[i]!;
    let start = 0;
    let incoming: IncomingTransition | undefined;
    if (i > 0) {
      const prev = timings[i - 1]!;
      const match = findAnyTransition(prev.scene.name, scene.name, program.transitions);
      if (match !== undefined) applied.add(match);
      const inc = findIncomingTransition(prev.scene.name, scene.name, program.transitions);
      if (inc !== undefined) {
        incoming = inc;
        const rawStart = prev.end - inc.duration;
        if (rawStart < prev.start) {
          diagnostics.push({
            level: "error",
            code: "TRANSITION_TOO_LONG",
            message: `Transition "${inc.type}" (${inc.duration}s) between "${prev.scene.name}" and "${scene.name}" is not shorter than scene "${prev.scene.name}" (${prev.scene.duration}s); start clamped to ${prev.start}s`,
            scene: scene.name,
          });
          start = prev.start;
        } else {
          start = rawStart;
        }
      } else {
        start = prev.end; // cut / 未声明 → 不重叠
      }
    }
    timings.push({ scene, start, end: start + scene.duration, ...(incoming !== undefined ? { incoming } : {}) });
  }
  for (const t of program.transitions) {
    if (!applied.has(t)) {
      diagnostics.push({
        level: "warning",
        code: "TRANSITION_UNMATCHED",
        message: `Transition "${t.type}" between [${t.between.join(", ")}] does not apply to any consecutive scene pair (or was superseded by an earlier declaration)`,
      });
    }
  }
  return timings;
}
