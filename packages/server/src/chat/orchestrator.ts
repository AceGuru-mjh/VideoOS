// ChatOrchestrator（issue #49，v0.2 §3）：对话式多轮 Agent 循环。
// 自有循环（不复用冻结的 AgentExecutor）：provider.chat → toolCalls → registry.call → tool 消息回填 → …；
// - 非阻塞：POST /api/agent/chat 校验后立即返回 runId，循环异步执行
// - 事件：agent-run-start / agent-text / agent-tool(start|ok|error) / agent-run-done 经 EventHub
//   广播（WS 实时 + 500 条环形缓冲，重连可用 GET /api/events 回放）
// - 停止：abort 标记（步骤间 + 每次工具调用前检查），未执行的 toolCalls 标记 stopped，保留已完成步骤
// - 全局单运行（单 ProjectSession）：并发第二跑 → 409 CHAT_RUN_ACTIVE
// - 演示模式：settings 侧 manual 条目无 script 字段（schema 剥除）→ 注入内置演示脚本，
//   离线可跑通「规划 → compile.run → render.preview → 总结」全链路
import { basename, resolve } from "node:path";
import {
  ManualProvider,
  type ChatMessage,
  type ManualScriptStep,
  type ModelProvider,
  type ToolCallRequest,
  type VapToolResult,
} from "@videoos/agent";
import { ServerError } from "../errors";
import { resolveAgentProviders } from "../settings/providers";
import type { SettingsValues } from "../settings/schema";
import type { ProjectSession, ServerState } from "../state";
import { GatedRegistry } from "./gate";
import { composeSkillSection, loadSkills } from "./skills";
import { newId, type ChatMessageRecord, type ChatToolCallRecord, type ChatUsageRecord } from "./sessions";

// ---------------------------------------------------------------- 常量

/** 喂给 LLM 的历史消息条数上限（保持上下文精简） */
const HISTORY_LIMIT = 20;
/** maxSteps 硬上限（settings.agent.maxSteps 与请求值均被截断到此） */
const MAX_STEPS_CAP = 30;
/** 落库/广播用工具结果摘要长度上限 */
const RESULT_SUMMARY_LIMIT = 300;
/** 回填 LLM 的工具结果长度上限（剥除 base64 等大字段后；知识工具的代码/配方需较完整到达模型） */
const TOOL_MESSAGE_LIMIT = 12_000;
/** 回填 LLM 路径的单字符串截断阈值（展示摘要保持 512：代码/配方 ≤8000 字符原样到达，不再被 512 截断摧毁） */
const TOOL_MESSAGE_STRING_LIMIT = 8_000;
/** 展示摘要路径的单字符串截断阈值（resultSummary 紧凑；与 stripBulky 缺省值一致） */
const SUMMARY_STRING_LIMIT = 512;

/**
 * 演示模式默认脚本（settings 的 manual 条目无 script 字段时注入）：
 * 规划文本（含工具调用）→ render.preview → 中文总结。
 */
export const DEMO_SCRIPT: ManualScriptStep[] = [
  {
    content: "收到！我先规划一下：编译当前项目确认基线，再渲染一帧预览检查画面效果。",
    toolCalls: [{ id: "demo-compile", name: "compile.run", arguments: {} }],
  },
  {
    toolCalls: [{ id: "demo-preview", name: "render.preview", arguments: { frame: 30 } }],
  },
  {
    content:
      "演示流程完成：项目编译通过，预览帧已生成。接入真实模型供应商后，我可以按你的需求规划、编写和修改视频 DSL，迭代渲染并输出成片。",
  },
];

// ---------------------------------------------------------------- 公共类型

export interface ChatStartInput {
  sessionId: string;
  message: string;
  /** 覆盖 settings.agent.maxSteps（≤ 30） */
  maxSteps?: number;
}

/** GET /api/agent/run/active 响应（无活跃运行时为 null） */
export interface ActiveRunInfo {
  runId: string;
  sessionId: string;
}

/** 构造选项（issue #54）：confirmTimeoutMs 供测试注入短超时（默认 120s） */
export interface ChatOrchestratorOptions {
  confirmTimeoutMs?: number;
}

interface ActiveRun extends ActiveRunInfo {
  aborted: boolean;
}

// ---------------------------------------------------------------- 工具结果整理

/**
 * 递归剥除大字段（base64 键 / 超长字符串），供摘要与 LLM 回填共用。
 * stringLimit 分级（v0.2.1 任务 11-c）：展示摘要保持 512 紧凑；
 * LLM 回填路径用 8000——pattern.get / skill.read / template.inspect 的代码与配方是弱模型的命脉，不能被 512 截断摧毁。
 */
function stripBulky(value: unknown, opts?: { stringLimit?: number }): unknown {
  const stringLimit = opts?.stringLimit ?? SUMMARY_STRING_LIMIT;
  if (Array.isArray(value)) return value.map((v) => stripBulky(v, opts));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (/base64/i.test(key)) continue;
      if (typeof v === "string" && v.length > stringLimit) {
        out[key] = `${v.slice(0, 64)}…（已截断，共 ${v.length} 字符）`;
        continue;
      }
      out[key] = stripBulky(v, opts);
    }
    return out;
  }
  return value;
}

/** 工具结果 → 紧凑 JSON 摘要（错误信息完整保留；剥除大字段；超长截断；展示用 512 / LLM 回填用 8000 分级） */
function summarizeResult(name: string, result: VapToolResult, limit: number, opts?: { stringLimit?: number }): string {
  const payload = {
    tool: name,
    ok: result.ok,
    ...(result.error !== undefined ? { error: result.error } : {}),
    ...(result.data !== undefined ? { data: stripBulky(result.data, opts) } : {}),
  };
  const text = JSON.stringify(payload) ?? "{}";
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 1))}…` : text;
}

/** 从工具结果提取产物提示：render.preview → frame；render.final → videoUrl（/renders/<basename>） */
function artifactHints(name: string, result: VapToolResult): { frame?: number; videoUrl?: string } {
  if (!result.ok || result.data === null || typeof result.data !== "object") return {};
  const data = result.data as Record<string, unknown>;
  if (name === "render.preview" && typeof data.frame === "number") {
    return { frame: data.frame };
  }
  if (name === "render.final" && typeof data.video === "string" && data.video.length > 0) {
    return { videoUrl: `/renders/${basename(data.video)}` };
  }
  return {};
}

// ---------------------------------------------------------------- 会话记录 → LLM 上下文

/**
 * 历史映射（保持上下文精简）：user/assistant 正文直传；
 * 带 toolCalls 的 assistant 回合附加一行紧凑「工具执行记录」（不回放 tool 角色消息）。
 */
export function toContextMessages(records: ReadonlyArray<ChatMessageRecord>): ChatMessage[] {
  return records.slice(-HISTORY_LIMIT).map((rec) => {
    if (rec.role === "user") return { role: "user" as const, content: rec.content };
    const parts = [rec.content];
    if (rec.toolCalls !== undefined && rec.toolCalls.length > 0) {
      const note = rec.toolCalls
        .map((t) => {
          const extras: string[] = [];
          if (t.frame !== undefined) extras.push(`frame=${t.frame}`);
          if (t.videoUrl !== undefined) extras.push(t.videoUrl);
          return `${t.name} ${t.status}${extras.length > 0 ? ` (${extras.join(", ")})` : ""}`;
        })
        .join("; ");
      parts.push(`[工具执行记录] ${note}`);
    }
    return { role: "assistant" as const, content: parts.filter((p) => p.length > 0).join("\n") };
  });
}

// ---------------------------------------------------------------- ChatOrchestrator

export class ChatOrchestrator {
  private readonly state: ServerState;
  private readonly gateOptions: ChatOrchestratorOptions;
  private active: ActiveRun | null = null;

  constructor(state: ServerState, options: ChatOrchestratorOptions = {}) {
    this.state = state;
    this.gateOptions = { ...options };
  }

  /** 测试注入：覆盖确认等待超时（不影响已构造的运行；null 恢复默认） */
  __setGateOptionsForTests(options: ChatOrchestratorOptions | null): void {
    if (options === null) delete this.gateOptions.confirmTimeoutMs;
    else this.gateOptions.confirmTimeoutMs = options.confirmTimeoutMs;
  }

  /** 停止标记检查（方法封装：stop() 可从任意 HTTP 请求置位，避免控制流窄化误判） */
  private isAborted(): boolean {
    return this.active !== null && this.active.aborted;
  }

  /** 当前活跃运行（前端 boot / 刷新恢复用）；无 → null */
  activeRun(): ActiveRunInfo | null {
    return this.active === null ? null : { runId: this.active.runId, sessionId: this.active.sessionId };
  }

  /**
   * 启动一次对话运行（非阻塞）：校验会话 → 装配 provider → 确保项目打开 →
   * 全局单运行检查 → 返回 runId（循环异步执行，进度走 WS 事件）。
   * 错误（均在返回 runId 之前抛出）：SESSION_NOT_FOUND 404 / PROVIDER_NONE 409 /
   * SESSION_NO_PROJECT 409 / SERVER_OPEN_FAILED 404 / CHAT_RUN_ACTIVE 409。
   */
  async start(input: ChatStartInput): Promise<{ runId: string }> {
    const record = this.state.sessions.get(input.sessionId); // 404 SESSION_NOT_FOUND
    const provider = this.pickProvider(); // 409 PROVIDER_NONE
    const projectSession = await this.ensureProject(record.projectRoot); // 409 SESSION_NO_PROJECT / 404 打开失败
    if (this.active !== null) {
      throw new ServerError("CHAT_RUN_ACTIVE", "已有 Agent 运行中（单任务），请先等待完成或停止", 409);
    }
    const runId = newId("r");
    // 检查与占位之间无 await（同步段）→ 并发请求不会双双通过
    this.active = { runId, sessionId: record.id, aborted: false };
    const maxSteps = clampMaxSteps(input.maxSteps ?? this.state.settings.get().agent.maxSteps);
    void this.runLoop(runId, record.id, input.message, provider, projectSession, maxSteps);
    return { runId };
  }

  /**
   * 停止运行：给定 runId 必须命中活跃运行，缺省停止当前活跃运行。
   * 无活跃运行 / runId 不匹配 → 404 RUN_NOT_FOUND。
   */
  stop(runId?: string): { stopped: boolean } {
    const active = this.active;
    if (active === null) {
      throw new ServerError("RUN_NOT_FOUND", "no active agent run", 404);
    }
    if (runId !== undefined && runId !== active.runId) {
      throw new ServerError("RUN_NOT_FOUND", `run "${runId}" not found (active: "${active.runId}")`, 404);
    }
    active.aborted = true;
    return { stopped: true };
  }

  // ---------------------------------------------------------------- provider 装配

  /** S2 桥解析 + 默认供应商优先；settings 侧 manual 条目注入演示脚本（离线演示模式） */
  private pickProvider(): ModelProvider {
    const values = this.state.settings.get();
    const { providers, source } = resolveAgentProviders(values, this.state.secure);
    if (providers.length === 0) {
      throw new ServerError(
        "PROVIDER_NONE",
        "未配置模型 Provider（在设置中心添加，或使用演示模式创建 manual 供应商）",
        409,
      );
    }
    let chosen: ModelProvider = providers[0];
    const defaultId = values.providers.defaultProvider;
    if (defaultId !== null) {
      const hit = providers.find((p) => p.id === defaultId);
      if (hit !== undefined) chosen = hit;
    }
    // settings 条目永不携带 script（schema 剥除）→ manual 即演示条目，注入默认演示脚本；
    // env 侧 manual（可带自定义脚本，测试/回放用）保持原样
    if (source === "settings" && chosen instanceof ManualProvider) {
      chosen = new ManualProvider({ id: chosen.id, model: chosen.model, script: DEMO_SCRIPT.map((s) => ({ ...s })) });
    }
    return chosen;
  }

  /** 会话项目就位：未绑定 → 409；与当前打开项目一致 → 复用；不同 → 切换打开（单 ProjectSession 模型） */
  private async ensureProject(projectRoot: string | null): Promise<ProjectSession> {
    if (projectRoot === null || projectRoot.length === 0) {
      throw new ServerError("SESSION_NO_PROJECT", "会话未绑定项目：请先在 Studio 打开项目，或创建会话时传入 projectRoot", 409);
    }
    const current = this.state.projectSession;
    if (current !== null && resolve(current.project.root) === resolve(projectRoot)) return current;
    return this.state.open(projectRoot);
  }

  // ---------------------------------------------------------------- 主循环

  private async runLoop(
    runId: string,
    sessionId: string,
    message: string,
    provider: ModelProvider,
    ps: ProjectSession,
    maxSteps: number,
  ): Promise<void> {
    const { state } = this;
    let steps = 0;
    let assistantMessageId: string | null = null;
    const trail: ChatToolCallRecord[] = [];
    const usage: ChatUsageRecord = { promptTokens: 0, completionTokens: 0 };
    let usageSeen = false;
    let lastContent = "";
    // 本运行 settings 快照（技能注入 + 权限门共用；运行中改设置不影响已开跑的 run）
    const values = state.settings.get();
    // 权限门（issue #54）：包 VAP 注册表；mergeTools 开启时同表合并 mcp_<serverId>_<tool>（issue #53）
    const gate = new GatedRegistry({
      registry: ps.registry,
      agent: values.agent,
      mcp: values.mcp.mergeTools ? state.mcp : null,
      settings: state.settings,
      confirms: state.confirms,
      emit: (e) => state.hub.emit(e),
      run: { sessionId, runId, isStopped: () => this.isAborted() },
      ...(this.gateOptions.confirmTimeoutMs !== undefined ? { confirmTimeoutMs: this.gateOptions.confirmTimeoutMs } : {}),
    });
    try {
      // 用户消息落库（后续 run 的历史由此而来）
      state.sessions.appendMessage(sessionId, {
        id: newId("m"),
        role: "user",
        content: message,
        createdAt: Date.now(),
      });
      const messages: ChatMessage[] = [
        { role: "system", content: await this.buildSystemPrompt(ps, message, values, maxSteps) },
        ...toContextMessages(state.sessions.get(sessionId).messages),
      ];
      const tools = gate.list();
      state.hub.emit({ type: "agent-run-start", sessionId, runId });

      for (let step = 0; step < maxSteps; step++) {
        // 步骤间停止检查
        if (this.isAborted()) {
          return this.finishStopped(sessionId, runId, steps, assistantMessageId, trail, lastContent, usageSeen ? { ...usage } : undefined);
        }
        const response = await provider.chat(messages, tools.length > 0 && provider.capabilities.tools ? { tools } : {});
        steps++;
        if (response.usage !== undefined) {
          usage.promptTokens += response.usage.promptTokens ?? 0;
          usage.completionTokens += response.usage.completionTokens ?? 0;
          usageSeen = true;
        }
        // 文本与工具调用同回时也把文本推给前端（步骤级粒度）
        if (response.content.length > 0) {
          state.hub.emit({ type: "agent-text", sessionId, runId, text: response.content });
        }
        const calls: ToolCallRequest[] = response.toolCalls ?? [];
        if (calls.length === 0) {
          // 最终回合：assistant 记录（content + 完整工具轨迹 + 累计用量）落库后收尾
          this.persistAssistant(sessionId, runId, assistantMessageId, {
            content: response.content,
            toolCalls: trail,
            usage: usageSeen ? { ...usage } : undefined,
          });
          state.hub.emit({
            type: "agent-run-done",
            sessionId,
            runId,
            ok: true,
            steps,
            ...(usageSeen ? { usage: { ...usage } } : {}),
          });
          return;
        }
        lastContent = response.content;
        // assistant 记录建档（首回合）或内容跟进（后续回合）：运行中 GET 会话可见轨迹增长
        if (assistantMessageId === null) {
          assistantMessageId = newId("m");
          state.sessions.appendMessage(sessionId, {
            id: assistantMessageId,
            role: "assistant",
            content: response.content,
            createdAt: Date.now(),
            runId,
            toolCalls: [],
          });
        } else {
          state.sessions.patchMessage(sessionId, assistantMessageId, { content: response.content });
        }
        messages.push({ role: "assistant", content: response.content, toolCalls: calls });

        for (let i = 0; i < calls.length; i++) {
          const call = calls[i];
          // 每次工具调用前停止检查：本条 + 余下标记 stopped
          if (this.isAborted()) {
            for (let j = i; j < calls.length; j++) {
              const skipped = calls[j];
              trail.push({ name: skipped.name, args: skipped.arguments, status: "stopped", durationMs: 0 });
            }
            return this.finishStopped(sessionId, runId, steps, assistantMessageId, trail, lastContent, usageSeen ? { ...usage } : undefined);
          }
          state.hub.emit({ type: "agent-tool", sessionId, runId, name: call.name, args: call.arguments, status: "start" });
          const startedAt = Date.now();
          const result = await gate.call(call.name, call.arguments, ps.session);
          const durationMs = Date.now() - startedAt;
          const hints = artifactHints(call.name, result);
          const record: ChatToolCallRecord = {
            name: call.name,
            args: call.arguments,
            status: result.ok ? "ok" : "error",
            durationMs,
            resultSummary: summarizeResult(call.name, result, RESULT_SUMMARY_LIMIT),
            ...hints,
          };
          trail.push(record);
          state.sessions.patchMessage(sessionId, assistantMessageId, { toolCalls: [...trail] });
          state.hub.emit({
            type: "agent-tool",
            sessionId,
            runId,
            name: call.name,
            args: call.arguments,
            status: result.ok ? "ok" : "error",
            durationMs,
            ...hints,
            ...(result.ok ? {} : { error: result.error ?? "unknown error" }),
            resultSummary: record.resultSummary,
          });
          // 工具结果回填 LLM（tool 角色；openai-compatible 与 anthropic 适配器同形接受）。
          // 与展示摘要（resultSummary，512/300 紧凑）不同：回填路径用宽额（8000/12000），
          // 让 pattern.get / skill.read / template.inspect 的代码与配方完整可抄（弱模型脚手架的命脉）。
          messages.push({
            role: "tool",
            content: summarizeResult(call.name, result, TOOL_MESSAGE_LIMIT, { stringLimit: TOOL_MESSAGE_STRING_LIMIT }),
            toolCallId: call.id,
            name: call.name,
          });
        }
      }

      // maxSteps 耗尽：保留已完成步骤，收尾为 MAX_STEPS
      const notice = `（已达到最大步数 ${maxSteps}，本轮停止）`;
      this.persistAssistant(sessionId, runId, assistantMessageId, {
        content: lastContent.length > 0 ? `${lastContent}\n\n${notice}` : notice,
        toolCalls: trail,
        usage: usageSeen ? { ...usage } : undefined,
      });
      state.hub.emit({
        type: "agent-run-done",
        sessionId,
        runId,
        ok: false,
        steps,
        error: "MAX_STEPS",
        ...(usageSeen ? { usage: { ...usage } } : {}),
      });
    } catch (err) {
      // provider 抛错等：assistant 错误消息落库（尽力而为，不遮蔽原始错误）+ run-done ok:false
      const messageText = err instanceof Error ? err.message : String(err);
      try {
        this.persistAssistant(sessionId, runId, assistantMessageId, {
          content: `（模型调用失败：${messageText}）`,
          toolCalls: trail,
          usage: usageSeen ? { ...usage } : undefined,
        });
      } catch {
        // 落库失败不遮蔽 run-done
      }
      state.hub.emit({ type: "agent-run-done", sessionId, runId, ok: false, steps, error: messageText });
    } finally {
      if (this.active !== null && this.active.runId === runId) this.active = null;
    }
  }

  /** 停止收尾：assistant 部分（content so far 或「已停止」）+ stopped 轨迹落库 → run-done STOPPED */
  private finishStopped(
    sessionId: string,
    runId: string,
    steps: number,
    assistantMessageId: string | null,
    trail: ChatToolCallRecord[],
    lastContent: string,
    usage: ChatUsageRecord | undefined,
  ): void {
    this.persistAssistant(sessionId, runId, assistantMessageId, {
      content: lastContent.length > 0 ? lastContent : "（已停止）",
      toolCalls: trail,
      usage,
    });
    this.state.hub.emit({
      type: "agent-run-done",
      sessionId,
      runId,
      ok: false,
      steps,
      error: "STOPPED",
      ...(usage !== undefined ? { usage } : {}),
    });
  }

  /** assistant 记录终态写入：无档（单回合直答/停止在首回合前）→ 追加；有档 → 补丁 */
  private persistAssistant(
    sessionId: string,
    runId: string,
    messageId: string | null,
    final: { content: string; toolCalls: ChatToolCallRecord[]; usage?: ChatUsageRecord },
  ): string {
    if (messageId === null) {
      const id = newId("m");
      this.state.sessions.appendMessage(sessionId, {
        id,
        role: "assistant",
        content: final.content,
        createdAt: Date.now(),
        runId,
        ...(final.toolCalls.length > 0 ? { toolCalls: final.toolCalls } : {}),
        ...(final.usage !== undefined ? { usage: final.usage } : {}),
      });
      return id;
    }
    this.state.sessions.patchMessage(sessionId, messageId, {
      content: final.content,
      ...(final.toolCalls.length > 0 ? { toolCalls: final.toolCalls } : {}),
      ...(final.usage !== undefined ? { usage: final.usage } : {}),
    });
    return messageId;
  }

  // ---------------------------------------------------------------- 系统提示

  /**
   * 中文、对话优先（不复用 executor 的工程提示）。弱模型脚手架引擎（v0.2.1 任务 11-c）：
   * 身份 + 脚手架优先工作方式 + 工具分组 + DSL 速查（引擎事实） + 修复循环纪律 + 汇报风格 +
   * 项目上下文 + 技能段（含配方注入） + 步数上限。
   */
  private async buildSystemPrompt(
    ps: ProjectSession,
    message: string,
    values: SettingsValues,
    maxSteps: number,
  ): Promise<string> {
    const sections: string[] = [
      "你是 VideoOS 视频创作 Agent（Video Creation Agent），通过调用 VAP 工具帮助用户把想法变成视频。",
      "",
      "# 工作方式（脚手架优先）",
      "- 先理解用户意图、想清楚再动手；关键信息缺失时先提出简短的问题。不要从零发明——仓库里有模板、动效模式库和技能，先找现成的再定制。",
      "- 做完整视频：template.list 按需求挑选 → template.inspect 看完整源码 → template.apply 一键套用（覆盖入口并自动编译）→ 只改文案/颜色/数据等常量，不动结构。",
      "- 单个动效不会写：pattern.search 关键词（hook/stagger/柱状图/转场…）→ pattern.get 拿可抄代码，直接粘贴改参数，不重造轮子。",
      "- 需要某类视频的完整方法论：skill.read（比自动注入更全，含 QA gates 与全部配方）。",
      "- API 拿不准就查：dsl.reference（builder/text/effects/camera/transition/timing/geometry/diagnostics/workflow 九主题）。",
      "- 覆盖入口等有风险改动前先 transaction.begin，失败 transaction.rollback；mcp_* 工具在表中时优先用（color.contrast 检查对比度、subtitle.* 字幕、plot.* 图表参考）。",
      "- 标准工作流：规划 → 编写/修改视频 DSL（src/video.ts）→ compile.run 编译 → 有 diagnostics 先修复 → render.preview 渲染关键帧检查效果 → test.run 视觉 QA → 全部通过后 render.final 输出成片。",
      "- 语义时间线：场景/节拍/图层都是命名实体（scene(\"intro\") / beat(\"title-enter\") / layer(\"title\")），优先用语义名而非裸帧号。",
      "",
      "# 工具分组（全部结构化输出；ok=false 时读 error 自我修复）",
      "- 编译：compile.run / compile.diagnostics / compile.vir",
      "- 场景与图层：scene.list / scene.inspect / scene.modify、layer.inspect / layer.modify",
      "- 资产与音频：asset.list / asset.add、audio.list / audio.set",
      "- 渲染：render.preview（单帧 PNG，缓存命中 <5ms）/ render.range / render.final（MP4）/ render.status / render.cancel",
      "- 缓存：cache.stats / cache.clear",
      "- 测试与诊断：test.run / test.results、inspect.frame / diff.frames / check.overflow / check.missingAssets",
      "- 事务：transaction.begin / transaction.commit / transaction.rollback / transaction.list",
      "- 故事板：storyboard.plan / storyboard.toScenes",
      "- 模板脚手架：template.list / template.inspect / template.apply（一键套用完整视频再改内容）",
      "- 知识库：pattern.search / pattern.get（动效模式 cookbook）、skill.read（技能全文含代码配方）、dsl.reference（分主题 API 速查）",
      "",
      "# DSL 速查（引擎事实，违反即翻车）",
      "- 画布默认 1920×1080@30fps（竖屏 preset 为 1080×1920）；秒换算帧：frame = round(s × 30)。",
      "- 文本是单行绘制：多行必须拆成多个 text 层；TextOptions 仅 size/font/weight/color/align/letterSpacing/lineHeight/maxWidth 八个字段。",
      "- at.x 语义随 align：left=左缘 / center=中心 / right=右缘；rect/ellipse 的 at 恒为中心。",
      "- enter 效果 10 种：fade、slide-up/slide-down/slide-left/slide-right、blur-up、blur-in、scale-pop、typewriter、wipe（后两种仅 text 层，rect 上得 EFFECT_UNSUPPORTED 警告且被忽略）。",
      "- exit 原路返回：slide-down 退场 = 向上离开（方向词描述进入路径）。",
      "- 时间窗：in 必须 < 场景 duration；out 必须 > in 且 ≤ duration；exit 从 out − delay − duration 开始。",
      "- 相机 4 种：static / push-in / pull-out / pan；过渡 3 种：cut / crossfade / fade-black（后两者产生重叠，吃后场景时长）。",
      "- 缓动 11 个合法名：linear、easeInQuad、easeOutQuad、easeInOutQuad、easeInCubic、easeOutCubic、easeInOutCubic、easeOutExpo、easeOutBack、spring、bounce。",
      "- 设计守则：帧零有墨、1 秒内可读钩子、列表 stagger 0.3-0.45s、结尾静止 ≥0.8s、静音也要成立。",
      "",
      "# 修复循环纪律",
      "- compile.run 失败 → 读 diagnostics 的错误码与位置 → 每轮只改一处 → 再编译（最多 3 轮；仍失败则带上诊断原文汇报求助）。",
      "- render.preview 至少检查三帧：第 1 帧、钩子帧、结尾帧；test.run 全绿才 render.final。",
      "- 诊断仍看不懂时：dsl.reference 查 diagnostics 主题（错误码语义与修复办法）。",
      "",
      "# 汇报风格",
      "- 每完成一步用一两句话简洁汇报结果（中文），不要粘贴大段 JSON。",
      "- 全部完成后给中文总结：做了什么、产物在哪（预览帧 / 视频路径）、下一步建议。",
      "",
      "# 当前项目",
      `- 名称：${ps.project.manifest.name}`,
      `- 根目录：${ps.project.root}`,
      `- 入口文件：${ps.project.manifest.entry}`,
    ];
    // VIR 摘要（best-effort：项目暂不可编译时静默跳过）
    const compile = await ps.session.ensureCompiled().catch(() => null);
    if (compile !== null) {
      sections.push(
        `- 场景数：${compile.vir.scenes.length}（总时长 ${compile.vir.meta.duration}s / ${compile.semantic.totalFrames} 帧 @ ${compile.vir.meta.fps}fps）`,
      );
    }
    // 技能段（issue #52）：@引用强制包含 + autoTrigger 关键词匹配 → 技能块（目标/配方/工作流/反模式摘要）+ 启用技能花名册
    const skills = await loadSkills(values.skills.customDir);
    const skillLines = composeSkillSection({
      message,
      skills,
      enabled: values.skills.enabled,
      autoTrigger: values.skills.autoTrigger,
      injectRecipes: values.skills.injectRecipes,
    });
    if (skillLines.length > 0) sections.push("", ...skillLines);
    sections.push("", "# 约束", `- 本轮最多 ${maxSteps} 个步骤（LLM 回合），合理安排节奏；工具失败优先修复而不是放弃。`);
    return sections.join("\n");
  }
}

/** maxSteps 归一：正整数 + 硬上限 30 */
function clampMaxSteps(value: number): number {
  const n = Number.isFinite(value) ? Math.floor(value) : 1;
  return Math.max(1, Math.min(n, MAX_STEPS_CAP));
}
