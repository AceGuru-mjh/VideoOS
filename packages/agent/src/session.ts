// VapContext 会话（SPEC §6/§7）：一切 VAP 工具的依赖注入对象。
// 职责：entry 动态加载（模块缓存破坏）→ compile → .video/vir.json 落盘 → 渲染器惰性创建（字体自动扫描）
//      → 单帧预览（内容寻址缓存复用 @videoos/cache 同款键）→ renderToVideo → QA 测试收集执行 → 事件审计。
// 关键实现决策（Bun 1.3.14 实测）：动态 import 的 "?t=" 查询参数【不会】破坏模块缓存（模块按真实路径去重，
// 且 Bun.invalidateModule 不存在）→ 采用「同目录唯一副本导入」：复制 entry 到 `<dir>/.videoos-fresh-*.ts`
// 再 import（副本路径唯一 → 必然重新求值；同目录保证 entry 的相对导入（./theme 等）依旧可解析）。
// 已知限制：仅入口文件本身被重新求值；入口相对依赖（src/theme.ts 等）被修改后仍走旧缓存（v1 只编辑入口文件）。
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { secondsToFrames } from "@videoos/core";
import { compile } from "@videoos/compiler";
import type { CompileResult } from "@videoos/compiler";
import { BACKEND_VERSION, ContentStore, FrameCache, frameKey, sha256Hex, virHash } from "@videoos/cache";
import { renderToVideo } from "@videoos/encode";
import type { RenderPipelineResult } from "@videoos/encode";
import { createRenderer } from "@videoos/render-canvas";
import type { FontRegistration, Renderer } from "@videoos/render-canvas";
import { createQaContext, runCollected } from "@videoos/qa";
import type { QaReport } from "@videoos/qa";
import type { VideoDefinition } from "@videoos/dsl";
import type { Vir } from "@videoos/vir";

// ---------------------------------------------------------------------------
// 公共契约
// ---------------------------------------------------------------------------

/** 事务句柄（与 M5 packages/workspace 的 Transaction 结构兼容：id/description/status/commit/rollback） */
export interface TransactionHandle {
  id: string;
  description?: string;
  status: "active" | "committed" | "rolled-back";
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

/**
 * 结构化工作区契约：packages/workspace 的 ProjectWorkspace 满足此形状（M5 并行开发中，本包不 import 它）。
 * readMemory/writeMemory 的落盘路径布局（.video/memory/<name>.json）由 workspace 实现决定。
 */
export interface WorkspaceLike {
  root: string;
  readMemory(name: string): Promise<unknown | null>;
  writeMemory(name: string, data: unknown): Promise<void>;
  transactions: { begin(description?: string): Promise<TransactionHandle>; list(): Promise<unknown[]> };
}

/** VAP 审计事件（每次工具调用/编译/渲染/测试/事务都产生；Studio Agent 面板直接消费） */
export interface VapEvent {
  at: string;
  kind: "tool-call" | "tool-result" | "compile" | "render" | "test" | "transaction";
  tool?: string;
  detail?: unknown;
}

/** emit 入参：at 可省（由会话填充 ISO 时间戳） */
export type VapEventInput = Omit<VapEvent, "at"> & { at?: string };

/** 事件总线（emit 自动补 at；all 返回全部历史） */
export interface VapEventBus {
  emit(e: VapEventInput): void;
  all(): VapEvent[];
}

export interface VapContext {
  workspace: WorkspaceLike;
  events: VapEventBus;
  /** 动态 import entry（模块缓存破坏），返回 defineVideo 产物 */
  loadDefinition(): Promise<VideoDefinition>;
  /** loadDefinition → compile → 写 .video/vir.json（键排序 + 2 空格缩进）→ 返回（并置为 lastCompile） */
  compile(): Promise<CompileResult>;
  readonly lastCompile: CompileResult | null;
  /** 惰性创建渲染器（compile() 后自动失效重建）；assets/fonts/*.{ttf,otf,woff} 自动注册（family=文件名去扩展） */
  getRenderer(): Promise<Renderer>;
  /** 单帧 PNG（内容寻址缓存优先；miss 才渲染并回填，键与 renderToVideo 完全一致 → final 渲染全命中） */
  renderPreviewPng(frame: number): Promise<Buffer>;
  /** renderToVideo（outputDir=.video/renders，cacheRoot=.video/cache） */
  renderFinal(opts?: { scene?: string }): Promise<RenderPipelineResult>;
  /** 动态 import tests/<glob>（收集器）→ createQaContext → runCollected */
  runTests(): Promise<QaReport>;
  listTestFiles(): Promise<string[]>;
}

/** 会话内部扩展面（VAP 工具实现使用；对 MCP/CLI 透明的附加状态） */
export interface VapSession extends VapContext {
  readonly entryPath: string;
  readonly testsGlob: string;
  readonly virPath: string;
  readonly diagnosticsDir: string;
  readonly rendersDir: string;
  readonly cacheRoot: string;
  readonly cacheStore: ContentStore;
  /** 工具层跟踪的当前事务（transaction.commit/rollback 作用对象） */
  currentTransaction: TransactionHandle | null;
  lastQaReport: QaReport | null;
  lastRender: RenderPipelineResult | null;
  /** lastCompile 为空时自动 compile（工具入口统一调用） */
  ensureCompiled(): Promise<CompileResult>;
  /** 扫描项目字体（assets/fonts） */
  scanFonts(): Promise<FontRegistration[]>;
  /** 动态 import 任意项目文件（同目录唯一副本，强制重新求值） */
  freshImport(absolutePath: string): Promise<Record<string, unknown>>;
}

/** 会话错误（code 前缀 SESSION_*；message 以 `${code}: ` 开头便于正则断言） */
export class SessionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "SessionError";
    this.code = code;
  }
}

export interface CreateVapContextOptions {
  workspace: WorkspaceLike;
  /** DSL 入口（默认 <root>/src/video.ts；相对路径按 root 解析） */
  entryPath?: string;
  /** 测试文件 glob，相对 root（默认 "tests/*.test.ts"；支持 ** 与 * 段） */
  testsGlob?: string;
  /** 事件旁路回调（Studio WS / MCP 通知） */
  onEvent?: (e: VapEvent) => void;
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/** 键字典序递归排序后的 JSON.stringify(value, null, 2)（canonical + 可读） */
export function prettyCanonicalJson(value: unknown): string {
  const sortDeep = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortDeep);
    if (v !== null && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        out[k] = sortDeep((v as Record<string, unknown>)[k]);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(sortDeep(value), null, 2);
}

/** glob（仅支持目录段 ** 与段内 *，分隔符 /）→ 匹配函数；不区分 ./ 前缀 */
function compileGlob(pattern: string): (relPath: string) => boolean {
  const segments = pattern.replace(/^\.\//, "").split("/");
  const matchSeg = (seg: string, s: string): boolean => {
    const re = new RegExp(`^${seg.split("*").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
    return re.test(s);
  };
  const match = (segs: string[], parts: string[]): boolean => {
    if (segs.length === 0) return parts.length === 0;
    if (segs[0] === "**") {
      for (let skip = 0; skip <= parts.length; skip++) {
        if (match(segs.slice(1), parts.slice(skip))) return true;
      }
      return false;
    }
    if (parts.length === 0) return false;
    return matchSeg(segs[0]!, parts[0]!) && match(segs.slice(1), parts.slice(1));
  };
  return (relPath: string): boolean => match(segments, relPath.split("/"));
}

const IGNORED_WALK_DIRS = new Set(["node_modules", ".video", ".git", "dist"]);

/** 递归收集 root 下匹配 matcher 的文件（绝对路径，按路径排序）；跳过 node_modules/.video 等目录 */
async function walkFiles(root: string, matcher: (rel: string) => boolean): Promise<string[]> {
  const found: string[] = [];
  const visit = async (dir: string): Promise<void> => {
    let entries: Array<{ name: string; isDirectory: () => boolean }> = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_WALK_DIRS.has(entry.name)) continue;
        await visit(full);
      } else {
        const rel = relative(root, full);
        if (matcher(rel)) found.push(full);
      }
    }
  };
  await visit(root);
  found.sort();
  return found;
}

// ---------------------------------------------------------------------------
// 会话实现
// ---------------------------------------------------------------------------

const DEFAULT_ENTRY = join("src", "video.ts");
const DEFAULT_TESTS_GLOB = join("tests", "*.test.ts");
const FONT_EXTENSIONS = [".ttf", ".otf", ".woff"] as const;

class VapSessionImpl implements VapSession {
  readonly workspace: WorkspaceLike;
  readonly entryPath: string;
  readonly testsGlob: string;
  readonly virPath: string;
  readonly diagnosticsDir: string;
  readonly rendersDir: string;
  readonly cacheRoot: string;
  readonly cacheStore: ContentStore;
  currentTransaction: TransactionHandle | null = null;
  lastQaReport: QaReport | null = null;
  lastRender: RenderPipelineResult | null = null;

  private readonly eventLog: VapEvent[] = [];
  private readonly onEvent?: (e: VapEvent) => void;
  private readonly frameCache: FrameCache;
  private compileResult: CompileResult | null = null;
  /** 上次编译时的 entry 内容哈希（ensureCompiled 据此检测外部修改 → 自动重编译） */
  private entryContentHash: string | null = null;
  private rendererPromise: Promise<Renderer> | null = null;
  private fontsCache: FontRegistration[] | null = null;
  private importCounter = 0;

  constructor(options: CreateVapContextOptions) {
    this.workspace = options.workspace;
    const root = options.workspace.root;
    this.entryPath = isAbsolute(options.entryPath ?? "")
      ? (options.entryPath as string)
      : resolve(root, options.entryPath ?? DEFAULT_ENTRY);
    this.testsGlob = options.testsGlob ?? DEFAULT_TESTS_GLOB;
    this.virPath = join(root, ".video", "vir.json");
    this.diagnosticsDir = join(root, ".video", "diagnostics");
    this.rendersDir = join(root, ".video", "renders");
    this.cacheRoot = join(root, ".video", "cache");
    this.cacheStore = new ContentStore(this.cacheRoot);
    this.frameCache = new FrameCache(this.cacheStore);
    this.onEvent = options.onEvent;
  }

  get events(): VapEventBus {
    return {
      emit: (e: VapEventInput): void => {
        const full: VapEvent = { ...e, at: e.at ?? new Date().toISOString() };
        this.eventLog.push(full);
        this.onEvent?.(full);
      },
      all: (): VapEvent[] => [...this.eventLog],
    };
  }

  get lastCompile(): CompileResult | null {
    return this.compileResult;
  }

  async ensureCompiled(): Promise<CompileResult> {
    // entry 被外部修改（Engineer 直接写文件 / MCP 客户端改盘）时自动重编译，
    // 保证 test.run / render.* / check.* 读到的 VIR 与磁盘源码一致（内容哈希检测，无 mtime 粒度问题）。
    if (this.compileResult === null || (await this.readEntryHash()) !== this.entryContentHash) {
      await this.compile();
    }
    return this.compileResult as CompileResult;
  }

  private async readEntryHash(): Promise<string | null> {
    try {
      return sha256Hex(await readFile(this.entryPath));
    } catch {
      return null; // 文件消失 → 触发 compile 给出明确错误
    }
  }

  /**
   * 动态 import 并强制重新求值：复制到同目录唯一副本（.videoos-fresh-<base>-<pid>-<n>.ts）→ import → 删除副本。
   * 副本唯一路径绕过 Bun 的模块缓存；同目录保证入口的相对导入（./theme）解析不变。
   */
  async freshImport(absolutePath: string): Promise<Record<string, unknown>> {
    if (!existsSync(absolutePath)) {
      throw new SessionError("SESSION_ENTRY_NOT_FOUND", `entry file not found: ${absolutePath}`);
    }
    const dir = dirname(absolutePath);
    const ext = extname(absolutePath) || ".ts";
    const base = basename(absolutePath, ext);
    const copy = join(dir, `.videoos-fresh-${base}-${process.pid}-${this.importCounter++}${ext}`);
    let mod: Record<string, unknown>;
    try {
      await writeFile(copy, await readFile(absolutePath));
      mod = (await import(pathToFileURL(copy).href)) as Record<string, unknown>;
    } catch (err) {
      throw new SessionError(
        "SESSION_ENTRY_IMPORT_FAILED",
        `failed to import ${absolutePath}: ${(err as Error).message}`,
      );
    } finally {
      await rm(copy, { force: true });
    }
    return mod;
  }

  async loadDefinition(): Promise<VideoDefinition> {
    const mod = await this.freshImport(this.entryPath);
    const def = mod.default;
    if (
      def === null || def === undefined ||
      typeof def !== "object" || (def as { kind?: unknown }).kind !== "videoos-definition"
    ) {
      throw new SessionError(
        "SESSION_ENTRY_INVALID",
        `${this.entryPath} must \`export default defineVideo(...)\` (got ${typeof def === "object" ? "missing kind marker" : String(typeof def)})`,
      );
    }
    return def as VideoDefinition;
  }

  async compile(): Promise<CompileResult> {
    const definition = await this.loadDefinition();
    const result = compile(definition, { assetRoot: this.workspace.root });
    this.compileResult = result;
    this.entryContentHash = sha256Hex(await readFile(this.entryPath));
    this.rendererPromise = null; // 渲染器失效（VIR 已变）
    await mkdir(dirname(this.virPath), { recursive: true });
    await writeFile(this.virPath, prettyCanonicalJson(result.vir), "utf8");
    this.events.emit({
      kind: "compile",
      detail: {
        virPath: this.virPath,
        scenes: result.vir.scenes.length,
        duration: result.vir.meta.duration,
        diagnostics: result.diagnostics.length,
        errors: result.diagnostics.filter((d) => d.level === "error").length,
      },
    });
    return result;
  }

  async scanFonts(): Promise<FontRegistration[]> {
    if (this.fontsCache !== null) return this.fontsCache;
    const fontsDir = join(this.workspace.root, "assets", "fonts");
    const out: FontRegistration[] = [];
    if (existsSync(fontsDir)) {
      for (const name of (await readdir(fontsDir)).sort()) {
        const ext = extname(name).toLowerCase();
        if ((FONT_EXTENSIONS as readonly string[]).includes(ext)) {
          out.push({ family: basename(name, ext), path: join(fontsDir, name) });
        }
      }
    }
    this.fontsCache = out;
    return out;
  }

  async getRenderer(): Promise<Renderer> {
    const compileResult = await this.ensureCompiled();
    if (this.rendererPromise === null) {
      this.rendererPromise = (async (): Promise<Renderer> => {
        const fonts = await this.scanFonts();
        return createRenderer(compileResult, { fonts, assetRoot: this.workspace.root });
      })();
    }
    return this.rendererPromise;
  }

  async renderPreviewPng(frame: number): Promise<Buffer> {
    const compileResult = await this.ensureCompiled();
    if (typeof frame !== "number" || !Number.isFinite(frame)) {
      throw new SessionError("SESSION_INVALID_FRAME", `frame must be a finite number, got ${String(frame)}`);
    }
    const vir: Vir = compileResult.vir;
    const total = Math.max(0, secondsToFrames(vir.meta.duration, vir.meta.fps));
    const clamped = Math.floor(Math.max(0, Math.min(frame, total - 1)));
    // 与 @videoos/encode renderFramePng/renderToVideo 完全一致的缓存键（附录 B）
    const key = frameKey({
      virHash: virHash(vir),
      backendId: "canvas",
      backendVersion: BACKEND_VERSION,
      frame: clamped,
      width: vir.meta.width,
      height: vir.meta.height,
    });
    const cached = await this.frameCache.getFrame(key);
    if (cached !== null) return cached;
    const renderer = await this.getRenderer();
    const png = renderer.renderFrame(clamped).toPng();
    await this.frameCache.putFrame(key, png);
    return png;
  }

  async renderFinal(opts: { scene?: string } = {}): Promise<RenderPipelineResult> {
    const compileResult = await this.ensureCompiled();
    const result = await renderToVideo({
      compileResult,
      outputDir: this.rendersDir,
      cacheRoot: this.cacheRoot,
      fonts: await this.scanFonts(),
      assetRoot: this.workspace.root,
      ...(opts.scene !== undefined ? { scene: opts.scene } : {}),
    });
    this.lastRender = result;
    this.events.emit({
      kind: "render",
      detail: { video: result.video, frames: result.frames, cacheHits: result.cacheHits, cacheMisses: result.cacheMisses },
    });
    return result;
  }

  async listTestFiles(): Promise<string[]> {
    const matcher = compileGlob(this.testsGlob);
    return walkFiles(this.workspace.root, matcher);
  }

  async runTests(): Promise<QaReport> {
    const compileResult = await this.ensureCompiled();
    const files = await this.listTestFiles();
    // 逐个 fresh import：@videoos/qa 的 describe/it 收集器是模块级单例（跨文件累积），
    // runCollected 执行后会自动清空 —— 多次 test.run 不会累积旧用例。
    for (const file of files) {
      await this.freshImport(file);
    }
    const renderer = await this.getRenderer();
    const qaCtx = createQaContext(compileResult, renderer, {
      goldenDir: join(this.workspace.root, "tests", "golden"),
    });
    const report = await runCollected(qaCtx);
    this.lastQaReport = report;
    this.events.emit({
      kind: "test",
      detail: { files: files.length, totalPassed: report.totalPassed, totalFailed: report.totalFailed },
    });
    return report;
  }
}

/** 创建 VAP 会话（一切工具的依赖注入入口） */
export async function createVapContext(options: CreateVapContextOptions): Promise<VapContext> {
  if (options.workspace === null || options.workspace === undefined || typeof options.workspace.root !== "string" || options.workspace.root.length === 0) {
    throw new SessionError("SESSION_INVALID_WORKSPACE", "options.workspace with a non-empty root is required");
  }
  return new VapSessionImpl(options);
}

/** VapContext → VapSession（工具内部扩展面；仅接受 createVapContext 的产物形状） */
export function asVapSession(ctx: VapContext): VapSession {
  const session = ctx as VapSession;
  if (typeof session.ensureCompiled !== "function" || typeof session.scanFonts !== "function") {
    throw new SessionError("SESSION_INVALID_CONTEXT", "ctx is not a VapSession created by createVapContext()");
  }
  return session;
}
