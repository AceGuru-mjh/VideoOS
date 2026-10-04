// @videoos/compiler：VideoDefinition → VIR + FramePlan + 诊断 + 语义索引
export { compile } from "./compile";
export type { CompileOptions, CompileResult } from "./compile";
export { CompilerError } from "./errors";
export { parseProgram, ProgramSchema } from "./parse";
export type { ParsedProgram, ParsedScene } from "./parse";
export { deriveSceneTiming } from "./timing";
export type { SceneTiming } from "./timing";
export { findIncomingTransition, findAnyTransition } from "./transition";
export type { IncomingTransition } from "./transition";
export { buildAssetRegistry, layerUses, imageAssetId, fontAssetId, audioAssetId, sanitizeAssetKey } from "./assets";
export type { AssetRegistry } from "./assets";
export { buildGraphs } from "./graphs";
export { collectDiagnostics } from "./diagnostics";
export type { Diagnostic } from "./diagnostics";
export { createFramePlan } from "./frame-plan";
export type { FramePlan, FrameCommand, FramePlanCamera, FramePlanTransition, TextClip } from "./frame-plan";
export type { Vir, VirScene, VirLayer, VirGraphs, SemanticIndex, SceneInfo } from "@videoos/vir";
