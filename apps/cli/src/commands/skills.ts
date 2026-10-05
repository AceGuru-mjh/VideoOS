// videoos skills：创作技能库浏览（issue #52/#61 交付后的 42 技能库 CLI 入口）。
// - list            全量清单（名称 / 版本 / 描述单行）
// - search <query>  关键词过滤（name/description/trigger 大小写不敏感子串 + CJK 直接子串）
// - show <name>     完整 SKILL.md（frontmatter 摘要 + markdown 正文）
// 数据源复用 server 的 loadSkills（内置 skills/ + 可选 --custom 目录），
// 纯函数 matchSkills 单独导出供测试。
import process from "node:process";
import type { Command } from "commander";
import { loadSkills } from "@videoos/server";
import type { SkillRecord } from "@videoos/server";
import { color, fail } from "../util";

/** 单行截断（列表描述列） */
function clip(text: string, max = 72): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * 技能匹配（纯函数，导出供测试）：
 * query 小写后对 name / description / trigger 做子串匹配 —— 拉丁词干可用空白切分
 * （任一词命中即算），CJK 无空白则整体子串。命中字段不区分优先级（列表保持字母序稳定）。
 */
export function matchSkills(query: string, skills: SkillRecord[]): SkillRecord[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [...skills].sort((a, b) => a.name.localeCompare(b.name));
  const terms = q.split(/\s+/).filter((t) => t.length > 0);
  const matched = skills.filter((s) => {
    const hay = `${s.name}\n${s.description}\n${s.trigger}`.toLowerCase();
    return terms.some((t) => hay.includes(t));
  });
  return matched.sort((a, b) => a.name.localeCompare(b.name));
}

/** list / search 共用渲染 */
function renderList(skills: SkillRecord[], title: string): void {
  console.log(color.bold(title));
  console.log("");
  if (skills.length === 0) {
    console.log(color.gray("（无匹配技能 — 换个关键词试试，例如 intro / 字幕 / lyrics）"));
    return;
  }
  for (const s of skills) {
    console.log(`  ${color.cyan(s.name.padEnd(22))} ${color.gray(s.version)}  ${clip(s.description)}`);
  }
  console.log("");
  console.log(color.gray(`共 ${skills.length} 个 · 查看详情：videoos skills show <name>`));
}

async function loadAll(customDir: string | undefined): Promise<SkillRecord[]> {
  return loadSkills(customDir && customDir.length > 0 ? customDir : null);
}

export function registerSkillsCommand(program: Command): void {
  const skills = program
    .command("skills")
    .description("创作技能库浏览：list / search / show（42 个内置技能，Agent 对话自动触发）");

  skills
    .command("list")
    .description("列出全部技能（内置 + --custom 自定义目录）")
    .option("--custom <dir>", "附加自定义技能目录（含 <dir>/<skill>/SKILL.md）")
    .action(async (opts: { custom?: string }) => {
      try {
        const all = await loadAll(opts.custom);
        renderList(matchSkills("", all), `技能库（${all.length} 个）`);
      } catch (err) {
        fail(`加载技能库失败：${err instanceof Error ? err.message : String(err)}`);
      }
    });

  skills
    .command("search")
    .description("按关键词搜索技能（匹配 name / description / trigger）")
    .argument("<query>", "关键词（多个词任意命中即匹配）")
    .option("--custom <dir>", "附加自定义技能目录")
    .action(async (query: string, opts: { custom?: string }) => {
      try {
        const all = await loadAll(opts.custom);
        renderList(matchSkills(query, all), `搜索 "${query}"（命中 ${matchSkills(query, all).length}/${all.length}）`);
      } catch (err) {
        fail(`加载技能库失败：${err instanceof Error ? err.message : String(err)}`);
      }
    });

  skills
    .command("show")
    .description("查看单个技能的完整 SKILL.md")
    .argument("<name>", "技能名（videoos skills list 中的名称）")
    .option("--custom <dir>", "附加自定义技能目录")
    .action(async (name: string, opts: { custom?: string }) => {
      try {
        const all = await loadAll(opts.custom);
        const skill = all.find((s) => s.name === name);
        if (skill === undefined) {
          const near = matchSkills(name, all).slice(0, 5).map((s) => s.name);
          const hint = near.length > 0 ? `；相近的：${near.join(", ")}` : "";
          fail(`技能 "${name}" 不存在${hint}`);
          return;
        }
        console.log(color.bold(`# ${skill.name}`) + color.gray(`  v${skill.version}  [${skill.source}]`));
        console.log(`${color.bold("description:")} ${skill.description}`);
        console.log(`${color.bold("trigger:")}     ${skill.trigger}`);
        console.log(color.gray("─".repeat(72)));
        console.log(skill.body.trimEnd());
      } catch (err) {
        fail(`加载技能库失败：${err instanceof Error ? err.message : String(err)}`);
      }
    });
}
