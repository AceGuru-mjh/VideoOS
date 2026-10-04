// Scene / Layer 工具：scene.list / scene.inspect / scene.modify / layer.inspect / layer.modify
// scene.modify 与 layer.modify 是【源码级锚点编辑】：不修改 VIR，而是定位 DSL 源码中的
// `v.scene("<scene>", { duration, background }, (s) => { s.text("<layer>", "内容", { color, size, opacity, enter }) })`
// 锚点做最小替换 → 写回 entry 文件 → 自动 re-compile。模式未命中 → PATTERN_NOT_FOUND（建议 Engineer 重写文件）。
//
// 锚点定位规则（字符串字面量 + 括号配对扫描，支持 // 与 /* */ 注释、\" 转义、单双引号）：
//  1. 场景块：`v.scene("name"`（首个字符串参数 === 场景名）→ 整个 v.scene(...) 调用（含 builder 箭头体）
//  2. 场景选项：场景调用的第一个「深度 0 的 { 对象字面量参数」；扫描遇 => 即停（防把 builder 体误当选项）
//  3. 图层调用：场景块内 `s.text|rect|ellipse|image("<layer>"`（首个字符串参数 === 图层名）
//  4. 图层选项：图层调用的第一个深度 0 { 参数；text 的内容字符串是其第 2 个字符串参数
//  5. 属性替换：选项对象「深度 0」的 `prop: <字面量>`（嵌套对象如 enter:{...} 内的同名属性不会误中）；
//     未找到 → 在选项 { 后插入 `prop: 值,`；整个选项对象缺失 → 在调用 ) 前追加 `, { prop: 值 }`
import { readFile, writeFile } from "node:fs/promises";
import type { SceneInfo } from "@videoos/vir";
import { isVideoEffect } from "@videoos/dsl";
import { z } from "zod";
import { asVapSession } from "../session";
import type { VapContext, VapSession } from "../session";
import type { VapTool, VapToolArgs, VapToolResult } from "./registry";

// ---------------------------------------------------------------------------
// 源码锚点扫描（JS/TS 子集）
// ---------------------------------------------------------------------------

export interface Span { start: number; end: number }

export interface EditOutcome {
  ok: boolean;
  /** ok=true：新源码 + 每处编辑的人读描述 */
  source?: string;
  edits?: string[];
  /** ok=false：原因（含 PATTERN_NOT_FOUND / INVALID_* 前缀） */
  reason?: string;
}

const COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const IDENT_START_RE = /[$_\p{L}]/u;
const IDENT_RE = /[$_\p{L}\p{N}]/u;

function at(s: string, i: number): string {
  return s[i] ?? "";
}

function skipWs(s: string, i: number): number {
  while (i < s.length && /\s/.test(at(s, i))) i++;
  return i;
}

function skipWsAndComma(s: string, i: number): number {
  let j = skipWs(s, i);
  if (at(s, j) === ",") j = skipWs(s, j + 1);
  return j;
}

function skipLineComment(s: string, i: number): number {
  let j = i;
  while (j < s.length && at(s, j) !== "\n") j++;
  return j;
}

function skipBlockComment(s: string, i: number): number {
  const close = s.indexOf("*/", i + 2);
  return close < 0 ? s.length : close + 2;
}

/** 跳过 i 处字符串字面量（单/双/模板引号，支持转义）；返回闭合引号后一位 */
function skipString(s: string, i: number): number {
  const quote = at(s, i);
  let j = i + 1;
  while (j < s.length) {
    const ch = at(s, j);
    if (ch === "\\") { j += 2; continue; }
    if (ch === quote) return j + 1;
    if (quote !== "`" && ch === "\n") return j;
    j++;
  }
  return j;
}

/** 解析 i 处字符串字面量（单/双引号）；非字符串返回 null */
function readStringLiteral(s: string, i: number): { value: string; span: Span } | null {
  const quote = at(s, i);
  if (quote !== '"' && quote !== "'") return null;
  let j = i + 1;
  let value = "";
  while (j < s.length) {
    const ch = at(s, j);
    if (ch === "\\") {
      const next = at(s, j + 1);
      value += next === "n" ? "\n" : next === "t" ? "\t" : next === "r" ? "\r" : next;
      j += 2;
      continue;
    }
    if (ch === quote) return { value, span: { start: i, end: j + 1 } };
    if (ch === "\n") return null;
    value += ch;
    j++;
  }
  return null;
}

/** 从 openIdx（指向 ( [ { 之一）扫描配对闭括号；跳过字符串与注释；失败返回 -1 */
export function matchDelim(s: string, openIdx: number): number {
  const open = at(s, openIdx);
  const close = open === "(" ? ")" : open === "[" ? "]" : open === "{" ? "}" : "";
  if (close === "") return -1;
  let depth = 0;
  let i = openIdx;
  while (i < s.length) {
    const ch = at(s, i);
    if (ch === "/" && at(s, i + 1) === "/") { i = skipLineComment(s, i); continue; }
    if (ch === "/" && at(s, i + 1) === "*") { i = skipBlockComment(s, i); continue; }
    if (ch === '"' || ch === "'" || ch === "`") { i = skipString(s, i); continue; }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

const SCENE_CALL_RE = /\bv\s*\.\s*scene\s*\(/g;
const LAYER_CALL_RE = /\bs\s*\.\s*(text|rect|ellipse|image)\s*\(/g;
const AUDIO_CALL_RE = /\bv\s*\.\s*audio\s*\(/g;

interface CallSpan {
  /** 调用整体 [start, end)（含 `v.scene(…)` 全部） */
  start: number;
  end: number;
  /** 开括号（"("）下标 */
  openParen: number;
  /** 调用种类："scene" | "text" | "rect" | "ellipse" | "image" | "audio" */
  kind: string;
}

/** 预扫描整段源码的注释区间（跳过字符串字面量；用于排除被注释掉的调用锚点） */
function commentSpans(source: string): Span[] {
  const spans: Span[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = at(source, i);
    if (ch === '"' || ch === "'" || ch === "`") { i = skipString(source, i); continue; }
    if (ch === "/" && at(source, i + 1) === "/") {
      const start = i;
      i = skipLineComment(source, i);
      spans.push({ start, end: i });
      continue;
    }
    if (ch === "/" && at(source, i + 1) === "*") {
      const start = i;
      i = skipBlockComment(source, i);
      spans.push({ start, end: i });
      continue;
    }
    i++;
  }
  return spans;
}

function inSpans(spans: Span[], index: number): boolean {
  return spans.some((s) => index >= s.start && index < s.end);
}

/** 在 source 中查找 `receiver.method(` 且首个字符串参数 === wantedName 的调用（第一个命中；跳过注释区）。
 *  正则含捕获组时（图层类型）以捕获组为 kind。 */
function findCall(source: string, re: RegExp, kind: string, wantedName: string): CallSpan | null {
  const comments = commentSpans(source);
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    if (inSpans(comments, m.index)) continue; // 被注释掉的调用不是有效锚点
    const openParen = m.index + m[0].length - 1;
    const closeParen = matchDelim(source, openParen);
    if (closeParen < 0) return null;
    const firstArgAt = skipWs(source, openParen + 1);
    const lit = readStringLiteral(source, firstArgAt);
    if (lit !== null && lit.value === wantedName) {
      return { start: m.index, end: closeParen + 1, openParen, kind: m[1] !== undefined ? m[1] : kind };
    }
  }
  return null;
}

/** 调用首个字符串参数（图层名/场景名/音频名） */
function callFirstStringArg(source: string, openParen: number): { value: string; span: Span } | null {
  return readStringLiteral(source, skipWs(source, openParen + 1));
}

/** 参数区第一个「深度 0 的 { 对象字面量参数」；遇 => 停止（builder 箭头体不是选项） */
function findOptionsArg(source: string, openParen: number, closeParen: number): Span | null {
  let depth = 0;
  let i = openParen + 1;
  while (i < closeParen) {
    const ch = at(source, i);
    if (ch === "/" && at(source, i + 1) === "/") { i = skipLineComment(source, i); continue; }
    if (ch === "/" && at(source, i + 1) === "*") { i = skipBlockComment(source, i); continue; }
    if (ch === '"' || ch === "'" || ch === "`") { i = skipString(source, i); continue; }
    if (ch === "=" && at(source, i + 1) === ">" && depth === 0) return null;
    if (ch === "(" || ch === "[") { depth++; i++; continue; }
    if (ch === ")" || ch === "]") { depth--; i++; continue; }
    if (ch === "{") {
      const close = matchDelim(source, i);
      if (close < 0) return null;
      if (depth === 0) return { start: i, end: close + 1 };
      i = close + 1;
      continue;
    }
    i++;
  }
  return null;
}

function readIdentEnd(s: string, i: number): number {
  let j = i;
  while (j < s.length && IDENT_RE.test(at(s, j))) j++;
  return j;
}

/** 字面量（字符串/数字/对象/数组）结束位置；非字面量返回起点（无进展） */
function readLiteralEnd(s: string, i: number): number {
  const ch = at(s, i);
  if (ch === '"' || ch === "'" || ch === "`") return skipString(s, i);
  if (ch === "+" || ch === "-" || (ch >= "0" && ch <= "9") || ch === ".") {
    let j = i;
    while (j < s.length && /[0-9.eE+-]/.test(at(s, j))) j++;
    return j;
  }
  if (ch === "{" || ch === "[") {
    const close = matchDelim(s, i);
    return close < 0 ? i : close + 1;
  }
  return i;
}

/**
 * 对象字面量「深度 0」的属性值 span：`prop: <字面量>`。
 * 嵌套对象（如 enter: { duration } ）内的同名属性不会误中 —— 修改 opacity/size 时不会改到动画参数。
 * 字符串键（"color": …）不识别（v1 DSL 均为标识符键；未命中走插入路径）。
 */
function findPropertyValueSpan(source: string, objSpan: Span, prop: string): Span | null {
  let depth = 0;
  let i = objSpan.start + 1;
  const end = objSpan.end - 1;
  while (i < end) {
    const ch = at(source, i);
    if (ch === '"' || ch === "'" || ch === "`") { i = skipString(source, i); continue; }
    if (ch === "/" && at(source, i + 1) === "/") { i = skipLineComment(source, i); continue; }
    if (ch === "/" && at(source, i + 1) === "*") { i = skipBlockComment(source, i); continue; }
    if (ch === "(" || ch === "[" || ch === "{") { depth++; i++; continue; }
    if (ch === ")" || ch === "]" || ch === "}") { depth--; i++; continue; }
    if (depth === 0 && IDENT_START_RE.test(ch)) {
      const wordEnd = readIdentEnd(source, i);
      if (source.slice(i, wordEnd) === prop) {
        const colonAt = skipWs(source, wordEnd);
        if (at(source, colonAt) === ":") {
          const valueStart = skipWs(source, colonAt + 1);
          const valueEnd = readLiteralEnd(source, valueStart);
          if (valueEnd > valueStart) return { start: valueStart, end: valueEnd };
        }
      }
      i = wordEnd;
      continue;
    }
    i++;
  }
  return null;
}

function applySpan(source: string, span: Span, replacement: string): string {
  return source.slice(0, span.start) + replacement + source.slice(span.end);
}

function insertAt(source: string, at: number, text: string): string {
  return source.slice(0, at) + text + source.slice(at);
}

/** 校验/归一 value 字面量文本（string → JSON 转义；number → String） */
function literalText(value: string | number): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

/** 替换（或插入）调用选项对象中的属性；无选项对象时在 ) 前追加 `, { prop: value }` */
function setPropertyInCallOptions(
  source: string,
  call: CallSpan,
  prop: string,
  value: string | number,
  editLabel: string,
): EditOutcome {
  const text = literalText(value);
  const opts = findOptionsArg(source, call.openParen, call.end - 1);
  if (opts === null) {
    return {
      ok: true,
      source: insertAt(source, call.end - 1, `, { ${prop}: ${text} }`),
      edits: [`${editLabel}（追加选项对象 ${prop}: ${text}）`],
    };
  }
  const valueSpan = findPropertyValueSpan(source, opts, prop);
  if (valueSpan === null) {
    return {
      ok: true,
      source: insertAt(source, opts.start + 1, ` ${prop}: ${text},`),
      edits: [`${editLabel}（插入 ${prop}: ${text}）`],
    };
  }
  return { ok: true, source: applySpan(source, valueSpan, text), edits: [`${editLabel} → ${text}`] };
}

// ---------------------------------------------------------------------------
// 高层编辑操作（纯函数：source in → source out，便于单测）
// ---------------------------------------------------------------------------

export type SceneOperation = "replace_text" | "set_color" | "set_duration" | "set_animation";

/** scene.modify 单操作：定位场景/图层锚点并应用一处编辑 */
export function applySceneModify(
  source: string,
  args: { scene: string; operation: SceneOperation | string; layer?: string; value: string | number },
): EditOutcome {
  const { scene, operation, layer, value } = args;
  const sceneCall = findCall(source, SCENE_CALL_RE, "scene", scene);
  if (sceneCall === null) {
    return { ok: false, reason: `PATTERN_NOT_FOUND: v.scene(${JSON.stringify(scene)}, …) 调用未在 entry 源码中找到；建议 Engineer 重写 src/video.ts` };
  }
  const sceneOpts = findOptionsArg(source, sceneCall.openParen, sceneCall.end - 1);

  if (operation === "set_duration") {
    if (layer !== undefined) return { ok: false, reason: "INVALID_ARGS: set_duration 作用于场景时长，不接受 layer" };
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      return { ok: false, reason: `INVALID_VALUE: set_duration 需要正数（秒），got ${String(value)}` };
    }
    if (sceneOpts === null) {
      return { ok: false, reason: `PATTERN_NOT_FOUND: v.scene(${JSON.stringify(scene)}) 无选项对象，无法设置 duration；建议 Engineer 重写` };
    }
    const span = findPropertyValueSpan(source, sceneOpts, "duration");
    if (span === null) {
      return {
        ok: true,
        source: insertAt(source, sceneOpts.start + 1, ` duration: ${String(value)},`),
        edits: [`scene "${scene}" duration → ${value}（插入）`],
      };
    }
    return { ok: true, source: applySpan(source, span, String(value)), edits: [`scene "${scene}" duration → ${value}`] };
  }

  if (operation === "set_color" && layer === undefined) {
    if (typeof value !== "string" || !COLOR_RE.test(value)) {
      return { ok: false, reason: `INVALID_VALUE: set_color 需要 #rgb/#rrggbb/#rrggbbaa 颜色，got ${String(value)}` };
    }
    if (sceneOpts === null) {
      return { ok: false, reason: `PATTERN_NOT_FOUND: v.scene(${JSON.stringify(scene)}) 无选项对象，无法设置 background；建议 Engineer 重写` };
    }
    const span = findPropertyValueSpan(source, sceneOpts, "background");
    if (span === null) {
      return {
        ok: true,
        source: insertAt(source, sceneOpts.start + 1, ` background: ${JSON.stringify(value)},`),
        edits: [`scene "${scene}" background → ${value}（插入）`],
      };
    }
    return { ok: true, source: applySpan(source, span, JSON.stringify(value)), edits: [`scene "${scene}" background → ${value}`] };
  }

  // 以下操作需要图层锚点
  if (layer === undefined) {
    return { ok: false, reason: `INVALID_ARGS: ${String(operation)} 需要图层名（layer 参数）` };
  }
  const layerRel = findCall(source.slice(sceneCall.start, sceneCall.end), LAYER_CALL_RE, "layer", layer);
  if (layerRel === null) {
    return { ok: false, reason: `PATTERN_NOT_FOUND: 图层 s.<kind>(${JSON.stringify(layer)}, …) 未在场景 "${scene}" 内找到；建议 Engineer 重写 src/video.ts` };
  }
  const layerCall: CallSpan = {
    start: sceneCall.start + layerRel.start,
    end: sceneCall.start + layerRel.end,
    openParen: sceneCall.start + layerRel.openParen,
    kind: layerRel.kind,
  };

  if (operation === "replace_text") {
    if (layerCall.kind !== "text") {
      return { ok: false, reason: `INVALID_ARGS: replace_text 仅适用于 text 图层（"${layer}" 是 ${layerCall.kind}）` };
    }
    if (typeof value !== "string") {
      return { ok: false, reason: `INVALID_VALUE: replace_text 需要字符串，got ${String(value)}` };
    }
    const nameLit = callFirstStringArg(source, layerCall.openParen);
    if (nameLit === null) {
      return { ok: false, reason: `PATTERN_NOT_FOUND: 图层 "${layer}" 首参不是字符串字面量；建议 Engineer 重写` };
    }
    const contentAt = skipWsAndComma(source, nameLit.span.end);
    const contentLit = readStringLiteral(source, contentAt);
    if (contentLit === null) {
      return { ok: false, reason: `PATTERN_NOT_FOUND: s.text("${layer}", "<内容>", …) 的内容字符串未找到（可能是模板字符串/变量）；建议 Engineer 重写` };
    }
    return { ok: true, source: applySpan(source, contentLit.span, JSON.stringify(value)), edits: [`text "${layer}"@${scene} 内容 → ${JSON.stringify(value)}`] };
  }

  if (operation === "set_color") {
    if (typeof value !== "string" || !COLOR_RE.test(value)) {
      return { ok: false, reason: `INVALID_VALUE: set_color 需要 #rgb/#rrggbb/#rrggbbaa 颜色，got ${String(value)}` };
    }
    const prop = layerCall.kind === "text" ? "color" : layerCall.kind === "rect" || layerCall.kind === "ellipse" ? "fill" : null;
    if (prop === null) {
      return { ok: false, reason: `INVALID_ARGS: set_color 不适用于 ${layerCall.kind} 图层 "${layer}"` };
    }
    return setPropertyInCallOptions(source, layerCall, prop, value, `${layerCall.kind} "${layer}"@${scene} ${prop}`);
  }

  if (operation === "set_animation") {
    if (typeof value !== "string" || !isVideoEffect(value)) {
      return { ok: false, reason: `INVALID_VALUE: set_animation 需要有效 effect 名（fade/slide-up/blur-up/typewriter/…），got ${String(value)}` };
    }
    const layerOpts = findOptionsArg(source, layerCall.openParen, layerCall.end - 1);
    if (layerOpts === null) {
      return { ok: false, reason: `PATTERN_NOT_FOUND: 图层 "${layer}" 无选项对象（没有 enter 动画可改）；建议 Engineer 重写` };
    }
    const enterSpan = findPropertyValueSpan(source, layerOpts, "enter");
    if (enterSpan === null || at(source, enterSpan.start) !== "{") {
      return { ok: false, reason: `PATTERN_NOT_FOUND: 图层 "${layer}" 选项中没有 enter: { … } 对象；建议 Engineer 重写` };
    }
    const effectSpan = findPropertyValueSpan(source, enterSpan, "effect");
    if (effectSpan === null) {
      return { ok: false, reason: `PATTERN_NOT_FOUND: enter 动画对象缺少 effect: "…"；建议 Engineer 重写` };
    }
    return { ok: true, source: applySpan(source, effectSpan, JSON.stringify(value)), edits: [`layer "${layer}"@${scene} enter.effect → ${value}`] };
  }

  return { ok: false, reason: `INVALID_ARGS: 未知操作 ${String(operation)}` };
}

/** layer.modify：property = text | color | size | opacity */
export function applyLayerModify(
  source: string,
  args: { scene: string; layer: string; property: "text" | "color" | "size" | "opacity" | string; value: string | number },
): EditOutcome {
  const { scene, layer, property, value } = args;
  if (property === "text" || property === "color") {
    return applySceneModify(source, { scene, layer, operation: property === "text" ? "replace_text" : "set_color", value });
  }
  if (property !== "size" && property !== "opacity") {
    return { ok: false, reason: `INVALID_ARGS: 未知属性 ${String(property)}` };
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { ok: false, reason: `INVALID_VALUE: ${property} 需要数字，got ${String(value)}` };
  }
  if (property === "size" && value <= 0) {
    return { ok: false, reason: `INVALID_VALUE: size 需要正数，got ${String(value)}` };
  }
  if (property === "opacity" && (value < 0 || value > 1)) {
    return { ok: false, reason: `INVALID_VALUE: opacity 需在 [0,1]，got ${String(value)}` };
  }
  const sceneCall = findCall(source, SCENE_CALL_RE, "scene", scene);
  if (sceneCall === null) {
    return { ok: false, reason: `PATTERN_NOT_FOUND: v.scene(${JSON.stringify(scene)}, …) 调用未找到；建议 Engineer 重写` };
  }
  const layerRel = findCall(source.slice(sceneCall.start, sceneCall.end), LAYER_CALL_RE, "layer", layer);
  if (layerRel === null) {
    return { ok: false, reason: `PATTERN_NOT_FOUND: 图层 ${JSON.stringify(layer)} 未在场景 "${scene}" 内找到；建议 Engineer 重写` };
  }
  if (property === "size" && layerRel.kind !== "text") {
    return { ok: false, reason: `INVALID_ARGS: size 仅适用于 text 图层（"${layer}" 是 ${layerRel.kind}）` };
  }
  const layerCall: CallSpan = {
    start: sceneCall.start + layerRel.start,
    end: sceneCall.start + layerRel.end,
    openParen: sceneCall.start + layerRel.openParen,
    kind: layerRel.kind,
  };
  return setPropertyInCallOptions(source, layerCall, property, value, `layer "${layer}"@${scene} ${property}`);
}

/** audio.set 用：v.audio("name", "src", { volume, fadeIn }) 的选项编辑（逐属性顺序应用，每次重新定位） */
export function applyAudioSet(
  source: string,
  args: { clip: string; volume?: number; fadeIn?: number },
): EditOutcome {
  const props: Array<[string, number]> = [];
  if (args.volume !== undefined) props.push(["volume", args.volume]);
  if (args.fadeIn !== undefined) props.push(["fadeIn", args.fadeIn]);
  if (props.length === 0) {
    return { ok: false, reason: "INVALID_ARGS: audio.set 需要至少一个 volume/fadeIn" };
  }
  let current = source;
  const edits: string[] = [];
  for (const [prop, val] of props) {
    if (!Number.isFinite(val) || val < 0) {
      return { ok: false, reason: `INVALID_VALUE: ${prop} 需要非负数，got ${String(val)}` };
    }
    const call = findCall(current, AUDIO_CALL_RE, "audio", args.clip);
    if (call === null) {
      return { ok: false, reason: `PATTERN_NOT_FOUND: v.audio(${JSON.stringify(args.clip)}, …) 调用未找到；建议 Engineer 重写 src/video.ts` };
    }
    const outcome = setPropertyInCallOptions(current, call, prop, val, `audio "${args.clip}" ${prop}`);
    if (!outcome.ok) return outcome;
    current = outcome.source ?? current;
    edits.push(...(outcome.edits ?? []));
  }
  return { ok: true, source: current, edits };
}

// ---------------------------------------------------------------------------
// 工具实现
// ---------------------------------------------------------------------------

function findSceneInfo(session: VapSession, scene: string): SceneInfo | null {
  const semantic = session.lastCompile?.semantic;
  if (semantic === undefined) return null;
  return semantic.scenes.find((s) => s.name === scene || s.id === scene) ?? null;
}

function availableScenes(session: VapSession): string {
  return session.lastCompile?.semantic.scenes.map((s) => s.name).join(", ") || "<none>";
}

/** 编辑结果 → 写回 entry → 自动重编译；编译失败返回结构化错误（文件已写入，提示可 rollback） */
async function commitEdit(ctx: VapContext, outcome: EditOutcome): Promise<VapToolResult> {
  const session = asVapSession(ctx);
  await writeFile(session.entryPath, outcome.source as string, "utf8");
  try {
    const result = await session.compile();
    return {
      ok: true,
      data: {
        edits: outcome.edits,
        diagnostics: result.diagnostics,
        errors: result.diagnostics.filter((d) => d.level === "error").length,
        scenes: result.vir.scenes.length,
        duration: result.vir.meta.duration,
        virPath: session.virPath,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: `COMPILE_REJECTED: ${(err as Error).message}（源码已写入 entry；若在事务中可用 transaction.rollback 回滚）`,
    };
  }
}

export function createSceneTools(): VapTool[] {
  const sceneListTool: VapTool = {
    name: "scene.list",
    description: "列出全部场景摘要（name/duration/start/图层名/节拍名）；未编译时自动编译",
    schema: z.object({}),
    async execute(_args: VapToolArgs, ctx: VapContext): Promise<VapToolResult> {
      const session = asVapSession(ctx);
      const result = await session.ensureCompiled();
      const scenes = result.vir.scenes.map((s) => ({
        name: s.name,
        id: s.id,
        duration: s.duration,
        start: s.start,
        layers: s.layers.map((l) => l.name),
        beats: s.beats.map((b) => b.name),
      }));
      return { ok: true, data: { scenes, totalFrames: result.semantic.totalFrames, duration: result.vir.meta.duration } };
    },
  };

  const sceneInspectTool: VapTool = {
    name: "scene.inspect",
    description: "单场景完整 VIR（图层/节拍/相机/背景）+ 语义信息（frameStart/frameEnd/节拍帧号）",
    schema: z.object({ scene: z.string().describe("场景名或 id") }),
    async execute(args: VapToolArgs, ctx: VapContext): Promise<VapToolResult> {
      const session = asVapSession(ctx);
      const compileResult = await session.ensureCompiled();
      const scene = String(args.scene ?? "");
      const info = findSceneInfo(session, scene);
      if (info === null) {
        return { ok: false, error: `SCENE_NOT_FOUND: ${JSON.stringify(scene)} (available: ${availableScenes(session)})` };
      }
      const virScene = compileResult.vir.scenes.find((s) => s.id === info.id);
      return {
        ok: true,
        data: {
          semantic: {
            name: info.name,
            id: info.id,
            start: info.start,
            end: info.end,
            duration: info.duration,
            frameStart: info.frameStart,
            frameEnd: info.frameEnd,
            beats: info.beats.map((b) => ({ name: b.name, at: b.at, frame: compileResult.semantic.frameOf(info.name, b.name) })),
          },
          vir: virScene,
        },
      };
    },
  };

  const sceneModifyTool: VapTool = {
    name: "scene.modify",
    description:
      "源码级锚点编辑（定位 v.scene/<layer> 调用做最小替换）→ 写回 entry → 自动重编译。" +
      "replace_text=换图层文本（layer 必填）；set_color=颜色（有 layer 改图层 color/fill，无 layer 改场景 background）；" +
      "set_duration=场景时长（秒）；set_animation=改图层 enter effect。模式未命中返回 PATTERN_NOT_FOUND（此时应让 Engineer 重写文件）",
    schema: z.object({
      scene: z.string().describe("场景名或 id"),
      operation: z.enum(["replace_text", "set_color", "set_duration", "set_animation"]),
      layer: z.string().optional().describe("图层名（replace_text/set_animation 必填；set_color 可选）"),
      value: z.union([z.string(), z.number()]).describe("新值（文本/颜色/effect 为 string；时长为 number 秒）"),
    }),
    async execute(args: VapToolArgs, ctx: VapContext): Promise<VapToolResult> {
      const session = asVapSession(ctx);
      await session.ensureCompiled();
      const info = findSceneInfo(session, String(args.scene ?? ""));
      if (info === null) {
        return { ok: false, error: `SCENE_NOT_FOUND: ${JSON.stringify(args.scene)} (available: ${availableScenes(session)})` };
      }
      const source = await readFile(session.entryPath, "utf8");
      const outcome = applySceneModify(source, {
        scene: info.name,
        operation: String(args.operation ?? ""),
        ...(args.layer !== undefined ? { layer: String(args.layer) } : {}),
        value: args.value as string | number,
      });
      if (!outcome.ok) return { ok: false, error: outcome.reason };
      return commitEdit(ctx, outcome);
    },
  };

  const layerInspectTool: VapTool = {
    name: "layer.inspect",
    description: "图层的 VIR 定义 + 场景中点帧的 FramePlan 命令（绝对几何/样式，已含动画求值）",
    schema: z.object({
      scene: z.string().describe("场景名或 id"),
      layer: z.string().describe("图层名"),
    }),
    async execute(args: VapToolArgs, ctx: VapContext): Promise<VapToolResult> {
      const session = asVapSession(ctx);
      const compileResult = await session.ensureCompiled();
      const info = findSceneInfo(session, String(args.scene ?? ""));
      if (info === null) {
        return { ok: false, error: `SCENE_NOT_FOUND: ${JSON.stringify(args.scene)} (available: ${availableScenes(session)})` };
      }
      const virScene = compileResult.vir.scenes.find((s) => s.id === info.id);
      const layer = virScene?.layers.find((l) => l.name === String(args.layer));
      if (layer === undefined) {
        return { ok: false, error: `LAYER_NOT_FOUND: ${JSON.stringify(args.layer)} in scene "${info.name}" (available: ${virScene?.layers.map((l) => l.name).join(", ") || "<none>"})` };
      }
      const midFrame = info.frameStart + Math.floor((info.frameEnd - info.frameStart) / 2);
      const plan = compileResult.framePlan(midFrame);
      const commands = plan.commands.filter((c) => c.layerId === layer.id);
      return {
        ok: true,
        data: { scene: { name: info.name, id: info.id }, sampledFrame: midFrame, vir: layer, commands },
      };
    },
  };

  const layerModifyTool: VapTool = {
    name: "layer.modify",
    description: "源码级锚点编辑图层属性（text=内容 / color=颜色 / size=字号 / opacity=不透明度）→ 写回 entry → 自动重编译",
    schema: z.object({
      scene: z.string().describe("场景名或 id"),
      layer: z.string().describe("图层名"),
      property: z.enum(["text", "color", "size", "opacity"]),
      value: z.union([z.string(), z.number()]).describe("text/color 为 string；size/opacity 为 number"),
    }),
    async execute(args: VapToolArgs, ctx: VapContext): Promise<VapToolResult> {
      const session = asVapSession(ctx);
      await session.ensureCompiled();
      const info = findSceneInfo(session, String(args.scene ?? ""));
      if (info === null) {
        return { ok: false, error: `SCENE_NOT_FOUND: ${JSON.stringify(args.scene)} (available: ${availableScenes(session)})` };
      }
      const layer = virLayerOf(session, info.id, String(args.layer));
      if (layer === undefined) {
        return { ok: false, error: `LAYER_NOT_FOUND: ${JSON.stringify(args.layer)} in scene "${info.name}"` };
      }
      const property = String(args.property ?? "");
      const value = args.value as string | number;
      if (property === "color" && (typeof value !== "string" || !COLOR_RE.test(value))) {
        return { ok: false, error: `INVALID_VALUE: color 需要 #rgb/#rrggbb/#rrggbbaa，got ${String(value)}` };
      }
      if (property === "text" && typeof value !== "string") {
        return { ok: false, error: `INVALID_VALUE: text 需要字符串，got ${String(value)}` };
      }
      const source = await readFile(session.entryPath, "utf8");
      const outcome = applyLayerModify(source, { scene: info.name, layer: layer.name, property, value });
      if (!outcome.ok) return { ok: false, error: outcome.reason };
      return commitEdit(ctx, outcome);
    },
  };

  return [sceneListTool, sceneInspectTool, sceneModifyTool, layerInspectTool, layerModifyTool];
}

function virLayerOf(session: VapSession, sceneId: string, layerName: string): import("@videoos/vir").VirLayer | undefined {
  const scene = session.lastCompile?.vir.scenes.find((s) => s.id === sceneId);
  return scene?.layers.find((l) => l.name === layerName);
}
