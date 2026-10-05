// mcp-shell 协议级 E2E：spawn 真子进程走完整 JSON-RPC 握手。
// 跨平台注意：命令选型两平台皆可运行（echo / exit 3 / echo err 1>&2 / pwd|cd 二选一 / ping|sleep 二选一），
// 不用含括号的 bun -e 内联码（cmd.exe 对括号参数的转义不可靠）；断言一律 node:path join。
import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnLiteServer } from "@videoos/mcp-lite/testing";

const SERVER = join(import.meta.dir, "index.ts");
const IS_WIN = process.platform === "win32";

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), "mcp-shell-"));
}

describe("mcp-shell (E2E)", () => {
  it(
    "exposes shell.exec and shell.which",
    async () => {
      const root = makeRoot();
      const server = await spawnLiteServer(SERVER, { env: { MCP_SHELL_ROOTS: root } });
      try {
        expect(server.tools.map((t) => t.name).sort()).toEqual(["shell.exec", "shell.which"]);
      } finally {
        await server.close();
        rmSync(root, { recursive: true, force: true });
      }
    },
    20_000,
  );

  it(
    "shell.exec runs a command and reports exitCode/stdout/durationMs",
    async () => {
      const root = makeRoot();
      const server = await spawnLiteServer(SERVER, { env: { MCP_SHELL_ROOTS: root } });
      try {
        const result = await server.call("shell.exec", { command: "echo hello" });
        expect(result.ok).toBe(true);
        const data = result.data as { exitCode: number | null; stdout: string; stderr: string; truncated: boolean; durationMs: number };
        expect(data.exitCode).toBe(0);
        expect(data.stdout).toContain("hello");
        expect(data.stderr).toBe("");
        expect(data.truncated).toBe(false);
        expect(data.durationMs).toBeGreaterThanOrEqual(0);
      } finally {
        await server.close();
        rmSync(root, { recursive: true, force: true });
      }
    },
    20_000,
  );

  it(
    "shell.exec honors cwd inside the jail",
    async () => {
      const root = makeRoot();
      mkdirSync(join(root, "sub"));
      const server = await spawnLiteServer(SERVER, { env: { MCP_SHELL_ROOTS: root } });
      try {
        const pwd = await server.call("shell.exec", { command: IS_WIN ? "cd" : "pwd", cwd: join(root, "sub") });
        expect(pwd.ok).toBe(true);
        const data = pwd.data as { exitCode: number | null; stdout: string };
        expect(data.exitCode).toBe(0);
        expect(data.stdout.trim().replace(/\\/g, "/").endsWith("/sub")).toBe(true);
      } finally {
        await server.close();
        rmSync(root, { recursive: true, force: true });
      }
    },
    20_000,
  );

  it(
    "shell.exec rejects cwd outside the jail (E_JAIL)",
    async () => {
      const root = makeRoot();
      const server = await spawnLiteServer(SERVER, { env: { MCP_SHELL_ROOTS: root } });
      try {
        const result = await server.call("shell.exec", { command: "echo hi", cwd: tmpdir() });
        expect(result.ok).toBe(false);
        expect(result.error).toContain("E_JAIL");
      } finally {
        await server.close();
        rmSync(root, { recursive: true, force: true });
      }
    },
    20_000,
  );

  it(
    "shell.exec surfaces non-zero exit codes as data (not errors)",
    async () => {
      const root = makeRoot();
      const server = await spawnLiteServer(SERVER, { env: { MCP_SHELL_ROOTS: root } });
      try {
        const result = await server.call("shell.exec", { command: "exit 3" });
        expect(result.ok).toBe(true);
        expect((result.data as { exitCode: number | null }).exitCode).toBe(3);
      } finally {
        await server.close();
        rmSync(root, { recursive: true, force: true });
      }
    },
    20_000,
  );

  it(
    "shell.exec captures stderr separately (1>&2 works on both cmd and sh)",
    async () => {
      const root = makeRoot();
      const server = await spawnLiteServer(SERVER, { env: { MCP_SHELL_ROOTS: root } });
      try {
        const result = await server.call("shell.exec", { command: "echo err 1>&2" });
        expect(result.ok).toBe(true);
        const data = result.data as { stderr: string; stdout: string; exitCode: number | null };
        expect(data.stderr.toLowerCase()).toContain("err");
        expect(data.exitCode).toBe(0);
      } finally {
        await server.close();
        rmSync(root, { recursive: true, force: true });
      }
    },
    20_000,
  );

  it(
    "shell.exec truncates stdout at maxOutput with a marker",
    async () => {
      const root = makeRoot();
      const server = await spawnLiteServer(SERVER, { env: { MCP_SHELL_ROOTS: root } });
      try {
        const result = await server.call("shell.exec", {
          command: `echo ${"x".repeat(300)}`,
          maxOutput: 100,
        });
        expect(result.ok).toBe(true);
        const data = result.data as { stdout: string; truncated: boolean };
        expect(data.truncated).toBe(true);
        expect(data.stdout).toContain("[truncated at 100 bytes]");
        expect(Buffer.byteLength(data.stdout, "utf8")).toBeLessThan(200);
      } finally {
        await server.close();
        rmSync(root, { recursive: true, force: true });
      }
    },
    20_000,
  );

  it(
    "shell.exec kills long-running commands at timeoutMs (TIMEOUT)",
    async () => {
      const root = makeRoot();
      const server = await spawnLiteServer(SERVER, { env: { MCP_SHELL_ROOTS: root } });
      try {
        const command = IS_WIN ? "ping -n 30 127.0.0.1" : "sleep 30";
        const started = Date.now();
        const result = await server.call("shell.exec", { command, timeoutMs: 800 });
        expect(Date.now() - started).toBeLessThan(10_000); // 真的被杀掉了，而不是等到自然结束
        expect(result.ok).toBe(false);
        expect(result.error).toContain("TIMEOUT");
      } finally {
        await server.close();
        rmSync(root, { recursive: true, force: true });
      }
    },
    20_000,
  );

  it(
    "shell.which finds bun on PATH",
    async () => {
      const root = makeRoot();
      const server = await spawnLiteServer(SERVER, { env: { MCP_SHELL_ROOTS: root } });
      try {
        const result = await server.call("shell.which", { command: "bun" });
        expect(result.ok).toBe(true);
        const data = result.data as { found: boolean; path?: string };
        expect(data.found).toBe(true);
        expect(typeof data.path).toBe("string");
        expect((data.path ?? "").length).toBeGreaterThan(0);
      } finally {
        await server.close();
        rmSync(root, { recursive: true, force: true });
      }
    },
    20_000,
  );

  it(
    "shell.which returns found:false for a missing binary (not an error)",
    async () => {
      const root = makeRoot();
      const server = await spawnLiteServer(SERVER, { env: { MCP_SHELL_ROOTS: root } });
      try {
        const result = await server.call("shell.which", { command: "definitely-missing-cmd-xyz-42" });
        expect(result.ok).toBe(true);
        expect(result.data).toMatchObject({ found: false, command: "definitely-missing-cmd-xyz-42" });
      } finally {
        await server.close();
        rmSync(root, { recursive: true, force: true });
      }
    },
    20_000,
  );

  it(
    "invalid tool arguments return JSON-RPC -32602",
    async () => {
      const root = makeRoot();
      const server = await spawnLiteServer(SERVER, { env: { MCP_SHELL_ROOTS: root } });
      try {
        const negative = await server.call("shell.exec", { command: "echo hi", timeoutMs: -5 });
        expect(negative.ok).toBe(false);
        expect(negative.error).toContain("-32602");

        const empty = await server.call("shell.exec", { command: "" });
        expect(empty.ok).toBe(false);
        expect(empty.error).toContain("-32602");

        const missing = await server.call("shell.which", {});
        expect(missing.ok).toBe(false);
        expect(missing.error).toContain("-32602");
      } finally {
        await server.close();
        rmSync(root, { recursive: true, force: true });
      }
    },
    20_000,
  );
});
