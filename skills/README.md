# VideoOS 技能库（skills/）

> 42 个视频创作技能。SKILL.md 契约（frontmatter / Workflow / DSL 白名单）见 [agent-kit/SPEC.md](../agent-kit/SPEC.md) §4 与 [agent-kit/CONVENTIONS.md](../agent-kit/CONVENTIONS.md) §2；写新技能的 10 步教程与逐技能详解见 [docs/agent-kit/skills.md](../docs/agent-kit/skills.md)。
> 校验命令：`bun run agent-kit/scripts/check-skills.ts`（当前 42/42 PASS）。

| 技能 | 场景 · 代表 trigger 关键词 | 技能 | 场景 · 代表 trigger 关键词 |
| --- | --- | --- | --- |
| **营销叙事** | | | |
| `product-demo` | 产品宣传五幕 · promo / launch | `cinematic-video` | 电影感多场景 · cinematic / brand film |
| `ad-remix` | 一稿三剪 30/15/6s · cutdown / bumper | `hook-forge` | 开头 1-3 秒钩子 · hook / retention |
| `trailer-cut` | 预告片三幕 · teaser / coming soon | `showreel` | 作品集快剪 · showreel / portfolio |
| `recruitment` | 招聘职位卡 · hiring / job posting | `countdown` | 倒计时翻牌 · countdown / launch timer |
| `quote-card` | 金句卡片 1:1 · quote / testimonial | `end-card` | 片尾定版卡 · outro / end screen |
| **音乐歌词** | | | |
| `kinetic-lyrics` | 歌词 MV 三态逐字 · lyrics / karaoke | `kinetic-typography` | 纯文字动能排版 · kinetic type |
| `audio-react` | 节拍驱动动效 · BPM / on the beat | | |
| **信息图表** | | | |
| `data-motion` | 图表动画画法 · bar chart / counter | `data-dashboard` | 看板叙事节奏 · KPI / dashboard |
| `chart-story` | 单图四幕叙事 · explain this chart / bar race | `roadmap` | 路线图时间轴 · roadmap / milestone |
| `changelog` | 版本更新日志 · release notes / what's new | `comparison` | 对比逐回合 PK · versus / X vs Y |
| `news-brief` | 资讯简报 · briefing / bulletin | `year-review` | 年度回顾 · annual recap |
| `meeting-recap` | 会议纪要视频 · minutes / recap | `math-derivation` | 公式推导步进 · proof / derivation |
| **教学讲解** | | | |
| `tutorial` | 分步教程 · how-to / step-by-step | `api-explainer` | API 讲解 · endpoint / request-response |
| `doc-to-video` | 文档转视频 · doc tour / README | `screenshot-tour` | 截图走查 · UI walkthrough / screenshots |
| `course-intro` | 课程片头 · course / workshop | `interview-clip` | 访谈切片 · podcast / testimonial clip |
| **品牌风格** | | | |
| `brand-kit` | BRAND token + reskin · style guide | `style-shorts` | 剪纸/像素/瑞士 · pixel art / Swiss |
| `logo-reveal` | Logo 揭示定版 · sting / ident | `tech-intro` | 科技感片头 · futuristic intro sting |
| `lower-thirds` | 人名条/字幕条 · lower third / chyron | | |
| **工程工具型** | | | |
| `short-video` | 竖屏 9:16 规范 · TikTok / Reels / Shorts | `aspect-reframe` | 16:9 与 9:16 双向重锚定 · vertical variant |
| `script-timing` | 口播字数预算 · pacing / overruns | `subtitle-burn` | 字幕烧制 · SRT / burn captions |
| `accessible-captions` | 无障碍字幕门禁 · a11y / WCAG | `gif-loop` | 循环 GIF · looping GIF / README embed |
| `ab-variants` | A/B 单变量实验 · variant A and B | `visual-qa` | 视觉 QA 套件 · tests / golden images |

存量 5 技能（product-demo / short-video / cinematic-video / data-motion / visual-qa）+ SPEC §4.2 清单 20 + 生态调研派生 17。新增技能走 docs/agent-kit/skills.md §4 的 10 步并过校验器。
