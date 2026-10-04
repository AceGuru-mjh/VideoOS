// VideoProgram 的 zod 防御性解析（复用 VIR 组件 schema；layers 的 uses 缺省填充为 []）
import { z } from "zod";
import {
  VirAudioClipSchema, VirBeatSchema, VirCameraSchema, VirLayerSchema, VirTransitionSchema,
} from "@videoos/vir";
import type { VirAudioClip, VirLayer } from "@videoos/vir";
import type { RawScene, VideoDefinition, VideoProgram } from "@videoos/dsl";
import { CompilerError } from "./errors";

const MetaSchema = z.object({
  title: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().finite().positive(),
  background: z.string().min(1),
  seed: z.number().finite(),
}).strict();

const RawSceneSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  duration: z.number().finite().positive(),
  background: z.string().optional(),
  camera: VirCameraSchema.optional(),
  layers: z.array(VirLayerSchema),
  beats: z.array(VirBeatSchema),
}).strict();

export const ProgramSchema = z.object({
  meta: MetaSchema,
  scenes: z.array(RawSceneSchema),
  transitions: z.array(VirTransitionSchema),
  audio: z.array(VirAudioClipSchema),
}).strict();

/** 解析后的中间形态：RawScene 的 layers 已带上 uses（默认 []），结构等同 VirScene 但无 start */
export type ParsedScene = Omit<RawScene, "layers"> & { layers: VirLayer[] };
export type ParsedProgram = Omit<VideoProgram, "scenes"> & { scenes: ParsedScene[] };

export function parseProgram(definition: VideoDefinition): ParsedProgram {
  if (typeof definition !== "object" || definition === null) {
    throw new CompilerError("COMPILER_INVALID_DEFINITION", "definition must be an object");
  }
  if (definition.kind !== "videoos-definition") {
    throw new CompilerError("COMPILER_INVALID_DEFINITION", `Unexpected definition kind: ${String((definition as { kind?: unknown }).kind)}`);
  }
  if (definition.version !== "1.0") {
    throw new CompilerError("COMPILER_INVALID_DEFINITION", `Unsupported definition version: ${String((definition as { version?: unknown }).version)}`);
  }
  const result = ProgramSchema.safeParse(definition.program);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ");
    throw new CompilerError("COMPILE_PARSE_ERROR", `Invalid video program: ${issues}`);
  }
  return result.data as unknown as ParsedProgram;
}

export type { VirAudioClip };
