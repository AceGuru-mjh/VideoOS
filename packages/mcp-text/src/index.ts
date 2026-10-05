// @videoos/mcp-text —— 纯文本处理服务器（stdio MCP）：统计 / 大小写转换 / slug / 行操作 / 软换行 / 正则抽取。
// 纯 TS 零原生依赖、零子进程；CJK 感知：统计时 1 个 CJK 字符折算 1 词，软换行允许在 CJK 字符间任意断行。
import { byteLength, defineTool, err, ok, runStdioServer } from "@videoos/mcp-lite";
import { z } from "zod";

/* ---------------- CJC / 统计帮助函数 ---------------- */

/** CJK 字符（汉字 / 平假名 / 片假名 / 谚文） */
const CJK_GLOBAL = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/gu;
const CJK_SINGLE = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u;

/** 码点数（而非 UTF-16 单元数） */
function codePoints(text: string): number {
  return Array.from(text).length;
}

/** 词数：拉丁词按空白切分；每个 CJK 字符折算 1 词 */
function countWords(text: string): number {
  let cjk = 0;
  const stripped = text.replace(CJK_GLOBAL, (m) => {
    cjk += Array.from(m).length;
    return " ";
  });
  const latin = stripped.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length ?? 0;
  return cjk + latin;
}

/** 行数：按 \n 切分；尾部换行不产生空行；空文本为 0 行 */
function countLines(text: string): number {
  if (text.length === 0) return 0;
  const parts = text.split("\n");
  return text.endsWith("\n") ? parts.length - 1 : parts.length;
}

/** 输入体积守卫（1MB），超限返回结构化错误 */
function tooLarge(text: string): string | null {
  return byteLength(text) > 1_048_576 ? "E_TOO_LARGE: input text exceeds 1MB, split it first" : null;
}

/* ---------------- 大小写转换 ---------------- */

/** 分词：拉丁字母数字串为 1 词，CJK 单字为 1 词 */
const WORD_TOKENS = /[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*|\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/gu;

function cap(word: string): string {
  return /^[a-z]/.test(word) ? word[0].toUpperCase() + word.slice(1) : word;
}

function convertCase(text: string, to: string): string {
  switch (to) {
    case "upper":
      return text.toUpperCase();
    case "lower":
      return text.toLowerCase();
    case "sentence":
      // 小写化后在句首（文本开头 / [.!?]\s+ / 段落换行后）恢复大写
      return text
        .toLowerCase()
        .replace(/(^\s*[a-z])|([.!?][ \t]+[a-z])|(\n[ \t]*[a-z])/g, (m) => m.toUpperCase());
    default: {
      const tokens = text.match(WORD_TOKENS) ?? [];
      switch (to) {
        case "camel":
          return tokens.map((w, i) => (i === 0 ? w.toLowerCase() : cap(w.toLowerCase()))).join("");
        case "pascal":
          return tokens.map((w) => cap(w.toLowerCase())).join("");
        case "snake":
          return tokens.map((w) => w.toLowerCase()).join("_");
        case "kebab":
          return tokens.map((w) => w.toLowerCase()).join("-");
        case "title":
          return tokens.map((w) => cap(w.toLowerCase())).join(" ");
        default:
          return text;
      }
    }
  }
}

/* ---------------- 带种子的确定性洗牌（LCG + Fisher-Yates） ---------------- */

function seededShuffle<T>(items: T[], seed: number): T[] {
  const arr = [...items];
  let state = (Math.trunc(seed) >>> 0) || 1;
  for (let i = arr.length - 1; i > 0; i--) {
    state = (Math.imul(state, 1_103_515_245) + 12_345) >>> 0;
    const j = state % (i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/* ---------------- 软换行（不切断单词；CJK 任意断行） ---------------- */

/** 把一个"无空白单元"拆成可断片段：CJK 单字各成一段，非 CJK 连续串整段不可断 */
function breakPieces(unit: string): string[] {
  const pieces: string[] = [];
  let buf = "";
  for (const ch of unit) {
    if (CJK_SINGLE.test(ch)) {
      if (buf.length > 0) {
        pieces.push(buf);
        buf = "";
      }
      pieces.push(ch);
    } else {
      buf += ch;
    }
  }
  if (buf.length > 0) pieces.push(buf);
  return pieces;
}

function wrapLine(line: string, width: number, indent: string): string[] {
  const out: string[] = [];
  const avail = Math.max(1, width - codePoints(indent));
  let cur = "";
  let curLen = 0;

  /** 行首放置超长片段：硬切 */
  const emitHard = (piece: string): void => {
    let chunk = "";
    let chunkLen = 0;
    for (const ch of piece) {
      if (chunkLen === avail) {
        out.push(indent + chunk);
        chunk = "";
        chunkLen = 0;
      }
      chunk += ch;
      chunkLen += 1;
    }
    cur = chunk;
    curLen = chunkLen;
  };

  const place = (piece: string, spaced: boolean): void => {
    const plen = codePoints(piece);
    if (cur.length === 0) {
      if (plen <= avail) {
        cur = piece;
        curLen = plen;
      } else {
        emitHard(piece);
      }
      return;
    }
    const cand = (spaced ? curLen + 1 : curLen) + plen;
    if (cand <= avail) {
      cur += (spaced ? " " : "") + piece;
      curLen = cand;
    } else {
      out.push(indent + cur);
      cur = "";
      curLen = 0;
      place(piece, false);
    }
  };

  const units = line.split(/\s+/).filter((u) => u.length > 0);
  if (units.length === 0) return [indent]; // 保留空行
  units.forEach((unit, ui) => {
    for (const piece of breakPieces(unit)) place(piece, ui > 0);
  });
  if (cur.length > 0) out.push(indent + cur);
  return out;
}

/* ---------------- 工具定义 ---------------- */

const textSchema = z.string().describe("input text");

const tools = [
  defineTool(
    "text.stats",
    "Text statistics: chars (code points), words (CJK char counts as one word), UTF-8 bytes, lines, and reading time at 2.5 words/sec.",
    z.object({ text: textSchema }),
    ({ text }) => {
      const guard = tooLarge(text);
      if (guard !== null) return err(guard);
      const words = countWords(text);
      return ok({
        chars: codePoints(text),
        words,
        bytes: byteLength(text),
        lines: countLines(text),
        readTimeSec: Math.round((words / 2.5) * 10) / 10,
      });
    },
  ),
  defineTool(
    "text.case",
    "Convert text casing: camel / pascal / snake / kebab / title / upper / lower / sentence.",
    z.object({
      text: textSchema,
      to: z
        .enum(["camel", "pascal", "snake", "kebab", "title", "upper", "lower", "sentence"])
        .describe("target casing style"),
    }),
    ({ text, to }) => {
      const guard = tooLarge(text);
      if (guard !== null) return err(guard);
      return ok({ result: convertCase(text, to), to });
    },
  ),
  defineTool(
    "text.slug",
    "Make a URL slug: lowercase, non-alphanumerics collapse into the separator, trimmed ends (unicode letters kept).",
    z.object({
      text: textSchema,
      separator: z.string().max(16).describe("output separator, default \"-\" (must be non-alphanumeric)").default("-"),
    }),
    ({ text, separator }) => {
      const guard = tooLarge(text);
      if (guard !== null) return err(guard);
      if (separator.length === 0 || /[A-Za-z0-9]/.test(separator)) {
        return err("E_ARG: separator must be 1-16 chars and contain no letters/digits (e.g. \"-\" or \"_\")");
      }
      const replaced = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, () => separator);
      const slug = replaced.split(separator).filter((s) => s.length > 0).join(separator);
      return ok({ slug, separator });
    },
  ),
  defineTool(
    "text.lines",
    "Operate on lines: sort / uniq (drop adjacent duplicates) / dedupe (drop all duplicates) / reverse / trim / number / shuffle (seeded, reproducible).",
    z.object({
      text: textSchema,
      op: z
        .enum(["sort", "uniq", "reverse", "trim", "number", "dedupe", "shuffle"])
        .describe("line operation"),
      seed: z.number().describe("shuffle PRNG seed (any integer; default 42)").default(42),
    }),
    ({ text, op, seed }) => {
      const guard = tooLarge(text);
      if (guard !== null) return err(guard);
      const hasTrailing = text.endsWith("\n");
      const lines = text.split("\n");
      if (hasTrailing) lines.pop(); // 尾部换行不是一行内容
      let out: string[];
      switch (op) {
        case "sort":
          out = [...lines].sort();
          break;
        case "uniq":
          out = lines.filter((l, i) => i === 0 || l !== lines[i - 1]);
          break;
        case "dedupe":
          out = [...new Set(lines)];
          break;
        case "reverse":
          out = [...lines].reverse();
          break;
        case "trim":
          out = lines.map((l) => l.trim());
          break;
        case "number":
          out = lines.map((l, i) => `${i + 1}. ${l}`);
          break;
        case "shuffle":
          out = seededShuffle(lines, seed);
          break;
      }
      const result = out.length === 0 ? "" : out.join("\n") + (hasTrailing ? "\n" : "");
      return ok({ result, op, count: out.length });
    },
  ),
  defineTool(
    "text.wrap",
    "Soft-wrap text at a width without breaking words; CJK characters may break anywhere; long words are hard-broken. Whitespace runs collapse to single spaces.",
    z.object({
      text: textSchema,
      width: z.number().int().min(2).max(1000).describe("target line width in code points").default(80),
      indent: z.string().max(64).describe("prefix prepended to every output line").default(""),
    }),
    ({ text, width, indent }) => {
      const guard = tooLarge(text);
      if (guard !== null) return err(guard);
      const lines = text.split("\n").flatMap((l) => wrapLine(l, width, indent));
      return ok({ result: lines.join("\n"), lineCount: lines.length, width, indent });
    },
  ),
  defineTool(
    "text.extract",
    "Extract regex matches from text (<=100 kept). Pass group (index or named group) to extract that capture instead of the full match.",
    z.object({
      text: textSchema,
      pattern: z.string().describe('JS regex source, e.g. "(?<year>\\\\d{4})-"'),
      flags: z
        .enum(["i", "g", "gi"])
        .describe('regex flags; "g"/"gi" (default) scan all matches, "i" alone returns only the first')
        .default("g"),
      group: z
        .union([z.number(), z.string()])
        .describe("capture group to return instead of the full match: 0 = full match, 1.. = index, or a named group; matches where the group is missing are skipped")
        .optional(),
    }),
    ({ text, pattern, flags, group }) => {
      const guard = tooLarge(text);
      if (guard !== null) return err(guard);
      if (typeof group === "number" && (!Number.isInteger(group) || group < 0)) {
        return err("E_ARG: group index must be a non-negative integer");
      }
      let re: RegExp;
      try {
        re = new RegExp(pattern, flags);
      } catch (error) {
        return err(`E_REGEX: invalid pattern ${JSON.stringify(pattern)} (${error instanceof Error ? error.message : String(error)})`);
      }
      const matches: Array<Record<string, unknown>> = [];
      let total = 0;
      let hits = 0;
      let m: RegExpExecArray | null;
      let steps = 0;
      while ((m = re.exec(text)) !== null) {
        total += 1;
        let value = m[0];
        let hit = true;
        if (group !== undefined) {
          const g = typeof group === "number" ? m[group] : m.groups?.[group];
          if (g === undefined) hit = false;
          else value = g;
        }
        if (hit) {
          hits += 1;
          if (matches.length < 100) {
            matches.push({
              text: value,
              index: m.index,
              ...(m.length > 1
                ? { groups: Array.from(m.slice(1), (g) => g ?? null) }
                : {}),
              ...(m.groups !== undefined
                ? { namedGroups: Object.fromEntries(Object.entries(m.groups).map(([k, v]) => [k, v ?? null])) }
                : {}),
            });
          }
        }
        if (!flags.includes("g")) break;
        if (m[0] === "") re.lastIndex += 1; // 零宽匹配推进，避免死循环
        steps += 1;
        if (steps > 200_000) break;
      }
      return ok({ matches, count: total, truncated: hits > 100 });
    },
  ),
];

await runStdioServer(tools, { serverName: "mcp-text", serverVersion: "0.1.0" });
