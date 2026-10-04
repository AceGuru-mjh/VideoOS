// MCP 集成测试用的 stdio server 测试入口（非包导出，仅由 test spawn）：
//   bun packages/mcp/test-server.ts --project <dir>
// 装配：ProjectWorkspace.open → createVapContext → createDefaultTools → runStdioServer。
// 入口文件名避开 *.test.ts（防止 bun test 误收集）。
import { startProjectMcpServer } from "./src/index";

function parseArg(name: string): string | undefined {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length - 1; i++) {
    if (argv[i] === name) return argv[i + 1];
  }
  const prefix = `${name}=`;
  const inline = argv.find((a) => a.startsWith(prefix));
  return inline !== undefined ? inline.slice(prefix.length) : undefined;
}

const project = parseArg("--project");
if (project === undefined) {
  process.stderr.write("usage: bun test-server.ts --project <dir>\n");
  process.exit(2);
}

try {
  await startProjectMcpServer(project, { serverName: "videoos-test-server" });
  process.exit(0);
} catch (err) {
  process.stderr.write(`[test-server] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
