// videoos 命令行入口（SPEC §11）：commander program + 命令分发 + 直接执行检测（node 与 bun 双兼容）
import { realpathSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { Command } from "commander";
import { VIDEOOS_VERSION } from "@videoos/core";
import { registerInitCommand } from "./commands/init";
import { registerCompileCommand } from "./commands/compile";
import { registerRenderCommand } from "./commands/render";
import { registerTestCommand } from "./commands/test";
import { registerAgentCommand } from "./commands/agent";
import { registerMcpCommand } from "./commands/mcp";
import { registerCacheCommand } from "./commands/cache";
import { registerDoctorCommand } from "./commands/doctor";
import { registerSkillsCommand } from "./commands/skills";
import { registerServeCommands } from "./commands/serve";
import { registerUpgradeCommand, notifyUpdateIfNeeded } from "./commands/upgrade";

export const program = new Command();

program
  .name("videoos")
  .description("🎬 VideoOS — The Agent-Native Video IDE & Compiler")
  .version(VIDEOOS_VERSION);

registerInitCommand(program);
registerCompileCommand(program);
registerRenderCommand(program);
registerTestCommand(program);
registerAgentCommand(program);
registerMcpCommand(program);
registerCacheCommand(program);
registerDoctorCommand(program);
registerSkillsCommand(program);
registerServeCommands(program);
registerUpgradeCommand(program);

/** 直接执行检测（bun dist/cli.js / node dist/cli.js / bun src/index.ts / bun --compile 单文件可执行均命中；被 import 时不触发） */
export function isMainModule(): boolean {
  // bun --compile 单文件可执行（release 产物的分发形态）：import.meta.url 是虚拟
  // bunfs 路径（file:///$bunfs/root/...），永远无法与 argv[1] 匹配；此时
  // import.meta.main（bun 专属信号，node 下为 undefined）是唯一可靠判据。
  if (import.meta.main === true) return true;
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
    // 命令成功结束后：静默检查更新（24h 节流 · 失败/离线完全静默 · patch+受管二进制后台自动装）
    await notifyUpdateIfNeeded();
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
