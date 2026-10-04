// 框架核心：微型 describe/it 收集器 + QaContext（依赖注入 + LRU 帧缓存）+ runSuites 执行器 + 报告序列化。
// bun:test 兼容策略（简化方案）：统一使用本包收集器（bun 测试文件里收集、手动调 runCollected(ctx) 执行），
// 无 bun 环境依赖 —— server/CLI 亦可直接 runSuites(手动构造的 Suite[])。
import { createHash } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import type { Canvas, ImageData } from "@napi-rs/canvas";
import type { CompileResult } from "@videoos/compiler";
import type { RenderedFrame, Renderer } from "@videoos/render-canvas";
import type { Vir, VirScene } from "@videoos/vir";
import { QA_INTERNAL, QaAssertionError } from "./types";
import type {
  FrameSubject, QaContext, QaInternals, QaOptions, QaReport, SceneSubject,
  Suite, SuiteResult, SuiteTest, TestFn, TestResult,
} from "./types";

const DEFAULT_GOLDEN_DIR = "tests/golden";
const FRAME_CACHE_CAPACITY = 8;

const round = (n: number, digits = 4): number => Number(n.toFixed(digits));

// ---------------------------------------------------------------------------
// virHash：SHA-256(canonicalJson(vir))（SPEC 附录 B；M3 cache 应与本实现收敛）
// ---------------------------------------------------------------------------

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => canonicalize(v)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(record[k])}`).join(",")}}`;
}

export function computeVirHash(vir: Vir): string {
  return createHash("sha256").update(canonicalize(vir)).digest("hex");
}

// ---------------------------------------------------------------------------
// QaContext 实现（compile/renderer 注入 + LRU(8) 帧渲染缓存 + notes）
// ---------------------------------------------------------------------------

class QaContextImpl implements QaContext, QaInternals {
  readonly compile: CompileResult;
  readonly renderer: Renderer;
  readonly options: Required<QaOptions>;
  readonly totalFrames: number;
  private readonly frameCache = new Map<number, { rendered: RenderedFrame; imageData?: ImageData }>();
  private notes: Record<string, unknown> = {};

  constructor(compileResult: CompileResult, renderer: Renderer, options: QaOptions) {
    if (options.goldenDir !== undefined && (typeof options.goldenDir !== "string" || options.goldenDir.length === 0)) {
      throw new Error("createQaContext: options.goldenDir must be a non-empty string when provided");
    }
    // 契约防线：断言语义（framePlan）与像素（renderer）必须来自同一 VIR，否则结果不可信
    const expected = computeVirHash(compileResult.vir);
    if (computeVirHash(renderer.vir) !== expected) {
      throw new Error(`createQaContext: renderer.vir does not match compile.vir (expected sha256 ${expected.slice(0, 12)}…); create the renderer from the same CompileResult`);
    }
    this.compile = compileResult;
    this.renderer = renderer;
    this.options = {
      updateGolden: options.updateGolden === true,
      goldenDir:
        options.goldenDir !== undefined && isAbsolute(options.goldenDir)
          ? options.goldenDir
          : resolve(process.cwd(), options.goldenDir ?? DEFAULT_GOLDEN_DIR),
    };
    this.totalFrames = Math.max(0, renderer.totalFrames);
  }

  get [QA_INTERNAL](): QaInternals {
    return this;
  }

  clampFrame(frame: number): number {
    if (typeof frame !== "number" || !Number.isFinite(frame)) {
      throw new QaAssertionError(`Invalid frame index ${String(frame)}: expected a finite number`, { assertion: "frame", frame: String(frame) });
    }
    return Math.max(0, Math.floor(Math.min(frame, this.totalFrames - 1)));
  }

  frame(n: number): FrameSubject {
    return { kind: "frame", frame: this.clampFrame(n), [QA_INTERNAL]: this };
  }

  scene(name: string): SceneSubject {
    const scene = this.findScene(name);
    return { kind: "scene", name: scene.name, [QA_INTERNAL]: this };
  }

  findScene(name: string): VirScene {
    const scenes = this.compile.vir.scenes;
    const scene = scenes.find((s) => s.name === name) ?? scenes.find((s) => s.id === name);
    if (scene === undefined) {
      throw new QaAssertionError(
        `Scene not found: "${name}" (available: ${scenes.map((s) => s.name).join(", ") || "<none>"})`,
        { assertion: "scene", scene: name, availableScenes: scenes.map((s) => s.name) },
      );
    }
    return scene;
  }

  private touchCache(frame: number): { rendered: RenderedFrame; imageData?: ImageData } | undefined {
    const hit = this.frameCache.get(frame);
    if (hit !== undefined) {
      this.frameCache.delete(frame);
      this.frameCache.set(frame, hit); // 刷新 LRU 新鲜度
    }
    return hit;
  }

  private storeCache(frame: number): { rendered: RenderedFrame; imageData?: ImageData } {
    const entry = { rendered: this.renderer.renderFrame(frame) };
    this.frameCache.set(frame, entry);
    while (this.frameCache.size > FRAME_CACHE_CAPACITY) {
      const oldest = this.frameCache.keys().next().value;
      if (oldest === undefined) break;
      this.frameCache.delete(oldest);
    }
    return entry;
  }

  frameRendered(frame: number): RenderedFrame {
    return (this.touchCache(frame) ?? this.storeCache(frame)).rendered;
  }

  frameImageData(frame: number): ImageData {
    let entry = this.touchCache(frame);
    if (entry === undefined) entry = this.storeCache(frame);
    if (entry.imageData === undefined) {
      const canvas = entry.rendered.canvas as Canvas;
      entry.imageData = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
    }
    return entry.imageData;
  }

  get frameCacheSize(): number {
    return this.frameCache.size;
  }

  recordDetails(details: Record<string, unknown>): void {
    Object.assign(this.notes, details);
  }

  drainDetails(): Record<string, unknown> {
    const drained = this.notes;
    this.notes = {};
    return drained;
  }
}

/**
 * 创建 QA 上下文（一切断言的依赖注入入口）。
 * 该上下文同时被设为「活动上下文」——未绑定的全局 frame()/scene() 工厂（SPEC §5.1 直用风格）使用它；
 * 需要显式控制时用 setActiveQaContext(ctx | null)。
 */
export function createQaContext(compile: CompileResult, renderer: Renderer, options: QaOptions = {}): QaContext {
  const ctx = new QaContextImpl(compile, renderer, options);
  activeContext = ctx;
  return ctx;
}

// ---------------------------------------------------------------------------
// 全局 frame()/scene() 工厂（SPEC §5.1 `import { frame, scene } from "@videoos/qa"` 风格）
// ---------------------------------------------------------------------------

let activeContext: QaContext | null = null;

export function setActiveQaContext(ctx: QaContext | null): void {
  activeContext = ctx;
}

export function frame(n: number): FrameSubject {
  if (activeContext === null) {
    throw new QaAssertionError("No active QA context: call createQaContext() (or setActiveQaContext) before using frame()", { assertion: "frame" });
  }
  return activeContext.frame(n);
}

export function scene(name: string): SceneSubject {
  if (activeContext === null) {
    throw new QaAssertionError("No active QA context: call createQaContext() (or setActiveQaContext) before using scene()", { assertion: "scene" });
  }
  return activeContext.scene(name);
}

// ---------------------------------------------------------------------------
// 微型 describe/it 收集器
// ---------------------------------------------------------------------------

const collectedSuites: Suite[] = [];
const suiteStack: Suite[] = [];

export function describe(suite: string, fn: () => void): void {
  if (typeof suite !== "string" || suite.length === 0) throw new Error("describe(): suite name must be a non-empty string");
  if (typeof fn !== "function") throw new Error(`describe(${JSON.stringify(suite)}): callback must be a function`);
  const parent = suiteStack[suiteStack.length - 1];
  const entry: Suite = { name: parent !== undefined ? `${parent.name} > ${suite}` : suite, tests: [] };
  collectedSuites.push(entry);
  suiteStack.push(entry);
  try {
    fn();
  } finally {
    suiteStack.pop();
  }
}

function currentSuite(): Suite {
  const current = suiteStack[suiteStack.length - 1];
  if (current === undefined) throw new Error('it(): must be called inside describe("...", () => { ... })');
  return current;
}

function itImpl(name: string, fn: TestFn): void {
  if (typeof name !== "string" || name.length === 0) throw new Error("it(): test name must be a non-empty string");
  if (typeof fn !== "function") throw new Error(`it(${JSON.stringify(name)}): test body must be a function`);
  currentSuite().tests.push({ name, fn });
}

function itSkipImpl(name: string, fn?: TestFn): void {
  if (typeof name !== "string" || name.length === 0) throw new Error("it.skip(): test name must be a non-empty string");
  if (fn !== undefined && typeof fn !== "function") throw new Error(`it.skip(${JSON.stringify(name)}): test body must be a function when provided`);
  currentSuite().tests.push({ name, fn: fn ?? (() => {}), skip: true });
}

export interface ItFn {
  (name: string, fn: TestFn): void;
  /** 跳过该用例（runner 记 skip，不执行）；fn 可省略 */
  skip(name: string, fn?: TestFn): void;
}

export const it: ItFn = Object.assign(itImpl, { skip: itSkipImpl });

/** 清空收集器（跨测试文件复用模块时的隔离手段；runCollected 也会自动清空） */
export function clearCollected(): void {
  collectedSuites.length = 0;
  suiteStack.length = 0;
}

export function collectedSuiteCount(): number {
  return collectedSuites.length;
}

// ---------------------------------------------------------------------------
// runSuites：顺序执行，捕获 QaAssertionError / 未知异常 → TestResult
// ---------------------------------------------------------------------------

export async function runSuites(suites: Suite[], ctx: QaContext): Promise<QaReport> {
  const startedAt = performance.now();
  const internals = ctx[QA_INTERNAL];
  const previousActive = activeContext;
  activeContext = ctx; // 运行期全局 frame()/scene() 绑定到当前 ctx
  const suiteResults: SuiteResult[] = [];
  let totalPassed = 0;
  let totalFailed = 0;
  try {
    for (const suite of suites) {
      const suiteStartedAt = performance.now();
      const results: TestResult[] = [];
      let passed = 0;
      let failed = 0;
      let skipped = 0;
      for (const test of suite.tests) {
        if (test.skip === true) {
          skipped++;
          results.push({ name: test.name, suite: suite.name, status: "skip" });
          continue;
        }
        internals.drainDetails(); // 丢弃上一用例残留 notes
        try {
          await test.fn();
          const details = internals.drainDetails();
          passed++;
          results.push({ name: test.name, suite: suite.name, status: "pass", ...(Object.keys(details).length > 0 ? { details } : {}) });
        } catch (err) {
          failed++;
          if (err instanceof QaAssertionError) {
            const notes = internals.drainDetails();
            results.push({
              name: test.name, suite: suite.name, status: "fail", message: err.message,
              details: { ...notes, ...err.details },
            });
          } else {
            results.push({
              name: test.name, suite: suite.name, status: "fail",
              message: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
      totalPassed += passed;
      totalFailed += failed;
      suiteResults.push({
        suite: suite.name, passed, failed, skipped, results,
        durationMs: round(performance.now() - suiteStartedAt, 3),
      });
    }
  } finally {
    activeContext = previousActive;
  }
  return {
    suites: suiteResults,
    totalPassed,
    totalFailed,
    durationMs: round(performance.now() - startedAt, 3),
    virHash: computeVirHash(ctx.compile.vir),
  };
}

/** 执行收集器中的全部套件（bun test 文件的入口），执行后自动清空收集器 */
export async function runCollected(ctx: QaContext): Promise<QaReport> {
  const suites = collectedSuites.splice(0, collectedSuites.length).map((s) => ({
    name: s.name,
    tests: s.tests.map((t) => ({ ...t })),
  }));
  return runSuites(suites, ctx);
}

// ---------------------------------------------------------------------------
// 报告序列化：Buffer/Uint8Array → 摘要占位（避免 JSON 爆炸；diff PNG 以文件路径为准）
// ---------------------------------------------------------------------------

export function toReportJson(report: QaReport): string {
  return JSON.stringify(
    report,
    // 注意：JSON.stringify 会先调用 toJSON 再进 replacer —— Buffer.toJSON() 产出 {type:"Buffer",data:[...]}，
    // 故除 Uint8Array 外还需识别该形状（否则二进制数组泄漏进 JSON）。
    (_key, value: unknown) => {
      if (value instanceof Uint8Array) return `<binary ${value.length} bytes>`;
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        const shape = value as { type?: unknown; data?: unknown };
        if (shape.type === "Buffer" && Array.isArray(shape.data)) {
          return `<binary ${shape.data.length} bytes>`;
        }
      }
      return value;
    },
    2,
  );
}
