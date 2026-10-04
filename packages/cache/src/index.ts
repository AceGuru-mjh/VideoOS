// @videoos/cache：内容寻址缓存（SHA-256 哈希工具 + 通用存储 + 帧缓存层）
export { sha256Hex, canonicalJson, virHash, assetHash } from "./hash";
export { ContentStore, CacheError } from "./store";
export type { CacheStats, NamespaceStats } from "./store";
export { frameKey, sceneKey, FrameCache, FRAMES_NAMESPACE } from "./frame-cache";
export type { FrameCacheKeyInput, SceneCacheKeyInput } from "./frame-cache";

/**
 * 渲染后端版本（缓存键 backendVersion 成分，SPEC 附录 B）。
 * 语义：渲染器像素行为（布局/合成/字体回退）发生任何可能改变 PNG 字节的变更时必须提升，
 * 否则旧缓存会掩盖渲染差异。M3 起为 0.1.0。
 */
export const BACKEND_VERSION = "0.1.0";
