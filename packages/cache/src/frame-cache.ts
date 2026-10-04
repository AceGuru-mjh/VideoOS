// 帧缓存层（SPEC §4.4 / 附录 B）：
//   frameKey = SHA256(canonicalJson({virHash, backendId, backendVersion, frame, width, height})) 截断 40 hex
//   sceneKey = SHA256(canonicalJson({virHash, sceneId, backendId, backendVersion})) 截断 40 hex
// 截断 40 hex（160 bit）碰撞概率对帧缓存规模可忽略；完整摘要保留在 canonicalJson 输入中
import { canonicalJson, sha256Hex } from "./hash";
import type { ContentStore } from "./store";

export interface FrameCacheKeyInput {
  virHash: string;
  backendId: string;
  backendVersion: string;
  frame: number;
  width: number;
  height: number;
}

export interface SceneCacheKeyInput {
  virHash: string;
  sceneId: string;
  backendId: string;
  backendVersion: string;
}

export function frameKey(input: FrameCacheKeyInput): string {
  return sha256Hex(canonicalJson({
    backendId: input.backendId,
    backendVersion: input.backendVersion,
    frame: input.frame,
    height: input.height,
    virHash: input.virHash,
    width: input.width,
  })).slice(0, 40);
}

export function sceneKey(input: SceneCacheKeyInput): string {
  return sha256Hex(canonicalJson({
    backendId: input.backendId,
    backendVersion: input.backendVersion,
    sceneId: input.sceneId,
    virHash: input.virHash,
  })).slice(0, 40);
}

/** 帧缓存命名空间（.video/cache/frames/…；SPEC §9） */
export const FRAMES_NAMESPACE = "frames";

/**
 * 帧缓存：命中统计 + PNG 存取。
 * key 为 frameKey 输出（40 hex）；磁盘文件名 `<key>.png`（可读性 + SPEC §4.4 的 .video/cache/frames/<key>.png 语义）。
 */
export class FrameCache {
  private readonly store: ContentStore;
  private _hits = 0;
  private _misses = 0;
  private _writes = 0;

  constructor(store: ContentStore) {
    this.store = store;
  }

  /** 查询命中次数 */
  get hits(): number {
    return this._hits;
  }
  /** 查询未命中次数 */
  get misses(): number {
    return this._misses;
  }
  /** 写入次数 */
  get writes(): number {
    return this._writes;
  }

  resetStats(): void {
    this._hits = 0;
    this._misses = 0;
    this._writes = 0;
  }

  /** 读取缓存帧；不存在返回 null 并计一次 miss */
  async getFrame(key: string): Promise<Buffer | null> {
    const png = await this.store.get(FRAMES_NAMESPACE, `${key}.png`);
    if (png === null) {
      this._misses++;
      return null;
    }
    this._hits++;
    return png;
  }

  /** 写入帧 PNG（计一次 write） */
  async putFrame(key: string, png: Buffer): Promise<void> {
    await this.store.put(FRAMES_NAMESPACE, `${key}.png`, png);
    this._writes++;
  }
}
