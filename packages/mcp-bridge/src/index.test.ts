// mcp-bridge 协议级 E2E：spawn 真子进程，插件工具经 MCP stdio 暴露（默认根 = <repo>/plugins，
// MCP_PLUGIN_ROOTS 可覆盖/多根）。失败路径（未知工具 / 非法入参 / 空根）均有覆盖。
import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnLiteServer } from "@videoos/mcp-lite/testing";

const SERVER = join(import.meta.dir, "index.ts");

/** 生成一个最小Solo插件（工具 solo.hello），用于 env 覆盖测试 */
function writeSoloPlugin(root: string, id: string): void {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "plugin.json"),
    JSON.stringify(
      {
        id,
        name: id,
        version: "0.1.0",
        description: `env override fixture plugin ${id}`,
        apiVersion: "0.1",
        permissions: ["tools"],
        provides: { tools: [`${id}.hello`] },
        entry: "index.ts",
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(dir, "index.ts"),
    [
      'import type { PluginContext } from "@videoos/plugin-kit";',
      "",
      "export default async function activate(ctx: PluginContext): Promise<void> {",
      "  ctx.registerTool({",
      `    name: "${id}.hello",`,
      '    description: "env fixture greeting",',
      "    schema: ctx.z.object({ name: ctx.z.string().default(\"world\") }),",
      "    run: ({ name }) => ({ ok: true, data: { hello: name, plugin: ctx.manifest.id } }),",
      "  });",
      "}",
      "",
    ].join("\n"),
  );
}

describe("mcp-bridge (E2E)", () => {
  it("exposes built-in plugin tools with default roots", async () => {
    const server = await spawnLiteServer(SERVER, { env: { MCP_PLUGIN_ROOTS: "" } });
    try {
      const names = server.tools.map((tool) => tool.name);
      expect(names).toContain("starter.hello");
      expect(names).toContain("brand-guard.brand.tokens");
      expect(names.length).toBeGreaterThanOrEqual(20);

      const hello = await server.call("starter.hello", { name: "VideoOS" });
      expect(hello.ok).toBe(true);
      const helloData = hello.data as { greeting: string; plugin: string };
      expect(helloData.greeting).toBe("Hello, VideoOS!");
      expect(helloData.plugin).toBe("starter");

      const defaults = await server.call("starter.hello", {});
      expect((defaults.data as { greeting: string }).greeting).toBe("Hello, world!");
    } finally {
      await server.close();
    }
  }, 20_000);

  it("palette.contrast reports WCAG ratio (black on white >= 19, aa/aaa)", async () => {
    const server = await spawnLiteServer(SERVER, { env: { MCP_PLUGIN_ROOTS: "" } });
    try {
      const result = await server.call("palette-forge.palette.contrast", {
        foreground: "#000000",
        background: "#ffffff",
      });
      expect(result.ok).toBe(true);
      const data = result.data as { ratio: number; aa: boolean; aaa: boolean };
      expect(data.ratio).toBeGreaterThanOrEqual(19);
      expect(data.aa).toBe(true);
      expect(data.aaa).toBe(true);
    } finally {
      await server.close();
    }
  }, 20_000);

  it("returns ok:false for an unknown tool (-32602 from the server tool table)", async () => {
    const server = await spawnLiteServer(SERVER, { env: { MCP_PLUGIN_ROOTS: "" } });
    try {
      const result = await server.call("no.such.tool", {});
      expect(result.ok).toBe(false);
      // 未知工具在 LiteServer 工具表层就被拒（-32602，与其余 mcp-* 服务器同语义）；
      // 宿主层 TOOL_NOT_FOUND 路径由 plugin-kit host.test.ts 覆盖
      expect(result.error).toContain("JSON-RPC -32602");
      expect(result.error).toContain("unknown tool");
    } finally {
      await server.close();
    }
  }, 20_000);

  it("surfaces plugin argument validation errors (E_ARGS)", async () => {
    const server = await spawnLiteServer(SERVER, { env: { MCP_PLUGIN_ROOTS: "" } });
    try {
      const result = await server.call("starter.hello", { name: 123 });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("E_ARGS");
    } finally {
      await server.close();
    }
  }, 20_000);

  it("honors MCP_PLUGIN_ROOTS (single custom root replaces built-ins)", async () => {
    const root = mkdtempSync(join(tmpdir(), "mcp-bridge-"));
    writeSoloPlugin(root, "solo");
    const server = await spawnLiteServer(SERVER, { env: { MCP_PLUGIN_ROOTS: root } });
    try {
      const names = server.tools.map((tool) => tool.name);
      expect(names).toEqual(["solo.hello"]);
      expect(names).not.toContain("starter.hello");
      const result = await server.call("solo.hello", { name: "bridge" });
      expect(result.ok).toBe(true);
      expect((result.data as { hello: string }).hello).toBe("bridge");
    } finally {
      await server.close();
    }
  }, 20_000);

  it("accepts multiple roots separated by colons", async () => {
    const rootA = mkdtempSync(join(tmpdir(), "mcp-bridge-"));
    const rootB = mkdtempSync(join(tmpdir(), "mcp-bridge-"));
    writeSoloPlugin(rootA, "alpha");
    writeSoloPlugin(rootB, "beta");
    const server = await spawnLiteServer(SERVER, { env: { MCP_PLUGIN_ROOTS: `${rootA}:${rootB}` } });
    try {
      const names = server.tools.map((tool) => tool.name).sort();
      expect(names).toEqual(["alpha.hello", "beta.hello"]);
    } finally {
      await server.close();
    }
  }, 20_000);

  it("starts cleanly with an empty plugin root (0 tools, server alive)", async () => {
    const empty = mkdtempSync(join(tmpdir(), "mcp-bridge-"));
    const server = await spawnLiteServer(SERVER, { env: { MCP_PLUGIN_ROOTS: empty } });
    try {
      expect(server.tools).toEqual([]);
      const result = await server.call("anything.at-all", {});
      expect(result.ok).toBe(false);
    } finally {
      await server.close();
    }
  }, 20_000);
});
