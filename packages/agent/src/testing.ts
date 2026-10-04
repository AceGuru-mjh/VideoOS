// 测试/演示项目夹具：在临时目录装配最小 VideoOS 项目（src/video.ts + tests/video.test.ts + testkit 工作区）。
// 供 @videoos/agent 自己的集成测试、MCP/CLI 冒烟使用。
// 注意：夹具源码对 @videoos/dsl / @videoos/qa 的 import 使用【绝对路径】—— 临时目录没有 node_modules；
//      真实项目（videoos init 产物）里使用正常的包名 import。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { createTestWorkspace } from "./testkit";
import type { WorkspaceLike } from "./session";

const nodeRequire = createRequire(import.meta.url);

/** 解析 workspace 包的入口绝对路径（夹具源码动态内嵌用） */
export function resolvePackageEntry(packageName: "@videoos/dsl" | "@videoos/qa"): string {
  return nodeRequire.resolve(packageName);
}

export interface FixtureProject {
  root: string;
  workspace: WorkspaceLike;
  entryPath: string;
  testPath: string;
  /** 读取 entry 源码 */
  readEntry(): Promise<string>;
  writeEntry(source: string): Promise<void>;
  dispose(): Promise<void>;
}

export interface FixtureOptions {
  /** 初始 entry 源码（默认：1 场景 intro + text "Hello"，640x360@12fps 1s） */
  entrySource?: string;
  /** 测试文件内容（默认：4 个 qa 用例） */
  testSource?: string | null;
}

/** 默认 entry：单场景 intro，text 图层 "greeting" 内容 "Hello"（fps 12 / 1s = 12 帧，渲染快） */
export function defaultEntrySource(): string {
  return `import { defineVideo } from ${JSON.stringify(resolvePackageEntry("@videoos/dsl"))};

export default defineVideo(
  { title: "Agent Fixture", width: 640, height: 360, fps: 12, background: "#101020", seed: 7 },
  (v) => {
    v.scene("intro", { duration: 1, background: "#101020" }, (s) => {
      s.beat("title", { at: 0.1, description: "标题入场" });
      s.text("greeting", "Hello", {
        size: 64,
        color: "#ffffff",
        at: { x: "50%", y: "50%" },
        enter: { effect: "fade", duration: 0.3 },
      });
    });
  },
);
`;
}

/** 默认测试文件：@videoos/qa 收集器风格（bun test 由本包运行，文件仅被 VAP test.run 动态 import） */
export function defaultTestSource(): string {
  return `import { describe, it, expect, frame, scene } from ${JSON.stringify(resolvePackageEntry("@videoos/qa"))};

describe("intro", () => {
  it("帧 0 不是黑帧", () => {
    expect(frame(0)).not.toBeBlack();
  });
  it("第 6 帧可见标题", () => {
    expect(frame(6)).toContainText("VideoOS");
  });
  it("场景时长在 0.5-2 秒之间", () => {
    expect(scene("intro")).durationBetween(0.5, 2);
  });
  it("无文本溢出", () => {
    expect(scene("intro")).noTextOverflow();
  });
});
`;
}

/** 在临时目录创建最小项目（src/video.ts + tests/video.test.ts + createTestWorkspace） */
export async function createFixtureProject(options: FixtureOptions = {}): Promise<FixtureProject> {
  const root = await mkdtemp(join(tmpdir(), "videoos-agent-fixture-"));
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "tests"), { recursive: true });
  const entrySource = options.entrySource ?? defaultEntrySource();
  const entryPath = join(root, "src", "video.ts");
  await writeFile(entryPath, entrySource, "utf8");
  const testPath = join(root, "tests", "video.test.ts");
  if (options.testSource !== null) {
    await writeFile(testPath, options.testSource ?? defaultTestSource(), "utf8");
  }
  const workspace = await createTestWorkspace(root);
  return {
    root,
    workspace,
    entryPath,
    testPath,
    readEntry: (): Promise<string> => import("node:fs/promises").then((fs) => fs.readFile(entryPath, "utf8")),
    writeEntry: (source: string): Promise<void> => import("node:fs/promises").then((fs) => fs.writeFile(entryPath, source, "utf8")),
    dispose: (): Promise<void> => rm(root, { recursive: true, force: true }),
  };
}
