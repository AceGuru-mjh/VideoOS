// @videoos/mcp-web — 网络读取服务器（Issue #34，SPEC §3.5 mcp-web 表）。
// 工具：web.fetch（http/https 抓取，重定向 ≤ 5，字节上限，HTML 剥标签抽正文）、
//       web.dns（A/AAAA 解析合并去重）。不做搜索（不引入任何搜索 API key）。
import { defineTool, runStdioServer } from "@videoos/mcp-lite";
import { z } from "zod/v4";
import { resolve4, resolve6 } from "node:dns/promises";

/** 可跟随的重定向状态码（其余 3xx 一律按最终响应处理） */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
/** 重定向跳数上限：最多跟随 5 次（第 6 次出现即报错） */
const MAX_REDIRECTS = 5;

/** fetch 异常统一包装：保证错误消息里含 "fetch failed"（便于上层识别网络类失败） */
function fetchErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.toLowerCase().includes("fetch failed") ? msg : `fetch failed: ${msg}`;
}

/** URL 协议门禁：仅 http(s)；解析失败或其它协议一律拒绝 */
function httpUrlOf(raw: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null;
}

/** HTML → 正文抽取：(1) 去 script/style；(2) 有 <body> 只取 body；(3) 块级标签 → 换行；(4) 去标签；(5) 解实体；(6) 折叠空白/空行 */
export function extractHtmlText(html: string): string {
  let s = html;
  // (1) 整段剔除 <script>…</script> 与 <style>…</style>（大小写不敏感，跨行匹配）
  s = s.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
  // (2) 若存在 <body>…</body> 只保留该段（head 残留标签一并丢弃）
  const body = /<body[\s\S]*?<\/body>/i.exec(s);
  if (body !== null) s = body[0];
  // (3) 块级结束标签 / <br> → 换行（保留段落结构）
  s = s.replace(/<br\s*\/?>|<\/(?:p|div|li|tr|h[1-6]|blockquote)>/gi, "\n");
  // (4) 剥掉其余所有标签
  s = s.replace(/<[^>]*>/g, "");
  // (5) 实体解码（&amp; 最后解，避免 "&amp;lt;" 被二次解码成 "<"）
  s = s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
  // (6) 行内 [ \t]+ 折叠为单空格；逐行 trim；连续空行压成一行空行
  s = s.replace(/[ \t]+/g, " ");
  const lines = s.split("\n").map((line) => line.trim());
  const kept: string[] = [];
  for (const line of lines) {
    if (line === "" && (kept.length === 0 || kept[kept.length - 1] === "")) continue;
    kept.push(line);
  }
  return kept.join("\n").trim();
}

/** 有字节上限地读取响应体：恰好到顶时多读一次判断流是否结束（精确设置 truncated） */
async function readBodyCapped(res: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  if (res.body === null) return { text: "", truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || value === undefined) break;
    if (total + value.length <= maxBytes) {
      chunks.push(value);
      total += value.length;
      if (total === maxBytes) {
        // 恰好读满上限：再读一次区分「正文恰好 maxBytes」与「还有更多」
        const next = await reader.read();
        if (next.done) break;
        truncated = true;
        await reader.cancel().catch(() => {
          /* 取消失败不影响已读内容 */
        });
        break;
      }
      continue;
    }
    // 该 chunk 越过上限：只保留到 maxBytes，必然截断
    const keep = maxBytes - total;
    chunks.push(value.slice(0, keep));
    total = maxBytes;
    truncated = true;
    await reader.cancel().catch(() => {
      /* ignore */
    });
    break;
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return { text: new TextDecoder().decode(merged), truncated };
}

const webFetch = defineTool({
  name: "web.fetch",
  description: "抓取 http(s) 资源：跟随重定向（≤5 跳）、字节上限、text/html 剥标签抽正文",
  schema: z.object({
    url: z.string().min(1),
    maxBytes: z.number().int().min(1024).max(8_388_608).default(262_144),
    timeoutMs: z.number().int().min(1000).max(60_000).default(15_000),
  }),
  call: async (args) => {
    // 协议门禁最先做：仅 http/https（ftp:/file:/data: 等一律拒绝）
    if (httpUrlOf(args.url) === null) return { ok: false, error: "only http(s) URLs are allowed" };
    try {
      let current = args.url;
      let response: Response | null = null;
      let finalUrl = args.url;
      // 初始请求 + 最多 5 次重定向跟随（第 6 次重定向 → too many redirects）
      for (let request = 0; request <= MAX_REDIRECTS; request++) {
        const res = await fetch(current, { redirect: "manual", signal: AbortSignal.timeout(args.timeoutMs) });
        if (REDIRECT_STATUSES.has(res.status)) {
          const location = res.headers.get("location");
          if (location === null) return { ok: false, error: `redirect (${res.status}) without location header` };
          const next = httpUrlOf(new URL(location, current).toString());
          if (next === null) return { ok: false, error: "only http(s) URLs are allowed" };
          current = next.toString();
          await res.arrayBuffer().catch(() => {
            /* 重定向响应体直接丢弃 */
          });
          continue;
        }
        response = res;
        finalUrl = current;
        break;
      }
      if (response === null) return { ok: false, error: `too many redirects (limit ${MAX_REDIRECTS})` };
      const contentType = response.headers.get("content-type") ?? "";
      const { text, truncated } = await readBodyCapped(response, args.maxBytes);
      const body = contentType.includes("text/html") ? extractHtmlText(text) : text;
      return {
        ok: true,
        data: { url: finalUrl, status: response.status, contentType, text: body, truncated },
      };
    } catch (err) {
      return { ok: false, error: fetchErrorMessage(err) };
    }
  },
});

const webDns = defineTool({
  name: "web.dns",
  description: "DNS 解析主机名：A + AAAA 记录合并去重（node:dns/promises）",
  schema: z.object({ hostname: z.string().min(1) }),
  call: async (args) => {
    try {
      const [v4, v6] = await Promise.allSettled([resolve4(args.hostname), resolve6(args.hostname)]);
      const addresses: string[] = [];
      for (const result of [v4, v6]) {
        if (result.status !== "fulfilled") continue;
        for (const addr of result.value) {
          if (!addresses.includes(addr)) addresses.push(addr);
        }
      }
      if (addresses.length === 0) {
        const reason = v4.status === "rejected" ? v4.reason : v6.status === "rejected" ? v6.reason : "no addresses";
        const msg = reason instanceof Error ? reason.message : String(reason);
        return { ok: false, error: `dns lookup failed: ${msg}` };
      }
      return { ok: true, data: { addresses } };
    } catch (err) {
      return { ok: false, error: `dns lookup failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
});

await runStdioServer([webFetch, webDns], { serverName: "mcp-web", serverVersion: "0.1.0" });
