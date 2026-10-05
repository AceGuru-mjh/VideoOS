// mcp-web 协议级 E2E：禁止真外网——web.fetch 全部用 node:http 在 127.0.0.1 随机端口起 mock server 喂假响应；
// web.dns 只测 localhost / 保留域。每个 mock server 用后 closeAllConnections + close，防句柄悬挂。
import { describe, expect, it } from "bun:test";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { AddressInfo } from "node:net";
import { spawnLiteServer } from "@videoos/mcp-lite/testing";

const SERVER = join(import.meta.dir, "index.ts");

interface MockServer {
  url: string;
  close(): Promise<void>;
}

async function startMock(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<MockServer> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    async close(): Promise<void> {
      await new Promise<void>((resolve) => {
        (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
        const timer = setTimeout(() => resolve(), 1_000);
        server.close(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    },
  };
}

describe("mcp-web (E2E)", () => {
  it(
    "exposes web.fetch and web.dns",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        expect(server.tools.map((t) => t.name).sort()).toEqual(["web.dns", "web.fetch"]);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "web.fetch returns status/contentType/text for a plain body",
    async () => {
      const mock = await startMock((_req, res) => {
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8", connection: "close" });
        res.end("hello from mock");
      });
      const server = await spawnLiteServer(SERVER);
      try {
        const result = await server.call("web.fetch", { url: `${mock.url}/data` });
        expect(result.ok).toBe(true);
        const data = result.data as { status: number; contentType: string; text: string; truncated: boolean };
        expect(data.status).toBe(200);
        expect(data.contentType).toContain("text/plain");
        expect(data.text).toBe("hello from mock");
        expect(data.truncated).toBe(false);
      } finally {
        await server.close();
        await mock.close();
      }
    },
    20_000,
  );

  it(
    "web.fetch strips html down to readable text (no script/style, block tags become newlines)",
    async () => {
      const mock = await startMock((_req, res) => {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", connection: "close" });
        res.end(
          "<html><head><style>.x{color:red}</style></head><body>" +
            "<script>var evil = 1;</script>" +
            "<h1>Title Here</h1><p>First para.</p><p>Second para.</p>" +
            "<div>tail &amp; more</div></body></html>",
        );
      });
      const server = await spawnLiteServer(SERVER);
      try {
        const result = await server.call("web.fetch", { url: mock.url });
        expect(result.ok).toBe(true);
        const data = result.data as { status: number; text: string; htmlStripped: boolean; truncated: boolean };
        expect(data.status).toBe(200);
        expect(data.htmlStripped).toBe(true);
        expect(data.text).toContain("Title Here");
        expect(data.text).toContain("First para.");
        expect(data.text).toContain("Second para.");
        expect(data.text).toContain("tail & more");
        expect(data.text).not.toContain("evil");
        expect(data.text).not.toContain("color:red");
        expect(data.text).not.toContain("<");
        expect(data.truncated).toBe(false);
      } finally {
        await server.close();
        await mock.close();
      }
    },
    20_000,
  );

  it(
    "web.fetch reports non-2xx statuses as data (404 stays ok)",
    async () => {
      const mock = await startMock((_req, res) => {
        res.writeHead(404, { "content-type": "text/plain", connection: "close" });
        res.end("not found");
      });
      const server = await spawnLiteServer(SERVER);
      try {
        const result = await server.call("web.fetch", { url: mock.url });
        expect(result.ok).toBe(true);
        expect((result.data as { status: number }).status).toBe(404);
      } finally {
        await server.close();
        await mock.close();
      }
    },
    20_000,
  );

  it(
    "web.fetch stops reading at maxBytes (truncated:true)",
    async () => {
      const mock = await startMock((_req, res) => {
        res.writeHead(200, { "content-type": "text/plain", connection: "close" });
        res.end("y".repeat(300_000));
      });
      const server = await spawnLiteServer(SERVER);
      try {
        const result = await server.call("web.fetch", { url: mock.url, maxBytes: 1_000 });
        expect(result.ok).toBe(true);
        const data = result.data as { text: string; truncated: boolean };
        expect(data.truncated).toBe(true);
        expect(data.text.length).toBe(1_000);
      } finally {
        await server.close();
        await mock.close();
      }
    },
    20_000,
  );

  it(
    "web.fetch follows up to 5 redirects",
    async () => {
      const mock = await startMock((req, res) => {
        if (req.url === "/a") {
          res.writeHead(302, { location: "/b", connection: "close" });
          res.end();
        } else {
          res.writeHead(200, { "content-type": "text/plain", connection: "close" });
          res.end("landed");
        }
      });
      const server = await spawnLiteServer(SERVER);
      try {
        const result = await server.call("web.fetch", { url: `${mock.url}/a` });
        expect(result.ok).toBe(true);
        const data = result.data as { status: number; text: string };
        expect(data.status).toBe(200);
        expect(data.text).toBe("landed");
      } finally {
        await server.close();
        await mock.close();
      }
    },
    20_000,
  );

  it(
    "web.fetch rejects redirect loops with E_REDIRECT",
    async () => {
      const mock = await startMock((_req, res) => {
        res.writeHead(302, { location: "/loop", connection: "close" });
        res.end();
      });
      const server = await spawnLiteServer(SERVER);
      try {
        const result = await server.call("web.fetch", { url: `${mock.url}/loop` });
        expect(result.ok).toBe(false);
        expect(result.error).toContain("E_REDIRECT");
      } finally {
        await server.close();
        await mock.close();
      }
    },
    20_000,
  );

  it(
    "web.fetch rejects non-http schemes (E_URL) and times out on silent servers (E_TIMEOUT)",
    async () => {
      const silent = await startMock(() => {
        // 永不响应
      });
      const server = await spawnLiteServer(SERVER);
      try {
        const ftp = await server.call("web.fetch", { url: "ftp://example.com/file" });
        expect(ftp.ok).toBe(false);
        expect(ftp.error).toContain("E_URL");

        const garbage = await server.call("web.fetch", { url: "not a url at all" });
        expect(garbage.ok).toBe(false);
        expect(garbage.error).toContain("E_URL");

        const started = Date.now();
        const timeout = await server.call("web.fetch", { url: silent.url, timeoutMs: 500 });
        expect(Date.now() - started).toBeLessThan(5_000);
        expect(timeout.ok).toBe(false);
        expect(timeout.error).toContain("E_TIMEOUT");
      } finally {
        await server.close();
        await silent.close();
      }
    },
    20_000,
  );

  it(
    "web.dns resolves localhost to loopback addresses",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const result = await server.call("web.dns", { hostname: "localhost" });
        expect(result.ok).toBe(true);
        const data = result.data as { addresses: string[]; hostname: string };
        expect(data.hostname).toBe("localhost");
        expect(data.addresses.length).toBeGreaterThanOrEqual(1);
        expect(data.addresses.some((a) => a === "127.0.0.1" || a === "::1")).toBe(true);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "web.dns fails with E_DNS for unresolvable hosts and E_HOST for garbage",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const missing = await server.call("web.dns", { hostname: "mcp-web-no-such-host.invalid" });
        expect(missing.ok).toBe(false);
        expect(missing.error).toContain("E_DNS");

        const garbage = await server.call("web.dns", { hostname: "bad host name!" });
        expect(garbage.ok).toBe(false);
        expect(garbage.error).toContain("E_HOST");
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
        const missing = await server.call("web.fetch", {});
        expect(missing.ok).toBe(false);
        expect(missing.error).toContain("-32602");

        const scheme = await server.call("web.fetch", { url: 42 });
        expect(scheme.ok).toBe(false);
        expect(scheme.error).toContain("-32602");

        const empty = await server.call("web.dns", { hostname: "" });
        expect(empty.ok).toBe(false);
        expect(empty.error).toContain("-32602");
      } finally {
        await server.close();
      }
    },
    20_000,
  );
});
