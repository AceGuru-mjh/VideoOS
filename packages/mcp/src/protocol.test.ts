// protocol.ts 单元测试：逐行 JSON 流式解析 + 写出 flush
import { describe, expect, it } from "bun:test";
import {
  errorResponse,
  isJsonRpcNotification,
  isJsonRpcRequest,
  isJsonRpcResponse,
  JsonRpcErrorCodes,
  readMessages,
  resultResponse,
  writeMessage,
} from "./protocol";
import type { JsonRpcMessage } from "./protocol";

async function* chunks(parts: Array<string | Uint8Array>): AsyncGenerator<string | Uint8Array> {
  for (const p of parts) yield p;
}

async function collect(messages: AsyncGenerator<JsonRpcMessage>): Promise<JsonRpcMessage[]> {
  const out: JsonRpcMessage[] = [];
  for await (const m of messages) out.push(m);
  return out;
}

describe("readMessages", () => {
  it("逐行解析多条消息（单 chunk 多行）", async () => {
    const got = await collect(
      readMessages(chunks(['{"id":1,"method":"a"}\n{"id":2,"method":"b"}\n{"method":"n"}\n'])),
    );
    expect(got.length).toBe(3);
    expect((got[0] as { id: number }).id).toBe(1);
    expect((got[2] as { method: string }).method).toBe("n");
  });

  it("容忍空行 / 尾随空白 / \\r\\n / 尾部无换行残留行", async () => {
    const input = [
      "\r\n",                                  // 空行（CRLF）
      "   \n",                                 // 纯空白行
      '{"id":1,"method":"a"}\r\n',
      '{"id":2,', ' "method":"b"}\n',           // 消息跨 chunk 分裂
      '{"id":3,"method":"c"}',                 // 尾部无换行
    ];
    const got = await collect(readMessages(chunks(input)));
    expect(got.length).toBe(3);
  });

  it("Uint8Array chunk 与字符串 chunk 混合", async () => {
    const enc = new TextEncoder();
    const got = await collect(
      readMessages(chunks([enc.encode('{"id":1,"me'), enc.encode('thod":"x"}\n'), '{"id":2,"method":"y"}\n'])),
    );
    expect(got.length).toBe(2);
  });

  it("非法 JSON 行 → onParseError 回调（不产出消息）", async () => {
    const errors: string[] = [];
    const got = await collect(
      readMessages(chunks(['{"id":1,"method":"ok"}\n', "{not json\n", '["broken"\n']), {
        onParseError: (raw) => errors.push(raw),
      }),
    );
    expect(got.length).toBe(1);
    expect(errors).toEqual(["{not json", '["broken"']);
  });

  it("空输入 → 无消息", async () => {
    const got = await collect(readMessages(chunks(["\n\n  \n"])));
    expect(got.length).toBe(0);
  });
});

describe("writeMessage", () => {
  it("JSON.stringify + \\n，等待 flush 回调", async () => {
    const written: string[] = [];
    const writable = {
      write(chunk: string, cb?: (err?: Error | null) => void): boolean {
        written.push(chunk);
        cb?.(null);
        return true;
      },
    };
    await writeMessage(writable, resultResponse(1, { ok: true }));
    expect(written.length).toBe(1);
    expect(written[0]).toBe('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n');
  });

  it("写失败 → reject", async () => {
    const writable = {
      write(_chunk: string, cb?: (err?: Error | null) => void): boolean {
        cb?.(new Error("EPIPE"));
        return true;
      },
    };
    await expect(writeMessage(writable, resultResponse(1, null))).rejects.toThrow("EPIPE");
  });
});

describe("消息判别与构造", () => {
  it("request / notification / response 判别", () => {
    expect(isJsonRpcRequest({ jsonrpc: "2.0", id: 1, method: "x" })).toBe(true);
    expect(isJsonRpcRequest({ jsonrpc: "2.0", method: "x" })).toBe(false);
    expect(isJsonRpcNotification({ jsonrpc: "2.0", method: "x" })).toBe(true);
    expect(isJsonRpcNotification({ jsonrpc: "2.0", id: 1, method: "x" })).toBe(false);
    expect(isJsonRpcResponse({ jsonrpc: "2.0", id: 1, result: {} })).toBe(true);
    expect(isJsonRpcResponse({ jsonrpc: "2.0", id: 1, error: { code: -1, message: "x" } })).toBe(true);
  });

  it("errorResponse / resultResponse 形状", () => {
    expect(errorResponse(null, JsonRpcErrorCodes.PARSE_ERROR, "bad")).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "bad" },
    });
    expect(errorResponse(7, -1, "m", { extra: 1 })).toEqual({
      jsonrpc: "2.0",
      id: 7,
      error: { code: -1, message: "m", data: { extra: 1 } },
    });
    expect(resultResponse("abc", 42)).toEqual({ jsonrpc: "2.0", id: "abc", result: 42 });
  });
});
