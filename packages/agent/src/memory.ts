// Agent Memory（SPEC §6.1）：项目级事实（.video/memory/project.json）与失败记忆（failure.json）。
// 存储经 WorkspaceLike.readMemory/writeMemory 间接落盘（具体路径布局由 workspace 包决定，
// 约定名："project" → { facts: {...} }，"failure" → Array<FailureEntry>）。
import type { WorkspaceLike } from "./session";

export interface FailureEntry {
  task: string;
  error: string;
  hint?: string;
  at: string;
}

interface ProjectMemoryFile {
  facts?: Record<string, unknown>;
}

export class AgentMemory {
  constructor(private readonly workspace: WorkspaceLike) {}

  /** 记住一条项目事实（分辨率/风格/品牌色等；合并写回） */
  async rememberFact(key: string, value: unknown): Promise<void> {
    if (typeof key !== "string" || key.length === 0) {
      throw new Error("AgentMemory.rememberFact: key must be a non-empty string");
    }
    const file = (await this.workspace.readMemory("project") ?? {}) as ProjectMemoryFile;
    const facts: Record<string, unknown> = { ...(file.facts ?? {}) };
    facts[key] = value;
    await this.workspace.writeMemory("project", { facts });
  }

  /** 全部项目事实（无记录返回 {}） */
  async recallFacts(): Promise<Record<string, unknown>> {
    const file = (await this.workspace.readMemory("project") ?? {}) as ProjectMemoryFile;
    return { ...(file.facts ?? {}) };
  }

  /** 记录一次失败（task=触发任务/工具，error=错误摘要，hint=下次预检建议；at 缺省当前时间） */
  async recordFailure(entry: { task: string; error: string; hint?: string; at?: string }): Promise<void> {
    const failures = await this.readFailures();
    failures.push({
      task: entry.task,
      error: entry.error,
      ...(entry.hint !== undefined ? { hint: entry.hint } : {}),
      at: entry.at ?? new Date().toISOString(),
    });
    await this.workspace.writeMemory("failure", failures);
  }

  /** 最近 limit 条失败记录（按时间序返回最后 N 条；limit 缺省全部） */
  async recallFailures(limit?: number): Promise<FailureEntry[]> {
    const failures = await this.readFailures();
    if (limit === undefined || limit >= failures.length) return failures;
    if (limit <= 0) return [];
    return failures.slice(failures.length - limit);
  }

  private async readFailures(): Promise<FailureEntry[]> {
    const raw = await this.workspace.readMemory("failure");
    if (raw === null || raw === undefined) return [];
    if (!Array.isArray(raw)) return [];
    return raw as FailureEntry[];
  }
}
