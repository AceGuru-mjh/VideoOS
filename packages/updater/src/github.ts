// GitHub Releases 更新源（v1 唯一分发渠道）。
// - UA 头 videoos/<version>（GitHub API 要求 UA，同时便于服务端识别）
// - 可选 token：VIDEOOS_GITHUB_TOKEN（提升匿名 60req/h 的速率限制）
// - etag 缓存：同实例重复请求带 If-None-Match，304 → 直接用缓存体（省流量 + 抗限流）
// - fetchImpl 可注入：测试全离线
import process from "node:process";
import { VIDEOOS_VERSION } from "@videoos/core";
import { UpdaterError } from "./provider";
import type { Channel, FetchLike, ReleaseAsset, ReleaseInfo, UpdateProvider } from "./provider";

export const DEFAULT_GITHUB_REPO = "AceGuru-mjh/VideoOS";
export const RELEASES_PAGE_URL = `https://github.com/${DEFAULT_GITHUB_REPO}/releases`;

export interface GitHubReleasesOptions {
  /** "owner/repo"；默认 AceGuru-mjh/VideoOS */
  repo?: string;
  /** 显式 token；缺省读 VIDEOOS_GITHUB_TOKEN */
  token?: string;
  fetchImpl?: FetchLike;
  /** API 基址（默认 https://api.github.com；测试可指向本地） */
  apiBase?: string;
}

interface CachedBody {
  etag: string | null;
  body: unknown;
}

/** GitHub API release 对象的最小结构收窄（unknown → 字段级判型，无 any） */
interface GithubReleaseShape {
  tag_name: unknown;
  name: unknown;
  draft: unknown;
  prerelease: unknown;
  published_at: unknown;
  body: unknown;
  assets: unknown;
}

function isGithubRelease(raw: unknown): raw is GithubReleaseShape {
  return typeof raw === "object" && raw !== null && "tag_name" in raw && "assets" in raw;
}

function assetFromGithub(raw: unknown): ReleaseAsset | null {
  if (typeof raw !== "object" || raw === null) return null;
  const a = raw as { name?: unknown; browser_download_url?: unknown; size?: unknown };
  if (typeof a.name !== "string" || typeof a.browser_download_url !== "string") return null;
  return { name: a.name, url: a.browser_download_url, size: typeof a.size === "number" ? a.size : 0 };
}

/** GitHub release JSON → ReleaseInfo（缺字段按容错值处理） */
function releaseFromGithub(raw: unknown): ReleaseInfo {
  if (!isGithubRelease(raw)) {
    throw new UpdaterError("PARSE", "GitHub API 返回了无法识别的 Release 结构（可能 API 版本变更）");
  }
  const tag = typeof raw.tag_name === "string" ? raw.tag_name : "";
  const version = tag.startsWith("v") ? tag.slice(1) : tag;
  const assets = Array.isArray(raw.assets)
    ? raw.assets.map(assetFromGithub).filter((a): a is ReleaseAsset => a !== null)
    : [];
  return {
    version,
    tag,
    channel: raw.prerelease === true ? "beta" : "stable",
    publishedAt: typeof raw.published_at === "string" ? raw.published_at : null,
    notes: typeof raw.body === "string" ? raw.body : "",
    assets,
  };
}

export class GitHubReleasesProvider implements UpdateProvider {
  private readonly repo: string;
  private readonly token: string | undefined;
  private readonly fetchImpl: FetchLike;
  private readonly apiBase: string;
  /** etag 缓存（path → {etag, body}）：同实例内 304 复用 */
  private readonly etagCache = new Map<string, CachedBody>();

  constructor(opts: GitHubReleasesOptions = {}) {
    this.repo = opts.repo ?? DEFAULT_GITHUB_REPO;
    const envToken = process.env.VIDEOOS_GITHUB_TOKEN;
    this.token =
      opts.token !== undefined && opts.token.length > 0
        ? opts.token
        : envToken !== undefined && envToken.length > 0
          ? envToken
          : undefined;
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
    this.apiBase = opts.apiBase ?? "https://api.github.com";
  }

  async latest(channel: Channel = "stable"): Promise<ReleaseInfo | null> {
    if (channel === "beta") {
      const list = await this.list(1, "beta");
      return list[0] ?? null;
    }
    const json = await this.getJson(`/repos/${this.repo}/releases/latest`);
    if (json === null) return null;
    return releaseFromGithub(json);
  }

  async list(limit = 10, channel: Channel = "stable"): Promise<ReleaseInfo[]> {
    const perPage = Math.min(Math.max(limit, 1) * 3, 100);
    const json = await this.getJson(`/repos/${this.repo}/releases?per_page=${String(perPage)}`);
    if (json === null || !Array.isArray(json)) return [];
    const all = json.filter(isGithubRelease).map(releaseFromGithub);
    // draft 只在 token 视野内出现，一律排除；stable 渠道再滤掉 prerelease
    const visible = all.filter((r) => r.channel === "beta" || r.channel === "stable");
    const filtered = channel === "beta" ? visible : visible.filter((r) => r.channel === "stable");
    return filtered.slice(0, limit);
  }

  async release(version: string): Promise<ReleaseInfo | null> {
    const bare = version.startsWith("v") ? version.slice(1) : version;
    const json = await this.getJson(`/repos/${this.repo}/releases/tags/v${bare}`);
    if (json === null) return null;
    return releaseFromGithub(json);
  }

  /** GET + JSON；404 → null；304 → etag 缓存体；网络/限流/HTTP 错 → 友好中文 UpdaterError */
  private async getJson(path: string): Promise<unknown> {
    const url = `${this.apiBase}${path}`;
    const cached = this.etagCache.get(path);
    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
      "user-agent": `videoos/${VIDEOOS_VERSION}`,
      "x-github-api-version": "2022-11-28",
    };
    if (this.token !== undefined) headers.authorization = `Bearer ${this.token}`;
    if (cached !== undefined && cached.etag !== null) headers["if-none-match"] = cached.etag;

    let res: Response;
    try {
      res = await this.fetchImpl(url, { method: "GET", headers });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new UpdaterError(
        "NETWORK",
        `网络请求失败（${url}）：${reason}。请检查网络后重试，或到 ${RELEASES_PAGE_URL} 手动下载`,
      );
    }

    if (res.status === 304 && cached !== undefined) return cached.body;
    if (res.status === 404) return null;
    if (res.status === 403 || res.status === 429) {
      throw new UpdaterError(
        "RATE_LIMIT",
        `GitHub API 拒绝访问（HTTP ${String(res.status)}，匿名调用限 60 次/小时）。` +
          (this.token === undefined
            ? "建议设置 VIDEOOS_GITHUB_TOKEN 环境变量后重试"
            : "token 可能过期或无权限，请检查 VIDEOOS_GITHUB_TOKEN"),
      );
    }
    if (!res.ok) {
      throw new UpdaterError("HTTP", `GitHub API HTTP ${String(res.status)} ${res.statusText}（${url}）`);
    }
    let body: unknown;
    try {
      body = (await res.json()) as unknown;
    } catch {
      throw new UpdaterError("PARSE", "GitHub API 返回了非 JSON 内容（网络被劫持或代理异常？）");
    }
    const etag = res.headers.get("etag");
    if (etag !== null) this.etagCache.set(path, { etag, body });
    return body;
  }
}
