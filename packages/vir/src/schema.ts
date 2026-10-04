// VIR zod schema：与 types.ts 一一对应（strict 模式；params 允许自定义数值键；uses 缺省为 []）
import { z } from "zod";
import type { Vir, VirLayer } from "./types";

export const VirVec2Schema = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();

export const VirPositionSchema = z.object({
  x: z.union([z.number().finite(), z.string().min(1)]),
  y: z.union([z.number().finite(), z.string().min(1)]),
}).strict();

export const VirTransformSchema = z.object({
  anchor: VirVec2Schema,
  position: VirPositionSchema,
  scale: VirVec2Schema,
  rotation: z.number().finite(),
  opacity: z.number().finite().min(0).max(1),
}).strict();

export const VirAnimationTypeSchema = z.enum(["enter", "exit", "loop"]);

export const VirAnimationSchema = z.object({
  type: VirAnimationTypeSchema,
  effect: z.string().min(1),
  duration: z.number().finite().positive(),
  delay: z.number().finite().min(0),
  easing: z.string().min(1),
  params: z.record(z.number().finite()).optional(),
}).strict();

export const VirTextPropsSchema = z.object({
  content: z.string(),
  font: z.string().min(1),
  size: z.number().finite().positive(),
  weight: z.number().finite().positive(),
  color: z.string().min(1),
  align: z.enum(["left", "center", "right"]),
  letterSpacing: z.number().finite(),
  lineHeight: z.number().finite().positive(),
  maxWidth: z.number().finite().positive().optional(),
}).strict();

export const VirRectPropsSchema = z.object({
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  fill: z.string().min(1),
  radius: z.number().finite().min(0).optional(),
  blur: z.number().finite().min(0).optional(),
}).strict();

export const VirEllipsePropsSchema = z.object({
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  fill: z.string().min(1),
  blur: z.number().finite().min(0).optional(),
}).strict();

export const VirImagePropsSchema = z.object({
  width: z.number().finite().positive().optional(),
  height: z.number().finite().positive().optional(),
  radius: z.number().finite().min(0).optional(),
  blur: z.number().finite().min(0).optional(),
}).strict();

// 图层基座（uses 可缺省 → 默认 []，便于编译器复用解析 DSL AST）
const VirLayerBaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(["text", "rect", "ellipse", "image", "group"]),
  in: z.number().finite().min(0),
  out: z.number().finite().positive(),
  transform: VirTransformSchema,
  animations: z.array(VirAnimationSchema),
  uses: z.array(z.string()).default([]),
  src: z.string().min(1).optional(),
  children: z.array(z.lazy((): z.ZodType<VirLayer> => VirLayerSchema)).optional(),
}).strict();

const VirLayerUnion = z.discriminatedUnion("type", [
  VirLayerBaseSchema.extend({ type: z.literal("text"), text: VirTextPropsSchema }).strict(),
  VirLayerBaseSchema.extend({ type: z.literal("rect"), rect: VirRectPropsSchema }).strict(),
  VirLayerBaseSchema.extend({ type: z.literal("ellipse"), ellipse: VirEllipsePropsSchema }).strict(),
  VirLayerBaseSchema.extend({ type: z.literal("image"), image: VirImagePropsSchema }).strict(),
  VirLayerBaseSchema.extend({ type: z.literal("group") }).strict(),
]);

// children 递归导致 zod 无法自动推断 → 显式标注为 VirLayer
export const VirLayerSchema: z.ZodType<VirLayer> = VirLayerUnion as unknown as z.ZodType<VirLayer>;

export const VirBeatSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  at: z.number().finite().min(0),
  description: z.string().optional(),
}).strict();

export const VirCameraSchema = z.object({
  type: z.enum(["static", "push-in", "pull-out", "pan"]),
  params: z.record(z.number().finite()),
}).strict();

export const VirSceneSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  start: z.number().finite().min(0),
  duration: z.number().finite().positive(),
  background: z.string().optional(),
  camera: VirCameraSchema.optional(),
  layers: z.array(VirLayerSchema),
  beats: z.array(VirBeatSchema),
}).strict();

export const VirTransitionSchema = z.object({
  type: z.enum(["cut", "crossfade", "fade-black"]),
  duration: z.number().finite().min(0),
  between: z.tuple([z.string().min(1), z.string().min(1)]),
}).strict();

export const VirAudioClipSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  src: z.string().min(1),
  start: z.number().finite().min(0),
  volume: z.number().finite().min(0),
  fadeIn: z.number().finite().min(0).optional(),
  fadeOut: z.number().finite().min(0).optional(),
  loop: z.boolean().optional(),
}).strict();

export const VirAssetRefSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["image", "font", "audio"]),
  src: z.string().min(1),
  hash: z.string().optional(),
}).strict();

export const VirGraphsSchema = z.object({
  temporal: z.object({
    nodes: z.array(z.object({
      id: z.string().min(1), kind: z.literal("scene"),
      start: z.number().finite(), end: z.number().finite(),
    }).strict()),
    edges: z.array(z.object({ from: z.string().min(1), to: z.string().min(1) }).strict()),
  }).strict(),
  spatial: z.object({ roots: z.record(z.array(z.string().min(1))) }).strict(),
  dependency: z.object({
    nodes: z.array(z.object({
      id: z.string().min(1), kind: z.enum(["asset", "layer", "scene"]),
    }).strict()),
    edges: z.array(z.object({ from: z.string().min(1), to: z.string().min(1) }).strict()),
  }).strict(),
}).strict();

export const VirMetaSchema = z.object({
  title: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().finite().positive(),
  duration: z.number().finite().min(0),
  background: z.string().min(1),
  seed: z.number().finite(),
}).strict();

export const VirSchema = z.object({
  virVersion: z.literal("1.0"),
  meta: VirMetaSchema,
  scenes: z.array(VirSceneSchema),
  transitions: z.array(VirTransitionSchema),
  audio: z.array(VirAudioClipSchema),
  assets: z.array(VirAssetRefSchema),
  graphs: VirGraphsSchema,
}).strict();

export interface VirParseIssue { path: string; message: string }

/** 结构化解析失败错误（code = VIR_PARSE_ERROR，issues 携带路径与信息） */
export class VirParseError extends Error {
  readonly code = "VIR_PARSE_ERROR";
  readonly issues: readonly VirParseIssue[];
  constructor(issues: readonly VirParseIssue[]) {
    super(`Invalid VIR: ${issues.map((i) => `${i.path || "<root>"}: ${i.message}`).join("; ")}`);
    this.name = "VirParseError";
    this.issues = issues;
  }
}

/** 解析未知输入为 VIR；失败抛出结构化 VirParseError */
export function parseVir(input: unknown): Vir {
  const result = VirSchema.safeParse(input);
  if (!result.success) {
    throw new VirParseError(result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })));
  }
  return result.data as Vir;
}
