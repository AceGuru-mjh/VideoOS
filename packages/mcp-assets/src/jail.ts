// 路径监狱（SPEC §3.5 安全基线）：多根 + realpath 防符号链接逃逸
import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";

/** 解析多根 env：Windows 只按 ';' 分隔（盘符含冒号）；POSIX 按 ':' 或 ';'。缺省回落 fallback（resolve 后） */
export function parseRoots(envValue: string | undefined, fallback: string): string[] {
  const raw = (envValue ?? "").trim();
  if (raw.length === 0) return [resolve(fallback)];
  const parts = process.platform === "win32" ? raw.split(";") : raw.split(/[:;]/);
  const roots = parts.map((p) => p.trim()).filter((p) => p.length > 0).map((p) => resolve(p));
  return roots.length > 0 ? roots : [resolve(fallback)];
}

/** realpath 尽力解析：路径不存在时回溯到最近的存在的祖先，再拼回尾部（保留 .. 的规范化效果） */
function realpathBestEffort(p: string): string {
  let cur = resolve(p);
  const tail: string[] = [];
  for (;;) {
    try {
      const real = realpathSync(cur);
      return tail.length === 0 ? real : join(real, ...tail);
    } catch {
      const parent = dirname(cur);
      if (parent === cur) return resolve(p);
      tail.unshift(basename(cur));
      cur = parent;
    }
  }
}

export class JailError extends Error {
  constructor(path: string) {
    super(`path escapes jail: ${path}`);
    this.name = "JailError";
  }
}

export interface PathJail {
  readonly roots: string[];
  /** 校验并规范化用户路径（绝对原样 / 相对按根逐个尝试），越狱抛 JailError */
  resolveIn(userPath: string): string;
}

export function createJail(roots: string[]): PathJail {
  const realRoots = roots.map((r) => realpathBestEffort(r));
  const inside = (candidate: string, root: string): boolean => candidate === root || candidate.startsWith(root + sep);
  return {
    roots,
    resolveIn(userPath: string): string {
      const candidates = isAbsolute(userPath) ? [resolve(userPath)] : roots.map((root) => resolve(root, userPath));
      for (const candidate of candidates) {
        const real = realpathBestEffort(candidate);
        if (realRoots.some((root) => inside(real, root))) return candidate;
      }
      throw new JailError(userPath);
    },
  };
}
