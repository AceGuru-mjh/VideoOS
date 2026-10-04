// compile 主流程：parse → 场景时序派生 → 资产注册 → VIR 组装（uses/graphs/duration）→ 诊断 → 语义索引/帧求值器
import { buildSemanticIndex, parseVir } from "@videoos/vir";
import type { SemanticIndex, Vir, VirScene } from "@videoos/vir";
import type { VideoDefinition } from "@videoos/dsl";
import { buildAssetRegistry, layerUses } from "./assets";
import { collectDiagnostics } from "./diagnostics";
import type { Diagnostic } from "./diagnostics";
import { CompilerError } from "./errors";
import { createFramePlan } from "./frame-plan";
import type { FramePlan } from "./frame-plan";
import { buildGraphs } from "./graphs";
import { parseProgram } from "./parse";
import { deriveSceneTiming } from "./timing";

export interface CompileOptions {
  /** 提供时对 image/audio 资产做文件存在性检查（相对 src 会拼接到该根路径下） */
  assetRoot?: string;
}

export interface CompileResult {
  vir: Vir;
  /** 惰性按帧求值（不预生成全部帧；纯函数） */
  framePlan: (frame: number) => FramePlan;
  diagnostics: Diagnostic[];
  semantic: SemanticIndex;
}

export function compile(definition: VideoDefinition, options: CompileOptions = {}): CompileResult {
  if (options.assetRoot !== undefined && (typeof options.assetRoot !== "string" || options.assetRoot.length === 0)) {
    throw new CompilerError("COMPILER_INVALID_OPTIONS", "options.assetRoot must be a non-empty string when provided");
  }
  // 1. zod 防御性解析 program
  const program = parseProgram(definition);
  const diagnostics: Diagnostic[] = [];

  // 2. 场景时序派生（重叠 = crossfade/fade-black 的 duration；cut 不重叠）
  const timings = deriveSceneTiming(program, diagnostics);

  // 3. 资产注册表（image src / audio src / text 字体家族 → font:family）
  const registry = buildAssetRegistry(program.scenes, program.audio, diagnostics);

  // 4. VIR 组装：scenes.start、layers.uses、graphs、meta.duration = 末场景 end - 首场景 start
  const totalDuration = timings.length > 0 ? timings[timings.length - 1]!.end - timings[0]!.start : 0;
  const scenes: VirScene[] = timings.map((t) => ({
    ...t.scene,
    start: t.start,
    layers: t.scene.layers.map((layer) => ({ ...layer, uses: layerUses(layer, registry) })),
  }));
  const vir: Vir = {
    virVersion: "1.0",
    meta: { ...program.meta, duration: totalDuration },
    scenes,
    transitions: program.transitions.map((t) => ({ ...t })),
    audio: program.audio.map((a) => ({ ...a })),
    assets: registry.assets.map((a) => ({ ...a })),
    graphs: buildGraphs(scenes, registry.assets),
  };

  // 5. 诊断收集（不抛错：内容问题以 error 级 Diagnostic 报告）
  diagnostics.push(...collectDiagnostics({ vir, registry, totalDuration, assetRoot: options.assetRoot }));

  // 自检：产物必须通过 VIR 自身 schema（编译器不变量防线）
  try {
    parseVir(vir);
  } catch (err) {
    throw new CompilerError("COMPILER_INTERNAL", `Assembled VIR failed its own schema: ${(err as Error).message}`);
  }

  return {
    vir,
    framePlan: createFramePlan(vir),
    diagnostics,
    semantic: buildSemanticIndex(vir),
  };
}
