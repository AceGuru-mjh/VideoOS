// mcp-host 测试夹具：崩溃服务器。
// 缺省（immediate）：启动后立即 process.exit(1)，不完成 initialize —— 测 start() 容错与重启退避。
// FIXTURE_CRASH_MODE=late：先以 mcp-lite 正常起一个 crash.now 工具（完成握手、可被 listTools 聚合），
//   FIXTURE_CRASH_DELAY_MS（默认 500）后 process.exit(1) —— 测 unhealthy 后从 listTools 排除。
import { defineTool, ok, runStdioServer } from "@videoos/mcp-lite";
import { z } from "zod";

const mode = process.env.FIXTURE_CRASH_MODE ?? "immediate";

if (mode === "late") {
  const delayMs = Number(process.env.FIXTURE_CRASH_DELAY_MS ?? "500");
  setTimeout(() => {
    process.exit(1);
  }, delayMs);
  await runStdioServer(
    [
      defineTool(
        "crash.now",
        "Answers once; the fixture server dies shortly after startup (crash fixture).",
        z.object({}),
        () => ok({ alive: true }),
      ),
    ],
    { serverName: "fixture-crash", serverVersion: "0.0.0" },
  );
} else {
  process.stderr.write("fixture-crash: exiting immediately\n");
  process.exit(1);
}
