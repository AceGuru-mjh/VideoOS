// @videoos/mcp-code —— 源码分析服务器（stdio MCP）：行分类统计 / 符号提取（函数·类·导入）/ TODO 标记 / 语言表。
// 纯 TS 零依赖：逐行正则启发式（行号准确）；无 language 参数时按内容探测（含 "def " → py 等），默认 ts。
import { defineTool, err, ok, runStdioServer, byteLength } from "@videoos/mcp-lite";
import { z } from "zod";

const MAX_BYTES = 1_048_576;

type Lang = "ts" | "js" | "py" | "go" | "rs" | "java" | "c" | "css" | "json";

/* ---------------- 语言表 ---------------- */

const LANGUAGES = [
  { id: "ts", name: "TypeScript", extensions: [".ts", ".tsx", ".mts", ".cts"], lineComment: "//", blockComment: "/* ... */", detection: "interface/type/enum, type annotations, import type" },
  { id: "js", name: "JavaScript", extensions: [".js", ".jsx", ".mjs", ".cjs"], lineComment: "//", blockComment: "/* ... */", detection: "require() / module.exports without TS-only syntax" },
  { id: "py", name: "Python", extensions: [".py", ".pyi"], lineComment: "#", blockComment: null, detection: "def / class / from x import y" },
  { id: "go", name: "Go", extensions: [".go"], lineComment: "//", blockComment: "/* ... */", detection: "func, package x, import blocks" },
  { id: "rs", name: "Rust", extensions: [".rs"], lineComment: "//", blockComment: "/* ... */", detection: "fn, impl, let mut, use a::b" },
  { id: "java", name: "Java", extensions: [".java"], lineComment: "//", blockComment: "/* ... */", detection: "package a.b;, public class" },
  { id: "c", name: "C / C++", extensions: [".c", ".h", ".cc", ".cpp", ".hpp"], lineComment: "//", blockComment: "/* ... */", detection: "#include" },
  { id: "css", name: "CSS", extensions: [".css", ".scss", ".less"], lineComment: "//", blockComment: "/* ... */", detection: "selector { property: value; } blocks" },
  { id: "json", name: "JSON", extensions: [".json", ".jsonc"], lineComment: null, blockComment: null, detection: "starts with { or [ and quoted keys" },
] as const;

const LANG_IDS = LANGUAGES.map((l) => l.id) as unknown as Lang[];

/** 行注释前缀 / 是否支持块注释 */
const LANG_CONFIG: Record<Lang, { lineComment: string | null; blockComment: boolean }> = {
  ts: { lineComment: "//", blockComment: true },
  js: { lineComment: "//", blockComment: true },
  py: { lineComment: "#", blockComment: false },
  go: { lineComment: "//", blockComment: true },
  rs: { lineComment: "//", blockComment: true },
  java: { lineComment: "//", blockComment: true },
  c: { lineComment: "//", blockComment: true },
  css: { lineComment: "//", blockComment: true },
  json: { lineComment: null, blockComment: false },
};

/** 内容启发式语言探测（默认 ts） */
function detectLanguage(text: string): Lang {
  if (/^\s*[[{]/.test(text) && /"[^"\n]*"\s*:/.test(text)) return "json";
  if (
    /\bdef\s+\w+\s*\(/.test(text) ||
    /^\s*class\s+\w+\s*[(:]/m.test(text) ||
    /^\s*from\s+[\w.]+\s+import\b/m.test(text) ||
    /^\s*import\s+[A-Za-z_][\w.,\s]*$/m.test(text)
  ) {
    return "py";
  }
  if (/\bfunc\s+\w*\s*\(/.test(text) || /^package\s+\w+/m.test(text)) return "go";
  if (/\bfn\s+\w+\s*\(/.test(text) || /\bimpl\s+\w/.test(text) || /\blet\s+mut\b/.test(text) || /^\s*use\s+[\w:]+/m.test(text)) return "rs";
  if (/\bpackage\s+[\w.]+\s*;/.test(text) || /\bpublic\s+(?:final\s+)?(?:class|interface|enum)\b/.test(text)) return "java";
  if (/#\s*include\s*[<"]/.test(text)) return "c";
  const cssLike =
    /(?:^|\n)\s*[.#@:a-zA-Z][\w-]*[^{}\n]*\{[^{}]*:[^{}]*\}/.test(text) || /@media\b/.test(text);
  if (cssLike && !/\b(const|let|var|function|=>|def\s)/.test(text)) return "css";
  if (/\brequire\s*\(/.test(text) || /\bmodule\.exports\b/.test(text)) return "js";
  return "ts"; // 含 "=>" + "const" 等 JS 家族信号时默认 ts
}

function resolveLanguage(language: string, text: string): Lang {
  if (language !== "auto" && (LANG_IDS as string[]).includes(language)) return language as Lang;
  return detectLanguage(text);
}

/* ---------------- 行分类 ---------------- */

/** 去掉尾部换行产生的空行；空文本为 0 行 */
function sourceLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split("\n");
  if (text.endsWith("\n")) lines.pop();
  return lines;
}

function classifyLines(text: string, lang: Lang): { total: number; code: number; comment: number; blank: number } {
  const { lineComment, blockComment } = LANG_CONFIG[lang];
  let code = 0;
  let comment = 0;
  let blank = 0;
  let inBlock = false;
  for (const line of sourceLines(text)) {
    const t = line.trim();
    if (inBlock) {
      comment += 1;
      if (t.includes("*/")) inBlock = false;
      continue;
    }
    if (t === "") {
      blank += 1;
    } else if (lineComment !== null && t.startsWith(lineComment)) {
      comment += 1;
    } else if (blockComment && t.startsWith("/*")) {
      comment += 1;
      if (!t.includes("*/")) inBlock = true;
    } else {
      code += 1;
    }
  }
  const total = code + comment + blank;
  return { total, code, comment, blank };
}

/* ---------------- 符号提取（逐行正则） ---------------- */

interface SymbolResult {
  functions: Array<{ name: string; line: number; async?: true }>;
  classes: Array<{ name: string; line: number; extends?: string }>;
  imports: Array<{ module: string; line: number }>;
}

const CONTROL_KEYWORDS = new Set([
  "if", "for", "while", "switch", "catch", "return", "new", "else", "do", "sizeof", "case", "throw",
]);

function emptySymbols(): SymbolResult {
  return { functions: [], classes: [], imports: [] };
}

function symbolsFor(text: string, lang: Lang): SymbolResult {
  switch (lang) {
    case "ts":
    case "js":
      return tsJsSymbols(text);
    case "py":
      return pySymbols(text);
    case "go":
      return goSymbols(text);
    case "rs":
      return rsSymbols(text);
    case "java":
      return javaSymbols(text);
    case "c":
      return cSymbols(text);
    case "css":
      return cssSymbols(text);
    default:
      return emptySymbols(); // json：无符号
  }
}

function tsJsSymbols(text: string): SymbolResult {
  const result = emptySymbols();
  sourceLines(text).forEach((line, i) => {
    const no = i + 1;
    const fn =
      /^\s*(?:export\s+)?(?:default\s+)?(async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/.exec(line);
    if (fn !== null) {
      result.functions.push({ name: fn[2], line: no, ...(fn[1] ? { async: true as const } : {}) });
      return;
    }
    const arrow =
      /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+?)?\s*=\s*(async\s+)?/.exec(line);
    if (arrow !== null && line.includes("=>")) {
      const rest = line.slice(arrow.index + arrow[0].length);
      if (/^\(/.test(rest) || /^[A-Za-z_$][\w$]*\s*=>/.test(rest)) {
        result.functions.push({ name: arrow[1], line: no, ...(arrow[2] ? { async: true as const } : {}) });
      }
      return;
    }
    const cl =
      /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)(?:\s+extends\s+([A-Za-z_$][\w$]*(?:\.[\w$]+)*))?/.exec(
        line,
      );
    if (cl !== null) {
      result.classes.push({ name: cl[1], line: no, ...(cl[2] ? { extends: cl[2] } : {}) });
      return;
    }
    const im =
      /^\s*import\s+(?:type\s+)?[^;'"]*?from\s+["']([^"']+)["']/.exec(line) ??
      /^\s*import\s+["']([^"']+)["']/.exec(line) ??
      /^\s*export\s+[^;'"]*?from\s+["']([^"']+)["']/.exec(line);
    if (im !== null) result.imports.push({ module: im[1], line: no });
  });
  return result;
}

function pySymbols(text: string): SymbolResult {
  const result = emptySymbols();
  sourceLines(text).forEach((line, i) => {
    const no = i + 1;
    const fn = /^\s*(async\s+)?def\s+([A-Za-z_]\w*)/.exec(line);
    if (fn !== null) {
      result.functions.push({ name: fn[2], line: no, ...(fn[1] ? { async: true as const } : {}) });
      return;
    }
    const cl = /^\s*class\s+([A-Za-z_]\w*)\s*(?:\(\s*([A-Za-z_][\w.]*)\s*[),])?/.exec(line);
    if (cl !== null) {
      result.classes.push({ name: cl[1], line: no, ...(cl[2] ? { extends: cl[2] } : {}) });
      return;
    }
    const from = /^\s*from\s+([\w.]+)\s+import\b/.exec(line);
    if (from !== null) {
      result.imports.push({ module: from[1], line: no });
      return;
    }
    const imp = /^\s*import\s+([\w.,\s]+)$/.exec(line);
    if (imp !== null) {
      for (const part of imp[1].split(",")) {
        const name = part.trim().split(/\s+as\s+/)[0].trim();
        if (name.length > 0) result.imports.push({ module: name, line: no });
      }
    }
  });
  return result;
}

function goSymbols(text: string): SymbolResult {
  const result = emptySymbols();
  let inImportBlock = false;
  sourceLines(text).forEach((line, i) => {
    const no = i + 1;
    if (/^import\s*\(/.test(line)) {
      inImportBlock = true;
      return;
    }
    if (inImportBlock) {
      if (line.trim() === ")") {
        inImportBlock = false;
        return;
      }
      const m = /^\s*(?:[\w.]+\s+)?"([^"]+)"/.exec(line);
      if (m !== null) result.imports.push({ module: m[1], line: no });
      return;
    }
    const fn = /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/.exec(line);
    if (fn !== null) {
      result.functions.push({ name: fn[1], line: no });
      return;
    }
    const cl = /^\s*type\s+([A-Za-z_]\w*)\s+(?:struct|interface)\b/.exec(line);
    if (cl !== null) {
      result.classes.push({ name: cl[1], line: no });
      return;
    }
    const im = /^import\s+(?:[\w.]+\s+)?"([^"]+)"/.exec(line);
    if (im !== null) result.imports.push({ module: im[1], line: no });
  });
  return result;
}

function rsSymbols(text: string): SymbolResult {
  const result = emptySymbols();
  sourceLines(text).forEach((line, i) => {
    const no = i + 1;
    const fn =
      /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+"[^"]*"\s+)?fn\s+([A-Za-z_]\w*)/.exec(line);
    if (fn !== null) {
      result.functions.push({ name: fn[1], line: no });
      return;
    }
    const cl = /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait)\s+([A-Za-z_]\w*)/.exec(line);
    if (cl !== null) {
      result.classes.push({ name: cl[1], line: no });
      return;
    }
    const im = /^\s*(?:pub\s+)?use\s+([\w:]+)/.exec(line);
    if (im !== null) result.imports.push({ module: im[1], line: no });
  });
  return result;
}

function javaSymbols(text: string): SymbolResult {
  const result = emptySymbols();
  sourceLines(text).forEach((line, i) => {
    const no = i + 1;
    const cl =
      /^\s*(?:public\s+|private\s+|protected\s+)?(?:static\s+)?(?:abstract\s+|final\s+)?(?:class|interface|enum|record)\s+([A-Za-z_]\w*)(?:\s+extends\s+([\w.]+))?/.exec(
        line,
      );
    if (cl !== null) {
      result.classes.push({ name: cl[1], line: no, ...(cl[2] ? { extends: cl[2] } : {}) });
      return;
    }
    const im = /^\s*import\s+(?:static\s+)?([\w.]+)\s*;/.exec(line);
    if (im !== null) {
      result.imports.push({ module: im[1], line: no });
      return;
    }
    const fn =
      /^\s*(?:public|private|protected|static|final|abstract|synchronized|native|default|strictfp|\s)*[\w<>[],.\s]+?\s+([A-Za-z_]\w*)\s*\([^;{]*\)\s*(?:throws\s+[\w.,\s]+)?\{\s*$/.exec(
        line,
      );
    if (fn !== null && !CONTROL_KEYWORDS.has(fn[1])) {
      result.functions.push({ name: fn[1], line: no });
    }
  });
  return result;
}

function cSymbols(text: string): SymbolResult {
  const result = emptySymbols();
  sourceLines(text).forEach((line, i) => {
    const no = i + 1;
    const fn = /(?:^|[^\w.#])([A-Za-z_]\w*)\s*\([^;()]*\)\s*\{\s*$/.exec(line);
    if (fn !== null && !CONTROL_KEYWORDS.has(fn[1])) {
      result.functions.push({ name: fn[1], line: no });
      return;
    }
    const st = /^\s*(?:typedef\s+)?struct\s+([A-Za-z_]\w*)/.exec(line);
    if (st !== null) {
      result.classes.push({ name: st[1], line: no });
      return;
    }
    const inc = /^\s*#\s*include\s*[<"]([^>"]+)[>"]/.exec(line);
    if (inc !== null) result.imports.push({ module: inc[1], line: no });
  });
  return result;
}

function cssSymbols(text: string): SymbolResult {
  const result = emptySymbols();
  sourceLines(text).forEach((line, i) => {
    const no = i + 1;
    const im = /^\s*@import\s+(?:url\(\s*)?["']?([^"')]+?)["']?\s*\)?\s*;/.exec(line);
    if (im !== null) result.imports.push({ module: im[1], line: no });
  });
  return result;
}

/* ---------------- 工具定义 ---------------- */

const languageSchema = z
  .enum(["ts", "js", "py", "go", "rs", "java", "c", "css", "json", "auto"])
  .describe('source language; "auto" (default) detects by content, falling back to ts');

const tools = [
  defineTool(
    "code.stats",
    "Classify source lines into code / comment / blank (// or # line comments, /* */ block comments by language) with a comment ratio.",
    z.object({
      text: z.string().describe("source code text"),
      language: languageSchema.default("auto"),
    }),
    ({ text, language }) => {
      if (byteLength(text) > MAX_BYTES) return err("E_TOO_LARGE: input text exceeds 1MB, split it first");
      const lang = resolveLanguage(language, text);
      const counts = classifyLines(text, lang);
      const ratioBase = counts.code + counts.comment;
      return ok({
        ...counts,
        commentRatio: ratioBase > 0 ? Math.round((counts.comment / ratioBase) * 10_000) / 10_000 : 0,
        language: lang,
      });
    },
  ),
  defineTool(
    "code.symbols",
    "Extract functions / classes / imports with accurate 1-based line numbers (TS, JS, Python, Go, Rust, Java, C best-effort regex heuristics).",
    z.object({
      text: z.string().describe("source code text"),
      language: languageSchema.default("auto"),
    }),
    ({ text, language }) => {
      if (byteLength(text) > MAX_BYTES) return err("E_TOO_LARGE: input text exceeds 1MB, split it first");
      const lang = resolveLanguage(language, text);
      const symbols = symbolsFor(text, lang);
      return ok({
        language: lang,
        functions: symbols.functions,
        classes: symbols.classes,
        imports: symbols.imports,
      });
    },
  ),
  defineTool(
    "code.todos",
    "Find TODO / FIXME / HACK / XXX / NOTE markers with the trailing text and 1-based line numbers.",
    z.object({ text: z.string().describe("source code text (any language)") }),
    ({ text }) => {
      if (byteLength(text) > MAX_BYTES) return err("E_TOO_LARGE: input text exceeds 1MB, split it first");
      const todos: Array<{ kind: string; text: string; line: number }> = [];
      sourceLines(text).forEach((line, i) => {
        const m = /\b(TODO|FIXME|HACK|XXX|NOTE)\b/.exec(line);
        if (m === null) return;
        const rest = line.slice(m.index + m[0].length).trim();
        const body = rest.replace(/^[:\-–—\s]+/, "").trim();
        todos.push({ kind: m[1], text: body, line: i + 1 });
      });
      return ok({ todos, count: todos.length });
    },
  ),
  defineTool(
    "code.languages",
    "List supported languages with file extensions, comment syntax and detection hints.",
    z.object({}),
    () => ok({ languages: LANGUAGES, count: LANGUAGES.length }),
  ),
];

await runStdioServer(tools, { serverName: "mcp-code", serverVersion: "0.1.0" });
