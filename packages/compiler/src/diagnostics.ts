// 编译诊断：Diagnostic 类型 + 收集器（时间窗/溢出/重复 id/资产存在性/颜色/位置/easing/effect）
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { isEasingName, normalizeColor, resolvePosition } from "@videoos/core";
import { isVideoEffect } from "@videoos/dsl";
import type { Vir, VirAssetRef } from "@videoos/vir";
import type { AssetRegistry } from "./assets";

export interface Diagnostic {
  level: "error" | "warning" | "info";
  code: string;
  message: string;
  scene?: string;
  layer?: string;
}

function layerColors(layer: Vir["scenes"][number]["layers"][number]): string[] {
  if (layer.type === "text") return [layer.text.color];
  if (layer.type === "rect") return [layer.rect.fill];
  if (layer.type === "ellipse") return [layer.ellipse.fill];
  return [];
}

export function collectDiagnostics(args: {
  vir: Vir;
  registry: AssetRegistry;
  totalDuration: number;
  assetRoot?: string;
}): Diagnostic[] {
  const { vir, registry, totalDuration, assetRoot } = args;
  const out: Diagnostic[] = [];
  const push = (d: Diagnostic): void => { out.push(d); };

  if (vir.scenes.length === 0) {
    push({ level: "error", code: "NO_SCENES", message: "Video contains no scenes" });
  }

  // ---- 重复 id（场景/图层/节拍/音频/资产 全局唯一） ----
  const seenIds = new Map<string, string>();
  const claimId = (id: string, kind: string, scene?: string, layer?: string): void => {
    const first = seenIds.get(id);
    if (first !== undefined) {
      push({
        level: "error", code: "DUPLICATE_ID",
        message: `Duplicate id "${id}" (${kind}); first seen as ${first}`,
        ...(scene !== undefined ? { scene } : {}), ...(layer !== undefined ? { layer } : {}),
      });
    } else {
      seenIds.set(id, kind);
    }
  };
  for (const scene of vir.scenes) {
    claimId(scene.id, `scene "${scene.name}"`);
    for (const layer of scene.layers) {
      claimId(layer.id, `layer "${layer.name}" in scene "${scene.name}"`, scene.name, layer.name);
    }
    for (const beat of scene.beats) {
      claimId(beat.id, `beat "${beat.name}" in scene "${scene.name}"`, scene.name);
    }
  }
  for (const clip of vir.audio) claimId(clip.id, `audio "${clip.name}"`);
  for (const asset of registry.assets) claimId(asset.id, `asset (${asset.src})`);

  // ---- 颜色格式（meta/scene 背景 + 图层颜色） ----
  try { normalizeColor(vir.meta.background); } catch (err) {
    push({ level: "error", code: "INVALID_COLOR", message: `meta.background: ${(err as Error).message}` });
  }
  for (const scene of vir.scenes) {
    if (scene.background !== undefined) {
      try { normalizeColor(scene.background); } catch (err) {
        push({ level: "error", code: "INVALID_COLOR", message: `Scene "${scene.name}" background: ${(err as Error).message}`, scene: scene.name });
      }
    }
  }

  // ---- 图层级检查 ----
  for (const scene of vir.scenes) {
    for (const layer of scene.layers) {
      const where = { scene: scene.name, layer: layer.name };
      if (layer.out <= layer.in) {
        push({ level: "error", code: "INVALID_TIME_WINDOW", message: `Layer "${layer.name}" has out (${layer.out}) <= in (${layer.in})`, ...where });
      }
      if (layer.out > scene.duration || layer.in >= scene.duration) {
        push({ level: "warning", code: "LAYER_BEYOND_SCENE", message: `Layer "${layer.name}" time window [${layer.in}, ${layer.out}) exceeds scene "${scene.name}" duration (${scene.duration}s); it will be clipped`, ...where });
      }
      if (layer.type === "text" && layer.text.maxWidth !== undefined) {
        const estimated = layer.text.content.length * layer.text.size * 0.62;
        if (estimated > layer.text.maxWidth) {
          push({
            level: "warning", code: "OVERFLOW_RISK",
            message: `Text "${layer.name}" estimated width ${estimated.toFixed(0)}px exceeds maxWidth ${layer.text.maxWidth}px (heuristic: chars × size × 0.62)`,
            ...where,
          });
        }
      }
      if (layer.type === "image" && layer.src === undefined) {
        push({ level: "warning", code: "IMAGE_NO_SRC", message: `Image layer "${layer.name}" has no src; no command will be generated`, ...where });
      }
      for (const color of layerColors(layer)) {
        try { normalizeColor(color); } catch (err) {
          push({ level: "error", code: "INVALID_COLOR", message: `Layer "${layer.name}": ${(err as Error).message}`, ...where });
        }
      }
      for (const anim of layer.animations) {
        if (!isEasingName(anim.easing)) {
          push({ level: "warning", code: "UNKNOWN_EASING", message: `Layer "${layer.name}" animation "${anim.effect}" uses unknown easing "${anim.easing}"; falling back to linear`, ...where });
        }
        if (!isVideoEffect(anim.effect)) {
          push({ level: "warning", code: "UNKNOWN_EFFECT", message: `Layer "${layer.name}" uses unknown animation effect "${anim.effect}"; the animation is ignored`, ...where });
        }
        if ((anim.effect === "typewriter" || anim.effect === "wipe") && layer.type !== "text") {
          push({ level: "warning", code: "EFFECT_UNSUPPORTED", message: `Effect "${anim.effect}" is only representable on text layers (visibleChars/clip); ignored on "${layer.name}" (type ${layer.type})`, ...where });
        }
      }
      try {
        resolvePosition(layer.transform.position, { width: vir.meta.width, height: vir.meta.height });
      } catch (err) {
        push({ level: "error", code: "INVALID_POSITION", message: `Layer "${layer.name}": ${(err as Error).message}`, ...where });
      }
    }
  }

  // ---- 未使用资产（layer.uses ∪ audio 引用 之外的注册资产） ----
  const usedAssetIds = new Set<string>();
  for (const scene of vir.scenes) {
    for (const layer of scene.layers) {
      for (const use of layer.uses) usedAssetIds.add(use);
    }
  }
  for (const clip of vir.audio) usedAssetIds.add(registry.audioId(clip.src));
  for (const asset of registry.assets) {
    if (!usedAssetIds.has(asset.id)) {
      push({ level: "info", code: "UNUSED_ASSET", message: `Asset "${asset.id}" (${asset.src}) is registered but never used` });
    }
  }

  // ---- 音频起点越界 ----
  if (totalDuration > 0) {
    for (const clip of vir.audio) {
      if (clip.start >= totalDuration) {
        push({ level: "warning", code: "AUDIO_OUT_OF_RANGE", message: `Audio "${clip.name}" starts at ${clip.start}s, beyond video duration ${totalDuration}s` });
      }
    }
  }

  // ---- 资产文件存在性（assetRoot 提供时；字体为合成 src，跳过） ----
  if (assetRoot !== undefined) {
    const checkFile = (asset: VirAssetRef): void => {
      const path = isAbsolute(asset.src) ? asset.src : join(assetRoot, asset.src);
      if (!existsSync(path)) {
        push({ level: "error", code: "ASSET_MISSING", message: `Asset file not found: ${asset.src} (resolved: ${path})` });
      }
    };
    for (const asset of registry.assets) {
      if (asset.type === "font") continue;
      checkFile(asset);
    }
  }

  return out;
}
