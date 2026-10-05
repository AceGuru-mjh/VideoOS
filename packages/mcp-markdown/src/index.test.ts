// mcp-markdown 协议级 E2E：spawn 真子进程，走 initialize → tools/list → tools/call 全链路。
import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { spawnLiteServer } from "@videoos/mcp-lite/testing";

const SERVER = join(import.meta.dir, "index.ts");

const DOC = [
  "# Title", // 1
  "", // 2
  "intro text", // 3
  "", // 4
  "## Section A", // 5
  "### Sub A", // 6
  "", // 7
  "```", // 8
  "# fenced heading", // 9
  "```", // 10
  "", // 11
  "## Section B", // 12
].join("\n");

describe("mcp-markdown (E2E)", () => {
  it(
    "exposes 5 md.* tools",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        expect(server.tools.map((t) => t.name).sort()).toEqual([
          "md.frontmatter",
          "md.links",
          "md.outline",
          "md.tables",
          "md.toc",
        ]);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "md.outline lists headings with levels and line numbers, skipping fences",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const r = await server.call("md.outline", { text: DOC });
        expect(r.ok).toBe(true);
        const data = r.data as { headings: Array<{ level: number; text: string; line: number }>; count: number };
        expect(data.count).toBe(4);
        expect(data.headings).toEqual([
          { level: 1, text: "Title", line: 1 },
          { level: 2, text: "Section A", line: 5 },
          { level: 3, text: "Sub A", line: 6 },
          { level: 2, text: "Section B", line: 12 },
        ]);

        const notHeadings = await server.call("md.outline", { text: "#hashtag\n####### seven hashes\n" });
        expect((notHeadings.data as { count: number }).count).toBe(0);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "md.toc renders indented anchors and respects maxDepth",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const r = await server.call("md.toc", { text: DOC });
        expect(r.ok).toBe(true);
        const data = r.data as { toc: string; count: number };
        expect(data.count).toBe(4);
        expect(data.toc).toBe(
          "- [Title](#title)\n  - [Section A](#section-a)\n    - [Sub A](#sub-a)\n  - [Section B](#section-b)",
        );

        const shallow = await server.call("md.toc", { text: DOC, maxDepth: 2 });
        const shallowData = shallow.data as { toc: string; count: number };
        expect(shallowData.count).toBe(3);
        expect(shallowData.toc).not.toContain("Sub A");

        const dup = await server.call("md.toc", { text: "# Same\n\n## Same\n" });
        expect((dup.data as { toc: string }).toc).toBe("- [Same](#same)\n  - [Same](#same-1)");
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "md.frontmatter parses key:value fields with quote stripping",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const r = await server.call("md.frontmatter", {
          text: '---\ntitle: My Video\ntags: "demo, intro"\nplain: yes\n---\n\n# Body\n',
        });
        expect(r.ok).toBe(true);
        const data = r.data as { has: boolean; fields: Record<string, string> };
        expect(data.has).toBe(true);
        expect(data.fields).toEqual({ title: "My Video", tags: "demo, intro", plain: "yes" });

        const none = await server.call("md.frontmatter", { text: "# Just a doc\n" });
        expect(none.data).toMatchObject({ has: false, fields: {} });

        const unterminated = await server.call("md.frontmatter", { text: "---\ntitle: x\n" });
        expect((unterminated.data as { has: boolean }).has).toBe(false);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "md.tables extracts headers, rows and line numbers",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const r = await server.call("md.tables", {
          text: "| Name | Age |\n| --- | ---: |\n| Bob | 42 |\n| Ann | 33 |\n\nplain text\n\na | b\n--- | ---\n1 | 2\n",
        });
        expect(r.ok).toBe(true);
        const data = r.data as {
          tables: Array<{ headers: string[]; rows: string[][]; line: number; rowCount: number }>;
          count: number;
        };
        expect(data.count).toBe(2);
        expect(data.tables[0]).toEqual({
          headers: ["Name", "Age"],
          rows: [["Bob", "42"], ["Ann", "33"]],
          line: 1,
          rowCount: 2,
        });
        expect(data.tables[1]).toEqual({
          headers: ["a", "b"],
          rows: [["1", "2"]],
          line: 8,
          rowCount: 1,
        });
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "md.links separates links and images and skips fenced code",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const r = await server.call("md.links", {
          text: 'See [docs](https://example.com) and ![alt text](img.png).\n\n[missing](https://x.com "with title")\n\n```\n[not a link](fenced)\n```\n',
        });
        expect(r.ok).toBe(true);
        const data = r.data as {
          links: Array<{ text: string; url: string; line: number }>;
          images: Array<{ alt: string; url: string; line: number }>;
          linkCount: number;
          imageCount: number;
        };
        expect(data.links).toEqual([
          { text: "docs", url: "https://example.com", line: 1 },
          { text: "missing", url: "https://x.com", line: 3 },
        ]);
        expect(data.images).toEqual([{ alt: "alt text", url: "img.png", line: 1 }]);
        expect(data.linkCount).toBe(2);
        expect(data.imageCount).toBe(1);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "md.outline handles empty input and invalid args return -32602",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const empty = await server.call("md.outline", { text: "" });
        expect(empty.ok).toBe(true);
        expect((empty.data as { count: number }).count).toBe(0);

        const missing = await server.call("md.toc", {});
        expect(missing.ok).toBe(false);
        expect(missing.error).toContain("-32602");

        const badDepth = await server.call("md.toc", { text: "# x", maxDepth: 9 });
        expect(badDepth.ok).toBe(false);
        expect(badDepth.error).toContain("-32602");
      } finally {
        await server.close();
      }
    },
    20_000,
  );
});
