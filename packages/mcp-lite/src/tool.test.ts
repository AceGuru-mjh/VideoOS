// 协议 + 工具定义器 + util + jail 单元测试。
import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  errorResponse,
  parseLine,
  resultResponse,
  writeMessage,
  JsonRpcErrorCodes,
} from "./protocol";
import { defineTool, err, ok, ToolError, zodToJsonSchema, LiteValidationError } from "./tool";
import { byteLength, truncateBytes, truncateList, withTimeout, TimeoutError } from "./util";
import { createJail } from "./jail";

describe("protocol", () => {
  it("errorResponse / resultResponse shapes", () => {
    expect(errorResponse(1, -32601, "nope")).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32601, message: "nope" },
    });
    expect(errorResponse("a", -32700, "bad", { extra: 1 })).toEqual({
      jsonrpc: "2.0",
      id: "a",
      error: { code: -32700, message: "bad", data: { extra: 1 } },
    });
    expect(resultResponse(2, { tools: [] })).toEqual({ jsonrpc: "2.0", id: 2, result: { tools: [] } });
  });

  it("parseLine trims and parses; writeMessage emits single line JSON", () => {
    expect(parseLine('  {"jsonrpc":"2.0","id":1,"method":"ping"} \n')).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "ping",
    });
    const chunks: string[] = [];
    writeMessage({ write: (c: string) => chunks.push(c) }, resultResponse(1, {}));
    expect(chunks).toEqual(['{"jsonrpc":"2.0","id":1,"result":{}}\n']);
  });

  it("error codes match JSON-RPC 2.0 + MCP extension", () => {
    expect(JsonRpcErrorCodes.PARSE_ERROR).toBe(-32700);
    expect(JsonRpcErrorCodes.INVALID_REQUEST).toBe(-32600);
    expect(JsonRpcErrorCodes.METHOD_NOT_FOUND).toBe(-32601);
    expect(JsonRpcErrorCodes.INVALID_PARAMS).toBe(-32602);
    expect(JsonRpcErrorCodes.INTERNAL_ERROR).toBe(-32603);
    expect(JsonRpcErrorCodes.SERVER_NOT_INITIALIZED).toBe(-32002);
  });
});

describe("zodToJsonSchema", () => {
  it("object with required/optional/enum/array/int", () => {
    const schema = zodToJsonSchema(
      z.object({
        path: z.string().describe("target path"),
        depth: z.number().int().min(0).max(5).optional(),
        mode: z.enum(["fast", "deep"]),
        tags: z.array(z.string()),
      }),
    );
    expect(schema).toEqual({
      type: "object",
      properties: {
        path: { type: "string", description: "target path" },
        depth: { type: "integer", minimum: 0, maximum: 5 },
        mode: { type: "string", enum: ["fast", "deep"] },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["path", "mode", "tags"],
    });
  });

  it("unsupported zod type throws", () => {
    expect(() => zodToJsonSchema(z.tuple([z.string()]))).toThrow(/unsupported/);
  });
});

describe("defineTool", () => {
  const echo = defineTool(
    "demo.echo",
    "Echo.",
    z.object({ text: z.string() }),
    ({ text }) => ok({ text }),
  );

  it("validates args and returns ok result", async () => {
    const result = await echo.call({ text: "hi" });
    expect(result).toEqual({ ok: true, data: { text: "hi" } });
    expect(echo.parameters).toMatchObject({ type: "object" });
  });

  it("validation failure throws LiteValidationError with field path", async () => {
    expect(echo.call({ text: 42 })).rejects.toThrow(/text: Expected string/);
  });

  it("runner throwing raw error is translated to TOOL_ERROR", async () => {
    const boom = defineTool("demo.boom", "Boom.", z.object({}), () => {
      throw new Error("kaboom");
    });
    const result = await boom.call({});
    expect(result.ok).toBe(false);
    expect(result.error).toContain("TOOL_ERROR: kaboom");
  });

  it("ToolError keeps its code prefix", async () => {
    const denied = defineTool("demo.denied", "Denied.", z.object({}), () => {
      throw new ToolError("E_JAIL", "escape attempt");
    });
    const result = await denied.call({});
    expect(result).toEqual({ ok: false, error: "E_JAIL: escape attempt" });
  });

  it("err() shape", () => {
    expect(err("E_X: nope")).toEqual({ ok: false, error: "E_X: nope" });
  });
});

describe("util", () => {
  it("truncateBytes is multibyte-safe", () => {
    expect(truncateBytes("hello", 100)).toEqual({ text: "hello", truncated: false });
    const cut = truncateBytes("你好世界", 7); // 3 bytes per CJK char
    expect(cut.truncated).toBe(true);
    expect(cut.text.startsWith("你")).toBe(true);
    expect(cut.text.includes("世")).toBe(false); // 3+3=6 fits, +3=9 > 7 → cut to 2 chars
  });

  it("byteLength counts UTF-8 bytes", () => {
    expect(byteLength("你好")).toBe(6);
    expect(byteLength("abc")).toBe(3);
  });

  it("truncateList reports total", () => {
    const result = truncateList([1, 2, 3, 4, 5], 3);
    expect(result).toEqual({ items: [1, 2, 3], truncated: true, total: 5 });
  });

  it("withTimeout rejects with TimeoutError", async () => {
    const never = new Promise(() => {});
    await expect(withTimeout(never, 20)).rejects.toThrow(TimeoutError);
    await expect(withTimeout(Promise.resolve(42), 50)).resolves.toBe(42);
  });
});

describe("jail (path prison)", () => {
  const root = mkdtempSync(join(tmpdir(), "mcp-lite-jail-"));
  // Windows CI 的 tmpdir 可能是 8.3 短名（RUNNER~1）而 realpath 返回长名 —— 期望值统一用 realpath 归一
  const realOf = async (p: string): Promise<string> => await realpath(p);

  it("resolves relative paths against root[0]", async () => {
    const jail = await createJail([root]);
    const realRoot = await realOf(root);
    writeFileSync(join(root, "a.txt"), "hi");
    expect(await jail.resolve("a.txt")).toBe(join(realRoot, "a.txt"));
    expect(await jail.resolve("./nested/../a.txt")).toBe(join(realRoot, "a.txt"));
  });

  it("blocks .. traversal and absolute escape", async () => {
    const jail = await createJail([root]);
    await expect(jail.resolve("../escape.txt")).rejects.toThrow(/E_JAIL/);
    await expect(jail.resolve("/etc/passwd")).rejects.toThrow(/E_JAIL/);
  });

  it("blocks null bytes and empty paths", async () => {
    const jail = await createJail([root]);
    await expect(jail.resolve("a\0b")).rejects.toThrow(/E_JAIL/);
    await expect(jail.resolve("")).rejects.toThrow(/E_JAIL/);
  });

  it("blocks symlink escape (realpath check)", async () => {
    const outside = mkdtempSync(join(tmpdir(), "mcp-lite-outside-"));
    writeFileSync(join(outside, "secret.txt"), "s3cret");
    const linkDir = join(root, "link");
    mkdirSync(linkDir);
    symlinkSync(join(outside, "secret.txt"), join(linkDir, "leak.txt"));
    const jail = await createJail([root]);
    await expect(jail.resolve("link/leak.txt")).rejects.toThrow(/E_JAIL/);
  });

  it("symlink inside jail still resolves to its real target path", async () => {
    const inner = join(root, "inner");
    mkdirSync(inner);
    writeFileSync(join(inner, "ok.txt"), "fine");
    symlinkSync(join(inner, "ok.txt"), join(root, "alias.txt"));
    const jail = await createJail([root]);
    expect(await jail.resolve("alias.txt")).toBe(join(await realOf(inner), "ok.txt"));
  });

  it("new file inside jail resolves (nearest-existing-ancestor realpath)", async () => {
    const jail = await createJail([root]);
    const realRoot = await realOf(root);
    const target = await jail.resolve("new-dir/new-file.txt");
    expect(target.startsWith(realRoot)).toBe(true);
  });

  it("multiple roots: path may live in any root", async () => {
    const root2 = mkdtempSync(join(tmpdir(), "mcp-lite-jail2-"));
    const jail = await createJail([root, root2]);
    expect(await jail.resolve(join(root2, "x.txt"))).toBe(join(await realOf(root2), "x.txt"));
  });
});

describe("LiteValidationError", () => {
  it("is an Error subclass (server maps it to -32602)", () => {
    const error = new LiteValidationError("path: required");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("LiteValidationError");
  });
});
