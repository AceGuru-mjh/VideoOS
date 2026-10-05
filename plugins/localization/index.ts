// localization —— 本地化审计：i18n.extract 抽 s.text("name","content") 图层文本；
// i18n.report 按 expansionFactor（缺省 1.3）做翻译膨胀预警（chars×factor > 40）；
// i18n.layers 按图层名汇总用量。
import { readdirSync, statSync, type Dirent } from "node:fs";
import { join } from "node:path";
import type { PluginContext, PluginFs } from "@videoos/plugin-kit";

const TEXT_RE = /\bs\.text\(\s*["'`]([^"'`]+)["'`]\s*,\s*["'`]([^"'`]+)["'`]/g;
const CHAR_BUDGET = 40; // 单层字符预算（翻译膨胀预警阈值）
const MAX_FILES = 200;
const MAX_DEPTH = 5;

interface Entry {
  layer: string;
  text: string;
  chars: number;
}

function collectTsFiles(root: string, out: string[], depth = 0): void {
  if (out.length >= MAX_FILES || depth > MAX_DEPTH) return;
  let entries: Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const abs = join(root, entry.name);
    if (entry.isDirectory()) {
      collectTsFiles(abs, out, depth + 1);
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      out.push(abs);
    }
    if (out.length >= MAX_FILES) return;
  }
}

/** path（.ts 文件或目录）→ 待扫描 .ts 文件清单 */
function resolveTsFiles(fs: PluginFs, path: string): { ok: true; files: string[] } | { ok: false; error: string } {
  if (!fs.exists(path)) {
    return { ok: false, error: `E_NOT_FOUND: no such file or directory: ${path}` };
  }
  const stats = statSync(path, { throwIfNoEntry: false });
  if (stats === undefined) {
    return { ok: false, error: `E_NOT_FOUND: cannot stat: ${path}` };
  }
  if (stats.isDirectory()) {
    const files: string[] = [];
    collectTsFiles(path, files);
    return { ok: true, files };
  }
  if (path.endsWith(".ts")) {
    return { ok: true, files: [path] };
  }
  return { ok: false, error: `E_ARG: expected a .ts file or a directory (got ${path})` };
}

function extractEntries(fs: PluginFs, files: string[]): Entry[] {
  const entries: Entry[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = fs.readFile(file);
    } catch {
      continue;
    }
    for (const match of text.matchAll(TEXT_RE)) {
      entries.push({ layer: match[1], text: match[2], chars: match[2].length });
    }
  }
  return entries;
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

export default async function activate(ctx: PluginContext): Promise<void> {
  const fs: PluginFs | undefined = ctx.fs;
  if (fs === undefined) {
    throw new Error("localization requires the fs:read permission (ctx.fs is unavailable)");
  }

  ctx.registerTool({
    name: "localization.i18n.extract",
    description: "Extract s.text(\"layer\", \"content\") calls from a .ts file or directory; returns [{layer, text, chars}] ready for a translation sheet.",
    schema: ctx.z.object({
      path: ctx.z.string().describe("absolute .ts file or directory to scan"),
    }),
    run: ({ path }) => {
      const resolved = resolveTsFiles(fs, path);
      if (!resolved.ok) return { ok: false, error: resolved.error };
      return { ok: true, data: extractEntries(fs, resolved.files) };
    },
  });

  ctx.registerTool({
    name: "localization.i18n.report",
    description: "Translation-expansion report: per s.text layer, warn when chars × expansionFactor would overflow a 40-char budget.",
    schema: ctx.z.object({
      path: ctx.z.string().describe("absolute .ts file or directory to scan"),
      expansionFactor: ctx.z
        .number()
        .min(1)
        .max(3)
        .describe("expected length growth ratio after translation")
        .default(1.3),
    }),
    run: ({ path, expansionFactor }) => {
      const resolved = resolveTsFiles(fs, path);
      if (!resolved.ok) return { ok: false, error: resolved.error };
      const entries = extractEntries(fs, resolved.files);
      const warnings = entries
        .map((entry) => {
          const expanded = entry.chars * expansionFactor;
          return { entry, expanded };
        })
        .filter(({ expanded }) => expanded > CHAR_BUDGET)
        .map(({ entry, expanded }) => ({
          layer: entry.layer,
          text: entry.text,
          chars: entry.chars,
          expanded: round1(expanded),
          overBy: round1(expanded - CHAR_BUDGET),
        }));
      return {
        ok: true,
        data: {
          threshold: CHAR_BUDGET,
          expansionFactor,
          checked: entries.length,
          warnings,
        },
      };
    },
  });

  ctx.registerTool({
    name: "localization.i18n.layers",
    description: "Summarize s.text usage per layer name: call count and the longest text, for spotting duplicate/overlong layers.",
    schema: ctx.z.object({
      path: ctx.z.string().describe("absolute .ts file or directory to scan"),
    }),
    run: ({ path }) => {
      const resolved = resolveTsFiles(fs, path);
      if (!resolved.ok) return { ok: false, error: resolved.error };
      const entries = extractEntries(fs, resolved.files);
      const byLayer = new Map<string, { layer: string; count: number; maxChars: number }>();
      for (const entry of entries) {
        const current = byLayer.get(entry.layer) ?? { layer: entry.layer, count: 0, maxChars: 0 };
        current.count += 1;
        current.maxChars = Math.max(current.maxChars, entry.chars);
        byLayer.set(entry.layer, current);
      }
      return {
        ok: true,
        data: {
          layers: [...byLayer.values()].sort((a, b) => (a.layer < b.layer ? -1 : 1)),
          total: entries.length,
        },
      };
    },
  });
}
