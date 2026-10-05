// asset-watcher —— 资产对账：asset.scan 抽 .ts 源里的 s.image("name","src") 与 s.audio/v.audio 引用，
// 对照目录下实际文件 → {missing, unused}；asset.summary 列文件与字节数。
// 真实 DSL 里 audio 挂在 v 上（v.audio）、image 挂在 s 上（s.image）；两种前缀都匹配。
import { readdirSync, statSync, type Dirent } from "node:fs";
import { join, relative } from "node:path";
import type { PluginContext, PluginFs } from "@videoos/plugin-kit";

const REF_RE = /(?:s|v)\.(image|audio)\(\s*["'`]([^"'`]+)["'`]\s*,\s*["'`]([^"'`]+)["'`]/g;
const MAX_FILES = 500;
const MAX_DEPTH = 5;

interface FoundFile {
  abs: string;
  rel: string; // 相对扫描根的 POSIX 风格路径
}

const toRel = (root: string, abs: string): string => relative(root, abs).split(/[\\/]/).join("/");

/** 递归收集文件（跳过隐藏项/node_modules，深度 ≤5，≤500 个） */
function collectFiles(root: string, dir: string, out: FoundFile[], depth = 0): void {
  if (out.length >= MAX_FILES || depth > MAX_DEPTH) return;
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(root, abs, out, depth + 1);
    } else if (entry.isFile()) {
      out.push({ abs, rel: toRel(root, abs) });
    }
    if (out.length >= MAX_FILES) return;
  }
}

export default async function activate(ctx: PluginContext): Promise<void> {
  const fs: PluginFs | undefined = ctx.fs;
  if (fs === undefined) {
    throw new Error("asset-watcher requires the fs:read permission (ctx.fs is unavailable)");
  }

  ctx.registerTool({
    name: "asset-watcher.asset.scan",
    description: "Scan a project directory: extract s.image / v.audio src references from .ts sources and diff them against existing files; returns missing and unused assets.",
    schema: ctx.z.object({
      path: ctx.z.string().describe("absolute project directory to scan"),
    }),
    run: ({ path }) => {
      if (!fs.exists(path)) {
        return { ok: false, error: `E_NOT_FOUND: no such directory: ${path}` };
      }
      const stats = statSync(path, { throwIfNoEntry: false });
      if (stats === undefined || !stats.isDirectory()) {
        return { ok: false, error: `E_ARG: asset.scan expects a directory (got ${path})` };
      }
      const files: FoundFile[] = [];
      collectFiles(path, path, files);

      // 1) .ts 源码里引用了哪些 src
      const refs = new Map<string, { kind: string; layer: string }>();
      for (const file of files) {
        if (!file.abs.endsWith(".ts")) continue;
        let text: string;
        try {
          text = fs.readFile(file.abs);
        } catch {
          continue;
        }
        for (const match of text.matchAll(REF_RE)) {
          refs.set(match[3], { kind: match[1], layer: match[2] });
        }
      }
      // 2) 对照实际文件
      const existing = new Set(files.map((file) => file.rel));
      const normalize = (src: string): string => src.replace(/^\.\//, "").split(/[\\/]/).join("/");
      const missing = [...refs.entries()]
        .filter(([src]) => !existing.has(normalize(src)))
        .map(([src, meta]) => ({ src: normalize(src), referencedBy: meta.layer, kind: meta.kind }));
      const referenced = new Set([...refs.keys()].map(normalize));
      const unused = files.map((file) => file.rel).filter((rel) => !referenced.has(rel));
      return {
        ok: true,
        data: {
          missing,
          unused,
          referencedCount: refs.size,
          fileCount: files.length,
          truncated: files.length >= MAX_FILES,
        },
      };
    },
  });

  ctx.registerTool({
    name: "asset-watcher.asset.summary",
    description: "List every file under a directory (skipping hidden/node_modules) with its size in bytes.",
    schema: ctx.z.object({
      path: ctx.z.string().describe("absolute directory to summarize"),
    }),
    run: ({ path }) => {
      if (!fs.exists(path)) {
        return { ok: false, error: `E_NOT_FOUND: no such directory: ${path}` };
      }
      const stats = statSync(path, { throwIfNoEntry: false });
      if (stats === undefined || !stats.isDirectory()) {
        return { ok: false, error: `E_ARG: asset.summary expects a directory (got ${path})` };
      }
      const files: FoundFile[] = [];
      collectFiles(path, path, files);
      const entries = files
        .map((file) => {
          const size = statSync(file.abs, { throwIfNoEntry: false });
          return { name: file.rel, sizeBytes: size === undefined ? 0 : size.size };
        })
        .sort((a, b) => (a.name < b.name ? -1 : 1));
      return {
        ok: true,
        data: { files: entries, count: entries.length, truncated: entries.length >= MAX_FILES },
      };
    },
  });
}
