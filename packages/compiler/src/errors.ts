// 编译器错误：结构性失败（定义非法/解析失败/内部不变量破坏）抛出；内容问题走 Diagnostic
export class CompilerError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CompilerError";
    this.code = code;
  }
}
