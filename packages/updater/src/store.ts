// 更新状态本地存储（OpenCode 式版本目录布局）：
//   <base>/cache/latest.json   —— 最近一次检查结果 {release, etag, checkedAt, channel, notifiedVersion?}
//   <base>/versions/<v>/       —— 各已安装版本（解压后的二进制）
//   <base>/current.json        —— 当前指向 {version, switchedAt, previous}
//   <base>/downloads/          —— 升级过程中的临时下载（完成后即清理）
// 平台基目录：
//   win   %LOCALAPPDATA%/videoos/updater（缺省回退 ~/AppData/Local）
//   mac   ~/Library/Application Support/videoos/updater
//   linux $XDG_DATA_HOME/videoos/updater（缺省 ~/.local/share）
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import process from "node:process";
import { join, dirname } from "node:path";
import type { ReleaseInfo } from "./provider";

/** 平台默认更新目录（pf 可注入：测试跨平台断言） */
export function defaultBaseDir(pf: NodeJS.Platform = process.platform): string {
  if (pf === "win32") {
    const local = process.env.LOCALAPPDATA;
    const base = local !== undefined && local.length > 0 ? local : join(homedir(), "AppData", "Local");
    return join(base, "videoos", "updater");
  }
  if (pf === "darwin") return join(homedir(), "Library", "Application Support", "videoos", "updater");
  const xdg = process.env.XDG_DATA_HOME;
  const data = xdg !== undefined && xdg.length > 0 ? xdg : join(homedir(), ".local", "share");
  return join(data, "videoos", "updater");
}

export interface LatestCache {
  release: ReleaseInfo | null;
  etag: string | null;
  /** 最近一次检查时间（epoch ms；24h 节流依据） */
  checkedAt: number;
  /** 该缓存对应的渠道（换渠道检查视为过期） */
  channel: string;
  /** 已提示过新版本的存在（update-notifier 风格：每版本只提示一次） */
  notifiedVersion?: string;
}

export interface CurrentRecord {
  version: string;
  switchedAt: number;
  /** 切换前的版本（rollback 目标；无历史为 null） */
  previous: string | null;
}

export interface InstalledVersion {
  version: string;
  path: string;
  /** 安装时间（以版本目录 mtime 近似） */
  installedAt: number;
  current: boolean;
}

/** JSON 原子写入：先写 tmp 再 rename（中途断电不留半截文件） */
function writeJsonAtomic(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

function readJson(path: string): unknown {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function asLatestCache(raw: unknown): LatestCache | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as { release?: unknown; etag?: unknown; checkedAt?: unknown; channel?: unknown; notifiedVersion?: unknown };
  if (typeof r.checkedAt !== "number" || typeof r.channel !== "string") return null;
  if (r.release !== null && typeof r.release !== "object") return null;
  return {
    release: (r.release ?? null) as ReleaseInfo | null,
    etag: typeof r.etag === "string" ? r.etag : null,
    checkedAt: r.checkedAt,
    channel: r.channel,
    ...(typeof r.notifiedVersion === "string" ? { notifiedVersion: r.notifiedVersion } : {}),
  };
}

function asCurrentRecord(raw: unknown): CurrentRecord | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as { version?: unknown; switchedAt?: unknown; previous?: unknown };
  if (typeof r.version !== "string" || typeof r.switchedAt !== "number") return null;
  return { version: r.version, switchedAt: r.switchedAt, previous: typeof r.previous === "string" ? r.previous : null };
}

export class UpdateStore {
  readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? defaultBaseDir();
  }

  get versionsDir(): string {
    return join(this.baseDir, "versions");
  }

  get cachePath(): string {
    return join(this.baseDir, "cache", "latest.json");
  }

  get currentPath(): string {
    return join(this.baseDir, "current.json");
  }

  versionDir(version: string): string {
    return join(this.versionsDir, version);
  }

  // ---- 检查缓存（24h 节流） ----

  readLatestCache(): LatestCache | null {
    return asLatestCache(readJson(this.cachePath));
  }

  writeLatestCache(cache: LatestCache): void {
    writeJsonAtomic(this.cachePath, cache);
  }

  // ---- 当前指向（原子切换） ----

  readCurrent(): CurrentRecord | null {
    return asCurrentRecord(readJson(this.currentPath));
  }

  writeCurrent(record: CurrentRecord): void {
    writeJsonAtomic(this.currentPath, record);
  }

  /** 切换当前版本（记录 previous 供回滚）；返回新记录 */
  switchTo(version: string, now: number): CurrentRecord {
    const old = this.readCurrent();
    const record: CurrentRecord = { version, switchedAt: now, previous: old !== null ? old.version : null };
    this.writeCurrent(record);
    return record;
  }

  /** 回滚目标版本（current.previous；目录不存在由调用方校验） */
  previousVersion(): string | null {
    return this.readCurrent()?.previous ?? null;
  }

  // ---- 已安装版本 ----

  listInstalled(): InstalledVersion[] {
    if (!existsSync(this.versionsDir)) return [];
    const current = this.readCurrent()?.version ?? null;
    const out: InstalledVersion[] = [];
    for (const name of readdirSync(this.versionsDir)) {
      const dir = join(this.versionsDir, name);
      if (!statSync(dir).isDirectory()) continue;
      // 目录名即版本（v1 布局：versions/<v>/）
      let installedAt = 0;
      try {
        installedAt = statSync(dir).mtimeMs;
      } catch {
        installedAt = 0;
      }
      out.push({ version: name, path: dir, installedAt, current: name === current });
    }
    out.sort((a, b) => {
      // 安装时间倒序；同毫秒内完成多次安装（快速脚本）时以版本号倒序兜底，保证 LRU 确定性
      if (b.installedAt !== a.installedAt) return b.installedAt - a.installedAt;
      return b.version.localeCompare(a.version, undefined, { numeric: true });
    });
    return out;
  }

  /**
   * LRU 清理：按安装时间保留最近 keep 个版本（current 永远保留，不计入淘汰）。
   * 返回被清理的版本名列表。
   */
  lruTrim(keep = 3): string[] {
    const installed = this.listInstalled();
    const current = installed.find((v) => v.current);
    const others = installed.filter((v) => !v.current);
    const removable = others.slice(Math.max(keep - (current !== undefined ? 1 : 0), 0));
    const removed: string[] = [];
    for (const v of removable) {
      try {
        rmSync(v.path, { recursive: true, force: true });
        removed.push(v.version);
      } catch {
        // 单个目录清理失败不阻断（下次升级再试）
      }
    }
    return removed;
  }
}
