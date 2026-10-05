// @videoos/mcp-regex —— 正则工具服务器（stdio MCP）：预编译校验 + 启发式解释、执行匹配、字面量转义、速查表。
// 纯 TS 零依赖：解释器是自写的逐字符扫描器（锚点/命名组/类/量词/字面量计数），不引入正则解析库。
import { defineTool, err, ok, runStdioServer, byteLength } from "@videoos/mcp-lite";
import { z } from "zod";

/* ---------------- 启发式解释器 ---------------- */

interface RegexExplanation {
  anchors: string[];
  groups: string[];
  captures: number;
  nonCapturing: number;
  lookarounds: number;
  classes: number;
  quantifiers: number;
  literalsCount: number;
}

/** 逐字符扫描 pattern（假设已通过 new RegExp 校验），统计各类构造 */
function explainRegex(source: string): RegexExplanation {
  const ex: RegexExplanation = {
    anchors: [],
    groups: [],
    captures: 0,
    nonCapturing: 0,
    lookarounds: 0,
    classes: 0,
    quantifiers: 0,
    literalsCount: 0,
  };
  let i = 0;
  const len = source.length;
  while (i < len) {
    const ch = source[i];
    if (ch === "\\") {
      const next = source[i + 1] ?? "";
      if ("dDwWsS".includes(next)) ex.classes += 1;
      else if (next === "b") ex.anchors.push("\\b (word boundary)");
      else if (next === "B") ex.anchors.push("\\B (non-word boundary)");
      else ex.literalsCount += 1; // \. \[ \\ \n … 均按 1 个字面量计
      i += 2;
    } else if (ch === "[") {
      // 字符类 […]（跳过首 ^ 与首 ] 字面量、类内转义）
      i += 1;
      if (source[i] === "^") i += 1;
      if (source[i] === "]") i += 1;
      while (i < len && source[i] !== "]") {
        i += source[i] === "\\" ? 2 : 1;
      }
      i += 1;
      ex.classes += 1;
    } else if (ch === "(") {
      if (source.startsWith("(?<", i)) {
        const kind = source[i + 3];
        if (kind === "=" || kind === "!") {
          ex.lookarounds += 1;
          ex.nonCapturing += 1;
          i += 4;
        } else {
          const close = source.indexOf(">", i + 3);
          const name = close > i + 3 ? source.slice(i + 3, close) : "";
          if (name.length > 0) ex.groups.push(name);
          i = close + 1;
        }
      } else if (source.startsWith("(?:", i)) {
        ex.nonCapturing += 1;
        i += 3;
      } else if (source[i + 1] === "?" && "=<!".includes(source[i + 2] ?? "")) {
        ex.lookarounds += 1;
        ex.nonCapturing += 1;
        i += 3;
      } else {
        ex.captures += 1;
        i += 1;
      }
    } else if (ch === "{") {
      const m = /^\{(\d+)(,(\d+)?)?\}/.exec(source.slice(i));
      if (m !== null) {
        ex.quantifiers += 1;
        i += m[0].length;
        if (source[i] === "?") i += 1; // lazy 修饰符不算新量词
      } else {
        ex.literalsCount += 1; // 不是量词的 { 按字面量
        i += 1;
      }
    } else if (ch === "*" || ch === "+" || ch === "?") {
      ex.quantifiers += 1;
      i += 1;
      if (source[i] === "?") i += 1;
    } else if (ch === "^") {
      ex.anchors.push("^ (start of string / line with m)");
      i += 1;
    } else if (ch === "$") {
      ex.anchors.push("$ (end of string / line with m)");
      i += 1;
    } else {
      // 组括号 / 分枝符是语法结构，不计入字面量
      if (ch !== "(" && ch !== ")" && ch !== "|") ex.literalsCount += 1;
      i += 1;
    }
  }
  return ex;
}

/** 构造 RegExp；失败返回 error 字符串 */
function tryCompile(source: string, flags: string): { re?: RegExp; error?: string } {
  try {
    return { re: new RegExp(source, flags) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** 全局匹配（内部强制加 g），带零宽推进与步数护栏 */
function matchAll(re: RegExp, text: string, cap: number): { matches: RegExpExecArray[]; total: number } {
  const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  const matches: RegExpExecArray[] = [];
  let total = 0;
  let m: RegExpExecArray | null;
  let steps = 0;
  while ((m = global.exec(text)) !== null) {
    total += 1;
    if (matches.length < cap) matches.push(m);
    if (m[0] === "") global.lastIndex += 1;
    steps += 1;
    if (steps > 100_000) break;
  }
  return { matches, total };
}

/* ---------------- 速查表（静态数据） ---------------- */

const CHEATSHEET = {
  categories: [
    {
      name: "anchors",
      items: [
        { syntax: "^", meaning: "start of string (or line with m flag)" },
        { syntax: "$", meaning: "end of string (or line with m flag)" },
        { syntax: "\\b", meaning: "word boundary (between \\w and non-\\w)" },
        { syntax: "\\B", meaning: "not a word boundary" },
      ],
    },
    {
      name: "character classes",
      items: [
        { syntax: "\\d \\D", meaning: "digit / non-digit ([0-9])" },
        { syntax: "\\w \\W", meaning: "word char / non-word char ([A-Za-z0-9_])" },
        { syntax: "\\s \\S", meaning: "whitespace / non-whitespace" },
        { syntax: "[abc]", meaning: "any of a, b, c" },
        { syntax: "[^abc]", meaning: "any char except a, b, c" },
        { syntax: "[a-z0-9_]", meaning: "character range" },
        { syntax: ".", meaning: "any char except newline (with s flag: any)" },
      ],
    },
    {
      name: "quantifiers",
      items: [
        { syntax: "*", meaning: "0 or more (greedy)" },
        { syntax: "+", meaning: "1 or more (greedy)" },
        { syntax: "?", meaning: "0 or 1" },
        { syntax: "{3}", meaning: "exactly 3" },
        { syntax: "{2,5}", meaning: "between 2 and 5" },
        { syntax: "{2,}", meaning: "2 or more" },
        { syntax: "*? +? ??", meaning: "lazy (non-greedy) variants" },
      ],
    },
    {
      name: "groups & references",
      items: [
        { syntax: "(...)", meaning: "capturing group (indexed from 1)" },
        { syntax: "(?<name>...)", meaning: "named capturing group" },
        { syntax: "(?:...)", meaning: "non-capturing group" },
        { syntax: "\\1", meaning: "backreference to group 1" },
        { syntax: "(a|b)", meaning: "alternation inside a group" },
      ],
    },
    {
      name: "lookaround",
      items: [
        { syntax: "(?=...)", meaning: "positive lookahead" },
        { syntax: "(?!...)", meaning: "negative lookahead" },
        { syntax: "(?<=...)", meaning: "positive lookbehind" },
        { syntax: "(?<!...)", meaning: "negative lookbehind" },
      ],
    },
    {
      name: "flags",
      items: [
        { syntax: "i", meaning: "case-insensitive" },
        { syntax: "g", meaning: "global (all matches)" },
        { syntax: "m", meaning: "^ and $ match line boundaries" },
        { syntax: "s", meaning: ". also matches newline" },
        { syntax: "u", meaning: "unicode mode (\\p{...} property escapes)" },
        { syntax: "y", meaning: "sticky (match at lastIndex only)" },
      ],
    },
    {
      name: "escapes",
      items: [
        { syntax: "\\. \\* \\+ \\? \\( \\)", meaning: "escape a metacharacter to match it literally" },
        { syntax: "\\n \\t \\r", meaning: "newline, tab, carriage return" },
        { syntax: "\\p{L}", meaning: "unicode letter (needs u flag)" },
        { syntax: "\\p{N}", meaning: "unicode number (needs u flag)" },
      ],
    },
  ],
  examples: [
    { task: "integer", pattern: "^-?\\d+$" },
    { task: "decimal number", pattern: "^-?\\d+(\\.\\d+)?$" },
    { task: "email (loose)", pattern: "[\\w.+-]+@[\\w-]+\\.[\\w.]+" },
    { task: "ISO date with named groups", pattern: "(?<year>\\d{4})-(?<month>\\d{2})-(?<day>\\d{2})" },
    { task: "hex color", pattern: "#(?:[0-9a-fA-F]{3}){1,2}\\b" },
    { task: "URL slug", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
    { task: "repeated word", pattern: "\\b(\\w+)\\s+\\1\\b" },
    { task: "leading/trailing whitespace", pattern: "^\\s+|\\s+$" },
    { task: "time HH:MM (24h)", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
    { task: "CJK character", pattern: "\\p{Script=Han}" },
  ],
};

/* ---------------- 工具定义 ---------------- */

const flagsSchema = z.string().max(8).describe('regex flags string, e.g. "gi" (valid chars: d g i m s u v y)');

const tools = [
  defineTool(
    "regex.build",
    "Validate a regex source before use and get a heuristic explanation (anchors, named groups, classes, quantifiers, literal count); never throws on bad input.",
    z.object({
      source: z.string().describe("regex source text, e.g. \"(?<year>\\\\d{4})\""),
      flags: flagsSchema.optional(),
    }),
    ({ source, flags }) => {
      if (flags !== undefined && !/^[dgimsuvy]*$/.test(flags)) {
        return err(`E_FLAGS: invalid flags ${JSON.stringify(flags)} (allowed: d g i m s u v y)`);
      }
      const safeFlags = flags ?? "";
      const compiled = tryCompile(source, safeFlags);
      if (compiled.error !== undefined || compiled.re === undefined) {
        return ok({ valid: false, pattern: source, flags: safeFlags, error: compiled.error ?? "invalid regex" });
      }
      return ok({
        valid: true,
        pattern: source,
        flags: safeFlags,
        explanation: explainRegex(source),
      });
    },
  ),
  defineTool(
    "regex.test",
    "Run a regex against text and return up to 50 matches with index, capture groups and named groups (global matching is implied).",
    z.object({
      pattern: z.string().describe("regex source text"),
      flags: flagsSchema.describe('extra flags, e.g. "i"; "g" is implied and not needed').optional(),
      text: z.string().describe("input text to match against"),
    }),
    ({ pattern, flags, text }) => {
      if (byteLength(text) > 1_048_576) return err("E_TOO_LARGE: input text exceeds 1MB, split it first");
      if (flags !== undefined && !/^[dgimsuvy]*$/.test(flags)) {
        return err(`E_FLAGS: invalid flags ${JSON.stringify(flags)} (allowed: d g i m s u v y)`);
      }
      const compiled = tryCompile(pattern, flags ?? "");
      if (compiled.error !== undefined || compiled.re === undefined) {
        return err(`E_REGEX: invalid pattern ${JSON.stringify(pattern)} (${compiled.error ?? "invalid regex"})`);
      }
      const { matches, total } = matchAll(compiled.re, text, 50);
      return ok({
        matches: matches.map((m) => ({
          text: m[0],
          index: m.index,
          ...(m.length > 1 ? { groups: Array.from(m.slice(1), (g) => g ?? null) } : {}),
          ...(m.groups !== undefined
            ? { namedGroups: Object.fromEntries(Object.entries(m.groups).map(([k, v]) => [k, v ?? null])) }
            : {}),
        })),
        count: total,
        truncated: total > matches.length,
      });
    },
  ),
  defineTool(
    "regex.escape",
    "Escape a literal string so it can be embedded in a regex and matched verbatim (meta characters get a backslash).",
    z.object({ text: z.string().max(65_536).describe("raw text to escape") }),
    ({ text }) => ok({ escaped: text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") }),
  ),
  defineTool(
    "regex.cheatsheet",
    "Regex quick reference: anchors, classes, quantifiers, groups, lookaround, flags and ready-made example patterns for common tasks.",
    z.object({}),
    () => ok(CHEATSHEET),
  ),
];

await runStdioServer(tools, { serverName: "mcp-regex", serverVersion: "0.1.0" });
