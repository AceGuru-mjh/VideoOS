// Model Router（SPEC §6.2）：任务类型 → 规则 prefer 顺序 → 已注册 provider → fallback。
import type { ModelProvider } from "./providers/types";

export type RouterTask = "code" | "vision" | "fast" | "default";

export interface RouterRule {
  task: RouterTask;
  /** prefer = provider ids，按序查找已注册 provider */
  prefer: string[];
}

export class RouterError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "RouterError";
    this.code = code;
  }
}

/** 默认规则：无（任何任务都直接 fallback 到第一个注册的 provider） */
export const DEFAULT_ROUTER_RULES: RouterRule[] = [];

export class ModelRouter {
  private readonly providers = new Map<string, ModelProvider>();
  private readonly rules: RouterRule[];

  constructor(providers: ModelProvider[], rules: RouterRule[] = DEFAULT_ROUTER_RULES) {
    this.rules = rules;
    for (const p of providers) this.register(p);
  }

  /** 注册 provider（id 重复 → 后者覆盖前者；Map 语义保持首次插入序） */
  register(p: ModelProvider): void {
    this.providers.set(p.id, p);
  }

  /** 已注册的 provider 列表（插入序） */
  list(): ModelProvider[] {
    return [...this.providers.values()];
  }

  /** 按 id 查找 */
  get(id: string): ModelProvider | undefined {
    return this.providers.get(id);
  }

  /**
   * 路由：命中规则的 prefer 顺序找已注册 provider（第一个存在的）；
   * 无规则/规则未命中/任务缺省 → fallback 第一个注册的 provider；
   * 无 provider → RouterError("PROVIDER_NONE")。
   */
  route(task: RouterTask = "default"): ModelProvider {
    if (this.providers.size === 0) {
      throw new RouterError("PROVIDER_NONE", "no model provider registered; configure VIDEOOS_PROVIDERS or register manually");
    }
    const rule = this.rules.find((r) => r.task === task);
    if (rule !== undefined) {
      for (const id of rule.prefer) {
        const found = this.providers.get(id);
        if (found !== undefined) return found;
      }
    }
    const first = this.providers.values().next().value;
    if (first === undefined) {
      throw new RouterError("PROVIDER_NONE", "no model provider registered");
    }
    return first;
  }
}
