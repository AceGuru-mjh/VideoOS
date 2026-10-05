// ChatOrchestrator（#49）：对话式 Agent 编排。
// 职责：会话消息持久化（SessionStore）+ LLM 多步循环（ModelRouter）+ 工具权限门禁
// （permissions.ts）+ 任务卡/artifact 提取 + WS agent-message 事件流（state.hub）。
// 非阻塞设计：start() 同步返回 runId，运行在后台 void 循环推进；stop() 只置中止位，
// 循环在每个步边界（含首次 provider 调用前）响应，保留已完成的文本与任务卡。
// 工具错误不打断循环（模型读到 ok=false 的结果自我修复）；provider/网络错误整体失败。
import { resolve } from "node:path";
import {
  ModelRouter,
  createProvidersFromEnv,
  type ChatMessage,
  type ModelProvider,
  type ToolCallRequest,
  type ToolDefinition,
  type VapToolResult,
} from "@videoos/agent";
import type { ProjectSession, ServerState } from "../state";
import type { SettingsStore, StudioSettings } from "../settings";
import type { SessionStore } from "./sessions";
import type { SkillService } from "./skills";
import type { McpBridge } from "./mcp-bridge";
import { evaluateToolPermission } from "./permissions";
import {
  taskCardLabel,
  toUsageMeta,
  type AgentEventPayload,
  type ChatArtifact,
  type ChatToolCallRecord,
  type ChatUsageMeta,
  type SessionMessage,
  type TaskCardEntry,
} from "./types";

/** 该会话已有活动 run（app.ts 映射为 409 SERVER_AGENT_BUSY） */
export class OrchestratorBusyError extends Error {
  readonly sessionId: string;
  readonly activeRunId: string;
  constructor(sessionId: string, activeRunId: string) {
    super(`agent run already active for session ${sessionId}${activeRunId.length > 0 ? ` (active run ${activeRunId})` : ""}`);
    this.name = "OrchestratorBusyError";
    this.sessionId = sessionId;
    this.activeRunId = activeRunId;
  }
}

export interface OrchestratorDeps {
  state: ServerState;
  sessions: SessionStore;
  settings: SettingsStore;
  skills: SkillService;
  mcp: McpBridge;
  /** 测试注入；缺省 createProvidersFromEnv() → ModelRouter（默认规则） */
  createProviders?: () => ModelProvider[];
}

/** 活动运行句柄（stop 只翻 abort 位） */
interface RunHandle {
  runId: string;
  sessionId: string;
  abort: boolean;
}

/** 会话绑定项目的 ProjectSession LRU 上限（跨项目多会话防内存膨胀） */
const PROJECT_SESSION_CACHE_MAX = 2;

/** 回传给 provider 的历史消息上限（条数 / 字符预算） */
const HISTORY_MAX_MESSAGES = 20;
const HISTORY_MAX_CHARS = 8_000;

/** 对话式系统提示基底（项目/技能/语言块在运行时拼接） */
const CHAT_SYSTEM_PROMPT_BASE = `你是 VideoOS Studio 的对话式视频创作助手，通过与用户多轮对话，在当前视频项目里完成视频制作。

# 工作方式
- 你是视频创作 agent：通过工具操作项目（编写/修改 DSL 源码、编译、预览、视觉测试、渲染）。
- 每个阶段完成后，用简短的语言向用户汇报进展（做了什么、结论是什么、下一步做什么），不要长篇大论。
- 工具全部返回结构化结果 { ok, data?, error? }；ok=false 时读取 error 自我修复，不要原样重复失败的调用。
- 修改项目内容必须遵守事务工作流：transaction.begin → 修改（storyboard.toScenes / scene.modify / layer.modify）→ compile.run → render.preview 检查 → test.run → 全绿 transaction.commit；测试失败先修复（最多 3 轮），仍失败 transaction.rollback 并向用户说明原因。
- render.final 只在测试全绿后执行。

# 常用工具
- 规划：storyboard.plan（意图→镜头）、storyboard.toScenes（镜头→DSL 代码）
- 修改：scene.modify、layer.modify、asset.add、audio.set
- 验证：compile.run、compile.diagnostics、render.preview、render.range、test.run、check.overflow、check.missingAssets
- 产物：render.final
- 完整清单以本次请求的 tools 参数为准（开启合并时可能包含 MCP 工具）

# 技能
- 若下方提供技能（Skills）指引，优先按其 Workflow 与 QA gates 工作。`;

/** 工具结果 → artifact 提取（仅产物型工具；其余返回 undefined） */
function extractArtifact(toolName: string, result: VapToolResult): ChatArtifact | undefined {
  if (!result.ok || result.data === null || typeof result.data !== "object") return undefined;
  const data = result.data as Record<string, unknown>;
  switch (toolName) {
    case "render.preview":
      return typeof data.pngBase64 === "string" && data.pngBase64.length > 0
        ? { type: "preview-frame", title: "preview", pngBase64: data.pngBase64 }
        : undefined;
    case "test.run":
      return { type: "qa", title: "QA", report: data };
    case "render.final":
      return typeof data.video === "string" && data.video.length > 0
        ? { type: "video", title: "Render", path: data.video }
        : undefined;
    default:
      return undefined;
  }
}

export class ChatOrchestrator {
  private readonly deps: OrchestratorDeps;
  /** runId → 活动运行 */
  private readonly runs = new Map<string, RunHandle>();
  /** 会话绑定项目的 ProjectSession 缓存（root → session，LRU，上限 2） */
  private readonly projectCache = new Map<string, ProjectSession>();

  constructor(deps: OrchestratorDeps) {
    this.deps = deps;
  }

  // ------------------------------------------------------------------ 公开 API

  /**
   * 非阻塞启动一次 agent run：校验会话、拒绝并发、落用户消息与 assistant 占位，
   * 立即返回 runId；后续推进全部经 WS 事件 + sessions.patchMessage 呈现。
   * 抛出：SessionNotFoundError（会话不存在）、OrchestratorBusyError（该会话已有活动 run）。
   */
  start(sessionId: string, message: string): { runId: string; userMessageId: string } {
    this.deps.sessions.require(sessionId);
    const active = this.activeRun(sessionId);
    if (active !== null) throw new OrchestratorBusyError(sessionId, active);

    const runId = `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const userMessage = this.deps.sessions.appendUserMessage(sessionId, message);
    const assistantMessage = this.deps.sessions.appendAssistantMessage(sessionId, runId);
    const handle: RunHandle = { runId, sessionId, abort: false };
    this.runs.set(runId, handle);
    // 后台推进；executeRun 内部兜底全部异常（此处 catch 仅作双保险，绝不未处理 rejection）
    void this.executeRun(handle, message, userMessage.id, assistantMessage.id).catch(() => undefined);
    return { runId, userMessageId: userMessage.id };
  }

  /** 置中止位（循环在步边界响应）；未知/已结束的 run → false */
  stop(runId: string): boolean {
    const run = this.runs.get(runId);
    if (run === undefined) return false;
    run.abort = true;
    return true;
  }

  isRunning(sessionId: string): boolean {
    return this.activeRun(sessionId) !== null;
  }

  activeRun(sessionId: string): string | null {
    for (const run of this.runs.values()) {
      if (run.sessionId === sessionId) return run.runId;
    }
    return null;
  }

  // ------------------------------------------------------------------ 运行主循环

  private async executeRun(
    handle: RunHandle,
    message: string,
    userMessageId: string,
    assistantMessageId: string,
  ): Promise<void> {
    const { sessionId, runId } = handle;

    // ---- 运行期累积状态（finish 时一次性回填消息） ----
    const cards: TaskCardEntry[] = [];
    const artifacts: ChatArtifact[] = [];
    const toolCallRecords: ChatToolCallRecord[] = [];
    const contentParts: string[] = [];
    const usage: ChatUsageMeta = { promptTokens: 0, completionTokens: 0 };
    const cardStarts = new Map<TaskCardEntry, number>();
    let cardSeq = 0;
    let planCard: TaskCardEntry | null = null;
    let respondCard: TaskCardEntry | null = null;
    let finished = false;

    const emit = (payload: Omit<AgentEventPayload, "sessionId" | "runId">): void => {
      const event: { type: "agent-message" } & AgentEventPayload = { type: "agent-message", sessionId, runId, ...payload };
      this.deps.state.hub.emit(event);
    };

    /** 消息回填（会话/消息被并发删除 → 置中止位，事件流照常收口） */
    const patchMessage = (patch: Partial<Omit<SessionMessage, "id" | "role">>): void => {
      try {
        this.deps.sessions.patchMessage(sessionId, assistantMessageId, patch);
      } catch {
        handle.abort = true;
      }
    };

    const cardStart = (step: string): TaskCardEntry => {
      const t0 = Date.now();
      const card: TaskCardEntry = {
        id: `c_${runId}_${cardSeq++}`,
        step,
        label: taskCardLabel(step),
        status: "running",
        startedAt: new Date(t0).toISOString(),
      };
      cards.push(card);
      cardStarts.set(card, t0);
      emit({ kind: "card", card: { ...card } });
      return card;
    };

    const cardSettle = (card: TaskCardEntry, status: "done" | "failed"): void => {
      const t0 = cardStarts.get(card);
      card.status = status;
      card.durationMs = t0 === undefined ? 0 : Math.max(0, Date.now() - t0);
      emit({ kind: "card", card: { ...card } });
    };

    /** 收口（幂等）：任务卡终态 + 消息全量回填 + done 事件 + 注销活动 run */
    const finish = (result: { ok: boolean; stopped?: boolean; error?: string }): void => {
      if (finished) return;
      finished = true;
      if (planCard !== null && planCard.status === "running") {
        cardSettle(planCard, result.ok || result.stopped === true ? "done" : "failed");
      }
      if (respondCard !== null && respondCard.status === "running") cardSettle(respondCard, "done");
      const finalUsage: ChatUsageMeta = { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens };
      patchMessage({
        content: contentParts.join("\n\n"),
        artifacts: [...artifacts],
        taskCards: cards.map((card) => ({ ...card })),
        toolCalls: [...toolCallRecords],
        usage: finalUsage,
        ...(result.stopped === true ? { stopped: true } : {}),
        ...(result.error !== undefined ? { error: result.error } : {}),
      });
      emit({
        kind: "done",
        ok: result.ok,
        ...(result.stopped === true ? { stopped: true } : {}),
        usage: finalUsage,
        messageId: assistantMessageId,
        ...(result.error !== undefined ? { error: result.error } : {}),
      });
      this.runs.delete(runId);
    };

    /** 快速失败：error 事件 + 消息 error 回填 + done(ok:false) */
    const failFast = (code: string, detail: string): void => {
      const error = `${code}: ${detail}`;
      emit({ kind: "error", error });
      finish({ ok: false, error });
    };

    /** 单次工具调用：权限门禁 → VAP/MCP 分发 → 卡片/artifact/事件 → tool 消息回填 */
    const runTool = async (call: ToolCallRequest, mcpNames: Set<string>, chatMessages: ChatMessage[]): Promise<void> => {
      emit({ kind: "tool-start", tool: { name: call.name, args: call.arguments } });
      const card = cardStart(call.name);
      const startedAt = Date.now();

      let result: VapToolResult;
      const decision = evaluateToolPermission({
        toolName: call.name,
        args: call.arguments,
        settings: this.deps.settings.get(),
      });
      if (decision.action === "deny") {
        result = { ok: false, error: decision.reason };
      } else {
        try {
          if (projectSession.registry.get(call.name) !== undefined) {
            result = await projectSession.registry.call(call.name, call.arguments, projectSession.session);
          } else if (mcpNames.has(call.name)) {
            const r = await this.deps.mcp.callTool(call.name, call.arguments);
            result = r.ok
              ? { ok: true, ...(r.data !== undefined ? { data: r.data } : {}) }
              : { ok: false, error: r.error ?? "MCP_CALL_FAILED" };
          } else {
            result = { ok: false, error: `TOOL_NOT_FOUND: ${call.name}` };
          }
        } catch (err) {
          result = { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
      const durationMs = Math.max(0, Date.now() - startedAt);

      const artifact = extractArtifact(call.name, result);
      if (artifact !== undefined) {
        artifacts.push(artifact);
        card.artifacts = [artifact];
      }

      const summary = result.ok
        ? result.data !== undefined
          ? JSON.stringify(result.data).slice(0, 200)
          : "ok"
        : (result.error ?? "failed").slice(0, 200);
      toolCallRecords.push({ name: call.name, ok: result.ok, durationMs, summary });
      // 事件次序契约：tool-start → card(running) → tool-end → card(done|failed)
      // （tool-end 先于卡结算，消费方可依 tool-end 回填耗时后再收卡终态）
      emit({
        kind: "tool-end",
        toolResult: {
          name: call.name,
          ok: result.ok,
          durationMs,
          summary,
          ...(artifact !== undefined ? { artifact } : {}),
        },
      });
      cardSettle(card, result.ok ? "done" : "failed");
      chatMessages.push({
        role: "tool",
        toolCallId: call.id,
        name: call.name,
        content: JSON.stringify(result).slice(0, 4_000),
      });
    };

    let projectSession: ProjectSession;
    try {
      // 步边界 0：stop 可能先于任何 await 到达（确定性中止）
      if (handle.abort) {
        finish({ ok: true, stopped: true });
        return;
      }

      // ---- 项目上下文解析（会话绑定优先，其次 IDE 当前项目；null → 快速失败） ----
      const stored = this.deps.sessions.require(sessionId);
      let root: string | null = stored.projectRoot ?? this.deps.state.projectSession?.project.root ?? null;
      if (root === null) {
        failFast(
          "SERVER_NO_PROJECT",
          "本会话未绑定项目且 IDE 未打开项目；请先 POST /api/project/open，或 PATCH /api/sessions/:id 绑定 projectRoot",
        );
        return;
      }
      root = resolve(root);
      if (stored.projectRoot === null) {
        // 会话尚未绑定但项目已打开 → 回填绑定（后续会话直接复用）
        try {
          this.deps.sessions.patch(sessionId, { projectRoot: root });
        } catch {
          // 绑定失败不阻断本次运行
        }
      }
      projectSession = await this.acquireProjectSession(root);
      if (handle.abort) {
        finish({ ok: true, stopped: true });
        return;
      }

      // ---- provider 装配（工厂注入 / env；空 → 快速失败） ----
      const providers = this.createProvidersSafe();
      if (providers.length === 0) {
        failFast("SERVER_NO_PROVIDER", "未配置模型 Provider（VIDEOOS_PROVIDERS / VIDEOOS_PROVIDER_<ID>_KEY）");
        return;
      }
      const router = new ModelRouter(providers);
      const provider = router.route("default");
      if (handle.abort) {
        finish({ ok: true, stopped: true });
        return;
      }

      // ---- 系统提示 + 会话历史 + 本轮用户消息 ----
      const settings = this.deps.settings.get();
      const systemPrompt = this.buildSystemPrompt(projectSession, message, settings);
      const chatMessages: ChatMessage[] = [
        { role: "system", content: systemPrompt },
        ...this.buildHistory(sessionId, userMessageId, assistantMessageId),
        { role: "user", content: message },
      ];

      // ---- 多步循环（上限 settings.agent.maxSteps） ----
      planCard = cardStart("plan");
      const maxSteps = settings.agent.maxSteps;
      for (let round = 0; round < maxSteps; round++) {
        if (handle.abort) {
          finish({ ok: true, stopped: true });
          return;
        }
        const merged = await this.buildTools(projectSession);
        if (handle.abort) {
          finish({ ok: true, stopped: true });
          return;
        }
        const chatOpts = merged.tools.length > 0 && provider.capabilities.tools ? { tools: merged.tools } : {};
        const response = await provider.chat(chatMessages, chatOpts);
        // 响应到达后、处理前检查中止：中止后到达的半成品不落盘（保留已完成步骤）
        if (handle.abort) {
          finish({ ok: true, stopped: true });
          return;
        }

        if (response.usage !== undefined) {
          const delta = toUsageMeta(response.usage);
          usage.promptTokens += delta.promptTokens;
          usage.completionTokens += delta.completionTokens;
        }
        if (response.content.length > 0) {
          contentParts.push(response.content);
          emit({ kind: "text", text: response.content, messageId: assistantMessageId });
          patchMessage({ content: contentParts.join("\n\n") });
        }

        if (response.toolCalls !== undefined && response.toolCalls.length > 0) {
          chatMessages.push({ role: "assistant", content: response.content, toolCalls: response.toolCalls });
          for (const call of response.toolCalls) {
            await runTool(call, merged.mcpNames, chatMessages);
            if (handle.abort) break; // 工具间也是步边界
          }
          if (handle.abort) {
            finish({ ok: true, stopped: true });
            return;
          }
          continue;
        }

        // 无工具调用 → 最终回复
        respondCard = cardStart("respond");
        cardSettle(respondCard, "done");
        finish({ ok: true });
        return;
      }
      // 步数预算耗尽：按正常完成收口（内容缓冲已含全部轮次文本；executor 同款语义）
      finish({ ok: true });
    } catch (err) {
      failFast("SERVER_RUN_FAILED", err instanceof Error ? err.message : String(err));
    }
  }

  // ------------------------------------------------------------------ 装配辅助

  /** provider 工厂（注入优先）；工厂/env 异常按"无 provider"处理，不炸运行 */
  private createProvidersSafe(): ModelProvider[] {
    try {
      return this.deps.createProviders !== undefined ? this.deps.createProviders() : createProvidersFromEnv();
    } catch {
      return [];
    }
  }

  /** 项目会话获取：IDE 同项目复用 → LRU 缓存 → state.createProjectSession 新建 */
  private async acquireProjectSession(root: string): Promise<ProjectSession> {
    const current = this.deps.state.projectSession;
    if (current !== null && current.project.root === root) return current;
    const cached = this.projectCache.get(root);
    if (cached !== undefined) {
      this.projectCache.delete(root);
      this.projectCache.set(root, cached); // LRU touch
      return cached;
    }
    const created = await this.deps.state.createProjectSession(root);
    this.projectCache.set(root, created);
    while (this.projectCache.size > PROJECT_SESSION_CACHE_MAX) {
      const oldest = this.projectCache.keys().next().value;
      if (oldest === undefined) break;
      this.projectCache.delete(oldest);
    }
    return created;
  }

  /** VAP 工具表 +（mergeTools 开且 host 运行时）MCP 工具（剔除与 VAP 同名冲突项） */
  private async buildTools(ps: ProjectSession): Promise<{ tools: ToolDefinition[]; mcpNames: Set<string> }> {
    const tools: ToolDefinition[] = ps.registry
      .list()
      .map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
    const mcpNames = new Set<string>();
    if (this.deps.settings.get().mcp.mergeTools) {
      const status = await this.deps.mcp.status();
      if (status.running) {
        const vapNames = new Set(tools.map((t) => t.name));
        for (const def of await this.deps.mcp.toolDefinitions()) {
          if (vapNames.has(def.name)) continue;
          mcpNames.add(def.name);
          tools.push({ name: def.name, description: def.description, parameters: def.parameters });
        }
      }
    }
    return { tools, mcpNames };
  }

  /** 系统提示拼接：基底 + ## Project（清单信息，不主动编译）+ ## Skills（@引用/自动触发）+ 语言 */
  private buildSystemPrompt(ps: ProjectSession, message: string, settings: StudioSettings): string {
    const blocks: string[] = [CHAT_SYSTEM_PROMPT_BASE];

    const sceneCount = ps.session.lastCompile?.semantic.scenes.length;
    blocks.push(
      `## Project\n\n- name: ${ps.project.manifest.name}\n- root: ${ps.project.root}\n- entry: ${ps.project.manifest.entry}` +
        (typeof sceneCount === "number" ? `\n- scenes: ${sceneCount}` : ""),
    );

    const refs = this.deps.skills.resolveReferences(message);
    const hasExplicitRefs = refs.skills.length > 0 || refs.unknown.length > 0;
    let skillBlock = "";
    if (hasExplicitRefs) {
      skillBlock = this.deps.skills.buildPromptBlock(refs.skills);
      if (refs.unknown.length > 0) {
        skillBlock += `\n(user referenced unknown skills: ${refs.unknown.join(", ")}; tell the user these skills do not exist)\n`;
      }
    } else {
      skillBlock = this.deps.skills.buildPromptBlock(this.deps.skills.matchAutoTrigger(message));
    }
    if (skillBlock.trim().length > 0) blocks.push(skillBlock.trim());

    blocks.push(`# 语言\n\n用户界面语言为 ${settings.language === "zh" ? "中文" : "English"}，请使用该语言与用户交流。`);
    return blocks.join("\n\n");
  }

  /** 本轮之前的会话历史（user/assistant、仅 content；最近 20 条 / 约 8000 字符预算） */
  private buildHistory(sessionId: string, userMessageId: string, assistantMessageId: string): ChatMessage[] {
    const session = this.deps.sessions.get(sessionId);
    if (session === null) return [];
    const prior = session.messages
      .filter((m) => m.id !== userMessageId && m.id !== assistantMessageId)
      .slice(-HISTORY_MAX_MESSAGES);
    const out: ChatMessage[] = [];
    let budget = HISTORY_MAX_CHARS;
    for (let i = prior.length - 1; i >= 0; i--) {
      const m = prior[i];
      if (m === undefined) break;
      const content = m.content.length > budget ? m.content.slice(0, Math.max(0, budget)) : m.content;
      budget -= content.length;
      out.unshift({ role: m.role, content });
      if (budget <= 0) break;
    }
    return out;
  }
}
