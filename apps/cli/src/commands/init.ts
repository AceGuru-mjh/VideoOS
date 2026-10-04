// videoos init [name] [--here]：ProjectWorkspace.init（目录树 + 清单）+ createProjectTemplate（内容）
import { resolve } from "node:path";
import process from "node:process";
import type { Command } from "commander";
import { ProjectWorkspace, WorkspaceError, createProjectTemplate } from "@videoos/workspace";
import { color, fail } from "../util";

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("从模板创建新视频项目（SPEC §9 目录树 + 示例 intro/outro）")
    .argument("[name]", "项目目录名（缺省需配合 --here）")
    .option("--here", "在当前目录初始化（不创建子目录）")
    .action(async (name: string | undefined, opts: { here?: boolean }) => {
      let root: string;
      let projectName: string;
      if (opts.here === true) {
        root = process.cwd();
        projectName = name ?? root.split(/[\\/]/).filter(Boolean).pop() ?? "videoos-project";
      } else if (name !== undefined && name.length > 0) {
        root = resolve(name);
        projectName = name;
      } else {
        fail("缺少项目名：videoos init <name> 或 videoos init --here（当前目录初始化）");
        return;
      }

      try {
        const ws = await ProjectWorkspace.init(root, { name: projectName });
        await createProjectTemplate(root, ws.manifest.name);
      } catch (err) {
        if (err instanceof WorkspaceError && err.code === "WORKSPACE_ALREADY_INITIALIZED") {
          fail(`${root} 已经是 VideoOS 项目（video.project.json 已存在）`);
        } else if (err instanceof WorkspaceError) {
          fail(err.message);
        } else {
          fail(`初始化失败：${err instanceof Error ? err.message : String(err)}`);
        }
        return;
      }

      const rel = resolve(root) === process.cwd() ? "." : resolve(root);
      console.log(color.green(`✔ 已创建项目 ${color.bold(projectName)} → ${rel}`));
      console.log("");
      console.log(`${projectName}/`);
      console.log("├── video.project.json     # 项目清单（name/entry/engines/render/agent）");
      console.log("├── src/");
      console.log("│   ├── video.ts           # DSL 入口（intro + outro 示例：6.0s / 1920×1080 / 30fps）");
      console.log("│   └── scenes/");
      console.log("├── assets/");
      console.log("│   ├── images/  ├── audio/  └── fonts/");
      console.log("├── tests/");
      console.log("│   ├── video.test.ts      # 视觉 QA（frame/scene 断言）");
      console.log("│   └── golden/");
      console.log("└── .video/                # 生成区（cache/renders/snapshots/diagnostics/memory，可 gitignore）");
      console.log("");
      console.log("下一步：");
      if (rel !== ".") console.log(`  cd ${rel}`);
      console.log("  videoos compile          # DSL → VIR（含诊断）");
      console.log("  videoos test             # 视觉 QA");
      console.log("  videoos render           # 渲染 MP4（需 ffmpeg）");
      console.log("  videoos agent exec '...' # Agent 自主修改（需配置 LLM）");
    });
}
