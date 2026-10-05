// @videoos/mcp-fs — 文件系统 MCP 服务器（Issue #31）。
// 安全基线（SPEC §3.5）：所有路径参数必须先经路径监狱 resolveIn() 规范化
// （绝对路径原样 / 相对路径按根逐个尝试，realpath 防符号链接逃逸），越狱 → 业务失败 { ok: false, error }。
// 监狱根来自环境变量 MCP_FS_ROOTS（多根，POSIX 按 ':' 或 ';' 分隔，Windows 按 ';'），缺省回落 cwd。
import { createHash } from "node:crypto";
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, sep } from "node:path";
import { defineTool, runStdioServer } from "@videoos/mcp-lite";
import { z } from "zod/v4";
import { createJail, parseRoots } from "./jail";
import type { PathJail } from "./jail";

// ---------------------------------------------------------------------------
// 监狱与公共辅助
// ---------------------------------------------------------------------------

const jail = createJail(parseRoots(process.env.MCP_FS_ROOTS, process.cwd()));

/** 工具统一失败出口：JailError（越狱）/ IO 异常 → 业务失败 { ok: false, error }（不抛出） */
function toFailure(err: unknown): { ok: false; error: string } {
  return { ok: false, error: err instanceof Error ? err.message : String(err) };
}

/** 判定已解析路径属于哪个监狱根（跨根 move 拒绝用）；不属于任何根 → null */
function rootOf(box: PathJail, resolved: string): string | null {
  for (const root of box.roots) {
    if (resolved === root || resolved.startsWith(root + sep)) return root;
  }
  return null;
}

/** EXDEV 跨设备回退：手动递归复制后删除源（rename 不能跨设备） */
function copyTree(src: string, dst: string): void {
  if (lstatSync(src).isDirectory()) {
    mkdirSync(dst, { recursive: true });
    for (const name of readdirSync(src)) copyTree(join(src, name), join(dst, name));
  } else {
    copyFileSync(src, dst);
  }
}

/**
 * glob 匹配（Bun.Glob）。注意：Bun 的 * 不跨目录分隔符（Bash 语义），
 * 为让 "*.txt" 也能命中子目录文件，相对路径不命中时再试 basename。
 */
function globMatch(glob: Bun.Glob, relPath: string): boolean {
  if (glob.match(relPath)) return true;
  const slash = relPath.lastIndexOf("/");
  return slash < 0 ? false : glob.match(relPath.slice(slash + 1));
}

/** 目录条目（fs.list / fs.search 共用形状） */
interface Entry {
  name: string;
  type: "file" | "dir";
  size: number;
  mtime: string;
}

// ---------------------------------------------------------------------------
// fs.list — 列目录（可递归）
// ---------------------------------------------------------------------------

const listTool = defineTool({
  name: "fs.list",
  description: "列出目录条目；depth 控制递归层数（1..5，默认 1），name 为相对路径（子目录用 / 分隔），目录 size 固定 0",
  schema: z.object({
    path: z.string().min(1),
    depth: z.number().int().min(1).max(5).optional(),
  }),
  call: (args) => {
    try {
      const abs = jail.resolveIn(args.path);
      const depth = args.depth ?? 1;
      if (!statSync(abs).isDirectory()) return { ok: false, error: `not a directory: ${args.path}` };
      const entries: Entry[] = [];
      // levels = 还可以向下走的层数；1 = 只列当前层
      const walk = (dir: string, rel: string, levels: number): void => {
        for (const d of readdirSync(dir, { withFileTypes: true })) {
          const absEntry = join(dir, d.name);
          const relEntry = rel.length === 0 ? d.name : `${rel}/${d.name}`;
          const st = lstatSync(absEntry);
          const type: "file" | "dir" = d.isDirectory() ? "dir" : "file";
          entries.push({ name: relEntry, type, size: type === "dir" ? 0 : st.size, mtime: st.mtime.toISOString() });
          // 符号链接不跟随（d.isDirectory() 对 symlink 为 false），杜绝越狱与循环
          if (type === "dir" && levels > 1) walk(absEntry, relEntry, levels - 1);
        }
      };
      walk(abs, "", depth);
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      return { ok: true, data: { entries, root: abs } };
    } catch (err) {
      return toFailure(err);
    }
  },
});

// ---------------------------------------------------------------------------
// fs.read — 读文件（截断 + 编码）
// ---------------------------------------------------------------------------

const readTool = defineTool({
  name: "fs.read",
  description: "读取文件前 maxBytes 字节（默认 65536）；encoding utf8 返回文本、base64 返回 base64；size 为完整字节长度",
  schema: z.object({
    path: z.string().min(1),
    maxBytes: z.number().int().min(1).max(16_777_216).optional(),
    encoding: z.enum(["utf8", "base64"]).optional(),
  }),
  call: (args) => {
    try {
      const abs = jail.resolveIn(args.path);
      const maxBytes = args.maxBytes ?? 65_536;
      const encoding = args.encoding ?? "utf8";
      if (statSync(abs).isDirectory()) return { ok: false, error: `is a directory: ${args.path}` };
      const buf = readFileSync(abs);
      const size = buf.length;
      const truncated = size > maxBytes;
      const slice = truncated ? buf.subarray(0, maxBytes) : buf;
      const content = encoding === "base64" ? slice.toString("base64") : slice.toString("utf8");
      return { ok: true, data: { content, truncated, size } };
    } catch (err) {
      return toFailure(err);
    }
  },
});

// ---------------------------------------------------------------------------
// fs.write — 写文件（sha256 摘要）
// ---------------------------------------------------------------------------

const writeTool = defineTool({
  name: "fs.write",
  description: "写入文件（utf8 文本或 base64 解码），createDirs 默认 true 自动建父目录；返回字节数与 sha256 前 12 位十六进制",
  schema: z.object({
    path: z.string().min(1),
    content: z.string(),
    createDirs: z.boolean().optional(),
    encoding: z.enum(["utf8", "base64"]).optional(),
  }),
  call: (args) => {
    try {
      const abs = jail.resolveIn(args.path);
      const createDirs = args.createDirs ?? true;
      const encoding = args.encoding ?? "utf8";
      const buf = encoding === "base64" ? Buffer.from(args.content, "base64") : Buffer.from(args.content, "utf8");
      if (createDirs) mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, buf);
      const sha256 = createHash("sha256").update(buf).digest("hex").slice(0, 12);
      return { ok: true, data: { bytes: buf.length, sha256 } };
    } catch (err) {
      return toFailure(err);
    }
  },
});

// ---------------------------------------------------------------------------
// fs.move — 移动/重命名（同根内）
// ---------------------------------------------------------------------------

const moveTool = defineTool({
  name: "fs.move",
  description: "移动或重命名（from/to 都必须在监狱内；多根监狱下跨根移动被拒绝；EXDEV 自动回退复制+删除）",
  schema: z.object({
    from: z.string().min(1),
    to: z.string().min(1),
  }),
  call: (args) => {
    try {
      const fromAbs = jail.resolveIn(args.from);
      const toAbs = jail.resolveIn(args.to);
      if (jail.roots.length > 1 && rootOf(jail, fromAbs) !== rootOf(jail, toAbs)) {
        return { ok: false, error: "cross-root move not allowed" };
      }
      try {
        renameSync(fromAbs, toAbs);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EXDEV") {
          copyTree(fromAbs, toAbs);
          rmSync(fromAbs, { recursive: true, force: true });
        } else {
          throw err;
        }
      }
      return { ok: true, data: { moved: true } };
    } catch (err) {
      return toFailure(err);
    }
  },
});

// ---------------------------------------------------------------------------
// fs.remove — 删除（非空目录保护）
// ---------------------------------------------------------------------------

const removeTool = defineTool({
  name: "fs.remove",
  description: "删除文件或目录；非空目录必须 recursive: true；removed 为删除的路径总数（递归时含目录自身）",
  schema: z.object({
    path: z.string().min(1),
    recursive: z.boolean().optional(),
  }),
  call: (args) => {
    try {
      const abs = jail.resolveIn(args.path);
      const recursive = args.recursive ?? false;
      const st = lstatSync(abs);
      if (st.isFile() || st.isSymbolicLink()) {
        unlinkSync(abs);
        return { ok: true, data: { removed: 1 } };
      }
      if (!st.isDirectory()) return { ok: false, error: `unsupported file type: ${args.path}` };
      if (!recursive) {
        if (readdirSync(abs).length > 0) {
          return { ok: false, error: "directory not empty (recursive: true required)" };
        }
        rmdirSync(abs);
        return { ok: true, data: { removed: 1 } };
      }
      // 递归：先走一遍数出将被删除的路径数（含目录自身），再整体删除
      let count = 1;
      const countWalk = (dir: string): void => {
        for (const d of readdirSync(dir, { withFileTypes: true })) {
          count += 1;
          if (d.isDirectory()) countWalk(join(dir, d.name));
        }
      };
      countWalk(abs);
      rmSync(abs, { recursive: true, force: true });
      return { ok: true, data: { removed: count } };
    } catch (err) {
      return toFailure(err);
    }
  },
});

// ---------------------------------------------------------------------------
// fs.search — glob（可选内容正则）搜索
// ---------------------------------------------------------------------------

const searchTool = defineTool({
  name: "fs.search",
  description: "在 root 下递归搜索（深度上限 8，跳过 node_modules/.git）：glob 匹配相对路径；contentRegex 只对 ≤1MB 的文件做内容正则过滤",
  schema: z.object({
    root: z.string().min(1),
    glob: z.string().min(1),
    contentRegex: z.string().min(1).optional(),
    maxResults: z.number().int().min(1).max(10_000).optional(),
  }),
  call: (args) => {
    try {
      const absRoot = jail.resolveIn(args.root);
      const maxResults = args.maxResults ?? 200;
      if (!statSync(absRoot).isDirectory()) return { ok: false, error: `not a directory: ${args.root}` };
      let contentRe: RegExp | null = null;
      if (args.contentRegex !== undefined) {
        try {
          contentRe = new RegExp(args.contentRegex);
        } catch (err) {
          return { ok: false, error: `invalid contentRegex: ${err instanceof Error ? err.message : String(err)}` };
        }
      }
      const glob = new Bun.Glob(args.glob);
      const skipDirs = new Set(["node_modules", ".git"]);
      // 结果 path 为相对 root 参数的路径（posix 风格 / 分隔）
      const matches: Array<{ path: string; size: number; mtime: string }> = [];
      const MAX_DEPTH = 8;
      const walk = (dir: string, rel: string, depth: number): void => {
        for (const d of readdirSync(dir, { withFileTypes: true })) {
          if (d.isDirectory()) {
            if (skipDirs.has(d.name)) continue;
            const relEntry = rel.length === 0 ? d.name : `${rel}/${d.name}`;
            if (contentRe === null && globMatch(glob, relEntry)) {
              matches.push({ path: relEntry, size: 0, mtime: lstatSync(join(dir, d.name)).mtime.toISOString() });
            }
            if (depth < MAX_DEPTH) walk(join(dir, d.name), relEntry, depth + 1);
          } else {
            const relEntry = rel.length === 0 ? d.name : `${rel}/${d.name}`;
            if (!globMatch(glob, relEntry)) continue;
            const absEntry = join(dir, d.name);
            const st = lstatSync(absEntry);
            if (contentRe !== null) {
              if (st.size > 1_048_576) continue; // 大文件不做内容扫描
              if (!contentRe.test(readFileSync(absEntry, "utf8"))) continue;
            }
            matches.push({ path: relEntry, size: st.size, mtime: st.mtime.toISOString() });
          }
        }
      };
      walk(absRoot, "", 1);
      matches.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
      const truncated = matches.length > maxResults;
      return { ok: true, data: { matches: matches.slice(0, maxResults), truncated } };
    } catch (err) {
      return toFailure(err);
    }
  },
});

// ---------------------------------------------------------------------------
// fs.tree — 目录树（ASCII 缩进文本，深度上限 3）
// ---------------------------------------------------------------------------

const treeTool = defineTool({
  name: "fs.tree",
  description: "目录树文本（2 空格缩进；目录后缀 /，文件带 (字节数 B)；目录在前文件在后按字母序；深度上限 3 层，超出截断）",
  schema: z.object({ path: z.string().min(1) }),
  call: (args) => {
    try {
      const abs = jail.resolveIn(args.path);
      if (!statSync(abs).isDirectory()) return { ok: false, error: `not a directory: ${args.path}` };
      const MAX_DEPTH = 3;
      const lines: string[] = [`${basename(abs)}/`];
      const byName = (a: { name: string }, b: { name: string }): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
      const walkTree = (dir: string, indent: string, depth: number): void => {
        const dirents = readdirSync(dir, { withFileTypes: true });
        const dirs = dirents.filter((d) => d.isDirectory()).sort(byName);
        const files = dirents.filter((d) => !d.isDirectory()).sort(byName);
        for (const d of dirs) {
          lines.push(`${indent}${d.name}/`);
          if (depth < MAX_DEPTH) walkTree(join(dir, d.name), `${indent}  `, depth + 1);
        }
        for (const f of files) {
          lines.push(`${indent}${f.name} (${lstatSync(join(dir, f.name)).size} B)`);
        }
      };
      walkTree(abs, "  ", 1);
      return { ok: true, data: { tree: lines.join("\n") } };
    } catch (err) {
      return toFailure(err);
    }
  },
});

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

await runStdioServer([listTool, readTool, writeTool, moveTool, removeTool, searchTool, treeTool], {
  serverName: "mcp-fs",
  serverVersion: "0.1.0",
});
