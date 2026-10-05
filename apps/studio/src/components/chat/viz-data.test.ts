// S5 可视化数据层（viz-data.ts）双语单元测试。
// 覆盖三类契约：
//  1. i18n 契约 —— pipelineStepLabel / deriveUsage 趋势行 title 在真实词典
//     （zh/en 聚合词典经 translate）下的双语输出，保证键位接线正确；
//  2. 冻结映射契约 —— stepOfTool 的工具 → 步骤表（任务书冻结 + 诊断归 QA 裁量）；
//  3. 派生逻辑契约 —— 步骤状态机 / 会话聚合 / 用量聚合 / 截断安全解析
//     （resultSummary 是服务端 ≤300 字符压缩串，JSON 截断必须走正则回退）。
// 纯函数模块：无 React、无 store —— 测试直接构造 VizRun / 消息记录 fixture。
import { describe, expect, test } from "bun:test";
import { translate } from "../../i18n/core";
import { zh } from "../../i18n/zh";
import { en } from "../../i18n/en";
import type { TranslateFn } from "../../i18n/format";
import type * as api from "../../api";
import type { ActiveRun } from "../../store";
import {
  aggregateStepStates,
  collectRuns,
  deriveStepStates,
  deriveUsage,
  errorFromSummary,
  fmtBytesLocal,
  fmtK,
  fmtMs,
  numFromSummary,
  parseQaFailFrame,
  PIPELINE_STEPS,
  pipelineStepLabel,
  stepOfTool,
  TREND_MAX,
  type VizRun,
  type VizToolCall,
} from "./viz-data";

/** 真实词典支撑的翻译函数（与 format.test.ts 同款 —— 键接线也被验证） */
const zhT: TranslateFn = (key, params) => translate(zh, key, params);
const enT: TranslateFn = (key, params) => translate(en, key, params);

/** 最小 VizToolCall fixture（error 为运行时可选附加字段：toolErrorText 经 as-cast 读取） */
function tc(
  name: string,
  status: VizToolCall["status"],
  durationMs = 100,
  extra: Partial<VizToolCall> & { error?: string } = {},
): VizToolCall {
  return { name, status, durationMs, ...extra };
}

/** 最小 VizRun fixture */
function run(over: Partial<VizRun> = {}): VizRun {
  return {
    key: "r1",
    createdAt: 1_700_000_000_000,
    status: "ok",
    toolCalls: [],
    text: "",
    usage: null,
    error: null,
    ...over,
  };
}

// ------------------------------------------------------------ i18n 契约

describe("pipelineStepLabel — 真实词典双语", () => {
  test("六步 zh 标签（规划/DSL/编译/预览/QA/渲染）", () => {
    expect(pipelineStepLabel("plan", zhT)).toBe("规划");
    expect(pipelineStepLabel("dsl", zhT)).toBe("DSL");
    expect(pipelineStepLabel("compile", zhT)).toBe("编译");
    expect(pipelineStepLabel("preview", zhT)).toBe("预览");
    expect(pipelineStepLabel("qa", zhT)).toBe("QA");
    expect(pipelineStepLabel("render", zhT)).toBe("渲染");
  });

  test("六步 en 标签（Plan/DSL/Compile/Preview/QA/Render）", () => {
    expect(pipelineStepLabel("plan", enT)).toBe("Plan");
    expect(pipelineStepLabel("dsl", enT)).toBe("DSL");
    expect(pipelineStepLabel("compile", enT)).toBe("Compile");
    expect(pipelineStepLabel("preview", enT)).toBe("Preview");
    expect(pipelineStepLabel("qa", enT)).toBe("QA");
    expect(pipelineStepLabel("render", enT)).toBe("Render");
  });

  test("PIPELINE_STEPS 顺序与唯一性（canonical 六步）", () => {
    expect(PIPELINE_STEPS.map((s) => s.id)).toEqual(["plan", "dsl", "compile", "preview", "qa", "render"]);
    expect(new Set(PIPELINE_STEPS.map((s) => s.id)).size).toBe(6);
  });
});

describe("deriveUsage 趋势行 title — 双语插值", () => {
  const fixture: VizRun[] = [
    run({
      key: "a",
      status: "ok",
      usage: { promptTokens: 800, completionTokens: 50 },
      toolCalls: [tc("compile.run", "ok", 1200), tc("render.preview", "ok", 950)],
    }),
  ];

  test("zh：任务 1 · 完成 · 2 次调用 · 2.1s · 850 tokens", () => {
    const snap = deriveUsage(fixture, zhT);
    expect(snap.trendRuns[0]?.title).toBe("任务 1 · 完成 · 2 次调用 · 2.1s · 850 tokens");
  });

  test("en：Run 1 · done · 2 calls · 2.1s · 850 tokens", () => {
    const snap = deriveUsage(fixture, enT);
    expect(snap.trendRuns[0]?.title).toBe("Run 1 · done · 2 calls · 2.1s · 850 tokens");
  });

  test("无 usage 的运行不加 tokens 后缀（title 止于时长）", () => {
    const snap = deriveUsage([run({ key: "b", toolCalls: [tc("compile.run", "ok", 500)] })], zhT);
    expect(snap.trendRuns[0]?.title).toBe("任务 1 · 完成 · 1 次调用 · 500ms");
    expect(snap.trendRuns[0]?.title).not.toContain("tokens");
  });

  test("四种状态词双语映射（running/ok/error/stopped）", () => {
    const runs: VizRun[] = [
      run({ key: "1", status: "running" }),
      run({ key: "2", status: "ok" }),
      run({ key: "3", status: "error" }),
      run({ key: "4", status: "stopped" }),
    ];
    const zhTitles = deriveUsage(runs, zhT).trendRuns.map((r) => r.title);
    const enTitles = deriveUsage(runs, enT).trendRuns.map((r) => r.title);
    expect(zhTitles[0]).toContain("进行中");
    expect(zhTitles[1]).toContain("完成");
    expect(zhTitles[2]).toContain("出错");
    expect(zhTitles[3]).toContain("已停止");
    expect(enTitles[0]).toContain("running");
    expect(enTitles[1]).toContain("done");
    expect(enTitles[2]).toContain("error");
    expect(enTitles[3]).toContain("stopped");
  });
});

// ------------------------------------------------------------ 冻结映射

describe("stepOfTool — 工具 → 步骤冻结表", () => {
  test("规划：storyboard.plan / storyboard.toScenes", () => {
    expect(stepOfTool("storyboard.plan")).toBe("plan");
    expect(stepOfTool("storyboard.toScenes")).toBe("plan");
  });

  test("DSL：scene.* / layer.* / audio.set / asset.add", () => {
    expect(stepOfTool("scene.create")).toBe("dsl");
    expect(stepOfTool("scene.update")).toBe("dsl");
    expect(stepOfTool("layer.add")).toBe("dsl");
    expect(stepOfTool("audio.set")).toBe("dsl");
    expect(stepOfTool("asset.add")).toBe("dsl");
  });

  test("编译：compile.*（run/get/status 全系）", () => {
    expect(stepOfTool("compile.run")).toBe("compile");
    expect(stepOfTool("compile.get")).toBe("compile");
  });

  test("预览：render.preview / render.range（render.status/cancel 不驱动）", () => {
    expect(stepOfTool("render.preview")).toBe("preview");
    expect(stepOfTool("render.range")).toBe("preview");
    expect(stepOfTool("render.status")).toBeNull();
    expect(stepOfTool("render.cancel")).toBeNull();
  });

  test("QA：test.* + 视觉检查诊断（inspect.frame / diff.frames / check.*）", () => {
    expect(stepOfTool("test.run")).toBe("qa");
    expect(stepOfTool("test.golden")).toBe("qa");
    expect(stepOfTool("inspect.frame")).toBe("qa");
    expect(stepOfTool("diff.frames")).toBe("qa");
    expect(stepOfTool("check.color")).toBe("qa");
  });

  test("渲染：render.final；未映射类（transaction/cache/asset.list/audio.list）→ null", () => {
    expect(stepOfTool("render.final")).toBe("render");
    expect(stepOfTool("transaction.begin")).toBeNull();
    expect(stepOfTool("cache.stats")).toBeNull();
    expect(stepOfTool("asset.list")).toBeNull();
    expect(stepOfTool("audio.list")).toBeNull();
  });
});

// ------------------------------------------------------------ 步骤状态机

describe("deriveStepStates — 单次运行状态机", () => {
  test("运行中且无任何工具 → 规划步 active（思考/规划中）", () => {
    const states = deriveStepStates(run({ status: "running", text: "" }));
    expect(states[0]?.status).toBe("active");
    expect(states.slice(1).every((s) => s.status === "pending")).toBe(true);
  });

  test("已有工具后的规划文本 → 规划步 done 且 untimed", () => {
    const states = deriveStepStates(
      run({ status: "ok", text: "先规划一下", toolCalls: [tc("compile.run", "ok", 800)] }),
    );
    expect(states[0]?.status).toBe("done");
    expect(states[0]?.timed).toBe(false);
    expect(states[2]?.status).toBe("done"); // compile
  });

  test("ok 调用 → done 且耗时求和、timed=true", () => {
    const states = deriveStepStates(
      run({ toolCalls: [tc("compile.run", "ok", 800), tc("compile.get", "ok", 200)] }),
    );
    const compile = states[2];
    expect(compile?.status).toBe("done");
    expect(compile?.durationMs).toBe(1000);
    expect(compile?.timed).toBe(true);
    expect(compile?.calls).toBe(2);
  });

  test("error 调用 → failed 且提取 errorText（error 字段优先）", () => {
    const states = deriveStepStates(
      run({ toolCalls: [tc("compile.run", "error", 0, { error: "SYNTAX: bad dsl" })] }),
    );
    const compile = states[2];
    expect(compile?.status).toBe("failed");
    expect(compile?.errorText).toBe("SYNTAX: bad dsl");
  });

  test("start 调用 → active（转圈）", () => {
    const states = deriveStepStates(run({ status: "running", toolCalls: [tc("render.preview", "start")] }));
    expect(states[3]?.status).toBe("active");
  });

  test("全部 stopped → pending（未执行即停止）", () => {
    const states = deriveStepStates(run({ status: "stopped", toolCalls: [tc("compile.run", "stopped")] }));
    expect(states[2]?.status).toBe("pending");
  });
});

describe("aggregateStepStates — 全会话聚合", () => {
  test("任一运行 ok 即 done；runs 计出现次数；耗时跨运行求和", () => {
    const aggregated = aggregateStepStates([
      run({ key: "a", toolCalls: [tc("compile.run", "ok", 500)] }),
      run({ key: "b", toolCalls: [tc("compile.run", "ok", 300)] }),
      run({ key: "c", toolCalls: [tc("render.preview", "ok", 100)] }),
    ]);
    expect(aggregated.runCount).toBe(3);
    const compile = aggregated.steps[2];
    expect(compile?.status).toBe("done");
    expect(compile?.durationMs).toBe(800);
    expect(compile?.runs).toBe(2);
    expect(compile?.calls).toBe(2);
    expect(aggregated.steps[3]?.runs).toBe(1); // preview 只在一个运行出现
  });

  test("规划文本点亮：任一运行有规划文本 → plan done（runs ≥ 1）", () => {
    const aggregated = aggregateStepStates([run({ key: "a", text: "规划文本" }), run({ key: "b" })]);
    expect(aggregated.steps[0]?.status).toBe("done");
    expect(aggregated.steps[0]?.runs).toBe(1);
  });

  test("有调用但全部失败 → failed 且保留首个 errorText", () => {
    const aggregated = aggregateStepStates([
      run({ key: "a", toolCalls: [tc("compile.run", "error", 0, { error: "E1" })] }),
    ]);
    expect(aggregated.steps[2]?.status).toBe("failed");
    expect(aggregated.steps[2]?.errorText).toBe("E1");
  });
});

// ------------------------------------------------------------ 用量聚合

describe("deriveUsage — 聚合与尽力而为解析", () => {
  test("token 聚合与渲染计数（preview×1 帧 / range 走 from-to / final / 去重成片）", () => {
    const snap = deriveUsage(
      [
        run({
          key: "a",
          usage: { promptTokens: 800, completionTokens: 200 },
          toolCalls: [
            tc("render.preview", "ok", 100),
            tc("render.range", "ok", 200, { args: { from: 10, to: 29 } }), // 20 帧
            tc("render.range", "ok", 200, { args: { from: 0, to: 4 } }), // 5 帧（args 优先于结果）
            tc("render.range", "ok", 200, { args: {}, resultSummary: '{"frames":9}' }), // args 缺失 → 结果 9
            tc("render.final", "ok", 300, { videoUrl: "/out/a.mp4" }),
            tc("render.final", "ok", 300, { videoUrl: "/out/a.mp4" }), // 去重
          ],
        }),
      ],
      zhT,
    );
    expect(snap.promptTokens).toBe(800);
    expect(snap.completionTokens).toBe(200);
    expect(snap.previewCalls).toBe(1);
    expect(snap.rangeCalls).toBe(3);
    expect(snap.previewFrames).toBe(1 + 20 + 5 + 9);
    expect(snap.finalCalls).toBe(2);
    expect(snap.videos).toHaveLength(1);
    expect(snap.videos[0]?.name).toBe("a.mp4");
  });

  test("缓存聚合：render.final 的 cacheHits/Misses 求和；cache.stats 取最近快照", () => {
    const snap = deriveUsage(
      [
        run({
          key: "a",
          toolCalls: [
            tc("render.final", "ok", 300, { resultSummary: '{"cacheHits":4,"cacheMisses":1}' }),
            tc("render.final", "ok", 300, { resultSummary: '{"cacheHits":2,"cacheMisses":0}' }),
            tc("cache.stats", "ok", 10, { resultSummary: '{"entries":42,"bytes":1048576}' }),
          ],
        }),
      ],
      zhT,
    );
    expect(snap.cacheHits).toBe(6);
    expect(snap.cacheMisses).toBe(1);
    expect(snap.cacheEntries).toBe(42);
    expect(snap.cacheBytes).toBe(1_048_576);
  });

  test("无可解析缓存数据 → null（不误报 0）", () => {
    const snap = deriveUsage([run({ key: "a", toolCalls: [tc("compile.run", "ok", 10)] })], zhT);
    expect(snap.cacheHits).toBeNull();
    expect(snap.cacheMisses).toBeNull();
    expect(snap.cacheEntries).toBeNull();
    expect(snap.cacheBytes).toBeNull();
  });

  test(`TREND_MAX 截断：${TREND_MAX + 1} 次运行 → 趋势仅最近 ${TREND_MAX} 条，totalRuns 全量`, () => {
    const many: VizRun[] = Array.from({ length: TREND_MAX + 1 }, (_, i) =>
      run({ key: `r${i}`, toolCalls: [tc("compile.run", "ok", 10)] }),
    );
    const snap = deriveUsage(many, zhT);
    expect(snap.totalRuns).toBe(TREND_MAX + 1);
    expect(snap.trendRuns).toHaveLength(TREND_MAX);
    expect(snap.trendRuns[snap.trendRuns.length - 1]?.key).toBe(`r${TREND_MAX}`);
    // 序号是全会话 1-based（截断不重排）
    expect(snap.trendRuns[snap.trendRuns.length - 1]?.title).toContain(`任务 ${TREND_MAX + 1}`);
  });
});

// ------------------------------------------------------------ 截断安全解析

describe("numFromSummary — JSON 截断回退", () => {
  test("完整 JSON：顶层与 data 包裹两层都能取", () => {
    expect(numFromSummary('{"frames":33}', "frames")).toBe(33);
    expect(numFromSummary('{"data":{"frames":33},"ok":true}', "frames")).toBe(33);
  });

  test("截断 JSON：正则回退取前缀数字", () => {
    const truncated = '{"frames":33,"scenes":[{"name":"intro","layers":[{"text":"很长…';
    expect(numFromSummary(truncated, "frames")).toBe(33);
  });

  test("缺失 / 非数字 / 空串 → null", () => {
    expect(numFromSummary(undefined, "frames")).toBeNull();
    expect(numFromSummary("", "frames")).toBeNull();
    expect(numFromSummary('{"other":1}', "frames")).toBeNull();
    expect(numFromSummary('{"frames":"not-a-number"}', "frames")).toBeNull();
  });
});

describe("parseQaFailFrame — QA 失败帧提取", () => {
  test("深走 suites[].results[]：fail + details.frame", () => {
    const summary = JSON.stringify({
      data: { suites: [{ name: "visual", results: [{ status: "pass" }, { status: "fail", details: { frame: 42 } }] }] },
    });
    expect(parseQaFailFrame(summary)).toBe(42);
  });

  test("fail + message 中的 frame N 文本", () => {
    const summary = JSON.stringify({ suites: [{ results: [{ status: "fail", message: "color drift at frame 17" }] }] });
    expect(parseQaFailFrame(summary)).toBe(17);
  });

  test("字符串帧号（数字字符串）也能取", () => {
    const summary = JSON.stringify({ suites: [{ results: [{ status: "fail", details: { frame: "23" } }] }] });
    expect(parseQaFailFrame(summary)).toBe(23);
  });

  test("截断 JSON 回退首个 \"frame\":N", () => {
    expect(parseQaFailFrame('{"suites":[{"results":[{"status":"fail","details":{"frame":88}…')).toBe(88);
  });

  test("无失败 / 空输入 → null", () => {
    expect(parseQaFailFrame(undefined)).toBeNull();
    expect(parseQaFailFrame('{"suites":[{"results":[{"status":"pass"}]}]}')).toBeNull();
  });
});

describe("errorFromSummary — 错误文本提取", () => {
  test("JSON error 字段", () => {
    expect(errorFromSummary('{"error":"boom"}')).toBe("boom");
  });

  test("截断回退 \"error\":\"…（≤200 字符，捕获含尾部省略号）", () => {
    expect(errorFromSummary('{"error":"trunc…')).toBe("trunc…");
  });

  test("无 error / 空输入 → null", () => {
    expect(errorFromSummary(undefined)).toBeNull();
    expect(errorFromSummary('{"ok":true}')).toBeNull();
  });
});

// ------------------------------------------------------------ collectRuns

describe("collectRuns — 会话 → 运行列表", () => {
  function msg(id: string, over: Partial<api.ChatMessageRecord> = {}): api.ChatMessageRecord {
    return { id, role: "assistant", content: "hi", createdAt: 1, ...over };
  }

  test("只收带工具调用的 assistant 消息", () => {
    const runs = collectRuns(
      [
        msg("u1", { role: "user", content: "task" }),
        msg("a1", { toolCalls: [{ name: "compile.run", args: {}, status: "ok", durationMs: 5 }] }),
        msg("a2"), // 纯文本回复
      ],
      null,
      "s1",
    );
    expect(runs.map((r) => r.key)).toEqual(["a1"]);
  });

  test("liveRun 同会话且未落库 → 追加；已落库（runId 去重）→ 不重复", () => {
    const live: ActiveRun = {
      runId: "run-9",
      sessionId: "s1",
      userText: "task",
      status: "running",
      toolCalls: [],
      text: "",
      steps: 0,
      usage: null,
      stopRequested: false,
      error: null,
    };
    const appended = collectRuns([], live, "s1");
    expect(appended).toHaveLength(1);
    expect(appended[0]?.key).toBe("live-run-9");

    const persisted = collectRuns(
      [msg("a1", { runId: "run-9", toolCalls: [{ name: "compile.run", args: {}, status: "ok", durationMs: 5 }] })],
      live,
      "s1",
    );
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.key).toBe("a1");
  });

  test("liveRun 属于其他会话 → 不追加", () => {
    const live: ActiveRun = {
      runId: "run-x",
      sessionId: "other",
      userText: "",
      status: "running",
      toolCalls: [],
      text: "",
      steps: 0,
      usage: null,
      stopRequested: false,
      error: null,
    };
    expect(collectRuns([], live, "s1")).toHaveLength(0);
  });
});

// ------------------------------------------------------------ 紧凑格式化

describe("fmtK / fmtMs / fmtBytesLocal — 技术串（双语一致）", () => {
  test("fmtK：980 / 12.3k / 1.04M", () => {
    expect(fmtK(980)).toBe("980");
    expect(fmtK(12_345)).toBe("12.3k");
    expect(fmtK(1_040_000)).toBe("1.04M");
  });

  test("fmtMs：230ms / 1.4s / 1m03s", () => {
    expect(fmtMs(230)).toBe("230ms");
    expect(fmtMs(1400)).toBe("1.4s");
    expect(fmtMs(63_000)).toBe("1m03s");
  });

  test("fmtBytesLocal：512 B / 1.2 KB / 3.3 MB（1024 进制）", () => {
    expect(fmtBytesLocal(512)).toBe("512 B");
    expect(fmtBytesLocal(1230)).toBe("1.2 KB");
    expect(fmtBytesLocal(3_500_000)).toBe("3.3 MB");
  });
});
