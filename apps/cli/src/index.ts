// videoos 命令行入口（SPEC §11）：commander program + 命令分发 + 直接执行检测（node 与 bun 双兼容）
import { realpathSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { Command } from "commander";
import { registerInitCommand } from "./commands/init";
import { registerCompileCommand } from "./commands/compile";
import { registerRenderCommand } from "./commands/render";
import { registerTestCommand } from "./commands/test";
import { registerAgentCommand } from "./commands/agent";
import { registerMcpCommand } from "./commands/mcp";
import { registerCacheCommand } from "./commands/cache";
import { registerDoctorCommand } from "./commands/doctor";
import { registerServeCommands } from "./commands/serve";

export const program = new Command();

program
  .name("videoos")
  .description("🎬 VideoOS — The Agent-Native Video IDE & Compiler")
  .version("0.2.0");

registerInitCommand(program);
registerCompileCommand(program);
registerRenderCommand(program);
registerTestCommand(program);
registerAgentCommand(program);
registerMcpCommand(program);
registerCacheCommand(program);
registerDoctorCommand(program);
registerServeCommands(program);

/** 直接执行检测（bun dist/cli.js / node dist/cli.js / bun src/index.ts 均命中；被 import 时不触发） */
export function isMainModule(): boolean {
  const argv1 = process.argv[1];
  if (typeof argv1 !== "string" || argv1.length === 0) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(argv1)).href;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    // commander 的 help/version/usage 错误已由 exitOverride/默认路径处理；此处兜底 action 异常
    const code = (err as { code?: string }).code;
    if (code !== "commander.helpDisplayed" && code !== "commander.version" && code !== "commander.unknownOption") {
      console.error(err instanceof Error ? err.stack : String(err));
      process.exit(1);
    } else {
      process.exit(0);
    }
  }
}
