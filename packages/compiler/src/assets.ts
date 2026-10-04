// 资产注册表：确定性 id（asset_<type>_<sanitizedKey>）与图层 uses 推导
import type { VirAssetRef, VirAudioClip, VirLayer } from "@videoos/vir";
import type { ParsedScene } from "./parse";
import type { Diagnostic } from "./diagnostics";

/** 路径/族名 → 小写 [a-z0-9_] 键（用于派生 asset id；注意理论碰撞由 ASSET_ID_COLLISION 诊断兜底） */
export function sanitizeAssetKey(value: string): string {
  const key = value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return key.length > 0 ? key : "unnamed";
}

export const imageAssetId = (src: string): string => `asset_image_${sanitizeAssetKey(src)}`;
/** 字体资产 src 为合成标识 "font:<family>"；id 直接取 family（避免 asset_font_font_ 双前缀） */
export const fontAssetId = (family: string): string => `asset_font_${sanitizeAssetKey(family)}`;
export const audioAssetId = (src: string): string => `asset_audio_${sanitizeAssetKey(src)}`;

export interface AssetRegistry {
  assets: VirAssetRef[];
  imageId: typeof imageAssetId;
  fontId: typeof fontAssetId;
  audioId: typeof audioAssetId;
}

/**
 * 注册顺序（即 VIR assets 数组顺序，确定性）：场景序 → 图层序（image.src、text.font），最后 audio.src。
 * 相同 src 去重；sanitized id 相同但 src 不同 → ASSET_ID_COLLISION 警告。
 */
export function buildAssetRegistry(
  scenes: readonly ParsedScene[],
  audio: readonly VirAudioClip[],
  diagnostics: Diagnostic[],
): AssetRegistry {
  const byId = new Map<string, VirAssetRef>();
  const ensure = (ref: VirAssetRef): void => {
    const existing = byId.get(ref.id);
    if (existing !== undefined) {
      if (existing.src !== ref.src) {
        diagnostics.push({
          level: "warning",
          code: "ASSET_ID_COLLISION",
          message: `Assets "${existing.src}" and "${ref.src}" sanitize to the same id "${ref.id}"; the first registration is kept`,
        });
      }
      return;
    }
    byId.set(ref.id, ref);
  };
  for (const scene of scenes) {
    for (const layer of scene.layers) {
      if (layer.type === "image" && layer.src !== undefined) {
        ensure({ id: imageAssetId(layer.src), type: "image", src: layer.src });
      } else if (layer.type === "text") {
        ensure({ id: fontAssetId(layer.text.font), type: "font", src: `font:${layer.text.font}` });
      }
    }
  }
  for (const clip of audio) {
    ensure({ id: audioAssetId(clip.src), type: "audio", src: clip.src });
  }
  return { assets: [...byId.values()], imageId: imageAssetId, fontId: fontAssetId, audioId: audioAssetId };
}

/** 图层依赖的资产 id（text → 字体；image → 图片；其余为空） */
export function layerUses(layer: VirLayer, registry: AssetRegistry): string[] {
  if (layer.type === "image" && layer.src !== undefined) return [registry.imageId(layer.src)];
  if (layer.type === "text") return [registry.fontId(layer.text.font)];
  return [];
}
