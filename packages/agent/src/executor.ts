// AgentExecutor（SPEC §6.3）：reason ↔ VAP tools ↔ World State 的 agent 循环。
// 每轮 provider.chat(messages, { tools }) → 有 toolCalls 则逐个 registry.call（结果以 tool 消息回填）→ 继续；
// 无 toolCalls → content 即最终输出；maxSteps（LLM 轮数）耗尽 → output = "MAX_STEPS_REACHED" + 最后 content。
import type { ToolCallRequest, ToolDefinition } from "./providers/types";
import type { ModelRouter, RouterTask } from "./router";
import type { AgentMemory } from "./memory";
import type { VapContext, VapEvent } from "./session";
import type { VapToolRegistry } from "./vap/registry";

export interface AgentStep {
  role: "assistant" | "tool";
  content: string;
  /** assistant 步：模型发起的工具调用 */
  toolCalls?: ToolCallRequest[];
  /** tool 步：对应的 toolCall id */
  toolCallId?: string;
  /** tool 步：工具名 */
  name?: string;
}

export interface AgentRunResult {
  output: string;
  steps: AgentStep[];
  toolCallCount: number;
  events: VapEvent[];
}

export interface AgentExecutorDeps {
  router: ModelRouter;
  registry: VapToolRegistry;
  context: VapContext;
  memory?: AgentMemory;
  systemPrompt?: string;
  /** LLM 轮数上限（默认 12） */
  maxSteps?: number;
  /** 每轮温度等（透传 provider.chat） */
  temperature?: number;
  maxTokens?: number;
}

export const DEFAULT_SYSTEM_PROMPT = `你是 VideoOS 视频工程师（Video Engineer Agent），通过 VAP 工具操作视频项目。

# 工作方式
- 你不直接"操纵视频"：你编写/修改视频程序（DSL 源码 src/video.ts）→ 编译 → 渲染 → 视觉测试 → 根据结果继续修复。
- 语义时间线：场景/节拍/图层都是命名实体（scene("intro") → beat("title-enter") → layer("title")）；不要用帧号思维，用语义名。

# 工具清单（全部结构化输出，ok=false 时读 error 自我修复）
- 编译：compile.run（重新编译并写 .video/vir.json）、compile.diagnostics、compile.vir（世界模型数据源）
- 场景：scene.list、scene.inspect、scene.modify（源码级锚点编辑：replace_text/set_color/set_duration/set_animation；PATTERN_NOT_FOUND 表示源码锚点缺失，此时应直接重写文件）
- 图层：layer.inspect、layer.modify（text/color/size/opacity）
- 资产/音频：asset.list、asset.add、audio.list、audio.set
- 渲染：render.preview（单帧 PNG，缓存命中 <5ms）、render.range、render.final（MP4）、render.status、render.cancel
- 缓存：cache.stats、cache.clear
- 测试：test.run（视觉 QA：语义断言/golden diff/溢出检测）、test.results
- 事务：transaction.begin / commit / rollback / list
- 诊断：inspect.frame（FramePlan）、diff.frames、check.overflow、check.missingAssets
- 故事板：storyboard.plan（意图→镜头）、storyboard.toScenes（镜头→DSL 代码）

# 事务工作流（修改项目内容时必须遵守）
1. transaction.begin（描述这次要改什么）
2. 修改（scene.modify / layer.modify / 重写文件）→ compile.run → render.preview 检查 → test.run
3. 全部通过 → transaction.commit；测试失败 → 先尝试修复（最多 3 轮），仍失败 → transaction.rollback 并报告原因
- render.final 只在测试全绿后执行。

# 修复线索
- 测试失败的结构化 details（visibleTexts/overflows/similarity/missing…）是修复的直接依据。
- check.overflow 用渲染器实测文本宽度（比编译期启发式精确），溢出时优先调 size 或改文案。
- 编译诊断 code 对照：OVERFLOW_RISK/ASSET_MISSING/TRANSITION_* 等，错误信息都带场景/图层定位。`;

/** 工具结果 → 回填给 LLM 的 tool 消息内容（紧凑 JSON，错误信息完整保留） */
function toolResultContent(name: string, result: { ok: boolean; data?: unknown; error?: string }): string {
  return JSON.stringify({ tool: name, ok: result.ok, ...(result.error !== undefined ? { error: result.error } : {}), ...(result.data !== undefined ? { data: result.data } : {}) });
}

export class AgentExecutor {
  private readonly deps: AgentExecutorDeps;
  readonly maxSteps: number;

  constructor(deps: AgentExecutorDeps) {
    this.deps = deps;
    this.maxSteps = deps.maxSteps ?? 12;
    if (!Number.isInteger(this.maxSteps) || this.maxSteps < 1) {
      throw new Error(`AgentExecutor: maxSteps must be a positive integer, got ${String(deps.maxSteps)}`);
    }
  }

  async run(userMessage: string, opts: { task?: RouterTask } = {}): Promise<AgentRunResult> {
    const { router, registry, context, memory } = this.deps;
    const provider = router.route(opts.task ?? "default");

    // 系统提示 + 项目记忆（事实 + 近期失败教训）
    let systemPrompt = this.deps.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    if (memory !== undefined) {
      const facts = await memory.recallFacts();
      if (Object.keys(facts).length > 0) systemPrompt += `\n\n# 项目事实（长期记忆）\n${JSON.stringify(facts, null, 2)}`;
      const failures = await memory.recallFailures(5);
      if (failures.length > 0) {
        systemPrompt += `\n\n# 近期失败记录（避免重复踩坑）\n${failures.map((f) => `- [${f.task}] ${f.error}${f.hint !== undefined ? `（提示：${f.hint}）` : ""}`).join("\n")}`;
      }
    }

    const messages: Array<{ role: "system" | "user" | "assistant" | "tool"; content: string; toolCallId?: string; name?: string; toolCalls?: ToolCallRequest[] }> = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ];
    const steps: AgentStep[] = [];
    const tools: ToolDefinition[] = registry.list();
    let toolCallCount = 0;
    let lastAssistantContent = "";

    for (let round = 0; round < this.maxSteps; round++) {
      const response = await provider.chat(messages, {
        ...(tools.length > 0 && provider.capabilities.tools ? { tools } : {}),
        ...(this.deps.temperature !== undefined ? { temperature: this.deps.temperature } : {}),
        ...(this.deps.maxTokens !== undefined ? { maxTokens: this.deps.maxTokens } : {}),
      });

      if (response.toolCalls !== undefined && response.toolCalls.length > 0) {
        steps.push({ role: "assistant", content: response.content, toolCalls: response.toolCalls });
        messages.push({ role: "assistant", content: response.content, toolCalls: response.toolCalls });
        for (const call of response.toolCalls) {
          const result = await registry.call(call.name, call.arguments, context);
          toolCallCount++;
          const content = toolResultContent(call.name, result);
          steps.push({ role: "tool", content, toolCallId: call.id, name: call.name });
          messages.push({ role: "tool", content, toolCallId: call.id, name: call.name });
          if (!result.ok && memory !== undefined) {
            await memory.recordFailure({ task: `tool:${call.name}`, error: result.error ?? "unknown error" }).catch(() => undefined);
          }
        }
        lastAssistantContent = response.content;
        continue;
      }

      steps.push({ role: "assistant", content: response.content });
      return { output: response.content, steps, toolCallCount, events: context.events.all() };
    }

    return {
      output: `MAX_STEPS_REACHED${lastAssistantContent.length > 0 ? `\n${lastAssistantContent}` : ""}`,
      steps,
      toolCallCount,
      events: context.events.all(),
    };
  }
}
