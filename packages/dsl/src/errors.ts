// DSL 构建错误：带稳定 code 的即时异常（builder 内抛出）
export class DslError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "DslError";
    this.code = code;
  }
}
