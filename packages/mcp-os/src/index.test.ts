// mcp-os 协议级 E2E：spawn 真子进程走完整 JSON-RPC 握手。全部离线、纯 node:os/fs，天然跨平台。
import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnLiteServer } from "@videoos/mcp-lite/testing";

const SERVER = join(import.meta.dir, "index.ts");

describe("mcp-os (E2E)", () => {
  it(
    "exposes os.info / os.disk / os.env",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        expect(server.tools.map((t) => t.name).sort()).toEqual(["os.disk", "os.env", "os.info"]);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "os.info reports machine info without username/home fields",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const result = await server.call("os.info", {});
        expect(result.ok).toBe(true);
        const data = result.data as {
          platform: string;
          release: string;
          arch: string;
          hostname: string;
          cpus: { model: string; count: number };
          memory: { totalBytes: number; freeBytes: number };
        };
        expect(typeof data.platform).toBe("string");
        expect(data.platform.length).toBeGreaterThan(0);
        expect(typeof data.release).toBe("string");
        expect(typeof data.arch).toBe("string");
        expect(typeof data.hostname).toBe("string");
        expect(data.cpus.count).toBeGreaterThanOrEqual(1);
        expect(typeof data.cpus.model).toBe("string");
        expect(data.memory.totalBytes).toBeGreaterThan(0);
        expect(data.memory.freeBytes).toBeGreaterThan(0);
        // 脱敏基线：绝不含用户名/家目录类字段
        for (const banned of ["username", "user", "homedir", "home", "userInfo", "env"]) {
          expect(Object.hasOwn(data, banned)).toBe(false);
        }
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "os.disk stats an explicit path",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "mcp-os-"));
      const server = await spawnLiteServer(SERVER);
      try {
        const result = await server.call("os.disk", { path: root });
        expect(result.ok).toBe(true);
        const data = result.data as { totalBytes: number; freeBytes: number };
        expect(data.totalBytes).toBeGreaterThan(0);
        expect(data.freeBytes).toBeGreaterThanOrEqual(0);
        expect(data.totalBytes).toBeGreaterThanOrEqual(data.freeBytes);
      } finally {
        await server.close();
        rmSync(root, { recursive: true, force: true });
      }
    },
    20_000,
  );

  it(
    "os.disk defaults to the working directory",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const result = await server.call("os.disk", {});
        expect(result.ok).toBe(true);
        const data = result.data as { path: string; totalBytes: number };
        expect(data.totalBytes).toBeGreaterThan(0);
        expect(data.path.length).toBeGreaterThan(0);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "os.env masks sensitive keys/values and lists missing ones",
    async () => {
      const server = await spawnLiteServer(SERVER, {
        env: {
          VOS_TEST_PLAIN: "hello world",
          VOS_TEST_API_KEY: "super-secret-material",
          VOS_TEST_TOKEN: "tok_123",
          VOS_TEST_VALUE_WITH_PASSWORD: "innocent",
        },
      });
      try {
        const result = await server.call("os.env", {
          keys: ["VOS_TEST_PLAIN", "VOS_TEST_API_KEY", "VOS_TEST_TOKEN", "VOS_TEST_VALUE_WITH_PASSWORD", "VOS_TEST_MISSING_XYZ"],
        });
        expect(result.ok).toBe(true);
        const data = result.data as { values: Record<string, string>; missing: string[] };
        expect(data.values["VOS_TEST_PLAIN"]).toBe("hello world");
        expect(data.values["VOS_TEST_API_KEY"]).toBe("***"); // 键名含 KEY
        expect(data.values["VOS_TEST_TOKEN"]).toBe("***"); // 键名含 TOKEN
        expect(data.values["VOS_TEST_VALUE_WITH_PASSWORD"]).toBe("***"); // 键名含 PASSWORD
        expect(data.missing).toEqual(["VOS_TEST_MISSING_XYZ"]);
        // 未请求的键绝不出现
        expect(Object.hasOwn(data.values, "PATH")).toBe(false);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "invalid tool arguments return JSON-RPC -32602",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const keysType = await server.call("os.env", { keys: "PATH" });
        expect(keysType.ok).toBe(false);
        expect(keysType.error).toContain("-32602");

        const pathType = await server.call("os.disk", { path: 42 });
        expect(pathType.ok).toBe(false);
        expect(pathType.error).toContain("-32602");

        const emptyKey = await server.call("os.env", { keys: [""] });
        expect(emptyKey.ok).toBe(false);
        expect(emptyKey.error).toContain("-32602");
      } finally {
        await server.close();
      }
    },
    20_000,
  );
});
