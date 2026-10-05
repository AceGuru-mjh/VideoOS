// @videoos/mcp-json —— JSON 工具服务器（stdio MCP）：validate/format/query/set/stats，纯文本处理零落盘。
// 关键设计：自写递归下降扫描器给 JSON.parse 失败定位「行/列/偏移」（JSC 的报错不含位置）；
// path 语法 $ 根 + .key + [n] + ["key"]（自实现 walker，找不到 found:false 不报错）；
// json.set 深拷贝后按路径改值，缺的容器按键/索引自动建（对象/数组）；输入 >1MB 一律 E_SIZE。
import { defineTool, byteLength, ok, runStdioServer, ToolError } from "@videoos/mcp-lite";
import { z } from "zod";

const MAX_TEXT_BYTES = 1_048_576; // 全部工具的 text 入参上限

// ---------------------------------------------------------------- 语法扫描器（定位行列）

interface Located {
  message: string;
  line: number;
  column: number;
  position: number;
}

class JsonScanError extends Error {
  constructor(readonly loc: Located) {
    super(loc.message);
    this.name = "JsonScanError";
  }
}

/** 扫描一遍 JSON 文本；首个语法错误带 行/列/偏移 抛 JsonScanError（只用于定位，值由 JSON.parse 产出） */
function scanJson(src: string): void {
  let i = 0;
  const fail = (position: number, message: string): never => {
    let line = 1;
    let lineStart = 0;
    for (let p = 0; p < position && p < src.length; p++) {
      if (src.charCodeAt(p) === 10) {
        line++;
        lineStart = p + 1;
      }
    }
    throw new JsonScanError({ message, line, column: position - lineStart + 1, position });
  };
  const at = (): string => (i < src.length ? src[i] : "");
  const isDigit = (): boolean => at() >= "0" && at() <= "9";
  const skipWs = (): void => {
    while (i < src.length && " \t\r\n".includes(src[i])) i++;
  };
  const expectWord = (word: string): void => {
    if (!src.startsWith(word, i)) fail(i, `invalid literal (expected "${word}")`);
    i += word.length;
  };
  const parseString = (): void => {
    const start = i;
    i++; // 开引号
    for (;;) {
      if (i >= src.length) fail(start, "unterminated string");
      const c = src[i];
      if (c === '"') {
        i++;
        return;
      }
      if (c === "\\") {
        const next = i + 1 < src.length ? src[i + 1] : "";
        if (next === "") fail(start, "unterminated string");
        if (next === "u") {
          for (let k = 0; k < 4; k++) {
            const hex = i + 2 + k < src.length ? src[i + 2 + k] : "";
            if (!/^[0-9a-fA-F]$/.test(hex)) fail(i + 1, "invalid \\u escape (expected 4 hex digits)");
          }
          i += 6;
          continue;
        }
        if ('"\\/bfnrt'.includes(next)) {
          i += 2;
          continue;
        }
        fail(i, `invalid escape sequence ${JSON.stringify(`\\${next}`)}`);
      }
      if (c.charCodeAt(0) < 0x20) fail(i, "unescaped control character in string");
      i++;
    }
  };
  const parseNumber = (): void => {
    const start = i;
    if (at() === "-") i++;
    if (i >= src.length) fail(start, "unexpected end of input in number");
    if (at() === "0") {
      i++;
      if (isDigit()) fail(i, "leading zeros are not allowed in numbers");
    } else if (at() >= "1" && at() <= "9") {
      while (isDigit()) i++;
    } else {
      fail(i, `invalid number (unexpected ${at() === "" ? "end of input" : JSON.stringify(at())})`);
    }
    if (at() === ".") {
      i++;
      if (!isDigit()) fail(i, "expected digit after decimal point");
      while (isDigit()) i++;
    }
    if (at() === "e" || at() === "E") {
      i++;
      if (at() === "+" || at() === "-") i++;
      if (!isDigit()) fail(i, "expected digit in exponent");
      while (isDigit()) i++;
    }
  };
  const parseValue = (): void => {
    skipWs();
    if (i >= src.length) fail(i, "unexpected end of input");
    const c = src[i];
    if (c === "{") {
      i++;
      skipWs();
      if (at() === "}") {
        i++;
        return;
      }
      for (;;) {
        skipWs();
        if (at() !== '"') {
          fail(i, `expected object key string but found ${at() === "" ? "end of input" : JSON.stringify(at())}`);
        }
        parseString();
        skipWs();
        if (at() !== ":") fail(i, `expected ":" after object key but found ${at() === "" ? "end of input" : JSON.stringify(at())}`);
        i++;
        parseValue();
        skipWs();
        if (at() === ",") {
          i++;
          continue;
        }
        if (at() === "}") {
          i++;
          return;
        }
        fail(i, `expected "," or "}" but found ${at() === "" ? "end of input" : JSON.stringify(at())}`);
      }
    }
    if (c === "[") {
      i++;
      skipWs();
      if (at() === "]") {
        i++;
        return;
      }
      for (;;) {
        parseValue();
        skipWs();
        if (at() === ",") {
          i++;
          continue;
        }
        if (at() === "]") {
          i++;
          return;
        }
        fail(i, `expected "," or "]" but found ${at() === "" ? "end of input" : JSON.stringify(at())}`);
      }
    }
    if (c === '"') {
      parseString();
      return;
    }
    if (c === "-" || (c >= "0" && c <= "9")) {
      parseNumber();
      return;
    }
    if (c === "t") return expectWord("true");
    if (c === "f") return expectWord("false");
    if (c === "n") return expectWord("null");
    fail(i, `unexpected character ${JSON.stringify(c)}`);
  };
  parseValue();
  skipWs();
  if (i < src.length) {
    fail(i, `unexpected content after JSON value (starts with ${JSON.stringify(src.slice(i, i + 10))})`);
  }
}

/** 定位 JSON.parse 失败点（扫描器自身异常时回退 null） */
function locateError(text: string): Located | null {
  try {
    scanJson(text);
    return null;
  } catch (error) {
    return error instanceof JsonScanError ? error.loc : null;
  }
}

/** 解析 + 失败定位（format/query/set/stats 共用；消息带行列） */
function parseJsonOrThrow(text: string, what = "text"): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    const loc = locateError(text);
    throw new ToolError(
      "E_PARSE",
      loc !== null
        ? `invalid JSON in ${what}: ${loc.message} at line ${loc.line}, column ${loc.column} (offset ${loc.position})`
        : `invalid JSON in ${what}`,
    );
  }
}

function assertSize(text: string): void {
  if (byteLength(text) > MAX_TEXT_BYTES) {
    throw new ToolError("E_SIZE", `input exceeds ${MAX_TEXT_BYTES} bytes; split the document or query a smaller slice`);
  }
}

// ---------------------------------------------------------------- path 解析与游标

type Segment = { type: "key"; key: string } | { type: "index"; index: number };

/** path 语法：可选 $ 根 + 重复的 .key / [n] / ["key"] / ['key']（裸键名开头也接受，如 "a.b[0]"） */
function parsePath(input: string): Segment[] {
  let s = input.trim();
  if (s.startsWith("$")) s = s.slice(1);
  if (s.length > 0 && !s.startsWith(".") && !s.startsWith("[")) s = `.${s}`; // 裸首键补点
  const segments: Segment[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ".") {
      let k = i + 1;
      while (k < s.length && s[k] !== "." && s[k] !== "[") k++;
      if (k === i + 1) throw new ToolError("E_PATH", `invalid path ${JSON.stringify(input)}: empty key after "." at offset ${i}`);
      segments.push({ type: "key", key: s.slice(i + 1, k) });
      i = k;
      continue;
    }
    if (c === "[") {
      const close = s.indexOf("]", i + 1);
      if (close === -1) throw new ToolError("E_PATH", `invalid path ${JSON.stringify(input)}: unterminated "["`);
      const inner = s.slice(i + 1, close).trim();
      if (inner.startsWith('"') || inner.startsWith("'")) {
        const quote = inner[0];
        if (inner.length < 2 || !inner.endsWith(quote) || inner.slice(1, -1).length === 0) {
          throw new ToolError("E_PATH", `invalid path ${JSON.stringify(input)}: bad quoted key ${JSON.stringify(inner)}`);
        }
        segments.push({ type: "key", key: inner.slice(1, -1) });
      } else if (/^\d+$/.test(inner)) {
        segments.push({ type: "index", index: Number.parseInt(inner, 10) });
      } else {
        throw new ToolError("E_PATH", `invalid path ${JSON.stringify(input)}: bad [...] segment ${JSON.stringify(inner)} (use ["key"] or [0])`);
      }
      i = close + 1;
      continue;
    }
    throw new ToolError("E_PATH", `invalid path ${JSON.stringify(input)}: unexpected ${JSON.stringify(c)} at offset ${i}`);
  }
  return segments;
}

function segText(seg: Segment): string {
  return seg.type === "key" ? `.${seg.key}` : `[${seg.index}]`;
}

/** 沿 segments 走；类型不符/缺键/越界 → found:false（不抛错） */
function walkPath(value: unknown, segments: Segment[]): { found: boolean; value?: unknown } {
  let cur: unknown = value;
  for (const seg of segments) {
    if (seg.type === "key") {
      if (typeof cur !== "object" || cur === null || Array.isArray(cur)) return { found: false };
      if (!Object.prototype.hasOwnProperty.call(cur, seg.key)) return { found: false };
      cur = (cur as Record<string, unknown>)[seg.key];
    } else {
      if (!Array.isArray(cur)) return { found: false };
      if (seg.index >= cur.length) return { found: false };
      cur = cur[seg.index];
    }
  }
  return { found: true, value: cur };
}

function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "object") return "an object";
  return `a ${typeof value}`;
}

function readSeg(container: unknown, seg: Segment): unknown {
  if (seg.type === "key") {
    if (typeof container !== "object" || container === null || Array.isArray(container)) return undefined;
    return Object.prototype.hasOwnProperty.call(container, seg.key)
      ? (container as Record<string, unknown>)[seg.key]
      : undefined;
  }
  if (!Array.isArray(container)) return undefined;
  return seg.index < container.length ? container[seg.index] : undefined;
}

function writeSeg(container: unknown, seg: Segment, value: unknown): void {
  if (seg.type === "key") {
    if (Array.isArray(container)) {
      throw new ToolError("E_PATH", `cannot set string key "${seg.key}" on an array (use [n])`);
    }
    if (typeof container !== "object" || container === null) {
      throw new ToolError("E_PATH", `cannot set "${seg.key}" on ${describeType(container)}`);
    }
    (container as Record<string, unknown>)[seg.key] = value;
    return;
  }
  if (!Array.isArray(container)) {
    throw new ToolError("E_PATH", `cannot set index [${seg.index}] on ${describeType(container)} (use .key for objects)`);
  }
  while (container.length <= seg.index) container.push(null); // 索引越界 → 用 null 填充
  container[seg.index] = value;
}

/** 深拷贝后按 segments 写入 value；缺失的中间容器按下一节的类型创建（key→对象，index→数组） */
function setAt(root: unknown, segments: Segment[], value: unknown): unknown {
  if (segments.length === 0) return value; // 整根替换
  // 根是标量/null → 按首段类型造新根；否则就地变异原根（引用不变，最后返回它）
  const container: unknown =
    typeof root === "object" && root !== null
      ? root
      : segments[0].type === "index"
        ? []
        : {};
  const result = container;
  let cur: unknown = container;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    const child = readSeg(cur, seg);
    if (child === undefined) {
      const created: unknown = segments[i + 1].type === "index" ? [] : {};
      writeSeg(cur, seg, created);
      cur = created;
    } else if (typeof child === "object" && child !== null) {
      cur = child;
    } else {
      throw new ToolError("E_PATH", `cannot descend into ${describeType(child)} at ${segText(seg)} (segment ${i + 1})`);
    }
  }
  writeSeg(cur, segments[segments.length - 1], value);
  return result;
}

// ---------------------------------------------------------------- stats

interface JsonStats {
  keys: number;
  maxDepth: number;
  sizeBytes: number;
  typeCounts: Record<string, number>;
}

function computeStats(value: unknown, text: string): JsonStats {
  const typeCounts: Record<string, number> = { object: 0, array: 0, string: 0, number: 0, boolean: 0, null: 0 };
  let keys = 0;
  const visit = (v: unknown): number => {
    if (v === null) {
      typeCounts.null++;
      return 0;
    }
    if (Array.isArray(v)) {
      typeCounts.array++;
      let depth = 0;
      for (const item of v) depth = Math.max(depth, visit(item));
      return 1 + depth;
    }
    if (typeof v === "object") {
      typeCounts.object++;
      let depth = 0;
      for (const [, item] of Object.entries(v)) {
        keys++;
        depth = Math.max(depth, visit(item));
      }
      return 1 + depth;
    }
    if (typeof v === "string") typeCounts.string++;
    else if (typeof v === "number") typeCounts.number++;
    else typeCounts.boolean++;
    return 0;
  };
  const maxDepth = visit(value);
  return { keys, maxDepth, sizeBytes: byteLength(text), typeCounts };
}

// ---------------------------------------------------------------- 工具表

const tools = [
  defineTool(
    "json.validate",
    "Validate JSON text; on success returns stats (keys/depth/typeCounts), on failure errors with line/column positions.",
    z.object({ text: z.string().describe("JSON text to validate") }),
    ({ text }) => {
      assertSize(text);
      try {
        const value = JSON.parse(text) as unknown;
        return ok({ valid: true, stats: computeStats(value, text) });
      } catch {
        const loc = locateError(text);
        return ok({
          valid: false,
          errors: [
            {
              path: "$",
              message:
                loc !== null
                  ? `${loc.message} at line ${loc.line}, column ${loc.column} (offset ${loc.position})`
                  : "syntax error",
            },
          ],
        });
      }
    },
  ),

  defineTool(
    "json.format",
    "Re-format JSON text with a chosen indent (0 = compact single line); rejects inputs over 1MB.",
    z.object({
      text: z.string().describe("JSON text to format"),
      indent: z.number().int().min(0).max(10).default(2).describe("spaces per nesting level (0 = compact, default 2)"),
    }),
    ({ text, indent }) => {
      assertSize(text);
      const value = parseJsonOrThrow(text);
      const formatted = JSON.stringify(value, null, indent === 0 ? undefined : indent);
      return ok({ text: formatted, sizeBytes: byteLength(formatted) });
    },
  ),

  defineTool(
    "json.query",
    "Query a value inside JSON text by path ($.a.b[0].c or a.b[0], keys with dots via [\"a.b\"]); returns found:false when absent.",
    z.object({
      text: z.string().describe("JSON text to query"),
      path: z
        .string()
        .describe('path like "$.a.b[0].c" or "a.b[0]"; supports .key, [n], ["key"], [\'key\']; "$" = whole document'),
    }),
    ({ text, path }) => {
      assertSize(text);
      const value = parseJsonOrThrow(text);
      const segments = parsePath(path);
      const result = walkPath(value, segments);
      return result.found
        ? ok({ found: true, path, value: result.value })
        : ok({ found: false, path, reason: "path does not exist in this document" });
    },
  ),

  defineTool(
    "json.set",
    "Set a value at a path inside JSON text and return the new pretty-printed document; missing containers along the path are created.",
    z.object({
      text: z.string().describe("original JSON text"),
      path: z.string().describe('target path, e.g. "$.a.b[0]" (missing parents are created: .key → object, [n] → array)'),
      value: z
        .string()
        .describe('JSON-encoded value to set, e.g. "42", "true", "\\"hi\\"", "[1,2]", "{\\"a\\":1}" (strings must be quoted)'),
    }),
    ({ text, path, value }) => {
      assertSize(text);
      if (byteLength(value) > MAX_TEXT_BYTES) {
        throw new ToolError("E_SIZE", `value exceeds ${MAX_TEXT_BYTES} bytes`);
      }
      const doc = parseJsonOrThrow(text);
      const segments = parsePath(path);
      let newValue: unknown;
      try {
        newValue = JSON.parse(value) as unknown;
      } catch {
        throw new ToolError(
          "E_VALUE",
          `value is not valid JSON: ${JSON.stringify(value)} (hint: a string value must be quoted, e.g. "\\"hi\\"")`,
        );
      }
      const updated = setAt(structuredClone(doc), segments, newValue);
      const out = JSON.stringify(updated, null, 2);
      return ok({ text: out, sizeBytes: byteLength(out) });
    },
  ),

  defineTool(
    "json.stats",
    "Statistics of a JSON document: recursive key count, max nesting depth, byte size and per-type counts.",
    z.object({ text: z.string().describe("JSON text to analyze") }),
    ({ text }) => {
      assertSize(text);
      const value = parseJsonOrThrow(text);
      return ok(computeStats(value, text));
    },
  ),
];

await runStdioServer(tools, { serverName: "mcp-json", serverVersion: "0.1.0" });
