// 路径监狱（agent-kit SPEC §3.5 安全基线）：所有落盘工具（fs/media/sqlite/archive/…）共用。
// 规则：resolve 后必须仍在某个根内；拒绝空字节；符号链接用 realpath 消解后再判前缀 —— 三连测
//（`..` 穿越 / 绝对路径逃逸 / 符号链接逃逸）全部拦截。
import { realpath } from "node:fs/promises";
import { existsSync } from "node:fs";
import { isAbsolute, join, normalize, resolve, sep } from "node:path";
import { ToolError } from "./tool";

export interface PathJail {
  /** 根目录（绝对路径，已 realpath） */
  readonly roots: string[];
  /**
   * 把用户输入路径解析成监狱内绝对路径；越狱/空字节/不存在祖先均抛 ToolError("E_JAIL")。
   * 相对路径相对 roots[0] 解析。
   */
  resolve(userPath: string): Promise<string>;
  /** 同步包含性检查（已 realpath 的绝对路径 → 是否在任一根内） */
  contains(absolute: string): boolean;
}

/** 分隔符感知的前缀判断（root=/a/b 匹配 /a/b 与 /a/b/...，不匹配 /a/bb） */
function isUnder(root: string, candidate: string): boolean {
  if (candidate === root) return true;
  return candidate.startsWith(root.endsWith(sep) ? root : root + sep);
}

/** 最近存在祖先的 realpath（不存在的新文件也能安全判狱：realpath 父目录 + 拼回尾部） */
async function realpathNearest(p: string): Promise<string> {
  let current = p;
  const tail: string[] = [];
  while (!existsSync(current)) {
    const idx = current.lastIndexOf(sep);
    if (idx <= 0) break;
    tail.unshift(current.slice(idx + 1));
    current = current.slice(0, idx);
  }
  const real = await realpath(current);
  return tail.length === 0 ? real : join(real, ...tail);
}

/**
 * 从环境变量构造监狱：envKey（如 "MCP_FS_ROOTS"）→ 冒号/分号分隔多根；
 * 未设置时用 fallbackRoots（缺省 [process.cwd()]）。
 */
export async function jailFromEnv(envKey: string, fallbackRoots: string[] = []): Promise<PathJail> {
  const raw = process.env[envKey];
  const list =
    raw !== undefined && raw.trim().length > 0
      ? raw.split(/[:;]/).filter((s) => s.trim().length > 0)
      : fallbackRoots.length > 0
        ? fallbackRoots
        : [process.cwd()];
  const roots = list.map((r) => normalize(resolve(r)));
  return createJail(roots);
}

/** 显式根列表构造监狱（根本身会被 realpath） */
export async function createJail(roots: string[]): Promise<PathJail> {
  const realRoots: string[] = [];
  for (const root of roots) {
    realRoots.push(await realpathNearest(normalize(resolve(root))));
  }
  return {
    roots: realRoots,
    async resolve(userPath: string): Promise<string> {
      if (typeof userPath !== "string" || userPath.length === 0) {
        throw new ToolError("E_JAIL", "path must be a non-empty string");
      }
      if (userPath.includes("\0")) {
        throw new ToolError("E_JAIL", "path must not contain null bytes");
      }
      const base = realRoots[0];
      if (base === undefined) throw new ToolError("E_JAIL", "jail has no roots");
      const absolute = isAbsolute(userPath) ? normalize(userPath) : resolve(base, userPath);
      const real = await realpathNearest(absolute);
      const inside = realRoots.some((root) => isUnder(root, real));
      if (!inside) {
        throw new ToolError("E_JAIL", `path escapes jail roots (${realRoots.join("; ")})`);
      }
      return real;
    },
    contains(absolute: string): boolean {
      return realRoots.some((root) => isUnder(root, absolute));
    },
  };
}

/** 同步版监狱（不需要 realpath 根的场景；resolve 不做符号链接消解 —— 仅建议只读工具使用） */
export function createSyncJail(roots: string[]): PathJail {
  const realRoots = roots.map((r) => normalize(resolve(r)));
  return {
    roots: realRoots,
    async resolve(userPath: string): Promise<string> {
      if (typeof userPath !== "string" || userPath.length === 0) {
        throw new ToolError("E_JAIL", "path must be a non-empty string");
      }
      if (userPath.includes("\0")) {
        throw new ToolError("E_JAIL", "path must not contain null bytes");
      }
      const base = realRoots[0];
      if (base === undefined) throw new ToolError("E_JAIL", "jail has no roots");
      const absolute = isAbsolute(userPath) ? normalize(userPath) : resolve(base, userPath);
      if (!realRoots.some((root) => isUnder(root, absolute))) {
        throw new ToolError("E_JAIL", `path escapes jail roots (${realRoots.join("; ")})`);
      }
      return absolute;
    },
    contains(absolute: string): boolean {
      return realRoots.some((root) => isUnder(root, absolute));
    },
  };
}
