// 更新源抽象：GitHub Releases 是 v1 唯一渠道（CLI 未发 npm，无 brew/registry 可探测），
// 接口化以便测试注入内存实现（全离线），未来可扩展 npm / 自建源。
export type Channel = "stable" | "beta";

export interface ReleaseAsset {
  /** 资产文件名（平台命名约定 videoos-{platform}-{arch}.tar.gz / windows 用 .zip） */
  name: string;
  /** 下载直链（GitHub browser_download_url） */
  url: string;
  /** 字节数（进度显示；未知为 0） */
  size: number;
}

export interface ReleaseInfo {
  /** 纯数字版本（无 v 前缀，如 "0.3.1"） */
  version: string;
  /** git 标签（如 "v0.3.1"） */
  tag: string;
  /** 渠道：GitHub prerelease 标记 → beta */
  channel: Channel;
  /** ISO 时间（GitHub published_at；可能缺失） */
  publishedAt: string | null;
  /** 发布说明（release body 原文） */
  notes: string;
  assets: ReleaseAsset[];
}

export interface UpdateProvider {
  /** 最新 Release（stable：最新正式版；beta：最新含预发布）；无任何 Release → null */
  latest(channel?: Channel): Promise<ReleaseInfo | null>;
  /** 最近 limit 个 Release（时间倒序；stable 渠道过滤掉 prerelease） */
  list(limit?: number, channel?: Channel): Promise<ReleaseInfo[]>;
  /** 指定版本（容忍 v 前缀）；不存在 → null */
  release(version: string): Promise<ReleaseInfo | null>;
}

/** fetch 注入签名（测试离线化 / 上层代理；实现只需兼容全局 fetch 的子集） */
export type FetchLike = (input: string, init?: FetchLikeInit) => Promise<Response>;

export interface FetchLikeInit {
  method?: string;
  headers?: Record<string, string>;
}

/** updater 统一错误：code 供 CLI/上层分流提示，message 已是友好中文（含原因与建议动作） */
export class UpdaterError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "UpdaterError";
    this.code = code;
  }
}
