// brand-guard —— 品牌守卫：brand.tokens 暴露调色板，brand.lint 扫 .ts/.md 里的离板 #rrggbb 色，
// brand.nearest 把杂色映射到最近的板内色。读文件走 ctx.fs（fs:read 权限），目录遍历用 node:fs。
import { readdirSync, statSync, type Dirent } from "node:fs";
import { join } from "node:path";
import type { PluginContext, PluginFs } from "@videoos/plugin-kit";

interface BrandConfig {
  colors: string[];
  fonts: string[];
}

const HEX_COLOR = /#([0-9a-fA-F]{6})(?![0-9a-fA-F])/g; // 6 位 hex，负向断言防 8 位误切
const MAX_FILES = 200;
const MAX_DEPTH = 5;

function brandConfig(ctx: PluginContext): BrandConfig {
  const raw = ctx.config.brand;
  if (
    raw !== null &&
    typeof raw === "object" &&
    Array.isArray((raw as BrandConfig).colors) &&
    Array.isArray((raw as BrandConfig).fonts)
  ) {
    return raw as BrandConfig;
  }
  return { colors: [], fonts: [] };
}

/** 递归收集 .ts/.md 文件（跳过隐藏项/node_modules，深度 ≤5，≤200 个） */
function collectLintables(root: string, out: string[], depth = 0): void {
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
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      collectLintables(full, out, depth + 1);
    } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".md"))) {
      out.push(full);
    }
    if (out.length >= MAX_FILES) return;
  }
}

function lintText(text: string, palette: Set<string>, file: string): Array<{ file: string; line: number; color: string }> {
  const violations: Array<{ file: string; line: number; color: string }> = [];
  for (const match of text.matchAll(HEX_COLOR)) {
    const color = `#${match[1].toLowerCase()}`;
    if (palette.has(color)) continue;
    const line = text.slice(0, match.index ?? 0).split("\n").length;
    violations.push({ file, line, color });
  }
  return violations;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const digits = hex.replace("#", "");
  const expanded = digits.length === 3 ? digits.split("").map((c) => c + c).join("") : digits;
  const num = Number.parseInt(expanded, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

export default async function activate(ctx: PluginContext): Promise<void> {
  const fs: PluginFs | undefined = ctx.fs;
  if (fs === undefined) {
    throw new Error("brand-guard requires the fs:read permission (ctx.fs is unavailable)");
  }
  const brand = brandConfig(ctx);
  const palette = new Set(brand.colors.map((c) => c.toLowerCase()));

  ctx.registerTool({
    name: "brand-guard.brand.tokens",
    description: "List the brand token palette (colors + fonts) configured for this plugin.",
    schema: ctx.z.object({}),
    run: () => ({ ok: true, data: { colors: brand.colors, fonts: brand.fonts } }),
  });

  ctx.registerTool({
    name: "brand-guard.brand.lint",
    description: "Scan a .ts/.md file or a directory tree for #rrggbb colors outside the brand palette; returns violations with file/line/color.",
    schema: ctx.z.object({
      path: ctx.z.string().describe("absolute file or directory to lint (relative to the host process cwd)"),
    }),
    run: ({ path }) => {
      if (!fs.exists(path)) {
        return { ok: false, error: `E_NOT_FOUND: no such file or directory: ${path}` };
      }
      const stats = statSync(path, { throwIfNoEntry: false });
      if (stats === undefined) {
        return { ok: false, error: `E_NOT_FOUND: cannot stat: ${path}` };
      }
      const files: string[] = [];
      if (stats.isDirectory()) {
        collectLintables(path, files);
      } else if (path.endsWith(".ts") || path.endsWith(".md")) {
        files.push(path);
      } else {
        return { ok: false, error: `E_ARG: brand.lint accepts a directory or a .ts/.md file (got ${path})` };
      }
      const violations: Array<{ file: string; line: number; color: string }> = [];
      for (const file of files) {
        let text: string;
        try {
          text = fs.readFile(file);
        } catch {
          continue; // 单文件不可读不炸整轮 lint
        }
        violations.push(...lintText(text, palette, file));
      }
      return { ok: true, data: { violations, filesScanned: files.length, palette: brand.colors } };
    },
  });

  ctx.registerTool({
    name: "brand-guard.brand.nearest",
    description: "Map a #rrggbb color to the nearest brand palette token (squared RGB distance).",
    schema: ctx.z.object({
      color: ctx.z
        .string()
        .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'color must be "#rgb" or "#rrggbb"')
        .describe("the color to place, e.g. \"#22d4ee\""),
    }),
    run: ({ color }) => {
      if (brand.colors.length === 0) {
        return { ok: false, error: "E_CONFIG: brand config has no colors" };
      }
      const target = hexToRgb(color);
      let nearest = brand.colors[0];
      let best = Number.POSITIVE_INFINITY;
      for (const candidate of brand.colors) {
        const rgb = hexToRgb(candidate);
        const dist =
          (rgb.r - target.r) * (rgb.r - target.r) +
          (rgb.g - target.g) * (rgb.g - target.g) +
          (rgb.b - target.b) * (rgb.b - target.b);
        if (dist < best) {
          best = dist;
          nearest = candidate;
        }
      }
      return { ok: true, data: { input: color, nearest, distance: Math.round(Math.sqrt(best) * 100) / 100 } };
    },
  });
}
