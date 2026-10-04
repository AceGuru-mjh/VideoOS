// videoos agent exec <instruction>：Provider 装配（VIDEOOS_PROVIDERS）→ ModelRouter → VAP 工具 → AgentExecutor
// 无 provider → 打印设置指引（GLM/OpenAI/DeepSeek 三例）并 exit 1。
import type { Command } from "commander";
import {
  AgentExecutor,
  createDefaultTools,
  createProvidersFromEnv,
  loadProviderConfig,
  ModelRouter,
  ProviderError,
  VapToolRegistry,
} from "@videoos/agent";
import type { VapEvent } from "@videoos/agent";
import { color, ctxFor, fail, openProject, resolveProjectRoot, truncate, withProjectOption } from "../util";

const PROVIDER_EXAMPLES = `设置方法（环境变量 VIDEOOS_PROVIDERS，JSON 数组）：

  # GLM（智谱）
  export VIDEOOS_PROVIDER_GLM_KEY=你的APIKey
  export VIDEOOS_PROVIDERS='[{"id":"glm","type":"openai-compatible","baseUrl":"https://open.bigmodel.cn/api/paas/v4","model":"glm-4.6"}]'

  # OpenAI
  export VIDEOOS_PROVIDER_OPENAI_KEY=sk-...
  export VIDEOOS_PROVIDERS='[{"id":"openai","type":"openai-compatible","baseUrl":"https://api.openai.com/v1","model":"gpt-4o"}]'

  # DeepSeek
  export VIDEOOS_PROVIDER_DEEPSEEK_KEY=sk-...
  export VIDEOOS_PROVIDERS='[{"id":"deepseek","type":"openai-compatible","baseUrl":"https://api.deepseek.com/v1","model":"deepseek-chat"}]

apiKey 也可写在 JSON 内；同一数组可放多个 provider（ModelRouter 按 prefer 规则路由）。
详见 SPEC §6 与 packages/agent/src/providers/config.ts`;

export function registerAgentCommand(program: Command): void {
  const agent = program.command("agent").description("Agent Runtime（VAP 工具循环）");
  withProjectOption(
    agent
      .command("exec")
      .description("执行一条自然语言指令（Agent 经 VAP 工具自主编译/修改/测试/渲染）")
      .argument("<instruction>", "自然语言指令，如「把标题改成 VideoOS v2 并重新渲染」"),
  ).action(async (instruction: string, opts: { project?: string }) => {
    // 1. Provider 配置
    let configs;
    try {
      configs = loadProviderConfig();
    } catch (err) {
      if (err instanceof ProviderError) {
        fail(err.message);
        console.error(color.gray(PROVIDER_EXAMPLES));
      } else {
        fail(String(err));
      }
      return;
    }
    if (configs.length === 0) {
      console.error(color.yellow("✗ 未配置任何模型 Provider（videoos agent 需要 LLM）"));
      console.error("");
      console.error(PROVIDER_EXAMPLES);
      process.exitCode = 1;
      return;
    }

    // 2. 项目 + 上下文
    const project = await openProject(resolveProjectRoot(opts.project));
    if (project === null) return;

    // onEvent 旁路：工具调用/结果实时打印（流式）
    const onEvent = (e: VapEvent): void => {
      if (e.kind === "tool-call" && e.tool !== undefined) {
        const args = JSON.stringify(e.detail !== null && typeof e.detail === "object" ? (e.detail as { args?: unknown }).args ?? {} : {});
        console.log(color.cyan(`→ ${e.tool} ${truncate(args, 96)}`));
      } else if (e.kind === "tool-result" && e.tool !== undefined) {
        const detail = (e.detail ?? {}) as { ok?: boolean; error?: string };
        if (detail.ok === false) {
          console.log(color.red(`  ✗ ${e.tool} ${truncate(detail.error ?? "unknown error", 96)}`));
        } else {
          console.log(color.green(`  ✓ ${e.tool} ok`));
        }
      }
    };
    const ctx = await ctxFor(project, onEvent);

    // 3. Router + 工具 + Executor
    const providers = createProvidersFromEnv();
    const router = new ModelRouter(providers);
    const registry = new VapToolRegistry();
    for (const tool of createDefaultTools()) registry.register(tool);
    const executor = new AgentExecutor({ router, registry, context: ctx });

    const primary = router.route();
    console.log(color.gray(`模型 ${primary.id} · ${primary.model}（${providers.length} 个 provider，${registry.names().length} 个 VAP 工具）`));
    console.log("");

    let result;
    try {
      result = await executor.run(instruction);
    } catch (err) {
      if (err instanceof ProviderError) {
        fail(`模型调用失败：${err.message}`);
      } else {
        fail(`Agent 执行失败：${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    // 逐步摘要（assistant 消息；工具调用已由 onEvent 实时打印）
    const assistantSteps = result.steps.filter((s) => s.role === "assistant");
    if (assistantSteps.length > 0) {
      console.log("");
      console.log(color.gray(`执行轨迹（${result.toolCallCount} 次工具调用 / ${assistantSteps.length} 轮 assistant）：`));
      for (const [i, step] of assistantSteps.entries()) {
        const calls = (step.toolCalls ?? []).map((c) => c.name).join(", ");
        const content = step.content.length > 0 ? step.content : "(无文本)";
        console.log(color.gray(`  #${i + 1} ${truncate(content, 88)}`));
        if (calls.length > 0) console.log(color.gray(`      调用：${calls}`));
      }
    }
    console.log("");
    console.log(color.bold("Agent 输出："));
    console.log(result.output);
  });
}
