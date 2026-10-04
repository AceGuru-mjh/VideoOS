// @videoos/mcp — MCP stdio 服务器（SPEC §8）。
// 自实现 JSON-RPC 2.0 逐行协议（protocol.ts）+ 方法路由（server.ts）+ 会话管理（session-mgr.ts），
// 不依赖官方 SDK。VAP 工具注册表（@videoos/agent VapToolRegistry）自动映射为 MCP tools。
// 消费方：apps/cli（`videoos mcp [--project <path>]`）、packages/server（M8 透传）。
import { join } from "node:path";
import { ProjectWorkspace } from "@videoos/workspace";
import { createVapContext, createDefaultTools, VapToolRegistry } from "@videoos/agent";
import type { WorkspaceLike } from "@videoos/agent";
import { runStdioServer } from "./server";
import type { McpServerOptions } from "./server";

export {
  JsonRpcErrorCodes,
  errorResponse,
  isJsonRpcNotification,
  isJsonRpcRequest,
  isJsonRpcResponse,
  readMessages,
  resultResponse,
  writeMessage,
} from "./protocol";
export type { JsonRpcError, JsonRpcMessage, JsonRpcNotification, JsonRpcRequest, JsonRpcResponse, MessageWritable } from "./protocol";

export { LATEST_PROTOCOL_VERSION, McpServer, runStdioServer } from "./server";
export type { McpServerDeps, McpServerOptions, McpToolDeps } from "./server";

export { SessionManager } from "./session-mgr";
export type { SessionStats } from "./session-mgr";

/**
 * ProjectWorkspace（@videoos/workspace）→ WorkspaceLike（@videoos/agent 结构契约）。
 * memory 的 read/write 映射为 readMemory/writeMemory；transactions 直接复用（结构兼容）。
 */
export function projectToWorkspace(project: ProjectWorkspace): WorkspaceLike {
  return {
    root: project.root,
    readMemory: (name: string) => project.memory.read(name),
    writeMemory: (name: string, data: unknown) => project.memory.write(name, data),
    transactions: project.transactions,
  };
}

/**
 * 打开项目 → VapContext → 全量 VAP 工具 → MCP stdio 循环（`videoos mcp` / test-server 共用装配）。
 * 项目打不开（WORKSPACE_NOT_FOUND 等）→ 直接抛 WorkspaceError（调用方决定退出码与提示）。
 */
export async function startProjectMcpServer(projectRoot: string, options?: McpServerOptions): Promise<void> {
  const project = await ProjectWorkspace.open(projectRoot);
  const entryPath = join(project.root, project.manifest.entry);
  const context = await createVapContext({
    workspace: projectToWorkspace(project),
    entryPath,
  });
  const registry = new VapToolRegistry();
  for (const tool of createDefaultTools()) registry.register(tool);
  await runStdioServer({ tools: registry, getContext: async () => context }, options);
}
