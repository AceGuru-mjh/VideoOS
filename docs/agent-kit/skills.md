# Agent Kit 技能库指南（42 技能）

> 本文实现 agent-kit/SPEC.md §4（支柱三 · 技能库）的交付物文档。SKILL.md 格式与 SPEC §4.1 冻结契约 D、agent-kit/CONVENTIONS.md §2 一致。

## 1. 是什么

`skills/<name>/SKILL.md` 是写给视频创作 Agent 的**创作剧本**：frontmatter 声明"是什么 / 何时用"，Workflow 编排真实的 VAP 工具（`compile.run` → `render.preview` → `test.run` → 修复循环），Recipes 给可直接照抄的 DSL 片段，QA gates 与 Anti-patterns 把踩过的坑固化成门禁。技能教"怎么做"，VAP 工具（Studio chat Agent 侧 38 个：31 基础 + 模板 3 + 知识 4，见 [docs/mcp-guide.md](../mcp-guide.md) 与 [docs/v0.2-agent-app.md §10](../v0.2-agent-app.md)）是"手"，两者配合完成 DSL → VIR → 渲染 → 视觉 QA 的闭环。

当前规模：42 个技能（存量 5 + SPEC §4.2 清单 20 + 生态调研派生 17），`bun run agent-kit/scripts/check-skills.ts` 全库 PASS。紧凑索引见 [skills/README.md](../../skills/README.md)。

## 2. 42 技能分类总表

### 营销叙事（10）

| 目录名 | 一句话场景 | 何时用关键词 |
| --- | --- | --- |
| `product-demo` | 产品宣传五幕：hook → 问题 → 方案 → 证明 → CTA | promo / demo / launch / marketing |
| `cinematic-video` | 电影感多场景：运镜、crossfade、命名 beat 网格 | cinematic / movie-like / brand film |
| `ad-remix` | 一稿三剪：同一素材出 30s / 15s / 6s 变体（保 hook → 保 CTA → 压中段） | cutdown / 30s 15s 6s / bumper |
| `hook-forge` | 开头 1-3 秒钩子：提问 / 大数字 / 动作先行 / 错位四模式库 | hook / first 3 seconds / retention |
| `trailer-cut` | 预告片三幕：3s tease → 4-6s 三连硬切 → 2s 定版 | teaser / coming soon / trailer |
| `showreel` | 作品集快剪：1s 宣言 hook + 每作品约 2.4s + 呼应收束帧 | showreel / portfolio / demo reel |
| `recruitment` | 招聘视频：职位卡轮播或单职位深讲，薪资用占位符不编造 | hiring / recruitment / job posting |
| `countdown` | 倒计时/活动预告：数字逐秒翻滚 + 事件定版卡 | countdown / launch timer / event teaser |
| `quote-card` | 金句卡片（1:1）：巨引号 + 打字机 + 关键句呼吸强调 + 署名 | quote / testimonial / pull-quote |
| `end-card` | 片尾定版卡：CTA + ≥0.8s 全静止，淡入不淡出 | outro / end screen / subscribe |

### 音乐歌词（3）

| 目录名 | 一句话场景 | 何时用关键词 |
| --- | --- | --- |
| `kinetic-lyrics` | 动态歌词 MV：upcoming/live/sung 三态逐字 + BPM 半拍网格 | lyrics video / karaoke / MV |
| `audio-react` | 节拍驱动动效：250ms 网格量化延迟与音频淡入 + 调试节拍器 | on the beat / BPM / audio-reactive |
| `kinetic-typography` | 纯文字动能排版：逐字 wave + 关键词 3x + 同位闪切替换 | kinetic type / typography / text-only |

### 信息图表（10）

| 目录名 | 一句话场景 | 何时用关键词 |
| --- | --- | --- |
| `data-motion` | 图表动画怎么画：bar/轴/值标签/count-up 全用 rect/text 原语 | bar chart / data story / counter |
| `data-dashboard` | 看板叙事节奏：hero KPI count-up + 2x1 卡对 + 趋势阶梯收结论 | KPI recap / dashboard / quarterly |
| `chart-story` | 单图表叙事四幕：establish → annotate → reveal → takeaway | explain this chart / bar race |
| `roadmap` | 路线图时间轴：节点逐个点亮 + 里程碑焦点轮播 + 三态标记 | roadmap / milestone / timeline |
| `changelog` | 版本更新日志：版本横幅 + 标签条目逐一入场 + 升级 CTA | changelog / release notes / what's new |
| `comparison` | 对比评测：分屏两列 + 逐回合 PK + "why X wins" 裁决帧 | versus / X vs Y / head-to-head |
| `news-brief` | 资讯简报：ticker 固定节奏轮换 + 编号要点 + 信源尾帧 | news update / briefing / bulletin |
| `year-review` | 年度回顾：4 KPI 数据大屏 + 高光时刻轮播 + 亮底反转定版 | year-in-review / annual recap |
| `meeting-recap` | 会议纪要视频：决策卡 + 行动清单（owner + due）+ 日期条 | meeting notes / minutes / recap |
| `math-derivation` | 公式推导步进：当前行下划线、已推行灰、⟹ 步进箭头 | proof / derivation / worked steps |

### 教学讲解（6）

| 目录名 | 一句话场景 | 何时用关键词 |
| --- | --- | --- |
| `tutorial` | 分步教程：步骤大数字 + 焦点挖空框 + 每步节奏表 + 进度条 | how-to / walkthrough / step-by-step |
| `api-explainer` | API 讲解：端点卡 + 参数行滑入 + 响应字段淡入 + 一句话总结 | explain an API / endpoint / request-response |
| `doc-to-video` | 文档转视频：md.outline 抽骨架即 storyboard + 密度裁剪 + 信源尾帧 | doc tour / README / blog post |
| `screenshot-tour` | 截图走查：Ken Burns 缓推 + 编号标注点 + 指针线 | product tour / UI walkthrough / screenshots |
| `course-intro` | 课程片头：课程名大字 + 章节预览列表 + 讲师署名条 | course intro / class / workshop |
| `interview-clip` | 访谈切片：说话人条 + 原句淡出 + 0.4s 静默帧 + 大字金句重登 | interview / podcast / testimonial clip |

### 品牌风格（5）

| 目录名 | 一句话场景 | 何时用关键词 |
| --- | --- | --- |
| `brand-kit` | 单 BRAND token 对象全场景消费 + contrast 门禁 + 一行 reskin | brand colors / style guide / reskin |
| `style-shorts` | 三种风格短打：剪纸拼贴 / 8-bit 像素 / 极简瑞士，规则表锁死 | paper cutout / pixel art / Swiss |
| `logo-reveal` | Logo 揭示：遮罩滑走擦除 + 光斑横扫 + 定版（无 logo 文件也可文字兜底） | logo reveal / sting / ident |
| `tech-intro` | 科技感片头：网格背景 + 大字 blur-up + 摄像机推拉 | tech / futuristic / intro sting |
| `lower-thirds` | 人名条/字幕条：级联滑入滑出 + 底部 10% 安全区 + 多说话人轮换 | name tag / lower third / chyron |

### 工程工具型（8）

| 目录名 | 一句话场景 | 何时用关键词 |
| --- | --- | --- |
| `short-video` | 竖屏 9:16 规范：1080x1920、大字、平台安全边距、高 beat 密度 | vertical / TikTok / Reels / Shorts |
| `aspect-reframe` | 16:9 与 9:16 双向重锚定：y% 映射表 + 安全区门禁 + 0.82x 字号补偿 | vertical variant / platform UI zones |
| `script-timing` | 口播字数预算：2-3 词/秒 + 标点停顿 → beat 时序表 + 超载三级裁剪 | script fits / overruns / pacing |
| `subtitle-burn` | 字幕烧制：SRT cue → 层映射 + 底板样式规范 + CPS 先改文再压时长 | burn captions / SRT / VTT |
| `accessible-captions` | 无障碍字幕五门禁：对比度 / CPS / 字号下限 / 防闪 / 音效字幕 | a11y / WCAG / hard-of-hearing |
| `gif-loop` | 无缝循环 GIF：首尾帧等效 + 480px / 12-15fps / ≤8MB 预算 + media.gif 导出 | looping GIF / README embed / Slack |
| `ab-variants` | A/B 单变量实验：平行目录 + DIFF.md + test.run 断言差集判定 | A/B test / variant A and B |
| `visual-qa` | 视觉 QA 套件：语义断言 + golden 阈值 + 事务回滚修复循环 | tests / QA / golden images |

相邻技能之间多数写有显式分工声明（"not for X — that's Y skill"），选用前先看同类目内各技能的 trigger 差异。

## 3. SKILL.md 契约摘要

frontmatter（四字段全部必填）：

| 字段 | 规则 |
| --- | --- |
| `name` | 必须等于目录名，kebab-case |
| `version` | `x.y.z` 语义化版本 |
| `description` | 英文，≤160 字符，说"是什么" |
| `trigger` | 英文，说"何时用"，与 description 必须不同（校验器硬性检查） |

章节与内容硬性要求：

- 章节必需 `# Title`、`Goal:`（目标视频：时长/比例/基调）、`## Workflow`、`## Recipes`；强烈推荐 `## QA gates` 与 `## Anti-patterns`（每条带 why）；
- `## Workflow` 必须字面出现 `compile.run` 与 `test.run`，且只引用真实 VAP 工具名（白名单见下），写明 QA 门禁与修复循环上限；
- Recipes 代码块 ≥ 2 个（```ts 围栏），且 `v.` / `s.` 调用只允许 DSL 白名单方法：`v.scene` `v.transition` `s.beat` `s.text` `s.rect` `s.ellipse` `s.image` `s.camera` `s.audio`（`defineVideo` 是普通导入函数，不计入）；
- 禁止 emoji；禁止 `sk-` / `ghp_` / `github_pat_` 等密钥样文（教学示例也不行）；
- 惯例：全文 70-120 行；Workflow 5-7 步；Anti-patterns 4-6 条；数字（帧数/秒数/字号）需自洽复算。

Workflow 可引用的 VAP 工具名（与 `@videoos/agent` createDefaultTools 对齐）：`storyboard.plan` `storyboard.toScenes` `compile.run` `compile.diagnostics` `compile.vir` `render.preview` `render.final` `render.range` `render.status` `render.cancel` `test.run` `test.results` `scene.list` `scene.inspect` `scene.modify` `layer.inspect` `layer.modify` `inspect.frame` `diff.frames` `asset.add` `asset.list` `audio.list` `audio.set` `cache.stats` `cache.clear` `check.overflow` `check.missingAssets` `transaction.begin` `transaction.commit` `transaction.rollback` `transaction.list` `project.*`。**禁止发明不存在的工具名**。

## 4. 写新技能：10 步教程

以既有技能为范本（推荐先精读 `product-demo`、`tech-intro`、`hook-forge` 三篇标杆）：

| 步 | 做什么 | 要点 |
| --- | --- | --- |
| 1 | 选品类与边界 | 在 §2 总表找定位；若与相邻技能重叠，写显式分工声明（"not for X — use Y"） |
| 2 | 定 trigger | 只写"何时用"判据，覆盖同义词与用户没说出领域词的隐性场景；不写工作流概述（Agent 会照 description 抄近路） |
| 3 | 写 frontmatter | name = 目录名、version 从 0.1.0 起、description ≤160 字符且与 trigger 分工 |
| 4 | 写 Goal | 一句话含时长区间 / 画幅比例 / 基调 |
| 5 | 建时序表 | 场景 × 时间轴（beat/层 in/out 时刻），帧数 = 秒 × 30 逐格复算自洽 |
| 6 | 写 Workflow | 5-7 步编号祈使句；字面含 `compile.run` 与 `test.run`；引用上节白名单工具；写明修复循环上限 |
| 7 | 写 Recipes | ≥2 个可抄的 `ts` 代码块，只用 DSL 白名单方法，标注所属 Act 与主导元素，给具体数值 |
| 8 | 写 QA gates | 帧断言（`render.preview` 后查具体帧）、1s hook 可读、stagger 0.3-0.45s、结尾静止 ≥0.8s、muted 也成立 |
| 9 | 写 Anti-patterns | 4-6 条"Agent 会想当然做错"的引擎事实，每条带 why（如 wipe/typewriter 仅 text 层、exit 动画原路返回） |
| 10 | 自校 | `bun run agent-kit/scripts/check-skills.ts` 必须 PASS；对照行数与代码块数惯例 |

## 5. check-skills.ts 用法与校验规则

```bash
bun run agent-kit/scripts/check-skills.ts
# 输出 check-skills: PASS (42 skills: ...) 且退出码 0；任何违规退出码 1 并逐文件列出
```

全部校验规则：

| # | 规则 | 违规样例 |
| --- | --- | --- |
| 1 | frontmatter 可解析且字段齐全：name = 目录名且 kebab、version 为 x.y.z、description 非空 ≤160、trigger 非空且 ≠ description | `name: demo_skill`（下划线非 kebab） |
| 2 | 章节存在：`# Title`、`Goal:`、`## Workflow`、`## Recipes` | 缺 `Goal:` 行 |
| 3 | `## Workflow` 字面包含 `compile.run` 与 `test.run` | 只写了 render.final |
| 4 | 围栏代码块 ≥ 2 个 | 只有一个 Recipes 片段 |
| 5 | 代码块内 `v.` / `s.` 方法在 DSL 白名单内（scene/transition/beat/text/rect/ellipse/image/camera/audio） | `s.group(...)`（v1 无此 API） |
| 6 | 全文无 emoji（`\p{Extended_Pictographic}`） | 标题里的表情符号 |
| 7 | 无密钥样文：`sk-` / `ghp_` / `gho_` / `ghu_` / `github_pat_` / `AKIA` / `xox[bap]-` 前缀 | 示例里的假 API key |

另：SKILL.md 缺失或空文件同样按违规报出。存量技能一并纳入校验；改了 `skills/` 的提交必须带一次 PASS 输出。

## 6. 技能库从哪来

| 批次 | 数量 | 说明 |
| --- | --- | --- |
| 存量（主线 v0.1） | 5 | product-demo、short-video、cinematic-video、data-motion、visual-qa |
| SPEC §4.2 清单 | 20 | tech-intro、kinetic-lyrics、logo-reveal、lower-thirds、quote-card、countdown、api-explainer、changelog、roadmap、data-dashboard、math-derivation、subtitle-burn、comparison、tutorial、screenshot-tour、interview-clip、news-brief、recruitment、course-intro、year-review |
| 生态调研派生（GitHub skills 生态验证过的新方向） | 17 | hook-forge、kinetic-typography、script-timing、aspect-reframe、ad-remix、end-card、gif-loop、accessible-captions、showreel、brand-kit、audio-react、ab-variants、trailer-cut、meeting-recap、doc-to-video、chart-story、style-shorts |

新增技能请走 §4 的 10 步并在 PR 里附 check-skills PASS 输出；品类建议先开 Issue 对齐（避免与既有技能边界重叠）。
