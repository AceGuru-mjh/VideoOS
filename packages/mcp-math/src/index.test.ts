// mcp-math 协议级 E2E：spawn 真子进程，走 initialize → tools/list → tools/call 全链路。
import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { spawnLiteServer } from "@videoos/mcp-lite/testing";

const SERVER = join(import.meta.dir, "index.ts");

describe("mcp-math (E2E)", () => {
  it(
    "exposes 5 math.* tools",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        expect(server.tools.map((t) => t.name).sort()).toEqual([
          "math.base",
          "math.eval",
          "math.percentage",
          "math.round",
          "math.stats",
        ]);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "math.eval honors precedence, right-assoc ^, unary minus and modulo",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const cases: Array<[string, number]> = [
          ["2 + 3 * 4", 14],
          ["(2 + 3) * 4", 20],
          ["2 ^ 3 ^ 2", 512],
          ["-2 ^ 2", -4],
          ["10 % 3", 1],
          ["2 - -3", 5],
          ["7 / 2", 3.5],
          ["2 * -3", -6],
        ];
        for (const [expression, expected] of cases) {
          const r = await server.call("math.eval", { expression });
          expect(r.ok).toBe(true);
          expect((r.data as { value: number }).value).toBe(expected);
        }
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "math.eval evaluates functions and constants",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const exact: Array<[string, number]> = [
          ["min(3, 1, 2)", 1],
          ["max(3, 1, 2)", 3],
          ["pow(2, 10)", 1024],
          ["sqrt(16) + abs(-2)", 6],
          ["floor(2.9)", 2],
          ["ceil(2.1)", 3],
          ["round(2.5)", 3],
          ["round(-2.5)", -3],
          ["log(1000)", 3],
          ["exp(0)", 1],
          ["max(1, min(5, 2))", 2],
          ["round(2.675, 2)", 2.68],
        ];
        for (const [expression, expected] of exact) {
          const r = await server.call("math.eval", { expression });
          expect(r.ok).toBe(true);
          expect((r.data as { value: number }).value).toBe(expected);
        }

        const ln = await server.call("math.eval", { expression: "ln(e)" });
        expect((ln.data as { value: number }).value).toBeCloseTo(1, 10);

        const pi = await server.call("math.eval", { expression: "pi" });
        expect((pi.data as { value: number }).value).toBeCloseTo(3.141592653589793, 10);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "math.eval formats float noise away (0.1 + 0.2)",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const r = await server.call("math.eval", { expression: "0.1 + 0.2" });
        expect(r.ok).toBe(true);
        const data = r.data as { value: number; formatted: string };
        expect(data.value).toBeCloseTo(0.3, 12);
        expect(data.formatted).toBe("0.3");

        const third = await server.call("math.eval", { expression: "1 / 3" });
        expect((third.data as { formatted: string }).formatted).toBe("0.333333333333");
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "math.eval reports E_PARSE with position and E_MATH for domain errors",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const parseCases: Array<[string, RegExp]> = [
          ["2 +", /E_PARSE.*position/],
          ["(1 + 2", /E_PARSE.*unbalanced/],
          ["1 + 2)", /E_PARSE.*unbalanced/],
          ["foo(1)", /E_PARSE.*unknown function/],
          ["xyz", /E_PARSE.*unknown identifier/],
          ["1 2", /E_PARSE.*malformed/],
          ["pow(2)", /E_PARSE.*expects/],
          ["min()", /E_PARSE.*expects/],
          ["", /E_PARSE.*empty/],
          ["2 $ 3", /E_PARSE.*unexpected character/],
        ];
        for (const [expression, pattern] of parseCases) {
          const r = await server.call("math.eval", { expression });
          expect(r.ok).toBe(false);
          expect(r.error).toMatch(pattern);
        }

        const mathCases = ["1 / 0", "sqrt(-1)", "10 ^ 1000", "ln(0)"];
        for (const expression of mathCases) {
          const r = await server.call("math.eval", { expression });
          expect(r.ok).toBe(false);
          expect(r.error).toContain("E_MATH");
        }
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "math.stats computes summary statistics",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const r = await server.call("math.stats", { numbers: [1, 2, 3, 4] });
        expect(r.ok).toBe(true);
        const data = r.data as {
          count: number;
          sum: number;
          mean: number;
          median: number;
          min: number;
          max: number;
          variance: number;
          stdev: number;
        };
        expect(data.count).toBe(4);
        expect(data.sum).toBe(10);
        expect(data.mean).toBe(2.5);
        expect(data.median).toBe(2.5);
        expect(data.min).toBe(1);
        expect(data.max).toBe(4);
        expect(data.variance).toBeCloseTo(5 / 3, 8);
        expect(data.stdev).toBeCloseTo(Math.sqrt(5 / 3), 8);

        const odd = await server.call("math.stats", { numbers: [3, 1, 2] });
        expect(odd.data).toMatchObject({ median: 2, mean: 2, variance: 1, stdev: 1 });

        const single = await server.call("math.stats", { numbers: [5] });
        expect(single.data).toMatchObject({ median: 5, variance: 0, stdev: 0 });

        const empty = await server.call("math.stats", { numbers: [] });
        expect(empty.ok).toBe(false);
        expect(empty.error).toContain("E_EMPTY");
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "math.base converts between bases 2-36",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const toHex = await server.call("math.base", { value: 255, to: 16 });
        expect(toHex.data).toMatchObject({ value: "ff", digits: 2, decimal: "255", from: 10, to: 16 });

        const toDec = await server.call("math.base", { value: "ff", from: 16, to: 10 });
        expect((toDec.data as { value: string }).value).toBe("255");

        const bin = await server.call("math.base", { value: "1010", from: 2, to: 10 });
        expect((bin.data as { value: string }).value).toBe("10");

        const neg = await server.call("math.base", { value: -255, to: 16 });
        expect(neg.data).toMatchObject({ value: "-ff", digits: 2 });

        const z36 = await server.call("math.base", { value: "zz", from: 36, to: 10 });
        expect((z36.data as { value: string }).value).toBe("1295");

        const back = await server.call("math.base", { value: "1295", to: 36 });
        expect((back.data as { value: string }).value).toBe("zz");

        const badBase = await server.call("math.base", { value: "1", to: 40 });
        expect(badBase.ok).toBe(false);
        expect(badBase.error).toContain("E_BASE");

        const badDigit = await server.call("math.base", { value: "9", from: 8, to: 10 });
        expect(badDigit.ok).toBe(false);
        expect(badDigit.error).toContain("E_PARSE");
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "math.round handles float-error cases and floor/ceil modes",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const r = await server.call("math.round", { value: 1.005, precision: 2 });
        expect(r.ok).toBe(true);
        expect(r.data).toMatchObject({ value: 1.01, formatted: "1.01" });

        const g = await server.call("math.round", { value: 2.675, precision: 2 });
        expect((g.data as { value: number }).value).toBe(2.68);

        const floorExact = await server.call("math.round", { value: 4.27, precision: 2, mode: "floor" });
        expect((floorExact.data as { value: number }).value).toBe(4.27);

        const floorDown = await server.call("math.round", { value: 4.276, precision: 2, mode: "floor" });
        expect((floorDown.data as { value: number }).value).toBe(4.27);

        const ceilUp = await server.call("math.round", { value: 4.271, precision: 2, mode: "ceil" });
        expect((ceilUp.data as { value: number }).value).toBe(4.28);

        const half = await server.call("math.round", { value: 2.5 });
        expect((half.data as { value: number }).value).toBe(3);

        const negHalf = await server.call("math.round", { value: -2.5 });
        expect((negHalf.data as { value: number }).value).toBe(-3);

        const intFloor = await server.call("math.round", { value: 3.7, mode: "floor" });
        expect((intFloor.data as { value: number }).value).toBe(3);

        const intCeil = await server.call("math.round", { value: 3.2, mode: "ceil" });
        expect((intCeil.data as { value: number }).value).toBe(4);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "math.percentage formats with decimals and rejects zero total",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const basic = await server.call("math.percentage", { part: 25, total: 200 });
        expect(basic.data).toMatchObject({ value: 12.5, formatted: "12.5%" });

        const third = await server.call("math.percentage", { part: 1, total: 3 });
        expect(third.data).toMatchObject({ value: 33.3, formatted: "33.3%" });

        const whole = await server.call("math.percentage", { part: 2, total: 3, decimals: 0 });
        expect(whole.data).toMatchObject({ value: 67, formatted: "67%" });

        const zero = await server.call("math.percentage", { part: 0, total: 5 });
        expect(zero.data).toMatchObject({ value: 0, formatted: "0.0%" });

        const negative = await server.call("math.percentage", { part: -25, total: 200 });
        expect(negative.data).toMatchObject({ value: -12.5, formatted: "-12.5%" });

        const bad = await server.call("math.percentage", { part: 1, total: 0 });
        expect(bad.ok).toBe(false);
        expect(bad.error).toContain("E_MATH");
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  it(
    "invalid args return -32602",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const badNumbers = await server.call("math.stats", { numbers: "nope" });
        expect(badNumbers.ok).toBe(false);
        expect(badNumbers.error).toContain("-32602");

        const missingTo = await server.call("math.base", { value: "ff", from: 16 });
        expect(missingTo.ok).toBe(false);
        expect(missingTo.error).toContain("-32602");

        const badPrecision = await server.call("math.round", { value: 1.5, precision: 99 });
        expect(badPrecision.ok).toBe(false);
        expect(badPrecision.error).toContain("-32602");
      } finally {
        await server.close();
      }
    },
    20_000,
  );
});
