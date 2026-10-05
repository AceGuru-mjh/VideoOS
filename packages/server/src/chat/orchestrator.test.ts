// ChatOrchestrator 模块级测试（无 HTTP）：真实 ServerState（独立 dataDir）+ ManualProvider 注入。
// fixture 项目建于 <repo>/.tmp-orch-<pid>/（repo 子树内 → DSL 工作区解析可用）。
// 事件采集走 state.hub.recent()（EventHub 环形缓冲记录全部广播，无需真实 WS 客户端）。
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  ManualProvider,
  type ChatMessage,
  type ChatOptions,
  type ChatResponse,
  type ManualScriptStep,
  type ModelProvider,
} from "@videoos/agent";
import { ProjectWorkspace, createProjectTemplate } from "@videoos/workspace";
import { ServerState } from "../state";
import { OrchestratorBusyError } from "./orchestrator";
import type { AgentEventPayload, SessionMessage } from "./types";

const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..", "..");
const FIXTURE_ROOT = join(REPO_ROOT, `.tmp-orch-${process.pid}`);
const PROJECT_ROOT = join(FIXTURE_ROOT, "demo");

/** 指定步挂起的 ManualProvider（stop / busy 确定性测试） */
class GatedManualProvider extends ManualProvider {
  chatCalls = 0;
  private readonly gateAt: number;
  private releaseGate: (() => void) | null = null;

  constructor(opts: { script: ManualScriptStep[]; gateAt: number }) {
    super({ script: opts.script });
    this.gateAt = opts.gateAt;
  }

  override async chat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResponse> {
    this.chatCalls++;
    if (this.chatCalls === this.gateAt) {
      await new Promise<void>((res) => {
        this.releaseGate = res;
      });
    }
    return super.chat(messages, opts);
  }

  release(): void {
    this.releaseGate?.();
  }
}

/** 每个用例独立的临时 dataDir（afterAll 统一清理） */
const dataDirs: string[] = [];

function newState(providerFactory?: () => ModelProvider[]): ServerState {
  const dataDir = mkdtempSync(join(tmpdir(), "videoos-orch-"));
  dataDirs.push(dataDir);
  return new ServerState({
    dataDir,
    ...(providerFactory !== undefined ? { agentProviderFactory: providerFactory } : {}),
  });
}

/** hub 环形缓冲中的 agent-message 事件 */
function agentMessages(state: ServerState): AgentEventPayload[] {
  return state.hub.recent().flatMap((e) => (e.type === "agent-message" ? [e] : []));
}

/** 轮询直到条件满足（默认 10s 超时） */
async function waitFor<T>(probe: () => T | undefined, what = "condition", timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`waitFor timeout: ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

function findDone(state: ServerState, sessionId: string, runId: string): AgentEventPayload | undefined {
  return agentMessages(state).find((e) => e.kind === "done" && e.sessionId === sessionId && e.runId === runId);
}

function assistantOf(state: ServerState, runId: string): SessionMessage | undefined {
  for (const session of state.sessions.list()) {
    const full = state.sessions.get(session.id);
    const found = full?.messages.find((m) => m.runId === runId);
    if (found !== undefined) return found;
  }
  return undefined;
}

beforeAll(async () => {
  await rm(FIXTURE_ROOT, { recursive: true, force: true });
  await ProjectWorkspace.init(PROJECT_ROOT, { name: "demo" });
  await createProjectTemplate(PROJECT_ROOT, "demo");
});

afterAll(async () => {
  await rm(FIXTURE_ROOT, { recursive: true, force: true });
  for (const dir of dataDirs) await rm(dir, { recursive: true, force: true });
});

describe("ChatOrchestrator 全链路", () => {
  test("多轮 run：文本/工具/任务卡/usage 持久化 + 会话项目绑定回填", async () => {
    const script: ManualScriptStep[] = [
      { content: "正在规划你的视频…", toolCalls: [{ id: "t1", name: "scene.list", arguments: {} }] },
      { content: "完成 — 已列出全部场景。" },
    ];
    const state = newState(() => [new ManualProvider({ script })]);
    await state.open(PROJECT_ROOT); // IDE 打开项目；会话 projectRoot 为 null → 运行时绑定

    const session = state.sessions.create({});
    const started = state.orchestrator.start(session.id, "帮我看看项目里有哪些场景");
    expect(started.runId).toMatch(/^r_/);
    expect(started.userMessageId).toMatch(/^m_/);

    const done = await waitFor(() => findDone(state, session.id, started.runId), "run done");
    expect(done.ok).toBe(true);
    expect(done.stopped).toBeUndefined();
    expect(done.messageId).toBeString();
    expect(state.orchestrator.isRunning(session.id)).toBe(false);

    // 事件序列
    const events = agentMessages(state).filter((e) => e.runId === started.runId);
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("text");
    expect(kinds).toContain("tool-start");
    expect(kinds).toContain("tool-end");
    expect(kinds).toContain("card");
    const toolEnd = events.find((e) => e.kind === "tool-end");
    expect(toolEnd?.toolResult?.name).toBe("scene.list");
    expect(toolEnd?.toolResult?.ok).toBe(true);
    expect(toolEnd?.toolResult?.durationMs).toBeGreaterThanOrEqual(0);

    // 会话持久化
    const finalSession = state.sessions.require(session.id);
    expect(finalSession.projectRoot).toBe(PROJECT_ROOT); // null → IDE 项目回填绑定
    expect(finalSession.messages.find((m) => m.id === started.userMessageId)?.role).toBe("user");

    const assistant = assistantOf(state, started.runId);
    expect(assistant).toBeDefined();
    expect(assistant?.content).toContain("正在规划");
    expect(assistant?.content).toContain("完成 — 已列出全部场景");
    expect(assistant?.usage).toEqual({ promptTokens: 0, completionTokens: 0 }); // ManualProvider 无 usage → 0 累计
    expect(assistant?.artifacts ?? []).toEqual([]);
    expect(assistant?.toolCalls?.[0]?.name).toBe("scene.list");
    expect(assistant?.toolCalls?.[0]?.ok).toBe(true);

    const cards = assistant?.taskCards ?? [];
    const cardSteps = cards.map((c) => c.step);
    expect(cardSteps).toEqual(["plan", "scene.list", "respond"]); // 发射顺序
    for (const card of cards) {
      expect(card.status).toBe("done");
      expect(card.durationMs).toBeGreaterThanOrEqual(0);
      expect(card.startedAt).toBeString();
    }
    expect(cards[0]?.id).toMatch(new RegExp(`^c_${started.runId}_`)); // 卡片 id 关联 runId
  }, 20_000);

  test("会话直接绑定项目（不经 IDE open）：render.preview 产物提取", async () => {
    const script: ManualScriptStep[] = [
      { toolCalls: [{ id: "t1", name: "compile.run", arguments: {} }] },
      { toolCalls: [{ id: "t2", name: "render.preview", arguments: { frame: 30 } }] },
      { content: "预览已生成。" },
    ];
    const state = newState(() => [new ManualProvider({ script })]);
    const session = state.sessions.create({ projectRoot: PROJECT_ROOT });

    const started = state.orchestrator.start(session.id, "编译并给我看第 30 帧");
    const done = await waitFor(() => findDone(state, session.id, started.runId), "run done");
    expect(done.ok).toBe(true);

    const events = agentMessages(state).filter((e) => e.runId === started.runId);
    const previewEnd = events.find((e) => e.kind === "tool-end" && e.toolResult?.name === "render.preview");
    expect(previewEnd?.toolResult?.ok).toBe(true);
    expect(previewEnd?.toolResult?.artifact?.type).toBe("preview-frame");
    expect((previewEnd?.toolResult?.artifact?.pngBase64 ?? "").length).toBeGreaterThan(100);

    const assistant = assistantOf(state, started.runId);
    const artifact = (assistant?.artifacts ?? []).find((a) => a.type === "preview-frame");
    expect(artifact?.title).toBe("preview");
    expect((artifact?.pngBase64 ?? "").length).toBeGreaterThan(100);
    // 任务卡携带同一产物
    const previewCard = (assistant?.taskCards ?? []).find((c) => c.step === "render.preview");
    expect(previewCard?.status).toBe("done");
    expect(previewCard?.artifacts?.[0]?.type).toBe("preview-frame");
    // compile.run 不产 artifact
    expect((assistant?.artifacts ?? []).some((a) => a.type === "qa" || a.type === "video")).toBe(false);
  }, 30_000);

  test("stop：步边界中止，保留已完成步骤，丢弃中止后到达的响应", async () => {
    const script: ManualScriptStep[] = [
      { content: "先看看场景。", toolCalls: [{ id: "t1", name: "scene.list", arguments: {} }] },
      { content: "这段不应被采纳。" },
    ];
    // 工厂每次创建新实例：数组按序追踪（闭包内 let 赋值会被 TS 控制流收窄误判）
    const created: GatedManualProvider[] = [];
    const state = newState(() => {
      created.push(new GatedManualProvider({ script, gateAt: 2 })); // 第 2 次 chat 挂起
      return [created[created.length - 1]!];
    });
    const session = state.sessions.create({ projectRoot: PROJECT_ROOT });

    const started = state.orchestrator.start(session.id, "列出场景");
    await waitFor(() => (created[0] !== undefined && created[0].chatCalls >= 2 ? created[0] : undefined), "provider gated at step 2");

    // 活动期状态 + stop 语义
    expect(state.orchestrator.isRunning(session.id)).toBe(true);
    expect(state.orchestrator.activeRun(session.id)).toBe(started.runId);
    expect(state.orchestrator.stop(started.runId)).toBe(true);
    expect(state.orchestrator.stop("r_unknown")).toBe(false); // 未知 run → false（HTTP 层 404）

    created[0].release();
    const done = await waitFor(() => findDone(state, session.id, started.runId), "stopped run done");
    expect(done.stopped).toBe(true);
    expect(done.ok).toBe(true);
    expect(state.orchestrator.isRunning(session.id)).toBe(false);

    const assistant = assistantOf(state, started.runId);
    expect(assistant?.stopped).toBe(true);
    expect(assistant?.content).toContain("先看看场景。");
    expect(assistant?.content).not.toContain("这段不应被采纳。"); // 中止后到达的响应不落盘
    const cardSteps = (assistant?.taskCards ?? []).map((c) => c.step);
    expect(cardSteps).toContain("scene.list");
    expect(cardSteps).not.toContain("respond"); // 未走到最终回复
    for (const card of assistant?.taskCards ?? []) expect(card.status).toBe("done");
  }, 20_000);

  test("工具权限显式 deny：结果 ok:false 带 PERMISSION_DENIED，循环继续到最终文本", async () => {
    const script: ManualScriptStep[] = [
      { toolCalls: [{ id: "t1", name: "scene.list", arguments: {} }] },
      { content: "工具被拒了，我直接说明情况。" },
    ];
    const state = newState(() => [new ManualProvider({ script })]);
    state.settings.update({ agent: { toolPermissions: { "scene.list": "deny" } } });
    const session = state.sessions.create({ projectRoot: PROJECT_ROOT });

    const started = state.orchestrator.start(session.id, "列出场景");
    const done = await waitFor(() => findDone(state, session.id, started.runId), "run done");
    expect(done.ok).toBe(true); // 工具被拒不打断循环

    const events = agentMessages(state).filter((e) => e.runId === started.runId);
    const toolEnd = events.find((e) => e.kind === "tool-end");
    expect(toolEnd?.toolResult?.ok).toBe(false);
    expect(toolEnd?.toolResult?.summary ?? "").toContain("PERMISSION_DENIED");

    const assistant = assistantOf(state, started.runId);
    expect(assistant?.content).toContain("工具被拒了"); // 模型拿到失败结果后继续输出最终文本
    expect(assistant?.error).toBeUndefined();
    const sceneCard = (assistant?.taskCards ?? []).find((c) => c.step === "scene.list");
    expect(sceneCard?.status).toBe("failed");
    expect(assistant?.toolCalls?.[0]?.ok).toBe(false);
  }, 20_000);

  test("同一会话并发 run → OrchestratorBusyError；结束后可再次启动", async () => {
    const script: ManualScriptStep[] = [{ content: "第一轮回答。" }];
    // 工厂每次创建新实例：按创建序号追踪，避免外层变量仍指向旧实例的竞态
    const created: GatedManualProvider[] = [];
    const state = newState(() => {
      const p = new GatedManualProvider({ script, gateAt: 1 });
      created.push(p);
      return [p];
    });
    const session = state.sessions.create({ projectRoot: PROJECT_ROOT });

    const first = state.orchestrator.start(session.id, "第一问");
    await waitFor(() => (created[0] !== undefined && created[0].chatCalls >= 1 ? created[0] : undefined), "run1 gated");
    expect(() => state.orchestrator.start(session.id, "第二问")).toThrow(OrchestratorBusyError);
    // 其他会话不受影响（同样挂起，稍后统一放行收口）
    const other = state.sessions.create({ projectRoot: PROJECT_ROOT });
    const otherRun = state.orchestrator.start(other.id, "别的问题");
    await waitFor(() => (created[1] !== undefined && created[1].chatCalls >= 1 ? created[1] : undefined), "run-other gated");

    created[0].release();
    const firstDone = await waitFor(() => findDone(state, session.id, first.runId), "first done");
    expect(firstDone.ok).toBe(true);
    expect(state.orchestrator.isRunning(session.id)).toBe(false);

    created[1].release();
    await waitFor(() => findDone(state, other.id, otherRun.runId), "other done");

    // 结束后同会话可再次启动（新一轮从脚本头部回放）
    const second = state.orchestrator.start(session.id, "再来一次");
    await waitFor(() => (created[2] !== undefined && created[2].chatCalls >= 1 ? created[2] : undefined), "run2 gated");
    created[2].release();
    const secondDone = await waitFor(() => findDone(state, session.id, second.runId), "second done");
    expect(secondDone.ok).toBe(true);
  }, 20_000);

  test("无项目上下文：SERVER_NO_PROJECT 快速失败（error 事件 + 消息 error 回填）", async () => {
    const state = newState(() => [new ManualProvider({ script: [{ content: "x" }] })]);
    const session = state.sessions.create({}); // projectRoot null 且未 open 任何项目

    const started = state.orchestrator.start(session.id, "做个视频");
    const done = await waitFor(() => findDone(state, session.id, started.runId), "no-project fail");
    expect(done.ok).toBe(false);

    const events = agentMessages(state).filter((e) => e.runId === started.runId);
    const error = events.find((e) => e.kind === "error");
    expect(error?.error ?? "").toContain("SERVER_NO_PROJECT");

    const assistant = assistantOf(state, started.runId);
    expect(assistant?.error ?? "").toContain("SERVER_NO_PROJECT");
    expect(assistant?.content).toBe("");
  }, 20_000);
});
