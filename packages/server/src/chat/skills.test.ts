// SkillService 模块级测试（#52 服务端）：SKILL.md 发现/解析校验/customDir 覆盖/
// 启停持久化/@引用解析/自动触发打分（含 CJK shingle）/系统提示注入块。
// 纯文件系统 fixture（mkdtemp 临时目录 + 手写 SKILL.md），无 HTTP、无真实模型。
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettingsStore } from "../settings";
import { SkillService } from "./skills";

const FENCE = "```";

/** 生成合法 SKILL.md 文本（version 缺省 → 不写该行，走默认 0.1.0） */
function skillMd(opts: {
  name: string;
  version?: string;
  description: string;
  trigger: string;
  body?: string;
}): string {
  const frontmatter = [
    "---",
    `name: ${opts.name}`,
    ...(opts.version === undefined ? [] : [`version: ${opts.version}`]),
    `description: ${opts.description}`,
    `trigger: ${opts.trigger}`,
    "---",
    "",
  ].join("\n");
  const body =
    opts.body ?? `# ${opts.name}\n\nGoal: fixture.\n\n## Workflow\n\n1. Single step.\n\n## Recipes\n\nNone.\n`;
  return frontmatter + body;
}

/** alpha 技能正文：Workflow 段含围栏代码 + 表格行 + 9 个编号步骤（测 8 行截断与剔除规则） */
const ALPHA_BODY = [
  "# Alpha",
  "",
  "Goal: fixture alpha.",
  "",
  "## Workflow",
  "",
  "1. Step one collects inputs.",
  "2. Step two writes the script.",
  "",
  `${FENCE}ts`,
  'v.scene("alpha", { duration: 2 }, (s) => {});',
  FENCE,
  "",
  "| Col | Value |",
  "| --- | --- |",
  "| alpha | 1 |",
  "",
  "3. Step three compiles.",
  "4. Step four previews.",
  "5. Step five checks QA gates.",
  "6. Step six repairs.",
  "7. Step seven renders final.",
  "8. Step eight delivers.",
  "9. Step nine must be cut.",
  "",
  "## Recipes",
  "",
  "Recipe prose after workflow.",
  "",
  "## QA gates",
  "",
  "- expect(frame(0)).not.toBeBlack()",
  "",
].join("\n");

const ALPHA_MD = skillMd({
  name: "alpha",
  version: "0.2.0",
  description: "Alpha demo skill for tests",
  trigger: "Use when the user asks for an alpha showcase or alpha sting opener",
  body: ALPHA_BODY,
});

/** 轮询等待条件成立（SettingsStore 落盘是异步写链，跨实例复核前需等 flush） */
async function waitFor(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await Bun.sleep(10);
  }
  throw new Error("waitFor: condition not met within timeout");
}

/** 收尾：等异步落盘链收尾后清理临时目录（避免清理后 persist 重建目录留垃圾） */
async function cleanup(...dirs: string[]): Promise<void> {
  await Bun.sleep(30);
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
}

describe("SkillService 发现与解析", () => {
  let root: string;
  let dataDir: string;
  let service: SkillService;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "videoos-skills-a-"));
    dataDir = await mkdtemp(join(tmpdir(), "videoos-skills-data-a-"));
    for (const dir of ["alpha", "beta", "broken", "bad-name", "bad_case", "bad-version", "bad-desc", "empty-dir"]) {
      await mkdir(join(root, dir));
    }
    await writeFile(join(root, "alpha", "SKILL.md"), ALPHA_MD, "utf8");
    await writeFile(
      join(root, "beta", "SKILL.md"),
      skillMd({ name: "beta", description: "Beta demo skill for tests", trigger: "Use for beta countdown lists" }),
      "utf8",
    );
    await writeFile(join(root, "broken", "SKILL.md"), "# Broken\n\nNo frontmatter in this file at all.\n", "utf8");
    await writeFile(
      join(root, "bad-name", "SKILL.md"),
      skillMd({ name: "totally-different", description: "Name mismatches the directory", trigger: "Never matches" }),
      "utf8",
    );
    await writeFile(
      join(root, "bad_case", "SKILL.md"),
      skillMd({ name: "bad_case", description: "Underscore is not kebab-case", trigger: "Never matches" }),
      "utf8",
    );
    await writeFile(
      join(root, "bad-version", "SKILL.md"),
      skillMd({ name: "bad-version", version: "abc", description: "Version is not semver", trigger: "Never matches" }),
      "utf8",
    );
    await writeFile(
      join(root, "bad-desc", "SKILL.md"),
      skillMd({ name: "bad-desc", description: "x".repeat(201), trigger: "Never matches" }),
      "utf8",
    );
    await writeFile(join(root, "stray.txt"), "not a skill dir\n", "utf8");
    service = new SkillService({ defaultDirs: [root], settings: new SettingsStore(dataDir) });
    await service.refresh();
  });

  afterAll(() => cleanup(root, dataDir));

  test("只发现合法技能且按名排序（杂散文件/空目录忽略）", () => {
    expect(service.list().map((s) => s.name)).toEqual(["alpha", "beta"]);
  });

  test("get 命中返回完整信息（source=builtin），未命中返回 null", () => {
    const alpha = service.get("alpha");
    expect(alpha?.version).toBe("0.2.0");
    expect(alpha?.source).toBe("builtin");
    expect(alpha?.dir).toBe(join(root, "alpha"));
    expect(alpha?.enabled).toBe(true);
    expect(service.get("nope")).toBeNull();
  });

  test("version 缺省补 0.1.0", () => {
    expect(service.get("beta")?.version).toBe("0.1.0");
  });

  test("非法文件静默跳过并记入 lastErrors（缺 frontmatter/名不匹配/非 kebab/坏版本/超长描述）", () => {
    const errs = service.lastErrors;
    expect(errs.length).toBe(5);
    expect(errs.some((e) => e.includes(join(root, "broken")))).toBe(true);
    expect(errs.some((e) => e.includes(join(root, "bad-name")))).toBe(true);
    expect(errs.some((e) => e.includes(join(root, "bad_case")))).toBe(true);
    expect(errs.some((e) => e.includes(join(root, "bad-version")))).toBe(true);
    expect(errs.some((e) => e.includes(join(root, "bad-desc")))).toBe(true);
  });

  test("refresh 幂等：重复扫描结果一致、错误不累积", async () => {
    await service.refresh();
    expect(service.list().map((s) => s.name)).toEqual(["alpha", "beta"]);
    expect(service.lastErrors.length).toBe(5);
  });

  test("lastErrors 返回副本，外部篡改不影响内部", () => {
    service.lastErrors.push("tampered");
    expect(service.lastErrors.length).toBe(5);
  });
});

describe("customDir 覆盖 builtin", () => {
  let root: string;
  let customRoot: string;
  let dataDir: string;
  let settings: SettingsStore;
  let service: SkillService;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "videoos-skills-b-"));
    customRoot = await mkdtemp(join(tmpdir(), "videoos-skills-b-custom-"));
    dataDir = await mkdtemp(join(tmpdir(), "videoos-skills-data-b-"));
    for (const dir of ["alpha", "beta"]) await mkdir(join(root, dir));
    await writeFile(
      join(root, "alpha", "SKILL.md"),
      skillMd({ name: "alpha", version: "0.1.0", description: "Builtin alpha description", trigger: "Use for builtin alpha" }),
      "utf8",
    );
    await writeFile(
      join(root, "beta", "SKILL.md"),
      skillMd({ name: "beta", description: "Builtin beta", trigger: "Use for beta" }),
      "utf8",
    );
    for (const dir of ["alpha", "gamma"]) await mkdir(join(customRoot, dir));
    await writeFile(
      join(customRoot, "alpha", "SKILL.md"),
      skillMd({ name: "alpha", version: "0.9.0", description: "Custom alpha override", trigger: "Use for custom alpha" }),
      "utf8",
    );
    await writeFile(
      join(customRoot, "gamma", "SKILL.md"),
      skillMd({ name: "gamma", version: "v1.2.3", description: "Custom gamma addition", trigger: "Use for gamma" }),
      "utf8",
    );
    settings = new SettingsStore(dataDir);
    service = new SkillService({ defaultDirs: [root], settings });
    await service.refresh();
  });

  afterAll(() => cleanup(root, customRoot, dataDir));

  test("未配置 customDir 时只有 builtin", () => {
    expect(service.list().map((s) => s.name)).toEqual(["alpha", "beta"]);
    expect(service.get("alpha")?.source).toBe("builtin");
  });

  test("custom 同名覆盖 builtin（描述取 custom）、新名追加、v 前缀版本剥掉", async () => {
    settings.update({ skills: { customDir: customRoot } });
    await service.refresh();
    expect(service.list().map((s) => s.name)).toEqual(["alpha", "beta", "gamma"]);
    const alpha = service.get("alpha");
    expect(alpha?.description).toBe("Custom alpha override");
    expect(alpha?.version).toBe("0.9.0");
    expect(alpha?.source).toBe("custom");
    expect(alpha?.dir).toBe(join(customRoot, "alpha"));
    expect(service.get("beta")?.source).toBe("builtin");
    const gamma = service.get("gamma");
    expect(gamma?.source).toBe("custom");
    expect(gamma?.version).toBe("1.2.3");
  });
});

describe("setEnabled 持久化", () => {
  let root: string;
  let dataDir: string;
  let settingsPath: string;
  let settings: SettingsStore;
  let service: SkillService;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "videoos-skills-c-"));
    dataDir = await mkdtemp(join(tmpdir(), "videoos-skills-data-c-"));
    settingsPath = join(dataDir, "settings.json");
    for (const dir of ["alpha", "beta"]) await mkdir(join(root, dir));
    await writeFile(
      join(root, "alpha", "SKILL.md"),
      skillMd({
        name: "alpha",
        description: "Alpha demo skill for tests",
        trigger: "Use when the user asks for an alpha showcase or alpha sting opener",
      }),
      "utf8",
    );
    await writeFile(
      join(root, "beta", "SKILL.md"),
      skillMd({ name: "beta", description: "Beta demo skill", trigger: "Use for beta lists" }),
      "utf8",
    );
    settings = new SettingsStore(dataDir);
    service = new SkillService({ defaultDirs: [root], settings });
    await service.refresh();
  });

  afterAll(() => cleanup(root, dataDir));

  test("未知技能返回 false", () => {
    expect(service.setEnabled("nope", true)).toBe(false);
  });

  test("禁用立即生效并跨实例持久（新 SettingsStore + refresh 复核）", async () => {
    expect(service.setEnabled("alpha", false)).toBe(true);
    expect(service.get("alpha")?.enabled).toBe(false);
    expect(service.list().find((s) => s.name === "alpha")?.enabled).toBe(false);
    // SettingsStore 落盘是异步链：轮询等 settings.json 就绪后再用全新实例复核
    await waitFor(() => {
      if (!existsSync(settingsPath)) return false;
      try {
        const saved = JSON.parse(readFileSync(settingsPath, "utf8")) as { skills?: { enabled?: Record<string, boolean> } };
        return saved.skills?.enabled?.alpha === false;
      } catch {
        return false;
      }
    });
    const service2 = new SkillService({ defaultDirs: [root], settings: new SettingsStore(dataDir) });
    await service2.refresh();
    expect(service2.get("alpha")?.enabled).toBe(false);
    expect(service2.get("beta")?.enabled).toBe(true);
    // 恢复，避免影响同 fixture 后续用例
    service.setEnabled("alpha", true);
    expect(service.get("alpha")?.enabled).toBe(true);
  });
});

describe("resolveReferences @引用解析", () => {
  let root: string;
  let dataDir: string;
  let service: SkillService;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "videoos-skills-d-"));
    dataDir = await mkdtemp(join(tmpdir(), "videoos-skills-data-d-"));
    for (const dir of ["alpha", "beta"]) await mkdir(join(root, dir));
    await writeFile(
      join(root, "alpha", "SKILL.md"),
      skillMd({
        name: "alpha",
        description: "Alpha demo skill for tests",
        trigger: "Use when the user asks for an alpha showcase or alpha sting opener",
      }),
      "utf8",
    );
    await writeFile(
      join(root, "beta", "SKILL.md"),
      skillMd({ name: "beta", description: "Beta demo skill", trigger: "Use for beta countdown lists" }),
      "utf8",
    );
    service = new SkillService({ defaultDirs: [root], settings: new SettingsStore(dataDir) });
    await service.refresh();
  });

  afterAll(() => cleanup(root, dataDir));

  test("@alpha ... @beta 按首现顺序解析", () => {
    const { skills, unknown } = service.resolveReferences("@alpha do a video @beta");
    expect(skills.map((s) => s.name)).toEqual(["alpha", "beta"]);
    expect(unknown).toEqual([]);
  });

  test("@ 前是标点仍算引用（括号包裹）", () => {
    const { skills } = service.resolveReferences("use (@alpha) now");
    expect(skills.map((s) => s.name)).toEqual(["alpha"]);
  });

  test("未知 token 进 unknown 清单", () => {
    const { skills, unknown } = service.resolveReferences("@unknown-thing sounds good");
    expect(skills).toEqual([]);
    expect(unknown).toEqual(["unknown-thing"]);
  });

  test("邮箱 local part（@ 前是词字符）不算引用", () => {
    const { skills, unknown } = service.resolveReferences("email me at a@alpha.com please");
    expect(skills).toEqual([]);
    expect(unknown).toEqual([]);
  });

  test("禁用技能仍解析且 enabled 原样返回（显式意图优先）", () => {
    service.setEnabled("alpha", false);
    const { skills } = service.resolveReferences("@alpha please");
    expect(skills.map((s) => s.name)).toEqual(["alpha"]);
    expect(skills[0]?.enabled).toBe(false);
    service.setEnabled("alpha", true);
  });

  test("重复引用去重（首现顺序）", () => {
    const { skills } = service.resolveReferences("@beta then @beta and @alpha");
    expect(skills.map((s) => s.name)).toEqual(["beta", "alpha"]);
  });
});

describe("matchAutoTrigger 自动触发", () => {
  let root: string;
  let dataDir: string;
  let settings: SettingsStore;
  let service: SkillService;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "videoos-skills-e-"));
    dataDir = await mkdtemp(join(tmpdir(), "videoos-skills-data-e-"));
    const names = ["alpha", "beta", ...Array.from({ length: 7 }, (_, i) => `match-${i + 1}`)];
    for (const name of names) await mkdir(join(root, name));
    await writeFile(
      join(root, "alpha", "SKILL.md"),
      skillMd({
        name: "alpha",
        description: "Alpha demo skill for tests",
        trigger: "Use when the user asks for an alpha showcase or alpha sting opener",
      }),
      "utf8",
    );
    await writeFile(
      join(root, "beta", "SKILL.md"),
      skillMd({ name: "beta", description: "Beta demo skill", trigger: "Use for beta countdown lists" }),
      "utf8",
    );
    for (let i = 1; i <= 7; i++) {
      await writeFile(
        join(root, `match-${i}`, "SKILL.md"),
        skillMd({ name: `match-${i}`, description: `Matcher fixture ${i}`, trigger: `Use for match ${i} demos` }),
        "utf8",
      );
    }
    settings = new SettingsStore(dataDir);
    service = new SkillService({ defaultDirs: [root], settings });
    await service.refresh();
  });

  afterAll(() => cleanup(root, dataDir));

  test("命中 alpha 特征触发词 → alpha 第一且唯一", () => {
    const hits = service.matchAutoTrigger("please make an alpha showcase video");
    expect(hits.map((s) => s.name)).toEqual(["alpha"]);
  });

  test("无关文本 → 空（分数阈值过滤）", () => {
    expect(service.matchAutoTrigger("zzz qqq xyzzy frobnicate")).toEqual([]);
  });

  test("autoTrigger=false → 空（显式 @ 引用不受影响）", () => {
    settings.update({ skills: { autoTrigger: false } });
    expect(service.matchAutoTrigger("please make an alpha showcase video")).toEqual([]);
    const { skills } = service.resolveReferences("@alpha");
    expect(skills.map((s) => s.name)).toEqual(["alpha"]);
    settings.update({ skills: { autoTrigger: true } });
  });

  test("禁用技能不参与自动触发", () => {
    service.setEnabled("alpha", false);
    expect(service.matchAutoTrigger("please make an alpha showcase video")).toEqual([]);
    service.setEnabled("alpha", true);
    expect(service.matchAutoTrigger("please make an alpha showcase video").map((s) => s.name)).toEqual(["alpha"]);
  });

  test("7 个技能全部命中时截取前 5（同分按名升序）", () => {
    const hits = service.matchAutoTrigger("match 1 2 3 4 5 6 7 go");
    expect(hits.length).toBe(5);
    expect(hits.map((s) => s.name)).toEqual(["match-1", "match-2", "match-3", "match-4", "match-5"]);
  });
});

describe("buildPromptBlock 系统提示注入块", () => {
  let root: string;
  let dataDir: string;
  let service: SkillService;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "videoos-skills-f-"));
    dataDir = await mkdtemp(join(tmpdir(), "videoos-skills-data-f-"));
    for (const dir of ["alpha", "beta"]) await mkdir(join(root, dir));
    await writeFile(join(root, "alpha", "SKILL.md"), ALPHA_MD, "utf8");
    await writeFile(
      join(root, "beta", "SKILL.md"),
      skillMd({ name: "beta", description: "Beta demo skill", trigger: "Use for beta countdown lists" }),
      "utf8",
    );
    service = new SkillService({ defaultDirs: [root], settings: new SettingsStore(dataDir) });
    await service.refresh();
  });

  afterAll(() => cleanup(root, dataDir));

  test("空输入 → 空串", () => {
    expect(service.buildPromptBlock([])).toBe("");
  });

  test("包含头部说明/技能段/what/when/摘要/收尾指令", () => {
    const block = service.buildPromptBlock([service.get("alpha")!, service.get("beta")!]);
    expect(block).toContain("## Skills (video production workflows)");
    expect(block).toContain(
      "When a skill below matches the user's request, follow its workflow steps and QA gates. Reference real VAP tool names only.",
    );
    expect(block).toContain("### skill: alpha (v0.2.0)");
    expect(block).toContain("- what: Alpha demo skill for tests");
    expect(block).toContain("- when: Use when the user asks for an alpha showcase or alpha sting opener");
    expect(block).toContain("- workflow summary:");
    expect(block).toContain("    1. Step one collects inputs.");
    expect(block).toContain("    8. Step eight delivers.");
    expect(block).toContain("### skill: beta (v0.1.0)");
    expect(block).toContain("    1. Single step.");
    expect(block).toContain("To use a skill the user mentioned with @name, follow it closely.");
  });

  test("摘要剔除表格行与围栏代码、截到 8 行、Workflow 段外内容不进入", () => {
    const block = service.buildPromptBlock([service.get("alpha")!]);
    expect(block).not.toContain("| Col |");
    expect(block).not.toContain('v.scene("alpha"');
    expect(block).not.toContain("Step nine");
    expect(block).not.toContain("Recipe prose after workflow.");
  });
});

describe("CJK 自动触发（2 字 shingle 子串匹配）", () => {
  let root: string;
  let dataDir: string;
  let service: SkillService;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "videoos-skills-g-"));
    dataDir = await mkdtemp(join(tmpdir(), "videoos-skills-data-g-"));
    for (const dir of ["intro-zh", "latin-only"]) await mkdir(join(root, dir));
    await writeFile(
      join(root, "intro-zh", "SKILL.md"),
      skillMd({
        name: "intro-zh",
        description: "Chinese product intro fixture",
        trigger: "当用户要求产品介绍或开场视频时使用 (use when the user asks for a product intro)",
      }),
      "utf8",
    );
    await writeFile(
      join(root, "latin-only", "SKILL.md"),
      skillMd({ name: "latin-only", description: "Latin only fixture", trigger: "Use for unrelated countdown tasks" }),
      "utf8",
    );
    service = new SkillService({ defaultDirs: [root], settings: new SettingsStore(dataDir) });
    await service.refresh();
  });

  afterAll(() => cleanup(root, dataDir));

  test("中文请求经 2 字 shingle 命中含中文触发词的技能", () => {
    const hits = service.matchAutoTrigger("做一个产品介绍视频");
    expect(hits.map((s) => s.name)).toEqual(["intro-zh"]);
  });

  test("无关中文文本不命中", () => {
    expect(service.matchAutoTrigger("今天天气怎么样")).toEqual([]);
  });

  test("中英混合文本：拉丁 token 分 + CJK shingle 分叠加命中", () => {
    const hits = service.matchAutoTrigger("来一个 product intro 的产品介绍视频");
    expect(hits.map((s) => s.name)).toEqual(["intro-zh"]);
  });
});
