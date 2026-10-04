// WorkspaceError：@videoos/workspace 统一错误类型。
// code 命名空间约定：
//   WORKSPACE_* —— 工作区/清单/memory 相关（含 WORKSPACE_MANIFEST_INVALID，语义即任务契约中的 MANIFEST_INVALID）
//   TX_*        —— 事务相关（任务契约指定 TX_ALREADY_ACTIVE；其余事务码沿用 TX_ 前缀）
// message 统一 `${code}: ${detail}` 前缀（与 RENDER_*/CACHE_*/ENCODE_* 各包错误约定一致，便于 toThrow(/CODE/) 匹配）。
export class WorkspaceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "WorkspaceError";
    this.code = code;
  }
}
