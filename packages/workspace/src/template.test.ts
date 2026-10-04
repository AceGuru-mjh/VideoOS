// 项目模板测试：文件生成 + 动态 import（repo 内 tmpdir 以获得 workspace 解析）+ 编译/QA 断言真跑通。
// 说明：@videoos/compiler 与 @videoos/render-canvas 为测试期依赖（经 bun workspace 解析 + tsc paths），
// 与 M3（encode 管线）同策略，未写入 package.json 以避免改动 bun.lock。
import { afterAll, beforeAll, describe, expect as bunExpect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "@videoos/compiler";
import { createRenderer } from "@videoos/render-canvas";
import { createQaContext, expect as qaExpect, frame, scene, runSuites } from "@videoos/qa";
import type { VideoDefinition } from "@videoos/dsl";
import type { Suite } from "@videoos/qa";
import { createProjectTemplate, ProjectWorkspace } from "./index";

// 动态 import 生成的 src/video.ts 时，"@videoos/dsl" 需可解析 —— 临时项目必须位于
// 仓库子树内（bun 对 workspace 包名做自动解析；仓库外无 node_modules 链）。
const REPO_ROOT = resolve(import.meta.dir, "../../..");

const tmpBases: string[] = [];
afterAll(() => {
  for (const base of tmpBases) rmSync(base, { recursive: true, force: true });
});

// 自愈：若上次运行异常中断留下了临时项目目录，先清理（避免裸 `bun test` 误收集其中的生成测试文件）
for (const stale of readdirSync(REPO_ROOT).filter((name) => name.startsWith(".tmp-ws-template-"))) {
  rmSync(join(REPO_ROOT, stale), { recursive: true, force: true });
}

const PROJECT_NAME = "Hello Project";

describe("createProjectTemplate", () => {
  let projectRoot = "";
  let definition: VideoDefinition;

  beforeAll(async () => {
    const base = mkdtempSync(join(REPO_ROOT, ".tmp-ws-template-"));
    tmpBases.push(base);
    projectRoot = join(base, "hello-project");
    await ProjectWorkspace.init(projectRoot, { name: "hello-project" });
    await createProjectTemplate(projectRoot, PROJECT_NAME);
    definition = (await import(pathToFileURL(join(projectRoot, "src", "video.ts")).href)).default as VideoDefinition;
  });

  test("writes src/video.ts, tests/video.test.ts and README.md", () => {
    for (const file of ["src/video.ts", "tests/video.test.ts", "README.md"]) {
      bunExpect(existsSync(join(projectRoot, ...file.split("/")))).toBe(true);
    }
    const video = readFileSync(join(projectRoot, "src", "video.ts"), "utf8");
    bunExpect(video).toContain('from "@videoos/dsl"');
    bunExpect(video).toContain("Hello VideoOS");
    bunExpect(video).toContain("github.com/AceGuru-mjh/VideoOS");
    const testFile = readFileSync(join(projectRoot, "tests", "video.test.ts"), "utf8");
    bunExpect(testFile).toContain('toContainText("Hello VideoOS")');
    bunExpect(testFile).toContain("not.toBeBlack");
    bunExpect(testFile).toContain("durationBetween(2, 4)");
    bunExpect(testFile).toContain("runCollected");
    const readme = readFileSync(join(projectRoot, "README.md"), "utf8");
    bunExpect(readme).toContain("videoos compile");
    bunExpect(readme).toContain(".video/");
  });

  test("generated src/video.ts imports cleanly and yields a videoos-definition", () => {
    bunExpect(definition.kind).toBe("videoos-definition");
    bunExpect(definition.program.meta).toEqual({
      title: PROJECT_NAME,
      width: 1920,
      height: 1080,
      fps: 30,
      background: "#0a0a12",
      seed: 42,
    });
    bunExpect(definition.program.scenes.map((s) => s.name)).toEqual(["intro", "outro"]);
    bunExpect(definition.program.scenes[0]?.duration).toBe(3.5);
    bunExpect(definition.program.scenes[1]?.duration).toBe(3);
    bunExpect(definition.program.transitions).toEqual([
      { type: "crossfade", duration: 0.5, between: ["intro", "outro"] },
    ]);
    bunExpect(definition.program.audio).toEqual([]);
    // intro：2 个 beat + push-in 相机
    bunExpect(definition.program.scenes[0]?.beats.length).toBe(2);
    bunExpect(definition.program.scenes[0]?.camera?.type).toBe("push-in");
  });

  test("template compiles with zero error diagnostics into a 6s / 30fps video", () => {
    const result = compile(definition);
    bunExpect(result.diagnostics.filter((d) => d.level === "error")).toEqual([]);
    bunExpect(result.vir.meta.duration).toBe(6);
    bunExpect(result.vir.meta.fps).toBe(30);
    bunExpect(result.vir.meta.width).toBe(1920);
    bunExpect(result.vir.meta.height).toBe(1080);
    const renderer = createRenderer(result, { assetRoot: projectRoot });
    bunExpect(renderer.totalFrames).toBe(180);
  });

  test("template QA assertions (toContainText / not.toBeBlack / durationBetween) all pass", async () => {
    const result = compile(definition);
    const ctx = createQaContext(result, createRenderer(result, { assetRoot: projectRoot }));
    const suites: Suite[] = [
      {
        name: "intro",
        tests: [
          { name: "shows the main title after 1 second", fn: () => { qaExpect(frame(30)).toContainText("Hello VideoOS"); } },
          { name: "does not start on a black frame", fn: () => { qaExpect(frame(0)).not.toBeBlack(); } },
        ],
      },
      {
        name: "outro",
        tests: [
          { name: "fits the rhythm (2-4 seconds)", fn: () => { qaExpect(scene("outro")).durationBetween(2, 4); } },
        ],
      },
    ];
    const report = await runSuites(suites, ctx);
    bunExpect(report.totalPassed).toBe(3);
    bunExpect(report.totalFailed).toBe(0);
  });

  test("composes with ProjectWorkspace: open() works and transactions protect the template", async () => {
    const ws = await ProjectWorkspace.open(projectRoot);
    bunExpect(ws.manifest.name).toBe("hello-project");
    bunExpect(ws.manifest.entry).toBe("src/video.ts");
    const tx = await ws.transactions.begin("polish title");
    const info = await ws.transactions.info(tx.id);
    bunExpect(info?.files).toBe(3); // src/video.ts + tests/video.test.ts + video.project.json
    await tx.commit();
    bunExpect((await ws.transactions.list()).map((t) => t.status)).toEqual(["committed"]);
  });
});
