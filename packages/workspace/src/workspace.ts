// ProjectWorkspace：VideoOS 项目文件系统（SPEC §9）。
// init 创建目录树 + video.project.json；open 读取并解析；isProject 同步存在性检查。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { WorkspaceError } from "./errors";
import { DEFAULT_ENTRY, parseManifest } from "./manifest";
import type { ProjectManifest } from "./manifest";
import { MemoryStore } from "./memory";
import { TransactionManager } from "./transactions";

/** 项目清单文件名（项目根下） */
export const PROJECT_FILE = "video.project.json";

/** .video/ 生成区子目录（SPEC §9） */
const DOT_VIDEO_SUBDIRS = ["cache", "renders", "snapshots", "diagnostics", "memory"] as const;

export interface WorkspacePaths {
  root: string;
  src: string;
  assets: string;
  tests: string;
  dotVideo: string;
  /** <root>/video.project.json */
  projectFile: string;
  /** <root>/.video/vir.json（编译产物） */
  vir: string;
  /** <root>/.video/graph.json（编译产物） */
  graph: string;
  /** <root>/.video/diagnostics/ */
  diagnostics: string;
  /** <root>/.video/cache/ */
  cache: string;
  /** <root>/.video/renders/ */
  renders: string;
  /** <root>/.video/snapshots/ */
  snapshots: string;
  /** <root>/.video/memory/ */
  memory: string;
}

function buildPaths(root: string): WorkspacePaths {
  const dotVideo = join(root, ".video");
  return {
    root,
    src: join(root, "src"),
    assets: join(root, "assets"),
    tests: join(root, "tests"),
    dotVideo,
    projectFile: join(root, PROJECT_FILE),
    vir: join(dotVideo, "vir.json"),
    graph: join(dotVideo, "graph.json"),
    diagnostics: join(dotVideo, "diagnostics"),
    cache: join(dotVideo, "cache"),
    renders: join(dotVideo, "renders"),
    snapshots: join(dotVideo, "snapshots"),
    memory: join(dotVideo, "memory"),
  };
}

/** init 的默认清单（SPEC §9 示例值） */
function defaultManifestFor(root: string): ProjectManifest {
  return {
    name: basename(resolve(root)) || "videoos-project",
    entry: DEFAULT_ENTRY,
    engines: { videoos: "^0.1" },
    render: { defaultBackend: "canvas", encoder: "ffmpeg" },
    agent: { autonomous: true, maxRepairLoops: 3 },
  };
}

/** 嵌套对象逐键合并（Partial 的嵌套段同样允许部分提供） */
function mergeManifest(defaults: ProjectManifest, override?: Partial<ProjectManifest>): ProjectManifest {
  if (override === undefined) return defaults;
  return {
    ...defaults,
    ...override,
    engines: { ...defaults.engines, ...(override.engines ?? {}) },
    render: { ...defaults.render, ...(override.render ?? {}) },
    agent: { ...defaults.agent, ...(override.agent ?? {}) },
  };
}

export class ProjectWorkspace {
  /**
   * 初始化项目：创建 SPEC §9 目录树（src/、src/scenes/、assets/{images,audio,fonts}/、
   * tests/、tests/golden/、.video/{cache,renders,snapshots,diagnostics,memory}），
   * 写入合并默认值后的 video.project.json。已存在项目文件 → WORKSPACE_ALREADY_INITIALIZED。
   */
  static async init(root: string, manifest?: Partial<ProjectManifest>): Promise<ProjectWorkspace> {
    const absRoot = resolve(root);
    if (ProjectWorkspace.isProject(absRoot)) {
      throw new WorkspaceError("WORKSPACE_ALREADY_INITIALIZED", `${join(absRoot, PROJECT_FILE)} already exists; use ProjectWorkspace.open() instead`);
    }
    const dirs = [
      join(absRoot, "src"),
      join(absRoot, "src", "scenes"),
      join(absRoot, "assets", "images"),
      join(absRoot, "assets", "audio"),
      join(absRoot, "assets", "fonts"),
      join(absRoot, "tests"),
      join(absRoot, "tests", "golden"),
      join(absRoot, ".video"),
      ...DOT_VIDEO_SUBDIRS.map((sub) => join(absRoot, ".video", sub)),
    ];
    for (const dir of dirs) mkdirSync(dir, { recursive: true });
    const merged = mergeManifest(defaultManifestFor(absRoot), manifest);
    const parsed = parseManifest(merged); // 非法用户输入在此拦截（WORKSPACE_MANIFEST_INVALID）
    writeFileSync(join(absRoot, PROJECT_FILE), `${JSON.stringify(parsed, null, 2)}\n`);
    return await ProjectWorkspace.open(absRoot);
  }

  /** 打开项目：读 video.project.json（缺失 → WORKSPACE_NOT_FOUND；损坏/非法 → WORKSPACE_MANIFEST_INVALID） */
  static async open(root: string): Promise<ProjectWorkspace> {
    const absRoot = resolve(root);
    const projectFile = join(absRoot, PROJECT_FILE);
    if (!existsSync(projectFile)) {
      throw new WorkspaceError("WORKSPACE_NOT_FOUND", `no ${PROJECT_FILE} found under ${absRoot} (not a VideoOS project?)`);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(projectFile, "utf8"));
    } catch (err) {
      throw new WorkspaceError("WORKSPACE_MANIFEST_INVALID", `${projectFile} is not valid JSON (${err instanceof Error ? err.message : String(err)})`);
    }
    return new ProjectWorkspace(absRoot, parseManifest(raw));
  }

  /** 同步存在性检查（仅探测 video.project.json 是否存在） */
  static isProject(root: string): boolean {
    return existsSync(join(resolve(root), PROJECT_FILE));
  }

  private constructor(
    readonly root: string,
    readonly manifest: ProjectManifest,
  ) {
    this.paths = buildPaths(root);
    this.memory = new MemoryStore(this.paths.memory);
    this.transactions = new TransactionManager(root, this.paths.snapshots);
  }

  readonly paths: WorkspacePaths;
  readonly memory: MemoryStore;
  readonly transactions: TransactionManager;
}
