// @videoos/mcp-crypto —— 哈希/HMAC/Base64/UUID/随机串/JWT 工具服务器（stdio MCP）。
// 全部基于 node:crypto 内建：零网络、零第三方依赖。
// 安全要点：算法白名单（E_ALGO）、hex/base64 输入严格校验（E_INPUT/E_DECODE）、
// JWT 验签用 timingSafeEqual 防时序攻击（仅支持 HS256）。
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { defineTool, err, ok, runStdioServer } from "@videoos/mcp-lite";
import { z } from "zod";

const HASH_ALGOS = ["md5", "sha1", "sha256", "sha384", "sha512"] as const;
const HMAC_ALGOS = ["sha1", "sha256", "sha512"] as const;
const HASH_ALGO_SET = new Set<string>(HASH_ALGOS);
const HMAC_ALGO_SET = new Set<string>(HMAC_ALGOS);

/** 标准 Base64（含可选 padding）严格校验：非法字符或不可能长度 → false */
function isValidBase64(value: string): boolean {
  const eq = value.indexOf("=");
  const body = eq === -1 ? value : value.slice(0, eq);
  const pad = eq === -1 ? 0 : value.length - eq;
  if (pad > 2) return false;
  if (eq !== -1 && /=$/.test(body)) return false; // '=' 只能出现在尾部
  if (body.length === 0 && pad === 0) return true; // 空串合法（解码为空）
  if (!/^[A-Za-z0-9+/]+$/.test(body)) return false;
  return (body.length + pad) % 4 !== 1; // 余 1 不可能
}

/** base64url 段校验（JWT 专用：无 padding、字符集 A-Za-z0-9_-） */
function decodeBase64Url(part: string): Buffer {
  const padded = part + "=".repeat((4 - (part.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

/** 拒绝采样：从字母表生成密码学均匀的随机串（randomBytes 供源） */
function sampleAlphabet(alphabet: string, count: number): string {
  const limit = 256 - (256 % alphabet.length);
  let out = "";
  while (out.length < count) {
    const bytes = randomBytes(Math.max(64, count * 2));
    for (const b of bytes) {
      if (b >= limit) continue; // 拒绝区，保证无取模偏差
      out += alphabet[b % alphabet.length];
      if (out.length === count) break;
    }
  }
  return out;
}

/** JWT payload 的 exp 过期检查（仅认数值型 exp，秒） */
function jwtExpired(payload: Record<string, unknown>): boolean {
  const exp = payload.exp;
  return typeof exp === "number" && Number.isFinite(exp) && Date.now() >= exp * 1000;
}

const tools = [
  defineTool(
    "crypto.hash",
    "Hash text with md5/sha1/sha256/sha384/sha512; use for content fingerprints, dedup keys and checksums.",
    z.object({
      algorithm: z
        .string()
        .describe('digest algorithm, one of: "md5", "sha1", "sha256", "sha384", "sha512"'),
      input: z.string().describe("input text; bytes are taken per encoding before hashing"),
      encoding: z
        .enum(["utf8", "base64", "hex"])
        .describe("how to interpret input text")
        .default("utf8"),
    }),
    ({ algorithm, input, encoding }) => {
      const algo = algorithm.trim().toLowerCase();
      if (!HASH_ALGO_SET.has(algo)) {
        return err(
          `E_ALGO: unsupported algorithm ${JSON.stringify(algorithm)} (supported: ${HASH_ALGOS.join(", ")})`,
        );
      }
      if (encoding === "hex" && !/^[0-9a-fA-F]*$/.test(input)) {
        return err(`E_INPUT: input is not valid hex: ${JSON.stringify(input.slice(0, 64))}`);
      }
      if (encoding === "base64" && !isValidBase64(input)) {
        return err(`E_INPUT: input is not valid base64: ${JSON.stringify(input.slice(0, 64))}`);
      }
      const digest = createHash(algo).update(input, encoding).digest("hex");
      return ok({ algorithm: algo, encoding, digest, bytes: digest.length / 2 });
    },
  ),
  defineTool(
    "crypto.hmac",
    "HMAC digest (sha1/sha256/sha512) of data with a secret key; use for API signature debugging.",
    z.object({
      algorithm: z.string().describe('HMAC algorithm, one of: "sha256", "sha1", "sha512"'),
      data: z.string().describe("message text (utf8)"),
      key: z.string().describe("secret key text (utf8)"),
    }),
    ({ algorithm, data, key }) => {
      const algo = algorithm.trim().toLowerCase();
      if (!HMAC_ALGO_SET.has(algo)) {
        return err(
          `E_ALGO: unsupported HMAC algorithm ${JSON.stringify(algorithm)} (supported: ${HMAC_ALGOS.join(", ")})`,
        );
      }
      const digest = createHmac(algo, key).update(data, "utf8").digest("hex");
      return ok({ algorithm: algo, digest });
    },
  ),
  defineTool(
    "crypto.base64",
    "Base64 encode/decode between utf8 text and standard base64 (strict: invalid characters rejected).",
    z.object({
      input: z.string().describe("utf8 text to encode, or base64 to decode"),
      mode: z.enum(["encode", "decode"]).describe("encode: text to base64; decode: base64 to text"),
    }),
    ({ input, mode }) => {
      if (mode === "encode") {
        return ok({ output: Buffer.from(input, "utf8").toString("base64") });
      }
      if (!isValidBase64(input.trim())) {
        return err(
          `E_DECODE: input is not valid base64 (allowed: A-Za-z0-9+/ with optional = padding): ${JSON.stringify(input.slice(0, 64))}`,
        );
      }
      const output = Buffer.from(input.trim(), "base64").toString("utf8");
      return ok({ output });
    },
  ),
  defineTool(
    "crypto.uuid",
    "Generate v4 UUIDs (crypto-random); use for placeholder asset/scene/job IDs.",
    z.object({
      count: z.number().int().min(1).max(50).describe("how many UUIDs (1-50)").default(1),
    }),
    ({ count }) => {
      const uuids = Array.from({ length: count }, () => randomUUID());
      return ok({ uuids, count });
    },
  ),
  defineTool(
    "crypto.random",
    "Generate a crypto-random string in a chosen charset (alphanumeric/hex/base64/numeric).",
    z.object({
      length: z.number().int().min(1).max(512).describe("desired output length (1-512)").default(32),
      charset: z
        .enum(["alphanumeric", "hex", "base64", "numeric"])
        .describe("output alphabet")
        .default("alphanumeric"),
    }),
    ({ length, charset }) => {
      let value: string;
      if (charset === "hex") {
        value = randomBytes(Math.ceil(length / 2)).toString("hex").slice(0, length);
      } else if (charset === "base64") {
        value = randomBytes(Math.ceil((length * 3) / 4) + 2).toString("base64").slice(0, length);
      } else if (charset === "numeric") {
        value = sampleAlphabet("0123456789", length);
      } else {
        value = sampleAlphabet(
          "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
          length,
        );
      }
      return ok({ charset, length: value.length, value });
    },
  ),
  defineTool(
    "crypto.jwt",
    "Decode a JWT, or verify its HS256 signature when a secret is given (constant-time compare); reports exp expiry.",
    z.object({
      token: z.string().describe("JWT compact serialization: header.payload.signature"),
      secret: z
        .string()
        .optional()
        .describe("HMAC-SHA256 secret; give it to verify the signature, omit to decode only"),
    }),
    ({ token, secret }) => {
      const parts = token.trim().split(".");
      if (parts.length !== 3 || parts.some((p) => p.length === 0)) {
        return err(
          "E_JWT: token must be 3 dot-separated base64url segments (header.payload.signature)",
        );
      }
      if (parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) {
        return err("E_JWT: segments must be base64url (A-Za-z0-9_-) only");
      }
      let header: unknown;
      let payload: unknown;
      try {
        header = JSON.parse(decodeBase64Url(parts[0]!).toString("utf8"));
        payload = JSON.parse(decodeBase64Url(parts[1]!).toString("utf8"));
      } catch (error) {
        return err(
          `E_JWT: cannot decode header/payload as JSON (${error instanceof Error ? error.message : String(error)})`,
        );
      }
      if (
        typeof header !== "object" || header === null || Array.isArray(header) ||
        typeof payload !== "object" || payload === null || Array.isArray(payload)
      ) {
        return err("E_JWT: header and payload must both be JSON objects");
      }
      const head = header as Record<string, unknown>;
      const body = payload as Record<string, unknown>;
      const expired = jwtExpired(body);
      if (secret === undefined) {
        return ok({ decoded: true, header: head, payload: body, ...(expired ? { expired: true } : {}) });
      }
      if (head.alg !== "HS256") {
        return ok({
          valid: false,
          header: head,
          payload: body,
          reason: `unsupported alg ${JSON.stringify(head.alg)}: only HS256 verification is supported (omit secret to decode)`,
          ...(expired ? { expired: true } : {}),
        });
      }
      const signature = decodeBase64Url(parts[2]!);
      const expected = createHmac("sha256", secret).update(`${parts[0]}.${parts[1]}`).digest();
      const valid = signature.length === expected.length && timingSafeEqual(signature, expected);
      const reason = valid
        ? expired
          ? `signature valid but token is expired (exp ${body.exp} is in the past)`
          : undefined
        : "signature mismatch: token was not signed with this secret";
      return ok({
        valid,
        header: head,
        payload: body,
        ...(expired ? { expired: true } : {}),
        ...(reason !== undefined ? { reason } : {}),
      });
    },
  ),
];

await runStdioServer(tools, { serverName: "mcp-crypto", serverVersion: "0.1.0" });
