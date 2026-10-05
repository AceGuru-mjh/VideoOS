// mcp-text 协议级 E2E：spawn 真子进程，走 initialize → tools/list → tools/call 全链路。
import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { spawnLiteServer } from "@videoos/mcp-lite/testing";

const SERVER = join(import.meta.dir, "index.ts");

describe("mcp-text (E2E)", () => {
  it(
    "exposes 6 text.* tools",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        expect(server.tools.map((t) => t.name).sort()).toEqual([
          "text.case",
          "text.extract",
          "text.lines",
          "text.slug",
          "text.stats",
          "text.wrap",
        ]);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "text.stats counts latin + CJK words, bytes, lines, read time",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const latin = await server.call("text.stats", { text: "Hello world" });
        expect(latin.ok).toBe(true);
        expect(latin.data).toMatchObject({ chars: 11, words: 2, bytes: 11, lines: 1, readTimeSec: 0.8 });

        const cjk = await server.call("text.stats", { text: "你好世界" });
        expect(cjk.ok).toBe(true);
        expect(cjk.data).toMatchObject({ chars: 4, words: 4, bytes: 12, lines: 1, readTimeSec: 1.6 });

        const mixed = await server.call("text.stats", { text: "Hello 世界\nsecond line" });
        expect(mixed.data).toMatchObject({ chars: 20, words: 5, bytes: 24, lines: 2, readTimeSec: 2 });

        const trailing = await server.call("text.stats", { text: "a\nb\n" });
        expect(trailing.data).toMatchObject({ lines: 2 });

        const empty = await server.call("text.stats", { text: "" });
        expect(empty.data).toMatchObject({ chars: 0, words: 0, lines: 0, readTimeSec: 0 });
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "text.case converts to all 8 targets",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const cases: Array<[string, string]> = [
          ["camel", "helloWorldFoo"],
          ["pascal", "HelloWorldFoo"],
          ["snake", "hello_world_foo"],
          ["kebab", "hello-world-foo"],
          ["title", "Hello World Foo"],
          ["upper", "HELLO WORLD FOO"],
          ["lower", "hello world foo"],
        ];
        for (const [to, expected] of cases) {
          const r = await server.call("text.case", { text: "Hello world FOO", to });
          expect(r.ok).toBe(true);
          expect((r.data as { result: string }).result).toBe(expected);
        }
        const sentence = await server.call("text.case", { text: "hello WORLD. next ONE", to: "sentence" });
        expect((sentence.data as { result: string }).result).toBe("Hello world. Next one");
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "text.slug slugs, collapses and trims separators",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const basic = await server.call("text.slug", { text: "Hello, World! 你好" });
        expect(basic.ok).toBe(true);
        expect((basic.data as { slug: string }).slug).toBe("hello-world-你好");

        const messy = await server.call("text.slug", { text: "  --Weird   Stuff--  " });
        expect((messy.data as { slug: string }).slug).toBe("weird-stuff");

        const under = await server.call("text.slug", { text: "a_b c", separator: "_" });
        expect((under.data as { slug: string }).slug).toBe("a_b_c");

        const none = await server.call("text.slug", { text: "!!!" });
        expect((none.data as { slug: string }).slug).toBe("");

        const badSep = await server.call("text.slug", { text: "x", separator: "a" });
        expect(badSep.ok).toBe(false);
        expect(badSep.error).toContain("E_ARG");
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "text.lines runs sort / uniq / dedupe / reverse / trim / number",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const sort = await server.call("text.lines", { text: "b\na\nc", op: "sort" });
        expect((sort.data as { result: string }).result).toBe("a\nb\nc");

        const uniq = await server.call("text.lines", { text: "a\na\nb\nb\nc", op: "uniq" });
        expect((uniq.data as { result: string }).result).toBe("a\nb\nc");

        const dedupe = await server.call("text.lines", { text: "a\nb\na\nb", op: "dedupe" });
        expect((dedupe.data as { result: string }).result).toBe("a\nb");

        const reverse = await server.call("text.lines", { text: "1\n2\n3", op: "reverse" });
        expect((reverse.data as { result: string }).result).toBe("3\n2\n1");

        const trim = await server.call("text.lines", { text: "  x  \n  y ", op: "trim" });
        expect((trim.data as { result: string }).result).toBe("x\ny");

        const number = await server.call("text.lines", { text: "a\nb", op: "number" });
        expect((number.data as { result: string }).result).toBe("1. a\n2. b");
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "text.lines shuffle is seeded, deterministic and a permutation",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const text = "a\nb\nc\nd\ne\nf\ng\nh";
        const first = await server.call("text.lines", { text, op: "shuffle", seed: 7 });
        const again = await server.call("text.lines", { text, op: "shuffle", seed: 7 });
        expect(first.ok).toBe(true);
        expect((first.data as { result: string }).result).toBe((again.data as { result: string }).result);

        const other = await server.call("text.lines", { text, op: "shuffle", seed: 99 });
        const shuffled = (other.data as { result: string }).result.split("\n");
        expect(shuffled.slice().sort()).toEqual(text.split("\n"));

        const defaultSeed = await server.call("text.lines", { text, op: "shuffle" });
        expect(defaultSeed.ok).toBe(true);
        expect((defaultSeed.data as { count: number }).count).toBe(8);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "text.wrap wraps words, CJK runs and overlong words",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const words = await server.call("text.wrap", { text: "The quick brown fox jumps", width: 10 });
        expect((words.data as { result: string }).result).toBe("The quick\nbrown fox\njumps");

        const cjk = await server.call("text.wrap", { text: "你好世界测试", width: 4 });
        expect((cjk.data as { result: string }).result).toBe("你好世界\n测试");

        const cjkNarrow = await server.call("text.wrap", { text: "你好世界测试", width: 2 });
        expect((cjkNarrow.data as { result: string }).result).toBe("你好\n世界\n测试");

        const long = await server.call("text.wrap", { text: "abcdefghij", width: 4 });
        expect((long.data as { result: string }).result).toBe("abcd\nefgh\nij");

        const indented = await server.call("text.wrap", { text: "aa bb cc", width: 6, indent: "  " });
        expect((indented.data as { result: string }).result).toBe("  aa\n  bb\n  cc");

        const blank = await server.call("text.wrap", { text: "a\n\nb", width: 10 });
        expect((blank.data as { result: string }).result).toBe("a\n\nb");
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "text.extract matches, filters by group and named groups",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const all = await server.call("text.extract", { text: "a1 b22 c333", pattern: "[a-z](\\d+)" });
        expect(all.ok).toBe(true);
        const allData = all.data as { matches: Array<{ text: string; index: number; groups: unknown[] }>; count: number };
        expect(allData.count).toBe(3);
        expect(allData.matches[0]).toMatchObject({ text: "a1", index: 0, groups: ["1"] });

        const byIndex = await server.call("text.extract", { text: "a1 b22 c333", pattern: "[a-z](\\d+)", group: 1 });
        expect((byIndex.data as { matches: Array<{ text: string }> }).matches.map((m) => m.text)).toEqual(["1", "22", "333"]);

        const named = await server.call("text.extract", {
          text: "John: 25, Jane: 31",
          pattern: "(?<name>[A-Za-z]+): (?<age>\\d+)",
          group: "age",
        });
        expect((named.data as { matches: Array<{ text: string }> }).matches.map((m) => m.text)).toEqual(["25", "31"]);

        const firstOnly = await server.call("text.extract", { text: "aa aa", pattern: "aa", flags: "i" });
        expect(firstOnly.data).toMatchObject({ count: 1, truncated: false });

        const insensitive = await server.call("text.extract", { text: "AB ab", pattern: "ab", flags: "gi" });
        expect((insensitive.data as { count: number }).count).toBe(2);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "text.extract rejects invalid regex and invalid args",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const badPattern = await server.call("text.extract", { text: "x", pattern: "(" });
        expect(badPattern.ok).toBe(false);
        expect(badPattern.error).toContain("E_REGEX");

        const badGroup = await server.call("text.extract", { text: "x", pattern: "x", group: -1 });
        expect(badGroup.ok).toBe(false);
        expect(badGroup.error).toContain("E_ARG");

        const badArgs = await server.call("text.stats", {});
        expect(badArgs.ok).toBe(false);
        expect(badArgs.error).toContain("-32602");

        const badEnum = await server.call("text.case", { text: "x", to: "nope" });
        expect(badEnum.ok).toBe(false);
        expect(badEnum.error).toContain("-32602");
      } finally {
        await server.close();
      }
    },
    20_000,
  );
});
