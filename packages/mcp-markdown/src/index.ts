// @videoos/mcp-markdown —— Markdown 结构分析服务器（stdio MCP）：大纲 / 目录 / frontmatter / 表格 / 链接。
// 纯 TS 零依赖：逐行扫描 + 代码围栏状态机；TOC 锚点为 GitHub 风格（小写连字符 + 重复编号）。
import { defineTool, err, ok, runStdioServer, byteLength } from "@videoos/mcp-lite";
import { z } from "zod";

const MAX_BYTES = 1_048_576;

/* ---------------- 共用扫描 ---------------- */

interface VisibleLine {
  line: string;
  no: number;
}

/** 返回代码围栏之外的行（含 1 起始行号）；``` 与 ~~~ 围栏本身也剔除 */
function linesOutsideFences(text: string): VisibleLine[] {
  const out: VisibleLine[] = [];
  let fence: string | null = null;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    if (fence !== null) {
      if (trimmed.startsWith(fence)) fence = null;
      continue;
    }
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      fence = trimmed.slice(0, 3);
      continue;
    }
    out.push({ line, no: i + 1 });
  }
  return out;
}

function tooLarge(text: string): string | null {
  return byteLength(text) > MAX_BYTES ? "E_TOO_LARGE: input text exceeds 1MB, split it first" : null;
}

/* ---------------- 大纲 / TOC ---------------- */

interface Heading {
  level: number;
  text: string;
  line: number;
}

function outlineOf(text: string): Heading[] {
  const out: Heading[] = [];
  for (const { line, no } of linesOutsideFences(text)) {
    const m = /^[ \t]{0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/.exec(line);
    if (m === null) continue;
    const body = (m[2] ?? "").replace(/[ \t]+#+[ \t]*$/, "").trim(); // 去尾部闭合 # 串
    out.push({ level: m[1].length, text: body, line: no });
  }
  return out;
}

/** GitHub 风格锚点：小写、剔除标点、空白→连字符；重复标题追加 -1/-2 */
function githubAnchor(text: string, seen: Map<string, number>): string {
  const base = text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s+/g, "-");
  const n = seen.get(base) ?? 0;
  seen.set(base, n + 1);
  return n === 0 ? base : `${base}-${n}`;
}

/* ---------------- 表格 ---------------- */

/** 分隔行：| --- | :---: | 形态（只含 空白/竖线/冒号/连字符 且含 - 与 |） */
function isSeparatorRow(line: string): boolean {
  if (!line.includes("|") || !line.includes("-")) return false;
  return /^[\s|:-]+$/.test(line);
}

function parseRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

/* ---------------- 工具定义 ---------------- */

const textSchema = z.string().describe("markdown source text");

const tools = [
  defineTool(
    "md.outline",
    "Extract the heading outline (ATX # .. ######) with levels, text and 1-based line numbers; headings inside code fences are skipped.",
    z.object({ text: textSchema }),
    ({ text }) => {
      const guard = tooLarge(text);
      if (guard !== null) return err(guard);
      const headings = outlineOf(text);
      return ok({ headings, count: headings.length });
    },
  ),
  defineTool(
    "md.toc",
    "Render a markdown table of contents as \"- [heading](#anchor)\" list items with per-level indentation and GitHub-style anchors.",
    z.object({
      text: textSchema,
      maxDepth: z.number().int().min(1).max(6).describe("deepest heading level to include").default(3),
    }),
    ({ text, maxDepth }) => {
      const guard = tooLarge(text);
      if (guard !== null) return err(guard);
      const seen = new Map<string, number>();
      const items = outlineOf(text)
        .filter((h) => h.level <= maxDepth)
        .map((h) => `${"  ".repeat(h.level - 1)}- [${h.text}](#${githubAnchor(h.text, seen)})`);
      return ok({ toc: items.join("\n"), count: items.length, maxDepth });
    },
  ),
  defineTool(
    "md.frontmatter",
    "Parse a leading \"---\" YAML-ish frontmatter block into flat key:value string fields (surrounding quotes stripped); has=false when absent or unterminated.",
    z.object({ text: textSchema }),
    ({ text }) => {
      const guard = tooLarge(text);
      if (guard !== null) return err(guard);
      const lines = text.split("\n");
      if ((lines[0] ?? "").trim() !== "---") return ok({ has: false, fields: {} });
      const fields: Record<string, string> = {};
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const t = line.trim();
        if (t === "---" || t === "...") return ok({ has: true, fields, lineCount: i - 1 });
        const idx = line.indexOf(":");
        if (idx <= 0) continue; // 无冒号 / 空键的行跳过（不支持嵌套结构）
        const key = line.slice(0, idx).trim();
        let value = line.slice(idx + 1).trim();
        if (
          value.length >= 2 &&
          ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
        ) {
          value = value.slice(1, -1);
        }
        fields[key] = value;
      }
      return ok({ has: false, fields: {} }); // 没有闭合 ---：不算 frontmatter
    },
  ),
  defineTool(
    "md.tables",
    "Extract pipe tables (header row + --- separator + body rows); returns headers, rows and the 1-based header line for each table.",
    z.object({ text: textSchema }),
    ({ text }) => {
      const guard = tooLarge(text);
      if (guard !== null) return err(guard);
      const vis = linesOutsideFences(text);
      const tables: Array<{ headers: string[]; rows: string[][]; line: number; rowCount: number }> = [];
      let i = 0;
      while (i < vis.length) {
        const { line, no } = vis[i];
        if (!line.includes("|") || isSeparatorRow(line)) {
          i += 1;
          continue;
        }
        const next = vis[i + 1];
        if (next === undefined || !isSeparatorRow(next.line)) {
          i += 1;
          continue;
        }
        const headers = parseRow(line);
        const rows: string[][] = [];
        let j = i + 2;
        while (j < vis.length && vis[j].line.includes("|") && !isSeparatorRow(vis[j].line)) {
          rows.push(parseRow(vis[j].line));
          j += 1;
        }
        tables.push({ headers, rows, line: no, rowCount: rows.length });
        i = j;
      }
      return ok({ tables, count: tables.length });
    },
  ),
  defineTool(
    "md.links",
    "Collect inline links [text](url) and images ![alt](url) with 1-based line numbers; code fences are skipped, link titles in quotes ignored.",
    z.object({ text: textSchema }),
    ({ text }) => {
      const guard = tooLarge(text);
      if (guard !== null) return err(guard);
      const links: Array<{ text: string; url: string; line: number }> = [];
      const images: Array<{ alt: string; url: string; line: number }> = [];
      const imgRe = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
      const linkRe = /(?<!!)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
      for (const { line, no } of linesOutsideFences(text)) {
        const rest = line.replace(imgRe, (_m: string, alt: string, url: string) => {
          images.push({ alt, url, line: no });
          return " ";
        });
        rest.replace(linkRe, (_m: string, linkText: string, url: string) => {
          links.push({ text: linkText, url, line: no });
          return " ";
        });
      }
      return ok({ links, images, linkCount: links.length, imageCount: images.length });
    },
  ),
];

await runStdioServer(tools, { serverName: "mcp-markdown", serverVersion: "0.1.0" });
