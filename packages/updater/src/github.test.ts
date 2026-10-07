// GitHubReleasesProvider 测试（fetchImpl 注入，全离线）：
// 200 正常解析 / 304 etag 复用 / 404 → null / 403 → 限流错误 / 网络异常 / UA 头 / token / 渠道过滤
import { describe, expect, test } from "bun:test";
import { VIDEOOS_VERSION } from "@videoos/core";
import { GitHubReleasesProvider } from "./github";
import { UpdaterError } from "./provider";
import type { FetchLike, FetchLikeInit } from "./provider";

/** GitHub release API 形状的 fixture（未知字段模拟真实返回） */
function ghRelease(tag: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    url: "https://api.github.com/repos/x/y/releases/1",
    tag_name: tag,
    name: tag,
    draft: false,
    prerelease: false,
    published_at: "2026-02-01T00:00:00Z",
    body: `## ${tag}\n- feat: something`,
    assets: [
      { name: "checksums.txt", browser_download_url: `https://dl/${tag}/checksums.txt`, size: 300 },
      { name: "videoos-linux-x64.tar.gz", browser_download_url: `https://dl/${tag}/videoos-linux-x64.tar.gz`, size: 1000 },
    ],
    ...extra,
  };
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

interface Captured {
  url: string;
  init: FetchLikeInit | undefined;
}

function captureFetch(handler: (c: Captured) => Response): { fetchImpl: FetchLike; calls: Captured[] } {
  const calls: Captured[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const c = { url, init };
    calls.push(c);
    return handler(c);
  };
  return { fetchImpl, calls };
}

describe("GitHubReleasesProvider", () => {
  test("latest：200 → 解析 tag/version/channel/notes/assets", async () => {
    const { fetchImpl, calls } = captureFetch(() => jsonResponse(200, ghRelease("v0.4.0")));
    const provider = new GitHubReleasesProvider({ fetchImpl });
    const rel = await provider.latest();
    expect(rel).not.toBeNull();
    expect(rel?.version).toBe("0.4.0");
    expect(rel?.tag).toBe("v0.4.0");
    expect(rel?.channel).toBe("stable");
    expect(rel?.notes).toContain("feat");
    expect(rel?.assets.map((a) => a.name)).toEqual(["checksums.txt", "videoos-linux-x64.tar.gz"]);
    // UA 头 videoos/<version>
    expect(calls[0]?.init?.headers?.["user-agent"]).toBe(`videoos/${VIDEOOS_VERSION}`);
  });

  test("latest：404（无任何 Release）→ null", async () => {
    const { fetchImpl } = captureFetch(() => jsonResponse(404, { message: "Not Found" }));
    const provider = new GitHubReleasesProvider({ fetchImpl });
    expect(await provider.latest()).toBeNull();
  });

  test("latest：403 → RATE_LIMIT 友好错误（含 token 建议）", async () => {
    const { fetchImpl } = captureFetch(() => jsonResponse(403, { message: "rate limited" }));
    const provider = new GitHubReleasesProvider({ fetchImpl });
    const err = await provider.latest().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpdaterError);
    expect((err as UpdaterError).code).toBe("RATE_LIMIT");
    expect((err as UpdaterError).message).toContain("VIDEOOS_GITHUB_TOKEN");
  });

  test("网络异常 → NETWORK 错误", async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error("ECONNREFUSED");
    };
    const provider = new GitHubReleasesProvider({ fetchImpl });
    const err = await provider.latest().catch((e: unknown) => e);
    expect((err as UpdaterError).code).toBe("NETWORK");
  });

  test("etag：第二次请求带 If-None-Match，304 → 用缓存体（不再消耗配额）", async () => {
    const etag = '"W/\\"abc123\\""';
    let hitCount = 0;
    const { fetchImpl, calls } = captureFetch((c) => {
      if (c.init?.headers?.["if-none-match"] === etag) {
        hitCount += 1;
        return new Response(null, { status: 304 });
      }
      return jsonResponse(200, ghRelease("v0.4.0"), { etag });
    });
    const provider = new GitHubReleasesProvider({ fetchImpl });
    const first = await provider.latest();
    const second = await provider.latest();
    expect(first?.version).toBe("0.4.0");
    expect(second?.version).toBe("0.4.0");
    expect(hitCount).toBe(1);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.init?.headers?.["if-none-match"]).toBe(etag);
  });

  test("list：stable 过滤 prerelease；beta 含 prerelease", async () => {
    const body = [
      ghRelease("v0.5.0-beta.1", { prerelease: true }),
      ghRelease("v0.4.1"),
      ghRelease("v0.4.0"),
    ];
    const { fetchImpl } = captureFetch(() => jsonResponse(200, body));
    const provider = new GitHubReleasesProvider({ fetchImpl });
    const stable = await provider.list(10, "stable");
    expect(stable.map((r) => r.version)).toEqual(["0.4.1", "0.4.0"]);
    const beta = await provider.list(10, "beta");
    expect(beta.map((r) => r.version)).toEqual(["0.5.0-beta.1", "0.4.1", "0.4.0"]);
    expect(beta[0]?.channel).toBe("beta");
  });

  test("release：容忍 v 前缀，404 → null", async () => {
    const { fetchImpl } = captureFetch((c) =>
      c.url.endsWith("/releases/tags/v0.4.0") ? jsonResponse(200, ghRelease("v0.4.0")) : jsonResponse(404, {}),
    );
    const provider = new GitHubReleasesProvider({ fetchImpl });
    expect((await provider.release("v0.4.0"))?.version).toBe("0.4.0");
    expect((await provider.release("0.4.0"))?.version).toBe("0.4.0");
    expect(await provider.release("9.9.9")).toBeNull();
  });

  test("token：authorization Bearer 头（构造参数或 VIDEOOS_GITHUB_TOKEN）", async () => {
    const { fetchImpl, calls } = captureFetch(() => jsonResponse(200, ghRelease("v0.4.0")));
    const provider = new GitHubReleasesProvider({ fetchImpl, token: "ghp_test" });
    await provider.latest();
    expect(calls[0]?.init?.headers?.authorization).toBe("Bearer ghp_test");
  });

  test("非 JSON 响应 → PARSE 错误", async () => {
    const fetchImpl: FetchLike = async () => new Response("<html>proxy error</html>", { status: 200 });
    const provider = new GitHubReleasesProvider({ fetchImpl });
    const err = await provider.latest().catch((e: unknown) => e);
    expect((err as UpdaterError).code).toBe("PARSE");
  });
});
