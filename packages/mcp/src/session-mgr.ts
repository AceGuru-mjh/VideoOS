// MCP 会话管理：VapContext 的惰性单例化 + 每连接统计。
// McpServerDeps.getContext 由本类背书：首次 tools/call 才装配上下文（打开项目/加载 entry），
// 之后复用同一实例（renderer/compile 缓存跨请求生效）。

export interface SessionStats {
  /** tools/call 总次数 */
  toolCalls: number;
  /** 工具返回 ok=false 的次数 */
  toolErrors: number;
  /** 上下文装配次数（应为 1；>1 表示发生过 reset） */
  contextCreations: number;
}

export class SessionManager {
  private readonly create: () => Promise<unknown>;
  private cached: unknown | undefined;
  private inflight: Promise<unknown> | null = null;
  private readonly stats: SessionStats = { toolCalls: 0, toolErrors: 0, contextCreations: 0 };

  constructor(create: () => Promise<unknown>) {
    this.create = create;
  }

  /** 上下文（惰性创建 + 并发去重 + 之后复用） */
  async context(): Promise<unknown> {
    if (this.cached !== undefined) return this.cached;
    if (this.inflight === null) {
      this.inflight = (async () => {
        this.stats.contextCreations++;
        const ctx = await this.create();
        this.cached = ctx;
        this.inflight = null;
        return ctx;
      })();
    }
    return this.inflight;
  }

  /** 记录一次工具调用（McpServer 在每次 tools/call 前调用） */
  recordToolCall(): void {
    this.stats.toolCalls++;
  }

  /** 记录一次失败的工具调用 */
  recordToolError(): void {
    this.stats.toolErrors++;
  }

  /** 丢弃缓存上下文（错误恢复/测试用；下次 context() 重新装配） */
  reset(): void {
    this.cached = undefined;
    this.inflight = null;
  }

  get statistics(): Readonly<SessionStats> {
    return { ...this.stats };
  }
}
