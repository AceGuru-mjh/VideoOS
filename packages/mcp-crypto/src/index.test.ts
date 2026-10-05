// mcp-crypto 协议级 E2E：spawn 真子进程，走 initialize → tools/call 全链路。
import { describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";
import { join } from "node:path";
import { spawnLiteServer } from "@videoos/mcp-lite/testing";

const SERVER = join(import.meta.dir, "index.ts");

/** 构造 HS256 JWT（测试夹具） */
function makeJwt(payload: Record<string, unknown>, secret: string): string {
  const b64url = (s: string): string => Buffer.from(s, "utf8").toString("base64url");
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

describe("mcp-crypto (E2E)", () => {
  it(
    "exposes 6 tools with namespaced names",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        expect(server.tools.map((t) => t.name).sort()).toEqual([
          "crypto.base64",
          "crypto.hash",
          "crypto.hmac",
          "crypto.jwt",
          "crypto.random",
          "crypto.uuid",
        ]);
        expect(server.serverInfo.name).toBe("mcp-crypto");
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "crypto.hash digests utf8/base64/hex inputs and rejects bad algorithms",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const utf8 = await server.call("crypto.hash", { algorithm: "sha256", input: "hello" });
        expect(utf8.ok).toBe(true);
        expect(utf8.data).toMatchObject({
          algorithm: "sha256",
          digest: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        });

        const md5 = await server.call("crypto.hash", { algorithm: "md5", input: "hello" });
        expect((md5.data as { digest: string }).digest).toBe("5d41402abc4b2a76b9719d911017c592");

        // base64("hello") 与 hex("hello") 应与 utf8 同 digest
        const b64 = await server.call("crypto.hash", {
          algorithm: "sha256",
          input: "aGVsbG8=",
          encoding: "base64",
        });
        expect((b64.data as { digest: string }).digest).toBe(
          "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        );
        const hex = await server.call("crypto.hash", {
          algorithm: "sha256",
          input: "68656c6c6f",
          encoding: "hex",
        });
        expect((hex.data as { digest: string }).digest).toBe(
          "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        );

        const badAlgo = await server.call("crypto.hash", { algorithm: "md4", input: "hello" });
        expect(badAlgo.ok).toBe(false);
        expect(badAlgo.error).toContain("E_ALGO");

        const badHex = await server.call("crypto.hash", {
          algorithm: "sha256",
          input: "xyz!",
          encoding: "hex",
        });
        expect(badHex.ok).toBe(false);
        expect(badHex.error).toContain("E_INPUT");

        const badEnum = await server.call("crypto.hash", {
          algorithm: "sha256",
          input: "x",
          encoding: "rot13",
        });
        expect(badEnum.ok).toBe(false);
        expect(badEnum.error).toContain("-32602");
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "crypto.hmac produces known digests and rejects non-whitelisted algorithms",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const sha256 = await server.call("crypto.hmac", {
          algorithm: "sha256",
          data: "hello",
          key: "key",
        });
        expect(sha256.ok).toBe(true);
        expect(sha256.data).toMatchObject({
          digest: "9307b3b915efb5171ff14d8cb55fbcc798c6c0ef1456d66ded1a6aa723a58b7b",
        });

        const sha1 = await server.call("crypto.hmac", { algorithm: "sha1", data: "hello", key: "key" });
        expect((sha1.data as { digest: string }).digest).toBe(
          "b34ceac4516ff23a143e61d79d0fa7a4fbe5f266",
        );

        const bad = await server.call("crypto.hmac", { algorithm: "md5", data: "x", key: "k" });
        expect(bad.ok).toBe(false);
        expect(bad.error).toContain("E_ALGO");
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "crypto.base64 encodes/decodes and rejects invalid characters with E_DECODE",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const enc = await server.call("crypto.base64", { input: "hello", mode: "encode" });
        expect(enc.data).toMatchObject({ output: "aGVsbG8=" });

        const dec = await server.call("crypto.base64", { input: "aGVsbG8=", mode: "decode" });
        expect(dec.data).toMatchObject({ output: "hello" });

        const unpadded = await server.call("crypto.base64", { input: "aGVsbG8", mode: "decode" });
        expect(unpadded.ok).toBe(true);
        expect((unpadded.data as { output: string }).output).toBe("hello");

        const bad = await server.call("crypto.base64", { input: "!!!not-base64!!!", mode: "decode" });
        expect(bad.ok).toBe(false);
        expect(bad.error).toContain("E_DECODE");

        // 长度余 1 也不可能出现在合法 base64 中
        const odd = await server.call("crypto.base64", { input: "a", mode: "decode" });
        expect(odd.ok).toBe(false);
        expect(odd.error).toContain("E_DECODE");
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "crypto.uuid returns distinct v4 UUIDs and enforces the count bound",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const one = await server.call("crypto.uuid", {});
        expect(one.ok).toBe(true);
        const single = one.data as { uuids: string[]; count: number };
        expect(single.count).toBe(1);
        expect(single.uuids).toHaveLength(1);
        expect(single.uuids[0]).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );

        const many = await server.call("crypto.uuid", { count: 10 });
        const list = (many.data as { uuids: string[] }).uuids;
        expect(list).toHaveLength(10);
        expect(new Set(list).size).toBe(10);

        const tooMany = await server.call("crypto.uuid", { count: 51 });
        expect(tooMany.ok).toBe(false);
        expect(tooMany.error).toContain("-32602");
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "crypto.random generates strings per charset with length bounds",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const hex = await server.call("crypto.random", { length: 16, charset: "hex" });
        expect(hex.data).toMatchObject({ charset: "hex", length: 16 });
        expect((hex.data as { value: string }).value).toMatch(/^[0-9a-f]{16}$/);

        const numeric = await server.call("crypto.random", { length: 8, charset: "numeric" });
        expect((numeric.data as { value: string }).value).toMatch(/^[0-9]{8}$/);

        const alnum = await server.call("crypto.random", { length: 32 }); // 默认 alphanumeric
        expect((alnum.data as { value: string }).value).toMatch(/^[A-Za-z0-9]{32}$/);

        const b64 = await server.call("crypto.random", { length: 20, charset: "base64" });
        expect((b64.data as { value: string }).value).toMatch(/^[A-Za-z0-9+/]{20}$/);

        const tooLong = await server.call("crypto.random", { length: 513 });
        expect(tooLong.ok).toBe(false);
        expect(tooLong.error).toContain("-32602");
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "crypto.jwt verifies HS256, decodes without secret, flags expiry and rejects malformed tokens",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const token = makeJwt({ sub: "user-1", role: "editor" }, "secret");
        const verified = await server.call("crypto.jwt", { token, secret: "secret" });
        expect(verified.ok).toBe(true);
        expect(verified.data).toMatchObject({ valid: true });
        expect((verified.data as { payload: { sub: string } }).payload.sub).toBe("user-1");
        expect((verified.data as { header: { alg: string } }).header.alg).toBe("HS256");

        const wrong = await server.call("crypto.jwt", { token, secret: "wrong" });
        expect(wrong.ok).toBe(true); // 查询成功，结论是签名不符
        expect(wrong.data).toMatchObject({ valid: false });
        expect((wrong.data as { reason: string }).reason).toContain("signature mismatch");

        const decoded = await server.call("crypto.jwt", { token });
        expect(decoded.ok).toBe(true);
        expect(decoded.data).toMatchObject({ decoded: true });
        expect((decoded.data as { payload: { sub: string } }).payload.sub).toBe("user-1");
        expect((decoded.data as { valid?: boolean }).valid).toBeUndefined();

        const expiredToken = makeJwt(
          { sub: "old", exp: Math.floor(Date.now() / 1000) - 3600 },
          "secret",
        );
        const expired = await server.call("crypto.jwt", { token: expiredToken, secret: "secret" });
        expect(expired.data).toMatchObject({ valid: true, expired: true });
        expect((expired.data as { reason: string }).reason).toContain("expired");
        const expiredDecode = await server.call("crypto.jwt", { token: expiredToken });
        expect(expiredDecode.data).toMatchObject({ decoded: true, expired: true });

        const notJwt = await server.call("crypto.jwt", { token: "not.a.jwt" });
        expect(notJwt.ok).toBe(false);
        expect(notJwt.error).toContain("E_JWT");

        const twoParts = await server.call("crypto.jwt", { token: "abc.def" });
        expect(twoParts.ok).toBe(false);
        expect(twoParts.error).toContain("E_JWT");
      } finally {
        await server.close();
      }
    },
    20_000,
  );
});
