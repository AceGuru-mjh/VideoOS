// Storyboard 工具测试：确定性模板切分 / toScenes 代码生成 / 注入式 LLM 生成器
import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { createDefaultTools, VapToolRegistry } from "./registry";
import { ShotSchema, shotsToScenesCode, templateShots } from "./tools-storyboard";
import type { VapContext, VapEvent } from "../session";

function stubContext(): { ctx: VapContext; events: VapEvent[] } {
  const events: VapEvent[] = [];
  const ctx = {
    events: {
      emit: (e: VapEvent): void => {
        events.push(e);
      },
      all: (): VapEvent[] => [...events],
    },
  } as unknown as VapContext;
  return { ctx, events };
}

function tool(name: string) {
  const tools = createDefaultTools();
  const found = tools.find((t) => t.name === name);
  if (found === undefined) throw new Error(`tool ${name} not found`);
  return found;
}

describe("templateShots（确定性模板）", () => {
  it("时长分档：<8s 4 镜头 / 8-20s 5 镜头 / >20s 6 镜头", () => {
    expect(templateShots("意图", 6)).toHaveLength(4);
    expect(templateShots("意图", 8)).toHaveLength(5);
    expect(templateShots("意图", 12.5)).toHaveLength(5);
    expect(templateShots("意图", 20)).toHaveLength(6);
    expect(templateShots("意图", 60)).toHaveLength(6);
  });

  it("同输入恒等输出（确定性）；start 累计、总时长守恒", () => {
    const a = templateShots("60 秒产品宣传", 30);
    const b = templateShots("60 秒产品宣传", 30);
    expect(a).toEqual(b);
    let start = 0;
    for (const shot of a) {
      expect(shot.start).toBeCloseTo(start, 5);
      expect(shot.duration).toBeGreaterThan(0);
      start += shot.duration;
    }
    expect(start).toBeCloseTo(30, 5);
    expect(a[0]!.id).toBe("shot_01");
    expect(a.map((s) => s.name)).toEqual(["hook", "problem", "insight", "solution", "proof", "cta"]);
    expect(a[0]!.keyElement).toContain("60 秒产品宣传");
  });
});

describe("shotsToScenesCode", () => {
  it("每 shot 一个 scene（key/sub text 层 + enter 节拍 + crossfade），名字安全化", () => {
    const shots = [
      { id: "shot_01", name: "开场 震撼!", start: 0, duration: 5, purpose: "吸引注意", keyElement: "主标题" },
      { id: "shot_02", name: "痛点", start: 5, duration: 7, purpose: "引发共鸣", keyElement: "痛点三连" },
      { id: "shot_03", name: "2c2b", start: 12, duration: 8, purpose: "展示方案", keyElement: "产品截图" },
    ];
    const code = shotsToScenesCode(shots, { title: "宣传视频" });
    expect(code).toContain('import { defineVideo } from "@videoos/dsl";');
    expect(code).toContain('v.scene("开场震撼-1", { duration: 5 }');
    expect(code).toContain('v.scene("痛点-2", { duration: 7 }');
    expect(code).toContain('v.scene("2c2b-3", { duration: 8 }'); // 数字开头也是合法 DSL 标识符
    expect(code).toContain('s.text("key", "主标题"');
    expect(code).toContain('s.text("sub", "吸引注意"');
    expect(code).toContain('s.beat("enter", { at: 0.2');
    expect(code).toContain('v.transition("crossfade", { duration: 0.4, between: ["开场震撼-1", "痛点-2"] })');
    expect(code).not.toContain("shot_01"); // shot id 不进场景名
  });
});

describe("storyboard 工具（VAP 集成）", () => {
  it("storyboard.plan 默认模板；storyboard.toScenes 返回代码", async () => {
    const { ctx } = stubContext();
    const plan = await tool("storyboard.plan").execute({ intent: "产品发布", durationSeconds: 10 }, ctx);
    expect(plan.ok).toBe(true);
    const data = plan.data as { shots: Array<Record<string, unknown>>; generator: string; totalDuration: number };
    expect(data.generator).toBe("template");
    expect(data.shots).toHaveLength(5);
    expect(data.totalDuration).toBeCloseTo(10, 5);

    const toScenes = await tool("storyboard.toScenes").execute({ shots: data.shots }, ctx);
    expect(toScenes.ok).toBe(true);
    const code = (toScenes.data as { code: string }).code;
    expect(code).toContain("defineVideo");
    expect(code).toContain("storyboard.toScenes");
  });

  it("注入 storyboardGenerator 后走 LLM 路径（shot 校验兜底）", async () => {
    const tools = createDefaultTools({
      storyboardGenerator: async (intent, duration) => [
        { id: "shot_01", name: "custom-shot", start: 0, duration, purpose: `意图：${intent}`, keyElement: "X" },
      ],
    });
    const planTool = tools.find((t) => t.name === "storyboard.plan")!;
    const { ctx } = stubContext();
    const result = await planTool.execute({ intent: "测试", durationSeconds: 4 }, ctx);
    expect(result.ok).toBe(true);
    const data = result.data as { generator: string; shots: Array<{ name: string; duration: number }> };
    expect(data.generator).toBe("llm");
    expect(data.shots[0]!.name).toBe("custom-shot");
    expect(data.shots[0]!.duration).toBe(4);
  });

  it("toScenes 的 shots schema 校验（缺字段被 registry 拦截）", async () => {
    const { ctx } = stubContext();
    const registry = new VapToolRegistry();
    registry.register(tool("storyboard.toScenes"));
    const bad = await registry.call("storyboard.toScenes", { shots: [{ id: "x", name: "y" }] }, ctx);
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/^SCHEMA:/);
  });

  it("ShotSchema 形状（导出供外部生成器对齐）", () => {
    expect(ShotSchema).toBeDefined();
    expect(z.array(ShotSchema).safeParse([{ id: "a", name: "b", start: 0, duration: 1, purpose: "p", keyElement: "k" }]).success).toBe(true);
  });
});
