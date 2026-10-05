// @videoos/mcp-math —— 数学计算服务器（stdio MCP）：表达式求值（自写 tokenizer + shunting-yard + RPN，无 eval）、
// 统计、进制互转（BigInt）、定点取整（字符串移位避浮点误差）、百分比。纯 TS 零依赖。
import { defineTool, err, ok, runStdioServer } from "@videoos/mcp-lite";
import { z } from "zod";

/* ---------------- 表达式求值（tokenizer + shunting-yard + RPN） ---------------- */

type Token =
  | { t: "num"; v: number; pos: number }
  | { t: "op"; v: string; pos: number } // + - * / % ^（一元负号归一化为 "u-"）
  | { t: "lparen"; pos: number; mark: number }
  | { t: "rparen"; pos: number }
  | { t: "comma"; pos: number }
  | { t: "call"; name: string; pos: number }
  | { t: "ident"; v: string; pos: number };

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

interface FnDef {
  arity: { min: number; max?: number };
  apply: (args: number[], pos: number) => number | string; // string = E_ 错误
}

const FUNCTIONS: Record<string, FnDef> = {
  min: { arity: { min: 1 }, apply: (args) => Math.min(...args) },
  max: { arity: { min: 1 }, apply: (args) => Math.max(...args) },
  abs: { arity: { min: 1, max: 1 }, apply: ([a]) => Math.abs(a) },
  round: {
    arity: { min: 1, max: 2 },
    apply: (args) => (args.length === 1 ? (args[0] < 0 ? -Math.round(-args[0]) : Math.round(args[0])) : roundTo(args[0], args[1], "nearest")),
  },
  floor: { arity: { min: 1, max: 1 }, apply: ([a]) => Math.floor(snapNearInt(a)) },
  ceil: { arity: { min: 1, max: 1 }, apply: ([a]) => Math.ceil(snapNearInt(a)) },
  sqrt: {
    arity: { min: 1, max: 1 },
    apply: ([a], pos) => (a < 0 ? `E_MATH: sqrt of negative number (${a}) at position ${pos}` : Math.sqrt(a)),
  },
  log: {
    arity: { min: 1, max: 1 },
    apply: ([a], pos) => (a <= 0 ? `E_MATH: log of non-positive number (${a}) at position ${pos}` : Math.log10(a)),
  },
  ln: {
    arity: { min: 1, max: 1 },
    apply: ([a], pos) => (a <= 0 ? `E_MATH: ln of non-positive number (${a}) at position ${pos}` : Math.log(a)),
  },
  exp: {
    arity: { min: 1, max: 1 },
    apply: ([a], pos) => {
      const r = Math.exp(a);
      return Number.isFinite(r) ? r : `E_MATH: exp(${a}) overflows at position ${pos}`;
    },
  },
  pow: {
    arity: { min: 2, max: 2 },
    apply: ([a, b], pos) => {
      const r = Math.pow(a, b);
      return Number.isFinite(r) ? r : `E_MATH: ${a} ^ ${b} is not finite at position ${pos}`;
    },
  },
};

function tokenize(src: string): Token[] | string {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i += 1;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const start = i;
      let num = "";
      while (i < src.length && /[0-9]/.test(src[i] ?? "")) {
        num += src[i];
        i += 1;
      }
      if (src[i] === ".") {
        num += ".";
        i += 1;
        if (!/[0-9]/.test(src[i] ?? "")) return `E_PARSE: invalid number at position ${i - 1} (dangling ".")`;
        while (i < src.length && /[0-9]/.test(src[i] ?? "")) {
          num += src[i];
          i += 1;
        }
      }
      tokens.push({ t: "num", v: Number(num), pos: start });
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      let name = "";
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i] ?? "")) {
        name += src[i];
        i += 1;
      }
      tokens.push(src[i] === "(" ? { t: "call", name, pos: start } : { t: "ident", v: name, pos: start });
      continue;
    }
    if ("+-*/%^(),".includes(ch)) {
      tokens.push(
        ch === "("
          ? { t: "lparen", pos: i, mark: tokens.length }
          : ch === ")"
            ? { t: "rparen", pos: i }
            : ch === ","
              ? { t: "comma", pos: i }
              : { t: "op", v: ch, pos: i },
      );
      i += 1;
      continue;
    }
    return `E_PARSE: unexpected character ${JSON.stringify(ch)} at position ${i}`;
  }
  return tokens;
}

const PREC: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2, "%": 2, "u-": 3, "^": 4 };
const RIGHT_ASSOC = new Set(["^", "u-"]);

interface FnFrame {
  name: string;
  args: number; // 逗号数 + 1；空参表归零
  pos: number;
}

type StackItem = { kind: "op"; v: string; pos: number } | { kind: "paren"; pos: number; mark: number } | { kind: "fn"; frame: FnFrame };

type RpnItem =
  | { t: "num"; v: number }
  | { t: "op"; v: string; pos: number }
  | { t: "fn"; name: string; args: number; pos: number };

function toRpn(tokens: Token[]): { rpn: RpnItem[] } | { error: string } {
  const rpn: RpnItem[] = [];
  const stack: StackItem[] = [];
  let prev: Token | null = null;

  for (const tok of tokens) {
    switch (tok.t) {
      case "num":
        rpn.push({ t: "num", v: tok.v });
        break;
      case "ident": {
        const constant = CONSTANTS[tok.v];
        if (constant === undefined) {
          return { error: `E_PARSE: unknown identifier ${JSON.stringify(tok.v)} at position ${tok.pos} (constants: pi, e)` };
        }
        rpn.push({ t: "num", v: constant });
        break;
      }
      case "call": {
        if (FUNCTIONS[tok.name] === undefined) {
          return { error: `E_PARSE: unknown function ${JSON.stringify(tok.name)} at position ${tok.pos}` };
        }
        stack.push({ kind: "fn", frame: { name: tok.name, args: 1, pos: tok.pos } });
        break;
      }
      case "lparen":
        stack.push({ kind: "paren", pos: tok.pos, mark: rpn.length });
        break;
      case "rparen": {
        while (stack.length > 0 && stack[stack.length - 1].kind === "op") {
          const top = stack.pop() as { kind: "op"; v: string; pos: number };
          rpn.push({ t: "op", v: top.v, pos: top.pos });
        }
        const open = stack.pop();
        if (open === undefined || open.kind !== "paren") {
          return { error: `E_PARSE: unbalanced ")" at position ${tok.pos}` };
        }
        const top = stack[stack.length - 1];
        if (top !== undefined && top.kind === "fn") {
          const frame = (stack.pop() as { kind: "fn"; frame: FnFrame }).frame;
          if (rpn.length === open.mark) frame.args = 0; // 空参数表 f()
          rpn.push({ t: "fn", name: frame.name, args: frame.args, pos: frame.pos });
        }
        break;
      }
      case "comma": {
        while (stack.length > 0 && stack[stack.length - 1].kind === "op") {
          const top = stack.pop() as { kind: "op"; v: string; pos: number };
          rpn.push({ t: "op", v: top.v, pos: top.pos });
        }
        const paren = stack[stack.length - 1];
        const fn = stack[stack.length - 2];
        if (
          paren === undefined ||
          paren.kind !== "paren" ||
          fn === undefined ||
          fn.kind !== "fn"
        ) {
          return { error: `E_PARSE: "," outside a function call at position ${tok.pos}` };
        }
        fn.frame.args += 1;
        break;
      }
      case "op": {
        const unaryContext = prev === null || prev.t === "op" || prev.t === "lparen" || prev.t === "comma";
        if (tok.v === "+" && unaryContext) break; // 一元 +：忽略
        const op = tok.v === "-" && unaryContext ? "u-" : tok.v;
        while (stack.length > 0) {
          const top = stack[stack.length - 1];
          if (top.kind !== "op") break;
          const pTop = PREC[top.v];
          const pCur = PREC[op];
          if (pTop > pCur || (pTop === pCur && !RIGHT_ASSOC.has(op))) {
            stack.pop();
            rpn.push({ t: "op", v: top.v, pos: top.pos });
          } else {
            break;
          }
        }
        stack.push({ kind: "op", v: op, pos: tok.pos });
        break;
      }
    }
    prev = tok;
  }

  while (stack.length > 0) {
    const top = stack.pop() as StackItem;
    if (top.kind === "paren") return { error: `E_PARSE: unbalanced "(" opened at position ${top.pos}` };
    if (top.kind === "fn") {
      return { error: `E_PARSE: function ${top.frame.name} at position ${top.frame.pos} is missing "(" after its name` };
    }
    rpn.push({ t: "op", v: top.v, pos: top.pos });
  }
  return { rpn };
}

function evalRpn(rpn: RpnItem[]): { value: number } | { error: string } {
  const st: number[] = [];
  for (const item of rpn) {
    if (item.t === "num") {
      st.push(item.v);
      continue;
    }
    if (item.t === "op") {
      if (item.v === "u-") {
        const a = st.pop();
        if (a === undefined) return { error: `E_PARSE: missing operand for unary "-" at position ${item.pos}` };
        st.push(-a);
        continue;
      }
      const b = st.pop();
      const a = st.pop();
      if (a === undefined || b === undefined) {
        return { error: `E_PARSE: missing operand for operator ${JSON.stringify(item.v)} at position ${item.pos}` };
      }
      switch (item.v) {
        case "+":
          st.push(a + b);
          break;
        case "-":
          st.push(a - b);
          break;
        case "*":
          st.push(a * b);
          break;
        case "/":
          if (b === 0) return { error: `E_MATH: division by zero at position ${item.pos}` };
          st.push(a / b);
          break;
        case "%":
          if (b === 0) return { error: `E_MATH: modulo by zero at position ${item.pos}` };
          st.push(a % b);
          break;
        case "^": {
          const r = Math.pow(a, b);
          if (!Number.isFinite(r)) return { error: `E_MATH: ${a} ^ ${b} is not finite at position ${item.pos}` };
          st.push(r);
          break;
        }
        default:
          return { error: `E_PARSE: unknown operator ${JSON.stringify(item.v)} at position ${item.pos}` };
      }
      continue;
    }
    // 函数
    const fn = FUNCTIONS[item.name];
    if (fn === undefined) return { error: `E_PARSE: unknown function ${JSON.stringify(item.name)} at position ${item.pos}` };
    if (item.args < fn.arity.min || (fn.arity.max !== undefined && item.args > fn.arity.max)) {
      const expect =
        fn.arity.max === undefined ? `at least ${fn.arity.min}` : fn.arity.min === fn.arity.max ? `${fn.arity.min}` : `${fn.arity.min}-${fn.arity.max}`;
      return { error: `E_PARSE: ${item.name}() expects ${expect} argument(s), got ${item.args} (position ${item.pos})` };
    }
    const args: number[] = [];
    for (let k = 0; k < item.args; k++) {
      const v = st.pop();
      if (v === undefined) return { error: `E_PARSE: missing argument for ${item.name}() at position ${item.pos}` };
      args.unshift(v);
    }
    const applied = fn.apply(args, item.pos);
    if (typeof applied === "string") return { error: applied };
    st.push(applied);
  }
  if (st.length !== 1) return { error: "E_PARSE: malformed expression (missing operator between values)" };
  const value = st[0];
  if (!Number.isFinite(value)) return { error: "E_MATH: result is not finite" };
  return { value };
}

/** 数值美化输出（12 位有效数字，去尾零） */
function formatNumber(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e21) return String(n);
  const s = n.toPrecision(12);
  if (s.includes("e")) return s.replace(/\.?0+e/, "e");
  return s.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

/* ---------------- 定点取整（字符串移位，规避浮点误差） ---------------- */

/** 移动小数点（优先走字符串 "1.005e2" 精确路径，失败回退乘法） */
function shiftDecimal(v: number, places: number): number {
  if (!Number.isFinite(v) || v === 0) return v;
  const s = `${v}`;
  if (!s.includes("e") && !s.includes("E")) {
    const shifted = Number(`${s}e${places}`);
    if (Number.isFinite(shifted) && shifted !== 0) return shifted;
  }
  return v * 10 ** places;
}

/** 把非常接近整数的浮点残渣吸附到整数（供 floor/ceil 使用） */
function snapNearInt(x: number): number {
  const r = Math.round(x);
  return Math.abs(x - r) < 1e-9 * Math.max(1, Math.abs(x)) ? r : x;
}

/** 四舍五入（half away from zero）/ floor / ceil，精度 0-15 位小数 */
function roundTo(value: number, precision: number, mode: "nearest" | "floor" | "ceil"): number {
  if (precision <= 0) {
    if (mode === "floor") return Math.floor(snapNearInt(value));
    if (mode === "ceil") return Math.ceil(snapNearInt(value));
    const r = Math.round(Math.abs(value));
    const signed = value < 0 ? -r : r;
    return Object.is(signed, -0) ? 0 : signed;
  }
  let out: number;
  if (mode === "nearest") {
    out = Math.round(shiftDecimal(Math.abs(value), precision));
  } else {
    const shifted = shiftDecimal(value, precision);
    const snapped = snapNearInt(shifted);
    out = mode === "floor" ? Math.floor(snapped) : Math.ceil(snapped);
  }
  const signed = value < 0 ? -out : out;
  const cleaned = Number(shiftDecimal(signed, -precision).toFixed(12));
  return Object.is(cleaned, -0) ? 0 : cleaned;
}

/* ---------------- 工具定义 ---------------- */

const finiteCheck = (name: string, v: number): string | null =>
  Number.isFinite(v) ? null : `E_ARG: ${name} must be a finite number`;

const tools = [
  defineTool(
    "math.eval",
    "Evaluate an arithmetic expression (no eval involved): + - * / % ^ ( ), unary minus, functions min max abs round floor ceil sqrt log ln exp pow, constants pi e.",
    z.object({
      expression: z
        .string()
        .max(4096)
        .describe('e.g. "2 + 3 * 4", "pow(2, 10) - sqrt(16)", "-2 ^ 2" (= -4); % is remainder, ^ is right-associative'),
    }),
    ({ expression }) => {
      if (expression.trim().length === 0) return err("E_PARSE: empty expression");
      const tokens = tokenize(expression);
      if (typeof tokens === "string") return err(tokens);
      const rpn = toRpn(tokens);
      if ("error" in rpn) return err(rpn.error);
      const result = evalRpn(rpn.rpn);
      if ("error" in result) return err(result.error);
      return ok({ value: result.value, formatted: formatNumber(result.value) });
    },
  ),
  defineTool(
    "math.stats",
    "Summary statistics of a number list: count, sum, mean, median, min, max, sample variance and sample standard deviation.",
    z.object({
      numbers: z.array(z.number()).describe("non-empty list of numbers"),
    }),
    ({ numbers }) => {
      if (numbers.length === 0) return err("E_EMPTY: numbers must be a non-empty array");
      for (const n of numbers) {
        if (!Number.isFinite(n)) return err("E_ARG: all numbers must be finite");
      }
      const sorted = [...numbers].sort((a, b) => a - b);
      const count = numbers.length;
      const sum = numbers.reduce((a, b) => a + b, 0);
      const mean = sum / count;
      const median =
        count % 2 === 1 ? sorted[(count - 1) / 2] : (sorted[count / 2 - 1] + sorted[count / 2]) / 2;
      const variance =
        count < 2 ? 0 : numbers.reduce((acc, x) => acc + (x - mean) ** 2, 0) / (count - 1);
      const round12 = (x: number): number => Number(x.toPrecision(12));
      return ok({
        count,
        sum: round12(sum),
        mean: round12(mean),
        median: round12(median),
        min: sorted[0],
        max: sorted[count - 1],
        variance: round12(variance),
        stdev: round12(Math.sqrt(variance)),
      });
    },
  ),
  defineTool(
    "math.base",
    "Convert an integer between bases 2-36 (BigInt-exact); value may be a number or a string in the source base.",
    z.object({
      value: z
        .union([z.string(), z.number()])
        .describe('value in the source base, e.g. 255, "ff" or "-1010"'),
      from: z.number().describe("source base, 2-36 (default 10)").default(10),
      to: z.number().describe("target base, 2-36"),
    }),
    ({ value, from, to }) => {
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 2 || from > 36 || to < 2 || to > 36) {
        return err("E_BASE: bases must be integers between 2 and 36");
      }
      const s = String(value).toLowerCase().trim();
      let neg = false;
      let idx = 0;
      if (s[0] === "+" || s[0] === "-") {
        neg = s[0] === "-";
        idx = 1;
      }
      if (idx >= s.length) return err(`E_PARSE: empty value for base ${from}`);
      let acc = 0n;
      for (; idx < s.length; idx++) {
        const digit = Number.parseInt(s[idx], 36);
        if (Number.isNaN(digit) || digit >= from) {
          return err(`E_PARSE: invalid digit ${JSON.stringify(s[idx])} for base ${from} at position ${idx}`);
        }
        acc = acc * BigInt(from) + BigInt(digit);
      }
      const signed = neg ? -acc : acc;
      const abs = signed < 0n ? -signed : signed;
      const repr = abs.toString(to);
      return ok({
        value: (signed < 0n ? "-" : "") + repr,
        digits: repr.length,
        decimal: signed.toString(10),
        from,
        to,
      });
    },
  ),
  defineTool(
    "math.round",
    "Round a number to a fixed precision (0-15 decimals) with float-error handling; mode: nearest (half away from zero), floor or ceil.",
    z.object({
      value: z.number().describe("number to round"),
      precision: z.number().int().min(0).max(15).describe("decimal places (default 0)").default(0),
      mode: z.enum(["nearest", "floor", "ceil"]).describe("rounding mode (default nearest)").default("nearest"),
    }),
    ({ value, precision, mode }) => {
      const bad = finiteCheck("value", value);
      if (bad !== null) return err(bad);
      const result = roundTo(value, precision, mode);
      return ok({ value: result, formatted: precision > 0 ? result.toFixed(precision) : String(result) });
    },
  ),
  defineTool(
    "math.percentage",
    "Compute part/total as a percentage with fixed decimals, e.g. 25/200 -> { value: 12.5, formatted: \"12.5%\" }.",
    z.object({
      part: z.number().describe("the part value"),
      total: z.number().describe("the total value (must not be 0)"),
      decimals: z.number().int().min(0).max(6).describe("decimal places (default 1)").default(1),
    }),
    ({ part, total, decimals }) => {
      for (const [name, v] of [["part", part], ["total", total]] as const) {
        const bad = finiteCheck(name, v);
        if (bad !== null) return err(bad);
      }
      if (total === 0) return err("E_MATH: total must not be zero");
      const value = roundTo((part / total) * 100, decimals, "nearest");
      return ok({ value, formatted: `${value.toFixed(decimals)}%` });
    },
  ),
];

await runStdioServer(tools, { serverName: "mcp-math", serverVersion: "0.1.0" });
