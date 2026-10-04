// ManualProvider：无 LLM 的确定性 provider（测试 / 演示 / 离线回放）。
// 构造时传入脚本序列，chat() 按序消费；耗尽后固定返回 { content: "done" }。
import type { ChatMessage, ChatOptions, ChatResponse, ModelProvider, ProviderCapabilities, ToolCallRequest } from "./types";

/** 脚本条目：content（回复文本）与 toolCalls（工具调用请求）至少其一 */
export interface ManualScriptStep {
  content?: string;
  toolCalls?: ToolCallRequest[];
}

export interface ManualProviderOptions {
  id?: string;
  model?: string;
  script: ManualScriptStep[];
  capabilities?: Partial<ProviderCapabilities>;
}

export class ManualProvider implements ModelProvider {
  readonly id: string;
  readonly model: string;
  readonly capabilities: ProviderCapabilities;
  private readonly script: ManualScriptStep[];
  private cursor = 0;

  constructor(opts: ManualProviderOptions) {
    if (!Array.isArray(opts.script)) {
      throw new Error("ManualProvider: script must be an array of { content?, toolCalls? }");
    }
    this.id = opts.id ?? "manual";
    this.model = opts.model ?? "manual-script";
    this.script = opts.script.map((s) => ({ ...s }));
    this.capabilities = { vision: false, tools: true, ...opts.capabilities };
  }

  async chat(_messages: ChatMessage[], _opts: ChatOptions = {}): Promise<ChatResponse> {
    const step = this.cursor < this.script.length ? this.script[this.cursor] : undefined;
    this.cursor++;
    if (step === undefined) {
      return { content: "done", model: this.model };
    }
    return {
      content: step.content ?? "",
      ...(step.toolCalls !== undefined && step.toolCalls.length > 0 ? { toolCalls: step.toolCalls } : {}),
      model: this.model,
    };
  }

  /** 已消费的脚本步数（测试断言用） */
  get consumed(): number {
    return this.cursor;
  }
}
