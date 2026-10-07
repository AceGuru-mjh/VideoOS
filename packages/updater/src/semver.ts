// 极简 semver：只覆盖 VideoOS 发版实际使用的 `x.y.z` 与 `x.y.z-预发布` 形态
// （版本 SSOT packages/core/src/version.ts 恒为纯 x.y.z；预发布仅出现在 beta 渠道 tag）。
// 不引第三方库 —— parse / compare / diff 三件事足够支撑升级决策。
export type ReleaseType = "none" | "patch" | "minor" | "major";

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** 预发布标识（如 "beta.1"）；正式版为 null */
  prerelease: string | null;
}

/** 解析版本号（容忍 v 前缀与首尾空白）；不合法返回 null */
export function parseVersion(input: string): ParsedVersion | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z][0-9A-Za-z.-]*))?$/.exec(input.trim());
  if (m === null) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ?? null,
  };
}

/** 校验是否为合法版本号字符串 */
export function isVersion(input: string): boolean {
  return parseVersion(input) !== null;
}

/** 单个预发布标识比较：纯数字按数值序，且数字 < 字母（semver §11） */
function cmpPrereleaseId(a: string, b: string): number {
  const aNum = /^\d+$/.test(a);
  const bNum = /^\d+$/.test(b);
  if (aNum && bNum) {
    const an = Number(a);
    const bn = Number(b);
    return an < bn ? -1 : an > bn ? 1 : 0;
  }
  if (aNum) return -1;
  if (bNum) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 预发布段比较：正式版 > 预发布；同为预发布按点分标识逐个比较 */
function cmpPrerelease(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const as = a.split(".");
  const bs = b.split(".");
  const n = Math.min(as.length, bs.length);
  for (let i = 0; i < n; i++) {
    const c = cmpPrereleaseId(as[i] ?? "", bs[i] ?? "");
    if (c !== 0) return c;
  }
  return as.length < bs.length ? -1 : as.length > bs.length ? 1 : 0;
}

function cmpParsed(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return cmpPrerelease(a.prerelease, b.prerelease);
}

/**
 * 版本比较：a < b → 负数；相等 → 0；a > b → 正数。
 * 任一解析失败抛错（调用方应先用 isVersion 防御）。
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (pa === null) throw new Error(`无效版本号："${a}"（期望 x.y.z 形态）`);
  if (pb === null) throw new Error(`无效版本号："${b}"（期望 x.y.z 形态）`);
  return cmpParsed(pa, pb);
}

/**
 * 升级类型判定：next 比 current 新时返回 major/minor/patch；
 * 持平、回退或任一无法解析 → "none"（保守：不当升级处理）。
 * 预发布版本（如 0.4.0-beta.1）不视为可升级目标 —— OpenCode 语义里 beta 只提示不自动装。
 */
export function versionDiff(current: string, next: string): ReleaseType {
  const a = parseVersion(current);
  const b = parseVersion(next);
  if (a === null || b === null) return "none";
  if (b.prerelease !== null) return "none";
  if (cmpParsed(a, b) >= 0) return "none";
  if (b.major > a.major) return "major";
  if (b.minor > a.minor) return "minor";
  return "patch";
}
