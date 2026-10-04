// @videoos/agent — Agent Runtime + Model Router + VAP 工具 + 会话装配（SPEC §6/§7）
// 消费方：packages/mcp（stdio JSON-RPC → registry.list()/call()）、apps/cli（videoos agent exec）、
//        packages/server（Studio Agent 面板，VapEvent 流）。
export type {
  ChatMessage, ChatOptions, ChatResponse, ChatRole, ChatUsage,
  ModelProvider, ProviderCapabilities, ToolCallRequest, ToolDefinition,
} from "./providers/types";
export { ProviderError, normalizeBaseUrl } from "./providers/types";
export { OpenAICompatibleProvider, toOpenAiMessages, toOpenAiTools } from "./providers/openai-compatible";
export type { OpenAICompatibleOptions } from "./providers/openai-compatible";
export { AnthropicProvider, toAnthropicMessages, toAnthropicTools } from "./providers/anthropic";
export type { AnthropicOptions } from "./providers/anthropic";
export { ManualProvider } from "./providers/manual";
export type { ManualScriptStep, ManualProviderOptions } from "./providers/manual";
export { loadProviderConfig, createProvider, createProvidersFromEnv, providerKeyEnvName } from "./providers/config";
export type { ProviderConfig, ProviderType } from "./providers/config";

export { ModelRouter, RouterError, DEFAULT_ROUTER_RULES } from "./router";
export type { RouterRule, RouterTask } from "./router";

export { AgentMemory } from "./memory";
export type { FailureEntry } from "./memory";

export { zodToJsonSchema } from "./schema";

export {
  createVapContext, asVapSession, prettyCanonicalJson, SessionError,
} from "./session";
export type {
  CreateVapContextOptions, TransactionHandle, VapContext, VapEvent, VapEventBus, VapEventInput, VapSession, WorkspaceLike,
} from "./session";

export { VapToolRegistry, createDefaultTools, VapRegistryError } from "./vap/registry";
export type { DefaultToolsOptions, VapTool, VapToolArgs, VapToolInfo, VapToolResult } from "./vap/registry";
export type { EditOutcome, Span } from "./vap/tools-scene";
export { applySceneModify, applyLayerModify, applyAudioSet } from "./vap/tools-scene";
export type { SceneOperation } from "./vap/tools-scene";
export { templateShots, shotsToScenesCode, ShotSchema } from "./vap/tools-storyboard";
export type { Shot, StoryboardGenerator, StoryboardToolOptions } from "./vap/tools-storyboard";

export { AgentExecutor, DEFAULT_SYSTEM_PROMPT } from "./executor";
export type { AgentExecutorDeps, AgentRunResult, AgentStep } from "./executor";

// 测试/演示支持（生产请使用 @videoos/workspace 的 ProjectWorkspace）
export { createTestWorkspace, listDirOrNull } from "./testkit";
