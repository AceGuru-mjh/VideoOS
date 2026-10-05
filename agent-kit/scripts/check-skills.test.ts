// check-skills harness 自身的测试（Issue #38 负例验收）：
// tempdir 构造坏技能 → 逐条命中规则；好技能 → 通过；不污染 skills/。
import { afterAll, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkSkillContent, checkSkillsDir } from "./check-skills";

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

async function newDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "check-skills-"));
  dirs.push(d);
  return d;
}

const GOOD_SKILL = `---
name: good-skill
version: 0.1.0
description: A well-formed skill for testing the harness itself.
trigger: The user asks for a well-formed test fixture video.
---

# Good Skill

Goal: a 5s fixture video.

## Workflow

1. Plan then write DSL.
2. \`compile.run\` until zero errors.
3. \`test.run\` green, then \`render.final\`.

## Recipes

First scene:

\`\`\`ts
v.scene("a", { duration: 2 }, (s) => {
  s.beat("in", { at: 0.2 });
  s.text("title", "Hello", { size: 100, color: "#ffffff", at: { x: "50%", y: "50%" } });
});
\`\`\`

Second scene:

\`\`\`ts
v.scene("b", { duration: 2 }, (s) => {
  s.rect("bar", { width: 200, height: 8, fill: "#f59e0b", at: { x: "50%", y: "40%" } });
  s.camera("push-in", { from: 1.0, to: 1.05 });
});
\`\`\`
`;

describe("checkSkillContent 负例", () => {
  const base = (overrides: Record<string, string>): string => {
    const fm = { name: "probe", version: "0.1.0", description: "Probe skill for harness tests.", trigger: "The user asks for a probe fixture.", ...overrides };
    const fmText = Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join("\n");
    return `---\n${fmText}\n---\n\n# Probe\n\nGoal: probe.\n\n## Workflow\n\n1. compile.run then test.run.\n\n## Recipes\n\n\`\`\`ts\nv.scene("a", { duration: 1 }, (s) => { s.beat("b", { at: 0 }); });\n\`\`\`\n\n\`\`\`ts\nv.scene("c", { duration: 1 }, (s) => { s.text("t", "x", { size: 10 }); });\n\`\`\`\n`;
  };

  const rules = (violations: ReturnType<typeof checkSkillContent>): string[] => violations.map((v) => v.rule);

  it("好技能 → 零违规", () => {
    expect(checkSkillContent(GOOD_SKILL, "good-skill/SKILL.md", "good-skill")).toEqual([]);
  });

  it("name 与目录名不一致 → frontmatter 违规", () => {
    const v = checkSkillContent(GOOD_SKILL, "other-name/SKILL.md", "other-name");
    expect(rules(v)).toContain("frontmatter");
    expect(v[0].message).toContain("must equal directory name");
  });

  it("缺 frontmatter → 违规且短路", () => {
    const v = checkSkillContent("# no frontmatter\n\nGoal: x\n", "x/SKILL.md", "x");
    expect(rules(v)).toContain("frontmatter");
  });

  it("description 超 160 字符 → 违规", () => {
    const v = checkSkillContent(base({ description: "x".repeat(161) }), "probe/SKILL.md", "probe");
    expect(rules(v)).toContain("frontmatter");
    expect(v[0].message).toContain("160");
  });

  it("trigger 与 description 雷同 → 违规", () => {
    const v = checkSkillContent(base({ trigger: "Probe skill for harness tests." }), "probe/SKILL.md", "probe");
    expect(rules(v)).toContain("frontmatter");
    expect(v[0].message).toContain("trigger");
  });

  it("version 非 semver → 违规", () => {
    const v = checkSkillContent(base({ version: "latest" }), "probe/SKILL.md", "probe");
    expect(rules(v)).toContain("frontmatter");
  });

  it("Workflow 缺 test.run → 违规", () => {
    const content = base({}).replace("compile.run then test.run", "compile.run only");
    const v = checkSkillContent(content, "probe/SKILL.md", "probe");
    expect(v.some((x) => x.rule === "workflow" && x.message.includes("test.run"))).toBe(true);
  });

  it("Workflow 缺 compile.run → 违规", () => {
    const content = base({}).replace("compile.run then test.run", "test.run only");
    const v = checkSkillContent(content, "probe/SKILL.md", "probe");
    expect(v.some((x) => x.rule === "workflow" && x.message.includes("compile.run"))).toBe(true);
  });

  it("代码块只有 1 个 → 违规", () => {
    const content = base({}).replace(/```ts\nv\.scene\("c"[\s\S]*?```/, "");
    const v = checkSkillContent(content, "probe/SKILL.md", "probe");
    expect(v.some((x) => x.rule === "recipes" && x.message.includes("2 fenced"))).toBe(true);
  });

  it("白名单外 DSL API（s.hologram）→ 违规", () => {
    const content = base({}).replace("s.beat(", "s.hologram(");
    const v = checkSkillContent(content, "probe/SKILL.md", "probe");
    expect(v.some((x) => x.rule === "recipes" && x.message.includes("s.hologram"))).toBe(true);
  });

  it("局部变量 .entries() 不误伤（词边界）", () => {
    const content = base({}).replace(
      "s.beat(",
      "for (const [i, x] of lines.entries()) s.beat(",
    );
    const v = checkSkillContent(content, "probe/SKILL.md", "probe");
    expect(v.filter((x) => x.rule === "recipes")).toEqual([]);
  });

  it("emoji → 违规（数学符号/箭头/制表符不误伤）", () => {
    const withEmoji = base({}).replace("Goal: probe.", "Goal: probe with 🎉 emoji and ≥ 3 math and → arrow.");
    const v = checkSkillContent(withEmoji, "probe/SKILL.md", "probe");
    expect(v.some((x) => x.rule === "hygiene" && x.message.includes("emoji"))).toBe(true);
    const mathOnly = base({}).replace("Goal: probe.", "Goal: probe with ≥ 3 math, → arrow, │ box chars — no emoji.");
    expect(checkSkillContent(mathOnly, "probe/SKILL.md", "probe").filter((x) => x.rule === "hygiene")).toEqual([]);
  });

  it("密钥样文（sk-/ghp- 前缀长串）→ 违规；task-run 不误伤", () => {
    const withKey = base({}).replace("Goal: probe.", "Goal: probe. Key: sk-abcdef1234567890xyz");
    const v = checkSkillContent(withKey, "probe/SKILL.md", "probe");
    expect(v.some((x) => x.rule === "hygiene" && x.message.includes("credential-like"))).toBe(true);
    const withGhp = base({}).replace("Goal: probe.", "Goal: probe. Token: ghp_Ab12Cd34Ef56Gh78Ij90");
    expect(checkSkillContent(withGhp, "probe/SKILL.md", "probe").some((x) => x.rule === "hygiene")).toBe(true);
    const safe = base({}).replace("Goal: probe.", "Goal: run the task-runner with risk-free flags.");
    expect(checkSkillContent(safe, "probe/SKILL.md", "probe").filter((x) => x.rule === "hygiene")).toEqual([]);
  });
});

describe("checkSkillsDir 目录级", () => {
  it("混合目录：好技能通过、坏技能逐条报告；缺 SKILL.md 也算违规", async () => {
    const dir = await newDir();
    await mkdir(join(dir, "good-skill"), { recursive: true });
    await writeFile(join(dir, "good-skill", "SKILL.md"), GOOD_SKILL, "utf8");
    await mkdir(join(dir, "bad-emoji"), { recursive: true });
    await writeFile(join(dir, "bad-emoji", "SKILL.md"), GOOD_SKILL.replace("# Good Skill", "# Good Skill 🎬"), "utf8");
    await mkdir(join(dir, "empty-dir"), { recursive: true });

    const result = checkSkillsDir(dir);
    expect(result.checked).toBe(2); // empty-dir 没有 SKILL.md → 不计入 checked
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.file.includes("bad-emoji") && v.rule === "hygiene")).toBe(true);
    expect(result.violations.some((v) => v.file.includes("empty-dir") && v.rule === "io")).toBe(true);
  }, 10_000);

  it("全好目录 → ok", async () => {
    const dir = await newDir();
    await mkdir(join(dir, "good-skill"), { recursive: true });
    await writeFile(join(dir, "good-skill", "SKILL.md"), GOOD_SKILL, "utf8");
    const result = checkSkillsDir(dir);
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(1);
  }, 10_000);

  it("不存在/空目录 → ok:false 且带 io 违规", async () => {
    const result = checkSkillsDir(join(await newDir(), "nope"));
    expect(result.ok).toBe(false);
    expect(result.violations[0].rule).toBe("io");
  }, 10_000);
});
