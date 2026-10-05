// ServerError：@videoos/server 统一错误类型（自 state.ts 拆出，供 settings 等子模块复用）。
// code 命名空间约定：SERVER_*（HTTP API）、SETTINGS_*（设置中心）。
// message 统一 `${code}: ${detail}` 前缀 → app.onError 映射状态码 + {error} 响应。
export class ServerError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(code: string, message: string, status = 400) {
    super(`${code}: ${message}`);
    this.name = "ServerError";
    this.code = code;
    this.status = status;
  }
}
