// videoos cache <stats|clear>：.video/cache 内容寻址缓存管理（ContentStore）
import type { Command } from "commander";
import { ContentStore } from "@videoos/cache";
import { color, fail, formatBytes, openProject, resolveProjectRoot, withProjectOption } from "../util";

export function registerCacheCommand(program: Command): void {
  const cache = program.command("cache").description("内容寻址帧缓存（.video/cache）管理");

  withProjectOption(
    cache
      .command("stats")
      .description("缓存统计：条目数 / 字节数 / 按命名空间细分"),
  ).action(async (opts: { project?: string }) => {
    const project = await openProject(resolveProjectRoot(opts.project));
    if (project === null) return;
    const store = new ContentStore(project.paths.cache);
    const stats = await store.stats();
    console.log(`缓存目录  ${project.paths.cache}`);
    console.log(`条目      ${stats.entries}`);
    console.log(`占用      ${formatBytes(stats.bytes)}`);
    const namespaces = Object.keys(stats.namespaces).sort();
    if (namespaces.length > 0) {
      console.log("命名空间：");
      for (const ns of namespaces) {
        const s = stats.namespaces[ns];
        if (s === undefined) continue;
        console.log(`  ${ns.padEnd(12)}${String(s.entries).padEnd(10)}${formatBytes(s.bytes)}`);
      }
    }
  });

  withProjectOption(
    cache
      .command("clear")
      .description("清空缓存（删除 .video/cache 全部内容）"),
  ).action(async (opts: { project?: string }) => {
    const project = await openProject(resolveProjectRoot(opts.project));
    if (project === null) return;
    const store = new ContentStore(project.paths.cache);
    const before = await store.stats();
    await store.clear();
    console.log(color.green(`✔ 已清空缓存（删除 ${before.entries} 个条目 / ${formatBytes(before.bytes)}）`));
    console.log(color.gray(`  目录 ${project.paths.cache}`));
  });

  cache.action(async (opts: { project?: string }) => {
    void opts;
    fail("用法：videoos cache <stats|clear>");
  });
}
