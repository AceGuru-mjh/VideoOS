// 对话子系统公共类型（#49–#53 契约层）：会话/消息/任务卡/artifact/WS agent 事件。
// 消费方：chat/sessions.ts（持久化）、chat/orchestrator.ts（编排写入）、
//        app.ts（REST 透传）、apps/studio（渲染协议）。
import type { ChatUsage } from "@videoos/agent";

// ---------------------------------------------------------------------------
// artifact：assistant 消息内联的可视化产物（#51）
// ---------------------------------------------------------------------------

export type ChatArtifactType = "code" | "preview-frame" | "qa" | "video" | "text";

export interface ChatArtifact {
  type: ChatArtifactType;
  /** 展示标题（如 "src/video.ts"、"preview · frame 42"、"QA report"） */
  title?: string;
  /** type=code/text：正文内容 */
  content?: string;
  /** type=code：语法高亮语言标记（默认 ts） */
  language?: string;
  /** type=preview-frame：PNG base64（render.preview 直出，免二次请求） */
  pngBase64?: string;
  /** type=qa：test.run 报告（序列化安全形状） */
  report?: unknown;
  /** type=video：render.final 产物绝对路径（UI 经 /renders/<basename> 播放） */
  path?: string;
}

// ---------------------------------------------------------------------------
// 任务卡：Agent 每步一张（规划→DSL→编译→预览→QA→渲染），状态徽章 + 耗时
// ---------------------------------------------------------------------------

export type TaskCardStatus = "pending" | "running" | "done" | "failed";

export interface TaskCardEntry {
  id: string;
  /** 步骤标识：工具名（compile.run）或保留字 plan/respond */
  step: string;
  /** 人类可读标签（协议层稳定英文键，UI 负责本地化展示） */
  label: string;
  status: TaskCardStatus;
  startedAt?: string;
  durationMs?: number;
  artifacts?: ChatArtifact[];
}

// ---------------------------------------------------------------------------
// 消息与会话
// ---------------------------------------------------------------------------

export interface ChatUsageMeta {
  promptTokens: number;
  completionTokens: number;
}

/** 工具调用记录（assistant 消息元数据；summary 供时间线回放） */
export interface ChatToolCallRecord {
  name: string;
  ok: boolean;
  durationMs: number;
  summary?: string;
}

export interface SessionMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  /** 产生该消息的 agent 运行（assistant 消息） */
  runId?: string;
  artifacts?: ChatArtifact[];
  taskCards?: TaskCardEntry[];
  toolCalls?: ChatToolCallRecord[];
  usage?: ChatUsageMeta;
  /** 运行失败时的错误摘要 */
  error?: string;
  /** 用户中断（保留已完成步骤） */
  stopped?: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
  /** 绑定的 videoos 项目根（null = 尚未绑定） */
  projectRoot: string | null;
  createdAt: string;
  updatedAt: string;
  messages: SessionMessage[];
}

/** GET /api/sessions 列表项 */
export interface SessionSummary {
  id: string;
  title: string;
  projectRoot: string | null;
  updatedAt: string;
  messageCount: number;
}

// ---------------------------------------------------------------------------
// WS agent 频道事件（EventHub 广播；UI 按 sessionId+runId 过滤）
// ---------------------------------------------------------------------------

export type AgentEventKind = "text" | "tool-start" | "tool-end" | "card" | "done" | "error";

export interface AgentToolStart {
  name: string;
  args?: unknown;
}

export interface AgentToolEnd {
  name: string;
  ok: boolean;
  durationMs: number;
  summary?: string;
  artifact?: ChatArtifact;
}

/** agent-message 事件负载（与 ServerEvent 的 { type: "agent-message" } 载荷同形） */
export interface AgentEventPayload {
  sessionId: string;
  runId: string;
  kind: AgentEventKind;
  /** kind=text：assistant 文本增量 */
  text?: string;
  /** kind=tool-start */
  tool?: AgentToolStart;
  /** kind=tool-end */
  toolResult?: AgentToolEnd;
  /** kind=card：任务卡状态翻转 */
  card?: TaskCardEntry;
  /** kind=done */
  ok?: boolean;
  stopped?: boolean;
  usage?: ChatUsageMeta;
  /** assistant 消息 id（done 时 UI 可整条刷新兜底） */
  messageId?: string;
  /** kind=error */
  error?: string;
}

/** ChatUsage（provider 原始）→ ChatUsageMeta（会话累计元数据） */
export function toUsageMeta(usage: ChatUsage | undefined): ChatUsageMeta {
  return { promptTokens: usage?.promptTokens ?? 0, completionTokens: usage?.completionTokens ?? 0 };
}

/** 任务卡标签查表（协议层稳定英文键；studio 端经 i18n 映射中英） */
export const TASK_CARD_LABELS: Record<string, string> = {
  plan: "Plan",
  respond: "Respond",
  "storyboard.plan": "Storyboard",
  "storyboard.toScenes": "Draft scenes",
  "scene.modify": "Edit scenes",
  "layer.modify": "Edit layers",
  "asset.add": "Add asset",
  "compile.run": "Compile",
  "compile.diagnostics": "Diagnostics",
  "render.preview": "Preview",
  "test.run": "QA",
  "render.final": "Render",
  "render.range": "Render range",
};

export function taskCardLabel(step: string): string {
  return TASK_CARD_LABELS[step] ?? step;
}
