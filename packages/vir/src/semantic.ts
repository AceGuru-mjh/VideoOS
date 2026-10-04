// 语义索引：命名实体（scene/beat/layer）→ 全局帧号/时间的确定性映射
import { secondsToFrames } from "@videoos/core";
import type { Vir, VirBeat, VirLayer } from "./types";

/** 语义查找失败（场景/节拍不存在） */
export class SemanticError extends Error {
  readonly code = "SEMANTIC_NOT_FOUND";
  constructor(message: string) {
    super(message);
    this.name = "SemanticError";
  }
}

export interface SceneInfo {
  id: string; name: string;
  start: number; end: number; duration: number;
  frameStart: number; frameEnd: number;   // frameEnd 为排他边界（frameStart + secondsToFrames(duration)）
  beats: VirBeat[];
  layerIds: string[];
}

export interface SemanticIndex {
  scenes: SceneInfo[];
  totalFrames: number;
  totalDuration: number;
  /** 全局帧号 = 场景起始帧 + beat.at(+offsetSeconds) 对应帧（四舍五入） */
  frameOf(sceneName: string, beatName?: string, offsetSeconds?: number): number;
  timeOf(sceneName: string, beatName?: string): number;
  /** 时间所在场景；重叠段返回先启动（出场）的场景；越界返回 null */
  sceneAt(time: number): SceneInfo | null;
  layer(vir: Vir, sceneName: string, layerName: string): VirLayer | undefined;
  beatFrames(sceneName: string): { name: string; frame: number }[];
}

export function buildSemanticIndex(vir: Vir): SemanticIndex {
  const fps = vir.meta.fps;
  const scenes: SceneInfo[] = vir.scenes.map((scene) => {
    const frameStart = secondsToFrames(scene.start, fps);
    return {
      id: scene.id,
      name: scene.name,
      start: scene.start,
      end: scene.start + scene.duration,
      duration: scene.duration,
      frameStart,
      frameEnd: frameStart + secondsToFrames(scene.duration, fps),
      beats: scene.beats,
      layerIds: scene.layers.map((layer) => layer.id),
    };
  });
  const byName = new Map<string, SceneInfo>(scenes.map((scene) => [scene.name, scene] as const));
  const requireScene = (sceneName: string): SceneInfo => {
    const scene = byName.get(sceneName);
    if (scene === undefined) throw new SemanticError(`Scene not found: "${sceneName}"`);
    return scene;
  };
  const requireBeat = (scene: SceneInfo, beatName: string): VirBeat => {
    const beat = scene.beats.find((b) => b.name === beatName);
    if (beat === undefined) {
      throw new SemanticError(`Beat "${beatName}" not found in scene "${scene.name}"`);
    }
    return beat;
  };
  const totalDuration = vir.meta.duration;

  return {
    scenes,
    totalFrames: secondsToFrames(totalDuration, fps),
    totalDuration,
    frameOf(sceneName: string, beatName?: string, offsetSeconds = 0): number {
      const scene = requireScene(sceneName);
      let t = offsetSeconds;
      if (beatName !== undefined) t += requireBeat(scene, beatName).at;
      return scene.frameStart + secondsToFrames(t, fps);
    },
    timeOf(sceneName: string, beatName?: string): number {
      const scene = requireScene(sceneName);
      if (beatName === undefined) return scene.start;
      return scene.start + requireBeat(scene, beatName).at;
    },
    sceneAt(time: number): SceneInfo | null {
      // 重叠段约定：返回“先启动”的场景（与 FramePlan.sceneId = 主场景一致）
      for (const scene of scenes) {
        if (scene.start <= time && time < scene.end) return scene;
      }
      return null;
    },
    layer(vir: Vir, sceneName: string, layerName: string): VirLayer | undefined {
      const scene = vir.scenes.find((s) => s.name === sceneName);
      if (scene === undefined) return undefined;
      return scene.layers.find((l) => l.name === layerName);
    },
    beatFrames(sceneName: string): { name: string; frame: number }[] {
      const scene = requireScene(sceneName);
      return scene.beats.map((beat) => ({ name: beat.name, frame: scene.frameStart + secondsToFrames(beat.at, fps) }));
    },
  };
}
