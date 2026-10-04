// 项目模板生成（videoos init 的内容部分）：src/video.ts + tests/video.test.ts + README.md。
// 模板即文档：新项目开箱即可 compile / test / render。
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WorkspaceError } from "./errors";

function videoSource(title: string): string {
  return `import { defineVideo } from "@videoos/dsl";

// VideoOS project entry — edit this file, then:
//   videoos compile   (DSL → VIR, diagnostics in .video/)
//   videoos test      (visual QA below in tests/video.test.ts)
export default defineVideo(
  {
    title: ${JSON.stringify(title)},
    width: 1920,
    height: 1080,
    fps: 30,
    background: "#0a0a12",
    seed: 42,
  },
  (v) => {
    v.scene("intro", { duration: 3.5, background: "#0a0a12" }, (s) => {
      s.beat("title-enter", { at: 0.2, description: "Main title blur-up entrance" });
      s.beat("subtitle-enter", { at: 0.8, description: "Subtitle fade-in" });

      s.text("title", "Hello VideoOS", {
        size: 120,
        weight: 700,
        color: "#ffffff",
        at: { x: "50%", y: "42%" },
        enter: { effect: "blur-up", duration: 0.8 },
      });

      s.text("subtitle", "Programmable Video Runtime", {
        size: 42,
        color: "#8b8ba7",
        at: { x: "50%", y: "56%" },
        enter: { effect: "fade", duration: 0.6, delay: 0.4 },
      });

      s.camera("push-in", { from: 1.0, to: 1.08 });
    });

    v.scene("outro", { duration: 3 }, (s) => {
      s.beat("repo-show", { at: 0.3, description: "Show repository url" });

      s.text("repo", "github.com/AceGuru-mjh/VideoOS", {
        size: 48,
        color: "#ffffff",
        at: { x: "50%", y: "50%" },
        enter: { effect: "fade", duration: 0.8 },
      });
    });

    // intro (3.5s) + outro (3s) − crossfade overlap (0.5s) = 6s @ 30fps, no audio
    v.transition("crossfade", { duration: 0.5, between: ["intro", "outro"] });
  },
);
`;
}

function testSource(): string {
  return `// Visual QA suite (bun test + @videoos/qa).
// Run with: videoos test  (or: bun test)
import { test } from "bun:test";
import { compile } from "@videoos/compiler";
import { createRenderer } from "@videoos/render-canvas";
import { describe, it, expect, frame, scene, createQaContext, runCollected } from "@videoos/qa";
import definition from "../src/video";

const result = compile(definition);
const ctx = createQaContext(result, createRenderer(result));

describe("intro", () => {
  it("shows the main title after 1 second", () => {
    expect(frame(30)).toContainText("Hello VideoOS");
  });

  it("does not start on a black frame", () => {
    expect(frame(0)).not.toBeBlack();
  });
});

describe("outro", () => {
  it("fits the rhythm (2-4 seconds)", () => {
    expect(scene("outro")).durationBetween(2, 4);
  });
});

test("video qa suite", async () => {
  const report = await runCollected(ctx);
  if (report.totalFailed > 0) {
    throw new Error(
      \`QA failed: \${report.totalFailed} test(s)\\n\${JSON.stringify(report.suites, null, 2)}\`,
    );
  }
});
`;
}

function readmeSource(name: string): string {
  return `# ${name}

A [VideoOS](https://github.com/AceGuru-mjh/VideoOS) project:
**DSL → VIR → Render → Visual QA** (deterministic, agent-native video).

## Directory layout

| Path | Purpose |
| --- | --- |
| \`src/video.ts\` | Video entry (\`defineVideo\` from \`@videoos/dsl\`) |
| \`src/scenes/\` | Optional scene modules |
| \`assets/{images,audio,fonts}/\` | Static assets |
| \`tests/video.test.ts\` | Visual QA suite (\`@videoos/qa\`) |
| \`tests/golden/\` | Golden baseline images |
| \`.video/\` | Generated: \`vir.json\`, \`graph.json\`, \`cache/\`, \`snapshots/\`, \`renders/\`, \`memory/\` — safe to gitignore |

## Commands

\`\`\`bash
videoos compile               # DSL → VIR (.video/vir.json + diagnostics)
videoos preview               # open VideoOS Studio
videoos render                # render final MP4 into .video/renders/
videoos test                  # run the visual QA suite
videoos test --update-golden  # (re)generate golden baselines
\`\`\`
`;
}

/**
 * 生成默认项目模板文件（覆盖式写入；目录按需创建）：
 *   src/video.ts       —— defineVideo 双场景示例（intro blur-up/push-in + outro fade + crossfade，30fps 1920×1080，约 6s）
 *   tests/video.test.ts —— @videoos/qa 骨架（toContainText / not.toBeBlack / durationBetween）
 *   README.md          —— 目录说明 + 常用命令
 * 通常与 ProjectWorkspace.init(root, { name }) 组合使用（init 负责目录树与 video.project.json）。
 */
export async function createProjectTemplate(root: string, name: string): Promise<void> {
  if (typeof name !== "string" || name.length === 0) {
    throw new WorkspaceError("WORKSPACE_INVALID_NAME", `project name must be a non-empty string (got ${JSON.stringify(name)})`);
  }
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(join(root, "src", "video.ts"), videoSource(name));
  writeFileSync(join(root, "tests", "video.test.ts"), testSource());
  writeFileSync(join(root, "README.md"), readmeSource(name));
}
