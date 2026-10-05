// @videoos/mcp-web —— 网络读取服务器（stdio MCP）：web.fetch（http/https 正文抓取）+ web.dns（域名解析）。
// 关键设计：只允许 http/https（否则 E_URL）；手动跟随重定向 ≤5 跳（E_REDIRECT 兜底）；
// 流式读 body 到 maxBytes 即停读（truncated:true）；text/html 抽正文（剥 script/style、块级标签转行）再截 64KB；
// 全程 AbortSignal.timeout（超时 → E_TIMEOUT）；不做搜索、不引入任何 API key。
import { promises as dnsPromises } from "node:dns";
import { defineTool, ok, runStdioServer, ToolError, truncateBytes } from "@videoos/mcp-lite";
import { z } from "zod";

const HTML_TEXT_CAP = 65_536; // html 抽出的正文再截断的上限
const REDIRECT_LIMIT = 5; // 重定向跳数上限（SPEC §3.5）
const USER_AGENT = "videoos-mcp-web/0.1";

/** 块级标签的闭合标签 → 换行（配合 <br>/<hr> → 换行，保住正文分段） */
const BLOCK_CLOSE_RE =
  /<\/(?:p|div|section|article|aside|header|footer|main|nav|table|thead|tbody|tfoot|tr|td|th|li|ul|ol|dl|dd|dt|h[1-6]|blockquote|pre|figure|figcaption|form|fieldset|address|details|summary|option|select|label|legend|center|body|html|title)\s*>/gi;

/** text/html → 纯正文：去注释/script/style/template、块级标签转行、剥其余标签、解码常见实体 */
function htmlToText(html: string): string {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, " ")
    .replace(BLOCK_CLOSE_RE, "\n")
    .replace(/<(?:br|hr)\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&(?:#0?39|#x27|apos);/gi, "'")
    .replace(/&#(\d+);/g, (match, decimal: string) => {
      const code = Number.parseInt(decimal, 10);
      return code > 0 && code <= 0x10ffff ? safeCodePoint(code) : match;
    })
    .replace(/&#x([0-9a-f]+);/gi, (match, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return code > 0 && code <= 0x10ffff ? safeCodePoint(code) : match;
    });
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

function safeCodePoint(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return "\uFFFD";
  }
}

/** 流式读 body：到 maxBytes 即 cancel（truncated:true），避免大响应拖垮内存 */
async function readBodyCapped(response: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  if (response.body === null) return { text: "", truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || value === undefined) break;
    const remain = maxBytes - received;
    if (value.length > remain) {
      if (remain > 0) chunks.push(value.subarray(0, remain));
      received = maxBytes;
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
    received += value.length;
  }
  return { text: Buffer.concat(chunks).toString("utf8"), truncated };
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isTimeoutError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.name === "TimeoutError" || error.name === "AbortError" || /timed? ?out/i.test(error.message);
  }
  return /timed? ?out/i.test(String(error));
}

const tools = [
  defineTool(
    "web.fetch",
    "Fetch an http/https URL and return status, content type and body text (html pages are stripped to readable text); follows up to 5 redirects.",
    z.object({
      url: z.string().describe("absolute http(s) URL, e.g. \"https://example.com/api\""),
      maxBytes: z
        .number()
        .int()
        .min(1)
        .max(2_097_152)
        .default(262_144)
        .describe("body read cap in bytes (default 256KB; reading stops beyond it with truncated:true)"),
      timeoutMs: z.number().int().min(100).max(30_000).default(15_000).describe("per-request timeout (default 15000)"),
    }),
    async ({ url, maxBytes, timeoutMs }) => {
      let current: URL;
      try {
        current = new URL(url);
      } catch {
        throw new ToolError("E_URL", `not a valid URL: ${JSON.stringify(url)}`);
      }
      if (current.protocol !== "http:" && current.protocol !== "https:") {
        throw new ToolError("E_URL", `only http/https URLs are supported (got "${current.protocol}")`);
      }
      const original = current;
      let response: Response | undefined;
      for (let hop = 0; hop <= REDIRECT_LIMIT; hop++) {
        let res: Response;
        try {
          res = await fetch(current, {
            redirect: "manual",
            signal: AbortSignal.timeout(timeoutMs),
            headers: { "user-agent": USER_AGENT, accept: "*/*" },
          });
        } catch (error) {
          if (isTimeoutError(error)) {
            throw new ToolError("E_TIMEOUT", `request to ${current.href} timed out after ${timeoutMs}ms`);
          }
          throw new ToolError("E_FETCH", `request to ${current.href} failed: ${errMsg(error)}`);
        }
        const location = res.headers.get("location");
        if (res.status >= 300 && res.status < 400 && location !== null && location.length > 0) {
          await res.body?.cancel().catch(() => {});
          if (hop === REDIRECT_LIMIT) {
            throw new ToolError("E_REDIRECT", `too many redirects (more than ${REDIRECT_LIMIT}) while fetching ${original.href}`);
          }
          try {
            current = new URL(location, current);
          } catch {
            throw new ToolError("E_REDIRECT", `invalid redirect Location header: ${JSON.stringify(location)}`);
          }
          if (current.protocol !== "http:" && current.protocol !== "https:") {
            throw new ToolError("E_URL", `redirect to non-http protocol: "${current.protocol}"`);
          }
          continue;
        }
        response = res;
        break;
      }
      if (response === undefined) {
        throw new ToolError("E_REDIRECT", `too many redirects (more than ${REDIRECT_LIMIT}) while fetching ${original.href}`);
      }
      const contentType = response.headers.get("content-type") ?? "";
      const { text: raw, truncated } = await readBodyCapped(response, maxBytes);
      if (contentType.toLowerCase().includes("text/html")) {
        const capped = truncateBytes(htmlToText(raw), HTML_TEXT_CAP);
        return ok({
          url: current.href,
          status: response.status,
          contentType,
          text: capped.text,
          truncated: truncated || capped.truncated,
          htmlStripped: true,
        });
      }
      return ok({ url: current.href, status: response.status, contentType, text: raw, truncated });
    },
  ),

  defineTool(
    "web.dns",
    "Resolve a hostname to its IPv4/IPv6 addresses (node:dns resolve4+resolve6 merged); returns E_DNS when nothing resolves.",
    z.object({
      hostname: z.string().min(1).max(253).describe('hostname to resolve, e.g. "localhost" or "example.com"'),
    }),
    async ({ hostname }) => {
      const host = hostname.trim().replace(/\.$/, "");
      if (host.length === 0 || /[^a-zA-Z0-9._-]/.test(host)) {
        throw new ToolError("E_HOST", `not a valid hostname: ${JSON.stringify(hostname)}`);
      }
      const [v4, v6] = await Promise.all([
        dnsPromises.resolve4(host).catch(() => [] as string[]),
        dnsPromises.resolve6(host).catch(() => [] as string[]),
      ]);
      const addresses = [...new Set([...v4, ...v6])];
      if (addresses.length === 0) {
        throw new ToolError("E_DNS", `could not resolve hostname: ${host}`);
      }
      return ok({ hostname: host, addresses });
    },
  ),
];

await runStdioServer(tools, { serverName: "mcp-web", serverVersion: "0.1.0" });
