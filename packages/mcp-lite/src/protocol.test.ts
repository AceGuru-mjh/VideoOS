// mcp-lite 协议单元测试（Issue #29）：readMessages 分块/粘包、错误码、写消息、行缓冲。
import { describe, expect, it } from "bun:test";
import {
  createLineBuffer,
  errorResponse,
  isJsonRpcNotification,
  isJsonRpcRequest,
  isJsonRpcResponse,
  JsonRpcErrorCodes,
  readMessages,
  resultResponse,
  writeMessage,
} from "./protocol";

describe("readMessages", () => {
  it("单条消息（无尾随换行）", () => {
    const [msg] = readMessages('{"jsonrpc":"2.0","id":1,"method":"initialize"}');
    expect(msg).toEqual({ jsonrpc: "2.0", id: 1, method: "initialize" });
  });

  it("多条消息一行一个（\\n 分隔）", () => {
    const msgs = readMessages('{"jsonrpc":"2.0","id":1,"method":"a"}\n{"jsonrpc":"2.0","id":2,"method":"b"}\n');
    expect(msgs).toHaveLength(2);
  });

  it("容忍空行 / \\r\\n / 尾随空白", () => {
    const msgs = readMessages('\r\n{"jsonrpc":"2.0","id":1,"method":"a"}\r\n\n   \n{"jsonrpc":"2.0","id":2,"method":"b"}');
    expect(msgs).toHaveLength(2);
  });

  it("非法 JSON 行走 onParseError 且不产出消息", () => {
    const errors: string[] = [];
    const msgs = readMessages("not json\n" + '{"jsonrpc":"2.0","id":1,"method":"a"}', {
      onParseError: (raw) => errors.push(raw),
    });
    expect(msgs).toHaveLength(1);
    expect(errors).toEqual(["not json"]);
  });

  it("缺省 onParseError 时非法行静默跳过", () => {
    expect(readMessages("{broken")).toHaveLength(0);
  });
});

describe("createLineBuffer（粘包安全）", () => {
  it("半包：一行拆两次 feed 才凑齐", () => {
    const buf = createLineBuffer();
    expect(buf.feed('{"jsonrpc":"2.0","id"')).toEqual([]);
    expect(buf.feed(':1,"method":"a"}\n')).toEqual(['{"jsonrpc":"2.0","id":1,"method":"a"}']);
  });

  it("粘包：两条消息一次 feed", () => {
    const buf = createLineBuffer();
    expect(buf.feed("a\nb\n")).toEqual(["a", "b"]);
  });

  it("flush 返回 EOF 残留行（无换行）", () => {
    const buf = createLineBuffer();
    buf.feed("partial");
    expect(buf.flush()).toBe("partial");
    expect(buf.flush()).toBeNull();
  });
});

describe("响应构造与判定", () => {
  it("errorResponse 带 data 与不带 data", () => {
    expect(errorResponse(3, -32602, "bad", { field: "path" })).toEqual({
      jsonrpc: "2.0",
      id: 3,
      error: { code: -32602, message: "bad", data: { field: "path" } },
    });
    expect(errorResponse(null, -32700, "parse")).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "parse" },
    });
  });

  it("resultResponse", () => {
    expect(resultResponse("abc", { ok: true })).toEqual({ jsonrpc: "2.0", id: "abc", result: { ok: true } });
  });

  it("isJsonRpcRequest / isJsonRpcNotification / isJsonRpcResponse 判别", () => {
    const req = { jsonrpc: "2.0", id: 1, method: "tools/list" } as const;
    const notif = { jsonrpc: "2.0", method: "notifications/initialized" } as const;
    const res = { jsonrpc: "2.0", id: 1, result: {} } as const;
    expect(isJsonRpcRequest(req)).toBe(true);
    expect(isJsonRpcNotification(req)).toBe(false);
    expect(isJsonRpcNotification(notif)).toBe(true);
    expect(isJsonRpcRequest(notif)).toBe(false);
    expect(isJsonRpcResponse(res)).toBe(true);
  });

  it("错误码常量与附录 C 一致", () => {
    expect(JsonRpcErrorCodes).toEqual({
      PARSE_ERROR: -32700,
      INVALID_REQUEST: -32600,
      METHOD_NOT_FOUND: -32601,
      INVALID_PARAMS: -32602,
      INTERNAL_ERROR: -32603,
      SERVER_NOT_INITIALIZED: -32002,
    });
  });
});

describe("writeMessage", () => {
  it("写出 JSON + 换行（无 Content-Length 头）", () => {
    const chunks: string[] = [];
    const fake = { write: (c: string) => chunks.push(c) };
    writeMessage(fake, resultResponse(1, { ok: true }));
    expect(chunks).toEqual(['{"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n']);
  });
});
