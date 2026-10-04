// AgentMemory 测试：项目事实合并 / 失败记忆追加与限量
import { describe, expect, it } from "bun:test";
import { AgentMemory } from "./memory";
import type { WorkspaceLike } from "./session";

function fakeWorkspace(): WorkspaceLike & { files: Map<string, unknown> } {
  const files = new Map<string, unknown>();
  return {
    files,
    root: "/fake/project",
    async readMemory(name: string) {
      return files.has(name) ? (files.get(name) as unknown) : null;
    },
    async writeMemory(name: string, data: unknown) {
      files.set(name, data);
    },
    transactions: {
      async begin() {
        throw new Error("not needed in memory tests");
      },
      async list() {
        return [];
      },
    },
  };
}

describe("AgentMemory", () => {
  it("rememberFact 合并写回、recallFacts 全量返回", async () => {
    const ws = fakeWorkspace();
    const memory = new AgentMemory(ws);
    expect(await memory.recallFacts()).toEqual({});
    await memory.rememberFact("resolution", "1920x1080");
    await memory.rememberFact("brandColor", "#6d28d9");
    await memory.rememberFact("resolution", "1280x720"); // 覆盖同 key
    const facts = await memory.recallFacts();
    expect(facts).toEqual({ resolution: "1280x720", brandColor: "#6d28d9" });
    // 存储形状：project.json = { facts: {...} }
    expect(ws.files.get("project")).toEqual({
      facts: { resolution: "1280x720", brandColor: "#6d28d9" },
    });
  });

  it("recordFailure 追加（at 缺省自动时间戳）、recallFailures 限量取尾部", async () => {
    const memory = new AgentMemory(fakeWorkspace());
    await memory.recordFailure({ task: "tool:scene.modify", error: "PATTERN_NOT_FOUND: ...", hint: "重写文件" });
    await memory.recordFailure({ task: "tool:test.run", error: "QA failed", at: "2026-01-01T00:00:00.000Z" });
    const all = await memory.recallFailures();
    expect(all).toHaveLength(2);
    expect(all[0]!.task).toBe("tool:scene.modify");
    expect(all[0]!.at).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO 时间戳
    expect(all[1]!.at).toBe("2026-01-01T00:00:00.000Z");
    const tail = await memory.recallFailures(1);
    expect(tail).toHaveLength(1);
    expect(tail[0]!.task).toBe("tool:test.run");
    expect(await memory.recallFailures(0)).toEqual([]);
    expect(await memory.recallFailures(99)).toHaveLength(2);
  });

  it("rememberFact 空 key 抛错", async () => {
    const memory = new AgentMemory(fakeWorkspace());
    expect(memory.rememberFact("", 1)).rejects.toThrow(/non-empty/);
  });
});
