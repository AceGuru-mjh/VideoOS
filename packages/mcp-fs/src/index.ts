// @videoos/mcp-fs —— 文件系统服务器（stdio MCP）：监狱内的 list/read/write/move/remove/search/tree。
// 关键设计：全部路径经 jailFromEnv("MCP_FS_ROOTS") 路径监狱（.. 穿越/符号链接逃逸自动 E_JAIL）；
// glob→RegExp 自实现（** 跨目录、* 单段内、? 单字符，不引第三方库）；fs.read 的 utf8 模式先嗅探
// 前 8KB 是否含 \0（二进制 → E_BINARY 提示改用 base64）；一切输出截断恒带 truncated 标记。
import { createHash } from "node:crypto";
import { lstat, mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, sep } from "node:path";
import {
  defineTool,
  jailFromEnv,
  ok,
  runStdioServer,
  ToolError,
  truncateBytes,
  type PathJail,
} from "@videoos/mcp-lite";
import { z } from "zod";

const jail = await jailFromEnv("MCP_FS_ROOTS");

const LIST_CAP = 1_000; // fs.list 条目上限
const SEARCH_CAP = 200; // fs.search 结果上限（SPEC §3.5）
const SEARCH_VISIT_BUDGET = 20_000; // fs.search 遍历预算（防病态大树拖死服务器）
const TREE_LINE_CAP = 300; // fs.tree 行数上限
const MAX_WALK_DEPTH = 5; // 递归深度上限
const MAX_UTF8_READ = 1_048_576; // utf8 单次读上限（= maxBytes 的 zod 上限）
const MAX_BASE64_READ = 8 * 1_048_576; // base64 单次读上限
const MAX_WRITE = 8 * 1_048_576; // 单次写上限
const SNIFF_BYTES = 8_192; // 二进制嗅探窗口

type EntryType = "file" | "dir" | "symlink" | "other";

interface DirEntryInfo {
  name: string;
  /** 相对所列目录的路径（统一 "/" 分隔） */
  path: string;
  type: EntryType;
  size: number;
  mtime: number;
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** dirent → 类型（readdir withFileTypes；符号链接不跟入，防循环） */
function direntType(d: { isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }): EntryType {
  if (d.isDirectory()) return "dir";
  if (d.isFile()) return "file";
  if (d.isSymbolicLink()) return "symlink";
  return "other";
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

// glob → RegExp：双星跨目录（"**/" 允许零层）、* 单段内、? 单字符；匹配时统一按 "/" 分隔
// 注意转义后 `*` 变成 `\*`（反斜杠+星），替换模式必须按这个形态匹配
function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // 注意 ? 也要转义
  const pattern = escaped
    .replace(/\\\*\\\*\//g, "(?:.*/)?") // "**/" → 零或多层目录
    .replace(/\\\*\\\*/g, ".*") // 其余 "**" → 跨目录任意
    .replace(/\\\*/g, "[^/]*") // "*" → 单段内
    .replace(/\\\?/g, "[^/]"); // "?" → 单字符
  return new RegExp(`^${pattern}$`);
}

/** 绝对路径落在哪个监狱根内（含根本身）；都不含 → undefined */
function containingRoot(j: PathJail, abs: string): string | undefined {
  for (const root of j.roots) {
    if (abs === root || abs.startsWith(root.endsWith(sep) ? root : root + sep)) return root;
  }
  return undefined;
}

/** 只读文件前 length 字节（短文件按实际长度返回） */
async function readPrefix(abs: string, length: number): Promise<Buffer> {
  const handle = await open(abs, "r");
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buf, 0, length, 0);
    return bytesRead === buf.length ? buf : buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

const tools = [
  defineTool(
    "fs.list",
    "List directory entries (name/type/size/mtime) up to a recursion depth; use to explore files inside the allowed roots.",
    z.object({
      path: z.string().describe("directory to list (absolute, or relative to the first allowed root)"),
      depth: z
        .number()
        .int()
        .min(1)
        .max(5)
        .default(1)
        .describe("recurse depth: 1 = direct children only (max 5)"),
    }),
    async ({ path, depth }) => {
      const abs = await jail.resolve(path);
      const st = await stat(abs).catch(() => {
        throw new ToolError("E_NOT_FOUND", `no such file or directory: ${path}`);
      });
      if (!st.isDirectory()) throw new ToolError("E_NOT_DIR", `not a directory: ${path}`);
      const entries: DirEntryInfo[] = [];
      let truncated = false;
      const walk = async (dir: string, rel: string, level: number): Promise<void> => {
        const dirents = (await readdir(dir, { withFileTypes: true })).sort(byName);
        for (const d of dirents) {
          if (entries.length >= LIST_CAP) {
            truncated = true;
            return;
          }
          const childAbs = join(dir, d.name);
          const childRel = rel === "" ? d.name : `${rel}/${d.name}`;
          const info = await lstat(childAbs).catch(() => null);
          entries.push({
            name: d.name,
            path: childRel,
            type: direntType(d),
            size: info?.size ?? 0,
            mtime: info?.mtimeMs ?? 0,
          });
          if (d.isDirectory() && level < depth) await walk(childAbs, childRel, level + 1);
        }
      };
      await walk(abs, "", 1);
      return ok({ path: abs, entries, count: entries.length, truncated });
    },
  ),

  defineTool(
    "fs.read",
    'Read a file as utf-8 text (or base64 payload) with a byte cap; binary files are rejected with E_BINARY unless encoding is "base64".',
    z.object({
      path: z.string().describe("file to read (absolute, or relative to the first allowed root)"),
      maxBytes: z
        .number()
        .int()
        .min(1)
        .max(MAX_UTF8_READ)
        .default(65_536)
        .describe("read cap in bytes (max 1MB); beyond it the output is truncated"),
      encoding: z.enum(["utf8", "base64"]).default("utf8").describe('"utf8" text or "base64" for binary payloads'),
    }),
    async ({ path, maxBytes, encoding }) => {
      const abs = await jail.resolve(path);
      const st = await stat(abs).catch(() => {
        throw new ToolError("E_NOT_FOUND", `no such file: ${path}`);
      });
      if (st.isDirectory()) throw new ToolError("E_IS_DIR", `is a directory: ${path}`);
      if (encoding === "base64") {
        if (st.size > MAX_BASE64_READ) {
          throw new ToolError("E_SIZE", `file too large for base64 read (${st.size} > ${MAX_BASE64_READ} bytes)`);
        }
        const truncated = st.size > maxBytes;
        const buf = await readPrefix(abs, truncated ? maxBytes : st.size);
        return ok({ path: abs, encoding: "base64", size: st.size, base64: buf.toString("base64"), truncated });
      }
      // utf8：多读 8 字节余量，让 truncateBytes 在多字节字符边界上切
      const readLen = Math.min(st.size, maxBytes + 8);
      const buf = await readPrefix(abs, readLen);
      if (buf.subarray(0, Math.min(buf.length, SNIFF_BYTES)).includes(0)) {
        throw new ToolError("E_BINARY", "file appears to be binary (NUL byte in first 8KB); retry with encoding \"base64\"");
      }
      const { text } = truncateBytes(buf.toString("utf8"), maxBytes);
      return ok({
        path: abs,
        encoding: "utf8",
        size: st.size,
        text,
        truncated: st.size > maxBytes,
      });
    },
  ),

  defineTool(
    "fs.write",
    "Write a file (utf-8 text or base64-decoded bytes) inside the allowed roots; returns written byte count and a sha256-12 checksum.",
    z.object({
      path: z.string().describe("target file (absolute, or relative to the first allowed root)"),
      content: z.string().describe('file content: plain text for encoding "utf8", base64 payload for "base64"'),
      createDirs: z.boolean().default(true).describe("create missing parent directories (default true)"),
      encoding: z.enum(["utf8", "base64"]).default("utf8").describe('how to interpret content ("utf8" or "base64")'),
    }),
    async ({ path, content, createDirs, encoding }) => {
      const abs = await jail.resolve(path);
      const buf = Buffer.from(content, encoding);
      if (buf.length > MAX_WRITE) {
        throw new ToolError("E_SIZE", `content too large (${buf.length} > ${MAX_WRITE} bytes); write in smaller chunks`);
      }
      if (createDirs) await mkdir(dirname(abs), { recursive: true });
      try {
        await writeFile(abs, buf);
      } catch (error) {
        throw new ToolError("E_WRITE", `failed to write ${path}: ${errMsg(error)}`);
      }
      const sha256 = createHash("sha256").update(buf).digest("hex").slice(0, 12);
      return ok({ path: abs, bytes: buf.length, sha256 });
    },
  ),

  defineTool(
    "fs.move",
    "Move or rename a file/directory within the SAME allowed root (cross-root moves are rejected with E_CROSS_ROOT).",
    z.object({
      from: z.string().describe("source path (absolute, or relative to the first allowed root)"),
      to: z.string().describe("destination path (must stay inside the same root as from)"),
    }),
    async ({ from, to }) => {
      const absFrom = await jail.resolve(from);
      const absTo = await jail.resolve(to);
      const rootFrom = containingRoot(jail, absFrom);
      const rootTo = containingRoot(jail, absTo);
      if (rootFrom === undefined || rootTo === undefined) {
        throw new ToolError("E_JAIL", "path escapes jail roots");
      }
      if (rootFrom !== rootTo) {
        throw new ToolError("E_CROSS_ROOT", `moving across jail roots is not allowed (${rootFrom} -> ${rootTo})`);
      }
      await stat(absFrom).catch(() => {
        throw new ToolError("E_NOT_FOUND", `no such file or directory: ${from}`);
      });
      if (absFrom === absTo) return ok({ from: absFrom, to: absTo });
      try {
        await rename(absFrom, absTo);
      } catch (error) {
        throw new ToolError("E_MOVE", `rename failed: ${errMsg(error)} (does the target parent directory exist?)`);
      }
      return ok({ from: absFrom, to: absTo });
    },
  ),

  defineTool(
    "fs.remove",
    "Delete a file or directory; directories need recursive:true (returns the number of removed entries).",
    z.object({
      path: z.string().describe("entry to delete (absolute, or relative to the first allowed root)"),
      recursive: z.boolean().default(false).describe("delete non-empty directories recursively (default false)"),
    }),
    async ({ path, recursive }) => {
      const abs = await jail.resolve(path);
      const st = await lstat(abs).catch(() => {
        throw new ToolError("E_NOT_FOUND", `no such file or directory: ${path}`);
      });
      let removed = 1;
      if (st.isDirectory()) {
        if (!recursive) {
          const children = await readdir(abs);
          if (children.length > 0) {
            throw new ToolError("E_NOT_EMPTY", `directory not empty: ${path} (pass recursive:true to delete anyway)`);
          }
        } else {
          // 预统计将删除的条目数（含目录本身；不跟入符号链接）
          const count = async (dir: string): Promise<number> => {
            let total = 1;
            for (const d of (await readdir(dir, { withFileTypes: true })).sort(byName)) {
              total += d.isDirectory() ? await count(join(dir, d.name)) : 1;
            }
            return total;
          };
          removed = await count(abs);
        }
      }
      try {
        await rm(abs, { recursive, force: false });
      } catch (error) {
        throw new ToolError("E_REMOVE", `failed to remove ${path}: ${errMsg(error)}`);
      }
      return ok({ path: abs, removed });
    },
  ),

  defineTool(
    "fs.search",
    'Search files under a root by glob ("**/*.ts"), optionally grepping each matched text file (<=1MB) with a regex.',
    z.object({
      root: z.string().describe("directory to search (absolute, or relative to the first allowed root)"),
      glob: z
        .string()
        .min(1)
        .describe('glob matched against paths relative to root: "**/*.ts" matches nested, "*.ts" top-level only, ? = one char'),
      contentRegex: z
        .string()
        .optional()
        .describe("when set, grep matched files line by line and return {path, line, text} hits instead of paths"),
    }),
    async ({ root, glob, contentRegex }) => {
      const absRoot = await jail.resolve(root);
      const st = await stat(absRoot).catch(() => {
        throw new ToolError("E_NOT_FOUND", `no such file or directory: ${root}`);
      });
      if (!st.isDirectory()) throw new ToolError("E_NOT_DIR", `not a directory: ${root}`);
      let re: RegExp;
      let contentRe: RegExp | undefined;
      try {
        re = globToRegExp(glob);
      } catch {
        throw new ToolError("E_GLOB", `invalid glob pattern: ${JSON.stringify(glob)}`);
      }
      if (contentRegex !== undefined) {
        try {
          contentRe = new RegExp(contentRegex);
        } catch (error) {
          throw new ToolError("E_REGEX", `invalid contentRegex: ${errMsg(error)}`);
        }
      }
      const paths: string[] = [];
      const matches: Array<{ path: string; line: number; text: string }> = [];
      let truncated = false;
      let visited = 0;
      const walk = async (dir: string, rel: string, level: number): Promise<void> => {
        if (level > MAX_WALK_DEPTH || visited > SEARCH_VISIT_BUDGET) {
          truncated = true;
          return;
        }
        const dirents = (await readdir(dir, { withFileTypes: true })).sort(byName);
        for (const d of dirents) {
          if (visited > SEARCH_VISIT_BUDGET) {
            truncated = true;
            return;
          }
          visited++;
          const childRel = rel === "" ? d.name : `${rel}/${d.name}`;
          const childAbs = join(dir, d.name);
          if (d.isDirectory()) {
            await walk(childAbs, childRel, level + 1);
            continue;
          }
          if (!re.test(childRel)) continue;
          if (contentRe === undefined) {
            if (paths.length >= SEARCH_CAP) {
              truncated = true;
              return;
            }
            paths.push(childRel);
            continue;
          }
          // contentRegex 模式：只 grep <=1MB 的文本文件
          const info = await lstat(childAbs).catch(() => null);
          if (info === null || info.size > MAX_UTF8_READ || d.isSymbolicLink()) continue;
          const text = await readFile(childAbs, "utf8").catch(() => null);
          if (text === null || text.includes("\0")) continue; // 二进制跳过
          for (const [idx, line] of text.split(/\r?\n/).entries()) {
            if (matches.length >= SEARCH_CAP) {
              truncated = true;
              return;
            }
            if (contentRe.test(line)) matches.push({ path: childRel, line: idx + 1, text: line });
          }
        }
      };
      await walk(absRoot, "", 1);
      return contentRegex === undefined
        ? ok({ paths, count: paths.length, truncated })
        : ok({ matches, count: matches.length, truncated });
    },
  ),

  defineTool(
    "fs.tree",
    "Render a directory as an indented tree text (depth <= 3, <= 300 lines, truncated flag when cut).",
    z.object({
      path: z.string().describe("directory to render (absolute, or relative to the first allowed root)"),
    }),
    async ({ path }) => {
      const abs = await jail.resolve(path);
      const st = await stat(abs).catch(() => {
        throw new ToolError("E_NOT_FOUND", `no such file or directory: ${path}`);
      });
      if (!st.isDirectory()) throw new ToolError("E_NOT_DIR", `not a directory: ${path}`);
      const lines: string[] = [`${basename(abs)}/`];
      let truncated = false;
      const walk = async (dir: string, prefix: string, level: number): Promise<void> => {
        if (level > 3) return;
        const dirents = (await readdir(dir, { withFileTypes: true })).sort(byName);
        for (let i = 0; i < dirents.length; i++) {
          if (lines.length >= TREE_LINE_CAP) {
            truncated = true;
            return;
          }
          const d = dirents[i];
          const last = i === dirents.length - 1;
          lines.push(`${prefix}${last ? "└─ " : "├─ "}${d.name}${d.isDirectory() ? "/" : ""}`);
          if (d.isDirectory()) await walk(join(dir, d.name), `${prefix}${last ? "   " : "│  "}`, level + 1);
        }
      };
      await walk(abs, "", 1);
      return ok({ path: abs, text: lines.join("\n"), lines: lines.length, truncated });
    },
  ),
];

await runStdioServer(tools, { serverName: "mcp-fs", serverVersion: "0.1.0" });
