# 技能写作指南 — SKILL.md 契约、校验与范例

> 面向为 `skills/` 新增创作技能的贡献者。契约源：`agent-kit/SPEC.md` §4.1（冻结契约 D）；
> 校验器：`agent-kit/scripts/check-skills.ts`。写之前先精读 2–3 个存量技能（§6）。
> 技能库现状：43 个（存量 5 + Agent Kit 新增 38），全部过校验（P2/P3/P4 代校验器）。

## 1. SKILL.md 契约（逐字段）

```markdown
---
name: <kebab-case id，必须等于目录名>
version: 0.1.0
description: <一句话，英文，≤ 160 字符>
trigger: <什么时候用这个技能 —— 面向 Agent 的判据，英文>
---

# <Title>

Goal: <目标视频：时长/比例/基调>

## Workflow
<编号步骤：只引用真实 VAP 工具名；写明 QA 门禁与修复循环上限>

## Recipes
<≥ 2 个真实可抄的 DSL 片段，每段标注所属 Act 与主导元素>

## QA gates        （存量技能的通行章节，强烈建议）
## Anti-patterns   （同上）
```

| 字段/章节 | 硬性规则 | 为什么 |
| --- | --- | --- |
| `name` | kebab-case（`/^[a-z][a-z0-9-]*$/`）**且等于目录名** | 目录即技能 id；不一致直接违规 |
| `version` | semver（`^\d+\.\d+\.\d+$`） | 技能可迭代 |
| `description` | 英文、一句话、≤ 160 字符 | 给人看的"它是什么" |
| `trigger` | 非空；**不得与 description 雷同**（校验器逐字比对，完全相同即违规） | trigger 是给 Agent 的路由判据（"用户要 X 时选我"），description 是给人的一句话定位 —— 两类读者，两段文案 |
| `# Title` / `Goal:` | 必须存在 | Goal 写时长/比例/基调（如 "a 20–30s marketing cut … 16:9"） |
| `## Workflow` | 编号步骤；**必须出现 `compile.run` 与 `test.run` 字样**；QA 门禁 + 修复循环上限（≤ `maxRepairLoops`，超限 `transaction.rollback`） | Workflow 是执行剧本，两个工具是编译/质检的最低闭环 |
| `## Recipes` | 代码块 ≥ 2 个；只准用 DSL 白名单 API（§3）；每段标注所属 Act 与主导元素 | 配方是技能的本体 —— 必须可抄、可编译 |
| `## QA gates` | 可选但强烈建议 | 可判定的断言清单（`toContainText` / `toHaveLayers` / `durationBetween` / `noTextOverflow`） |
| `## Anti-patterns` | 可选但强烈建议 | 该品类的"绝不做"清单，review 的依据 |

description 与 trigger 的分工实例（摘自 `skills/countdown`）：

```yaml
description: Countdown and event teaser - numbers swap exactly on whole seconds, the final
  GO frame pops with easeOutBack, then a still CTA lockup.
trigger: The user asks for a countdown, "3-2-1", launch or event teaser, stream
  "starting soon" clip, webinar open, or deadline reminder video.
```

description 说"成片长什么样"；trigger 列出用户会说出的请求形状（关键词、场景、别名）。

## 2. 真实 VAP 工具清单（31 个，以 `@videoos/agent` `createDefaultTools` 为准）

Workflow 里只准引用这些名字（**禁止发明不存在的工具名**）：

| 组 | 工具 |
| --- | --- |
| 编译 | `compile.run` · `compile.diagnostics` · `compile.vir` |
| 场景/图层 | `scene.list` · `scene.inspect` · `scene.modify` · `layer.inspect` · `layer.modify` |
| 项目资产 | `asset.list` · `asset.add` · `audio.list` · `audio.set` |
| 渲染/缓存 | `render.preview` · `render.range` · `render.final` · `render.status` · `render.cancel` · `cache.stats` · `cache.clear` |
| 质检 | `test.run` · `test.results` |
| 事务 | `transaction.begin` · `transaction.commit` · `transaction.rollback` · `transaction.list` |
| 诊断 | `inspect.frame` · `diff.frames` · `check.overflow` · `check.missingAssets` |
| 故事板 | `storyboard.plan` · `storyboard.toScenes` |

典型 Workflow 骨架（结构是契约，工具是动词）：事实收集 → `storyboard.plan`（输出只是草稿，结构表才是契约）→ 写 `src/video.ts`（Recipes）→ `compile.run` 0 errors → `render.preview` 逐 beat → QA gates → `test.run` → 修复环（≤ `maxRepairLoops`，超限 `transaction.rollback`）→ `render.final`。

## 3. DSL API 白名单（`check-skills.ts` 内置常量）

Recipes 代码块里 `s.xxx(` / `v.xxx(` 形式的调用只准出自以下集合（= `@videoos/dsl` 真实导出面，`packages/dsl/src/builder.ts`）：

```
v.scene  v.transition  v.audio
s.text  s.rect  s.ellipse  s.image  s.camera  s.beat
defineVideo
```

**警告**：SPEC 早期示例里的 `s.group` / `v.output` 是幽灵 API，DSL 里**不存在** —— 用了校验器直接 fail（`non-whitelisted DSL API calls: s.group, v.output`）。

词边界细节：校验器用 `\b([sv])\.([a-zA-Z]+)\(` 提取调用 —— 局部变量的方法调用（如 `lines.entries()`、`TICKS.entries()`）因 `s` 前是字母（无词边界）**不会**被误判成 `s.entries`，可在配方里放心使用数组迭代；反之，任何**独立成词**的 `s.` / `v.` 调用都会被检查，别拿这两个字母当普通变量名。

## 4. 校验器：五条规则 + 运行方式

```bash
bun run agent-kit/scripts/check-skills.ts             # 扫 skills/（缺省）
bun run agent-kit/scripts/check-skills.ts path/to/dir # 自定义目录
```

退出码：**0 = 全过**（`[check-skills] OK — 25 skills passed`）；**1 = 有违规**，逐条打印每条违规的文件、规则名与消息（形如 `<file> [<rule>] <message>`）。CI（`agent-kit-ci.yml` 的 "Skills check" 步骤）跑同一条命令 —— 它在 ubuntu job 的最后一步，违规即工作流红。

| # | 规则 | 判定要点 |
| --- | --- | --- |
| 1 | frontmatter | `---` 块可解析（文件头，顶层 `key: value`）；`name`=目录名且 kebab；`version` semver；`description` ≤ 160；`trigger` 非空且 ≠ description |
| 2 | sections | 存在 `# Title`、`Goal:` 行、`## Workflow`、`## Recipes` |
| 3 | workflow | Workflow 章节文本包含 `compile.run` 与 `test.run` |
| 4 | recipes | 围栏代码块 ≥ 2；全文 DSL 调用 ⊆ 白名单（§3） |
| 5 | hygiene | 无 emoji；无密钥样文（§5） |

另：目录里没有 `SKILL.md` 也算违规（`[io] SKILL.md not found`），但不计入 `checked` 数。

## 5. 卫生规则（hygiene）

- **无 emoji**：校验正则覆盖表情符号块 + 变体选择符 + 区域指示符。**允许的非 ASCII**：数学符号（`≥ × ≈`）、箭头（`→ ←`）、制表符（`│ ─`）、中点 `·` —— 存量技能大量使用，不会误伤。
- **无凭据样文**：`\b(?:sk|ghp|gho|github_pat)[-_][A-Za-z0-9]{8,}` 直接 fail。示例密钥一律写占位符（`<API_KEY>`）或干脆不写。词边界 `\b` 的存在使 `task-runner`、`risk-free` 这类普通词**不会**被 `sk-` 误伤（sk 必须在词首才算命中）。
- 配方里的非 ASCII 数学/引号字符建议以 `\uXXXX` 转义写入代码块（存量技能的做法，避免编码意外）。
- 本文档与 `docs/agent-kit/` 其余两篇同样遵守以上卫生规则（贡献文档不是技能，但保持同一套审美）。

## 6. 范例：抄这三个

- **`skills/product-demo`** — 五幕结构范式：Act/Window/Scene/Job/Dominant element 五列表格 + 每幕一个配方（Hook 大字 blur-up、Problem 三行 stagger、Solution 编号动列、Proof 大数字、CTA 定版）+ "never invent metrics" 的数据纪律。**叙事类技能的骨架模板**。
- **`skills/countdown`** — 节拍网格律：数字 N 独占整秒窗 `[i, i+0.95)`，`in`/`out` 时间窗保证换帧落整秒、两个数字绝不共存；easeOutBack 只预算给终帧 GO（"overshoot is budgeted for ONE frame"）；变体表（3-2-1 / 10-1 / 60-10）展示同一法则换网格。**时间轴驱动类技能的骨架**。
- **`skills/comparison`** — 数据诚实规则：固定列锚 `x = 27%/73%`、每行同一 px/分刻度（"if A's 8.6 bar out-lengths B's 9.1 bar, the video lies"）、反分维度（价格）只显数值不画条、verdict 永不无据判胜（"a fabricated WINNER chip is the cardinal sin"）。**任何带数字/评分的技能先抄这里的纪律**。

其他可参照的结构原型（20 个新技能刻意做了结构分化，写新技能先对号入座再动笔）：

| 结构装置 | 技能示例 |
| --- | --- |
| 单场景三拍（遮罩揭标/定版） | `logo-reveal` · `quote-card` · `roadmap` |
| in/out 时间窗逐层独占 | `kinetic-lyrics` · `lower-thirds` · `subtitle-burn` |
| 逐场景重铸色（当前项高亮、既往项置灰） | `math-derivation` |
| 两列流动（请求/响应包往返） | `api-explainer` |
| 列表对位（横幅与条目反向入场） | `changelog` |
| 一步一景 + 聚光框 | `tutorial` |
| Ken Burns 交替推拉 | `screenshot-tour` |
| KPI 大数计数 + 趋势线分段生长 | `data-dashboard` · `year-review` |
| 竖屏社媒（复用 short-video 安全区） | `news-brief` · `recruitment` |

## 7. 反模式（校验器抓不到、review 会打回的）

- **发明 VAP 工具名**：Workflow 里写 `render.export`、`qa.check` 之类不存在的工具 —— 校验器只检查 Workflow 里 `compile.run`/`test.run` 的存在性，其余工具名靠 review；只引用 §2 清单。
- **把 product-demo 结构套给每个品类**：五幕 ≠ 万能模板。countdown 是节拍网格、math-derivation 是逐场景重铸色、api-explainer 是两列流动 —— 先找品类的时间结构（表/窗/网格/列表），再定结构（§6 表）。
- **含糊的 trigger**（"make a video"、"create content"）：trigger 要写成可判定的路由判据 —— 列出用户会说出的请求形状（"countdown / 3-2-1 / launch teaser / starting soon"），并与 description 明确分工。
- **不可编译的配方**：幻觉参数（`s.text` 没有 `font` 参数）、幽灵 API（§3）、未声明就用的变量。写完在脑内过一遍 `compile.run`；layer 的时间窗（`in`/`out`）、enter/exit 参数以 `packages/dsl/src/builder.ts` 为准。
- **配方无标注**：每段代码块前一行说明它属于哪个 Act、主导元素是什么 —— 这是契约的一部分，也是后续维护者唯一的导航。
- **无数据纪律**：编造指标、无出处的评分、没有日期的 countdown —— 宁可问用户，不可造数。
- **超长**：目标 60–110 行。技能是给 Agent 读的操作卡，不是教科书；细节留给 DSL/QA 文档。

## 8. 提交前清单

- [ ] `bun run agent-kit/scripts/check-skills.ts` 退出码 0
- [ ] description ≤ 160 字符、一句话；trigger 与其明确分工且非逐字相同
- [ ] Workflow 含 `compile.run` + `test.run`，修复环写明上限与回滚（`transaction.rollback`）
- [ ] Recipes ≥ 2 段、全部白名单 DSL、每段标注 Act + 主导元素
- [ ] 无 emoji、无密钥样文；非 ASCII 仅限数学/箭头/制表符/中点
- [ ] `bun run typecheck` 绿（虽然技能是纯 md，CI 会整仓跑）+ `Agent Kit CI` 绿（路径过滤含 `skills/**`）

配套阅读：模型供应商接入见 [model-providers.md](./model-providers.md)；本地 MCP 工具与 mcp.json 见 [mcp-servers.md](./mcp-servers.md)。
