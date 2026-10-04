// 视频引擎 sidecar 入口 —— 由打包的 bun 运行时执行（非 Node！）。
// 职责：启动 @videoos/server（studio API + 静态 UI），端口协议回传 Electron 主进程。
// 注意：esbuild 以 target=bun 打包 —— createVapContext 对项目 .ts 入口的动态 import
// 依赖 bun 原生 TS 加载，这是整个 sidecar 必须是 bun 的原因。
import process from "node:process";
import { startStudioServer } from "@videoos/server";

interface ReadyInfo {
  port: number;
  project: string | null;
}

const args = process.argv.slice(2);
let projectRoot: string | undefined;
for (let i = 0; i < args.length - 1; i++) {
  if (args[i] === "--project" && typeof args[i + 1] === "string" && args[i + 1].length > 0) {
    projectRoot = args[i + 1];
  }
}

const studioDistDir = process.env.VIDEOOS_STUDIO_DIST;

try {
  const handle = await startStudioServer({
    port: 0, // 随机端口，避免多实例冲突
    ...(projectRoot !== undefined ? { projectRoot } : {}),
    ...(studioDistDir !== undefined && studioDistDir.length > 0 ? { studioDistDir } : {}),
  });
  const info: ReadyInfo = {
    port: handle.port,
    project: handle.state.projectSession?.project.root ?? null,
  };
  process.stdout.write(`VIDEOOS_SERVER_READY ${JSON.stringify(info)}\n`);

  process.on("SIGTERM", () => process.exit(0));
  process.on("SIGINT", () => process.exit(0));
  process.on("uncaughtException", (err) => {
    process.stderr.write(`[videoos-engine] uncaught: ${err instanceof Error ? err.stack : String(err)}\n`);
  });
  // 保持事件循环存活（server 句柄已持有，此处兜底）
  setInterval(() => {}, 1 << 30);
} catch (err) {
  process.stderr.write(
    `[videoos-engine] fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exit(1);
}
