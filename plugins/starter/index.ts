// starter —— 示范插件：注册 starter.hello / starter.ping，并订阅全部已声明事件记录日志。
// 新插件从这里复制目录开始（README.md 有 manifest 字段逐项说明）。
// 插件约束：只允许 node:* 运行时 import + 对本包的 type-only import（zod 一律从 ctx.z 取）。
import type { PluginContext } from "@videoos/plugin-kit";

export default async function activate(ctx: PluginContext): Promise<void> {
  ctx.registerTool({
    name: "starter.hello",
    description: "Greet a caller and report which plugin answered; smoke-tests the plugin runtime.",
    schema: ctx.z.object({
      name: ctx.z.string().describe("who to greet").default("world"),
    }),
    run: ({ name }) => ({
      ok: true,
      data: { greeting: `Hello, ${name}!`, plugin: ctx.manifest.id, apiVersion: ctx.manifest.apiVersion },
    }),
  });

  ctx.registerTool({
    name: "starter.ping",
    description: "Runtime health probe: reply with a pong timestamp from inside the plugin sandbox.",
    schema: ctx.z.object({}),
    run: () => ({
      ok: true,
      data: { pong: true, at: new Date().toISOString(), plugin: ctx.manifest.id },
    }),
  });

  // 示范事件订阅：manifest.provides.hooks 声明了哪些事件，ctx.on 就只能订哪些
  for (const event of ctx.manifest.provides.hooks ?? []) {
    ctx.on(event, (payload) => {
      ctx.log(`event "${event}" received: ${JSON.stringify(payload ?? null)}`);
    });
  }
}

export function deactivate(): void {
  // starter 不持有资源：工具与订阅都活在宿主注册表里，宿主 stop() 时一并清理
}
