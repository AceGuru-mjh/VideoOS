// @videoos/updater —— OpenCode 式 CLI 自更新（v1：GitHub Releases 单渠道）。
//
// 语义（对齐 OpenCode）：
//   - 检查节流：24h 内只真正请求一次远端（cache/latest.json，--force 可跳过）
//   - 安全底线：产物必须带 sha256 校验和（checksums.txt 或 <asset>.sha256），
//     缺失或不匹配 → 拒绝安装
//   - 绝不替换正在运行的二进制：新版本解压到 versions/<v>/ + current.json 原子切换，
//     下次启动生效；旧版本保留供回滚（LRU 3 个）
//   - patch + autoupdate=true + binary-managed → 后台静默装；minor/major 或 notify → 只提示
//   - VIDEOOS_DISABLE_AUTOUPDATE 非空 → 完全禁用（检查也跳过，直接返回不可用态）
//
// 运行环境约束：bun / node / Electron 主进程均可跑 —— 只用 node: 内建与全局 fetch，禁 Bun.* API。
import { execFile } from "node:child_process";
import { existsSync, rmSync, renameSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { VIDEOOS_VERSION } from "@videoos/core";
import { UpdaterEmitter } from "./events";
import { GitHubReleasesProvider, RELEASES_PAGE_URL } from "./github";
import { UpdaterError } from "./provider";
import type { Channel, FetchLike, ReleaseAsset, ReleaseInfo, UpdateProvider } from "./provider";
import { isVersion, versionDiff } from "./semver";
import type { ReleaseType } from "./semver";
import { UpdateStore } from "./store";
import type { CurrentRecord, InstalledVersion } from "./store";
import { downloadFile } from "./download";
import { parseChecksums, verifyAsset } from "./verify";

export type UpdateMode = true | "notify" | false;
export type InstallMode = "source" | "binary-managed" | "binary-standalone";

/** 检查节流窗口（OpenCode 同款 24h） */
export const CHECK_THROTTLE_MS = 24 * 60 * 60 * 1000;
/** LRU 保留的版本数（含 current） */
export const KEEP_VERSIONS = 3;

const execFileAsync = promisify(execFile);

export interface UpdaterOptions {
  /** 更新渠道（默认 stable；beta 含 GitHub prerelease） */
  channel?: Channel;
  /** GitHub token（缺省读 VIDEOOS_GITHUB_TOKEN；可空） */
  token?: string;
  /** fetch 注入（测试离线化） */
  fetchImpl?: FetchLike;
  /** 覆盖状态目录（默认按平台：LOCALAPPDATA / ~/Library/Application Support / XDG_DATA） */
  baseDir?: string;
  /** 时钟注入（测试节流） */
  now?: () => number;
  /** 更新源注入（测试用内存实现） */
  provider?: UpdateProvider;
  /** 当前版本覆盖（默认 SSOT VIDEOOS_VERSION；测试注入） */
  currentVersion?: string;
  /** 平台覆盖（默认 process.platform；测试注入） */
  platform?: NodeJS.Platform;
  /** 架构覆盖（默认 process.arch；测试注入） */
  arch?: string;
}

export interface UpdateState {
  current: string;
  latest: string;
  available: boolean;
  type: ReleaseType;
  channel: Channel;
  latestRelease: ReleaseInfo | null;
  checkedAt: number;
  /** true = 命中 24h 节流缓存（未发网络请求） */
  fromCache: boolean;
  /** VIDEOOS_DISABLE_AUTOUPDATE 生效时为 true */
  disabled: boolean;
}

export interface UpgradeResult {
  from: string;
  to: string;
  /** 新版本解压目录（versions/<v>/） */
  path: string;
  /** LRU 清理掉的旧版本 */
  removed: string[];
}

export interface RollbackResult {
  from: string;
  to: string;
  path: string;
}

export class Updater extends UpdaterEmitter {
  readonly currentVersion: string;
  private readonly channel: Channel;
  private readonly store: UpdateStore;
  private readonly provider: UpdateProvider;
  private readonly fetchImpl: FetchLike | undefined;
  private readonly nowFn: () => number;
  private readonly platform: NodeJS.Platform;
  private readonly arch: string;

  constructor(opts: UpdaterOptions = {}) {
    super();
    this.currentVersion = opts.currentVersion ?? VIDEOOS_VERSION;
    this.channel = opts.channel ?? "stable";
    this.store = new UpdateStore(opts.baseDir);
    this.provider =
      opts.provider ??
      new GitHubReleasesProvider({
        ...(opts.token !== undefined ? { token: opts.token } : {}),
        ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
      });
    this.fetchImpl = opts.fetchImpl;
    this.nowFn = opts.now ?? Date.now;
    this.platform = opts.platform ?? process.platform;
    this.arch = opts.arch ?? process.arch;
  }

  get baseDir(): string {
    return this.store.baseDir;
  }

  /**
   * 检查更新（24h 节流：cache/latest.json 的 checkedAt，force 可跳过）。
   * VIDEOOS_DISABLE_AUTOUPDATE 非空 → 不发请求，直接返回不可用态。
   */
  async getUpdateState(opts: { force?: boolean } = {}): Promise<UpdateState> {
    const force = opts.force === true;
    const now = this.nowFn();
    const disabled = process.env.VIDEOOS_DISABLE_AUTOUPDATE !== undefined && process.env.VIDEOOS_DISABLE_AUTOUPDATE !== "";
    const cache = this.store.readLatestCache();

    if (disabled) {
      return {
        current: this.currentVersion,
        latest: this.currentVersion,
        available: false,
        type: "none",
        channel: this.channel,
        latestRelease: null,
        checkedAt: cache !== null ? cache.checkedAt : now,
        fromCache: cache !== null,
        disabled: true,
      };
    }

    // 节流命中：同渠道且 24h 内检查过 → 用缓存结果（对当前版本重新推导 available/type）
    if (
      !force &&
      cache !== null &&
      cache.channel === this.channel &&
      now - cache.checkedAt < CHECK_THROTTLE_MS
    ) {
      return this.stateFromRelease(cache.release, cache.checkedAt, true);
    }

    let release: ReleaseInfo | null;
    try {
      release = await this.provider.latest(this.channel);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.emit("failed", { phase: "check", error: message });
      throw err;
    }
    const checkedAt = this.nowFn();
    this.store.writeLatestCache({ release, etag: null, checkedAt, channel: this.channel });
    return this.stateFromRelease(release, checkedAt, false);
  }

  private stateFromRelease(release: ReleaseInfo | null, checkedAt: number, fromCache: boolean): UpdateState {
    const latest = release !== null ? release.version : this.currentVersion;
    const type = release !== null ? versionDiff(this.currentVersion, release.version) : "none";
    const available = type !== "none";
    if (available && release !== null) {
      this.emit("update-available", { current: this.currentVersion, latest: release.version, type });
    }
    return {
      current: this.currentVersion,
      latest,
      available,
      type,
      channel: this.channel,
      latestRelease: release,
      checkedAt,
      fromCache,
      disabled: false,
    };
  }

  /** 最近 limit 个 Release（时间倒序） */
  async listReleases(limit = 10): Promise<ReleaseInfo[]> {
    return this.provider.list(limit, this.channel);
  }

  /**
   * 安装指定版本（升/降级同一命令）：
   * 选平台资产 → 下载 → sha256 校验 → 解压到 versions/<v>/ → current.json 原子切换 → LRU 清理。
   * 绝不替换正在运行的二进制（新版本下次启动生效）。
   */
  async upgradeTo(version: string, opts: { onProgress?: (received: number, total: number) => void } = {}): Promise<UpgradeResult> {
    const bare = version.startsWith("v") ? version.slice(1) : version;
    if (!isVersion(bare)) {
      throw new UpdaterError("BAD_VERSION", `无效版本号 "${version}"（期望 x.y.z 形态，如 0.3.1）`);
    }

    let release: ReleaseInfo | null;
    try {
      release = await this.provider.release(bare);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.emit("failed", { phase: "check", error: message });
      throw err;
    }
    if (release === null) {
      throw new UpdaterError("NO_RELEASE", `未找到版本 v${bare} 的 Release；请到 ${RELEASES_PAGE_URL} 确认版本号`);
    }

    // 1) 平台资产选择（命名约定 videoos-{platform}-{arch}.tar.gz；windows 为 .zip）
    const asset = selectAsset(release, this.platform, this.arch);
    if (asset === null) {
      const want = platformAssetName(this.platform, this.arch);
      throw new UpdaterError(
        "NO_ASSET",
        `版本 v${bare} 没有平台资产 ${want}；请到 ${RELEASES_PAGE_URL} 查看可用产物或联系维护者`,
      );
    }

    // 2) 校验和资产（checksums.txt 优先，其次 <asset>.sha256）—— 安全优先：缺失拒绝安装
    const checksumAsset =
      release.assets.find((a) => a.name === "checksums.txt") ??
      release.assets.find((a) => a.name === `${asset.name}.sha256`);
    if (checksumAsset === undefined) {
      throw new UpdaterError(
        "NO_CHECKSUM",
        `版本 v${bare} 缺少校验和资产（checksums.txt 或 ${asset.name}.sha256）—— 无法验证产物完整性，拒绝安装。` +
          `请到 ${RELEASES_PAGE_URL} 反馈或手动下载`,
      );
    }

    // 3) 下载资产 + 校验和
    const downloadsDir = join(this.store.baseDir, "downloads");
    const archivePath = join(downloadsDir, asset.name);
    const checksumPath = join(downloadsDir, checksumAsset.name);
    try {
      const bytes = await downloadFile(asset.url, archivePath, {
        ...(this.fetchImpl !== undefined ? { fetchImpl: this.fetchImpl } : {}),
        ...(opts.onProgress !== undefined ? { onProgress: opts.onProgress } : {}),
      });
      this.emit("downloaded", { version: bare, name: asset.name, bytes });
      await downloadFile(checksumAsset.url, checksumPath, {
        ...(this.fetchImpl !== undefined ? { fetchImpl: this.fetchImpl } : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.emit("failed", { phase: "download", error: message });
      throw err;
    }

    // 4) sha256 校验
    let expected: string | undefined;
    try {
      if (checksumAsset.name === "checksums.txt") {
        const map = parseChecksums(await readFile(checksumPath, "utf8"));
        expected = map.get(asset.name);
        if (expected === undefined) {
          throw new UpdaterError(
            "CHECKSUM_MISSING_ENTRY",
            `checksums.txt 中没有 ${asset.name} 的条目 —— 拒绝安装；请到 ${RELEASES_PAGE_URL} 反馈`,
          );
        }
      } else {
        expected = await readFile(checksumPath, "utf8");
      }
    } catch (err) {
      if (err instanceof UpdaterError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw new UpdaterError("CHECKSUM_READ", `读取校验和失败：${message}`);
    }
    const verified = await verifyAsset(archivePath, expected).catch(() => false);
    if (!verified) {
      // 拒绝安装并清空整个下载缓存（防半截/损坏文件残留）
      rmSync(downloadsDir, { recursive: true, force: true });
      throw new UpdaterError(
        "CHECKSUM_MISMATCH",
        `校验和不匹配（${asset.name}）—— 下载可能损坏或被篡改，已拒绝安装并删除下载缓存。请重试；持续失败请到 ${RELEASES_PAGE_URL} 手动下载`,
      );
    }

    // 5) 解压到 versions/<v>/（staging 目录先解压校验，再原子 rename 落位）
    const targetDir = this.store.versionDir(bare);
    const stagingDir = join(this.store.versionsDir, `.staging-${bare}-${String(this.nowFn())}`);
    try {
      await mkdir(this.store.versionsDir, { recursive: true });
      await mkdir(stagingDir, { recursive: true });
      await extractArchive(archivePath, stagingDir);
      rmSync(targetDir, { recursive: true, force: true });
      renameSync(stagingDir, targetDir);
    } catch (err) {
      rmSync(stagingDir, { recursive: true, force: true });
      const message = err instanceof Error ? err.message : String(err);
      this.emit("failed", { phase: "extract", error: message });
      if (err instanceof UpdaterError) throw err;
      throw new UpdaterError("EXTRACT", `解压失败：${message}`);
    }

    // 6) current.json 原子切换 + LRU 清理 + 下载缓存清理
    const from = this.currentVersion;
    this.store.switchTo(bare, this.nowFn());
    const removed = this.store.lruTrim(KEEP_VERSIONS);
    rmSync(downloadsDir, { recursive: true, force: true });

    this.emit("updated", { from, to: bare });
    return { from, to: bare, path: targetDir, removed };
  }

  /** 回滚到上一个版本（current.previous）；目标已被 LRU 清理 → 报错并给出重装指引 */
  async rollback(): Promise<RollbackResult> {
    const current = this.store.readCurrent();
    const previous = this.store.previousVersion();
    if (current === null || previous === null) {
      throw new UpdaterError(
        "NO_PREVIOUS",
        "没有可回滚的版本（无切换历史）。可用 `videoos upgrade <version>` 安装任意历史版本",
      );
    }
    const targetDir = this.store.versionDir(previous);
    if (!existsSync(targetDir)) {
      throw new UpdaterError(
        "ROLLBACK_MISSING",
        `回滚目标 v${previous} 的文件已被清理（只保留最近 ${String(KEEP_VERSIONS)} 个版本）。可重新安装：videoos upgrade ${previous}`,
      );
    }
    this.store.switchTo(previous, this.nowFn());
    this.emit("updated", { from: current.version, to: previous });
    return { from: current.version, to: previous, path: targetDir };
  }

  /** 已安装版本列表（安装时间倒序；含 current 标记） */
  listInstalled(): InstalledVersion[] {
    return this.store.listInstalled();
  }

  /** 当前指向（current.json 原文；可能 null） */
  currentRecord(): CurrentRecord | null {
    return this.store.readCurrent();
  }

  /** 上一个已安装版本（无切换历史 → null） */
  previousVersion(): string | null {
    return this.store.previousVersion();
  }

  /** 标记"已就该版本提示过用户"（update-notifier 风格：每版本只提示一次） */
  markNotified(version: string): void {
    const cache = this.store.readLatestCache();
    if (cache === null) return;
    this.store.writeLatestCache({ ...cache, notifiedVersion: version });
  }

  /** 已提示过的版本（未提示过为 null） */
  notifiedVersion(): string | null {
    return this.store.readLatestCache()?.notifiedVersion ?? null;
  }
}

// ---------------------------------------------------------------------------
// 平台资产选择（命名约定必须与 release.yml 产物名一致）
// ---------------------------------------------------------------------------

/** 资产命名：videoos-{linux|darwin|windows}-{x64|arm64}.tar.gz（windows 用 .zip） */
export function platformAssetName(platform: NodeJS.Platform, arch: string): string {
  const p = platform === "win32" ? "windows" : platform;
  const ext = platform === "win32" ? "zip" : "tar.gz";
  return `videoos-${p}-${arch}.${ext}`;
}

function selectAsset(release: ReleaseInfo, platform: NodeJS.Platform, arch: string): ReleaseAsset | null {
  const primary = release.assets.find((a) => a.name === platformAssetName(platform, arch));
  if (primary !== undefined) return primary;
  // windows：zip 为主，但 tar.gz 同样可解（Win10+ bsdtar），作为兼容回退
  if (platform === "win32") {
    return release.assets.find((a) => a.name === `videoos-windows-${arch}.tar.gz`) ?? null;
  }
  return null;
}

/** tar 解压（tar.gz 与 zip 均可 —— Win10+ 自带 bsdtar；linux/macOS 系统自带 tar） */
async function extractArchive(archive: string, destDir: string): Promise<void> {
  try {
    await execFileAsync("tar", ["-xf", archive, "-C", destDir]);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (/ENOENT|not found|not recognized/i.test(reason)) {
      throw new UpdaterError(
        "NO_TAR",
        `系统缺少 tar 命令（Windows 需 10 1809+；或手动解压 ${archive} 到 ${destDir}）：${reason}`,
      );
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 安装形态探测 / 自动更新策略（OpenCode 语义）
// ---------------------------------------------------------------------------

export interface InstallModeProbe {
  execPath?: string;
  argv1?: string;
}

/**
 * 安装形态探测：
 *   binary-managed —— 可执行文件位于 versions/<v>/ 目录（updater 安装的版本，可自动更新）
 *   source         —— 源码模式（apps/cli/src/ 或附近有 .git）→ 提示 git pull
 *   binary-standalone —— 独立二进制（用户手动放置）→ 升级走 upgradeTo，但默认不自动
 */
export function detectInstallMode(probe: InstallModeProbe = {}): InstallMode {
  // 注意区分「未提供」与「显式 undefined」：测试注入 argv1: undefined 时不得回退到真实 argv（否则会被测试进程自身的仓库路径干扰）
  const execPath = "execPath" in probe ? probe.execPath : process.execPath;
  const argv1 = "argv1" in probe ? probe.argv1 : process.argv[1];
  const candidates = [execPath, argv1].filter((p): p is string => typeof p === "string" && p.length > 0);

  for (const p of candidates) {
    if (/(?:^|[\\/])versions[\\/][^\\/]+[\\/]/.test(p)) return "binary-managed";
  }
  for (const p of candidates) {
    if (p.includes("apps/cli/src") || p.includes(`apps${"\\"}cli${"\\"}src`)) return "source";
  }
  // 附近（向上至多 6 级）有 .git → 源码检出里跑的脚本/解释器
  for (const p of candidates) {
    if (hasGitAncestor(dirname(p), 6)) return "source";
  }
  return "binary-standalone";
}

function hasGitAncestor(dir: string, maxUp: number): boolean {
  let current = dir;
  for (let i = 0; i < maxUp; i++) {
    if (existsSync(join(current, ".git"))) return true;
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
  return false;
}

/**
 * 解析自动更新策略（环境变量 VIDEOOS_AUTOUPDATE）：
 *   true（默认）—— OpenCode 同款：managed 形态下 patch 后台静默装
 *   "notify"     —— 只提示，不自动装
 *   false        —— 完全关闭（"false"/"0"/"no"/"off"）
 * VIDEOOS_DISABLE_AUTOUPDATE 非空 → 强制 false。
 */
export function resolveUpdateMode(): UpdateMode {
  const disable = process.env.VIDEOOS_DISABLE_AUTOUPDATE;
  if (disable !== undefined && disable !== "") return false;
  const raw = process.env.VIDEOOS_AUTOUPDATE;
  if (raw === undefined || raw === "") return true;
  const v = raw.toLowerCase();
  if (v === "false" || v === "0" || v === "no" || v === "off") return false;
  if (v === "notify") return "notify";
  return true;
}

/** OpenCode 自动装判定：仅 patch + autoupdate=true + binary-managed 才后台静默装 */
export function shouldAutoInstall(type: ReleaseType, mode: UpdateMode, installMode: InstallMode): boolean {
  return type === "patch" && mode === true && installMode === "binary-managed";
}

export { UpdaterError } from "./provider";
export { GitHubReleasesProvider, DEFAULT_GITHUB_REPO, RELEASES_PAGE_URL } from "./github";
export { defaultBaseDir, UpdateStore } from "./store";
export type { LatestCache, CurrentRecord, InstalledVersion } from "./store";
export { sha256File, parseChecksums, verifyAsset } from "./verify";
export { downloadFile } from "./download";
export type { DownloadOptions } from "./download";
export type { Channel, ReleaseAsset, ReleaseInfo, UpdateProvider, FetchLike, FetchLikeInit } from "./provider";
export { compareVersions, isVersion, parseVersion, versionDiff } from "./semver";
export type { ParsedVersion, ReleaseType } from "./semver";
export type { UpdaterEventPayloads, UpdaterEventName, UpdaterHandler } from "./events";
export { UpdaterEmitter } from "./events";
