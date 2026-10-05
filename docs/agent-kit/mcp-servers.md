# Agent Kit MCP 服务器目录（25 服务器 · 113 工具）

> 本文实现 agent-kit/SPEC.md §3（支柱二 · 本地 MCP）的交付物文档。线协议、宿主接口与安全基线与 SPEC §3.2-§3.6 冻结契约一致；工具清单以各包 `src/index.ts` 的 `defineTool` 实测为准（本文数字均已逐一拉起服务器经 `tools/list` 核对）。

## 1. 总览

25 个 stdio MCP 服务器 + 2 个基础设施包（`mcp-lite` 协议原语、`mcp-host` 客户端宿主），按用途分六组：

| 分组 | 服务器 | 工具数 |
| --- | --- | --- |
| 本地能力 | fs · shell · os · web | 14 |
| 文本数据 | json · csv · text · diff · regex · markdown · code · math | 36 |
| 媒体素材 | media · assets · image · font | 19 |
| 开发工具 | sqlite · git · crypto | 18 |
| 生成转换 | color · plot · subtitle · archive · time | 26 |
| 基础设施 | lite · host · bridge（bridge 动态转发 20 个插件工具） | 0（内置） |

线协议（与主线 `@videoos/mcp` 逐字节兼容，全部服务器一致）：

- JSON-RPC 2.0，**逐行 JSON**（`\n` 分隔，无 Content-Length 头），protocolVersion `2025-03-26`；
- 握手：`initialize` → `notifications/initialized` → `tools/list` / `tools/call`；未初始化先调他法 → `-32002`；
- 错误码：`-32700/-32600/-32601/-32602/-32603/-32002`（参数校验失败 = `-32602`，message 含字段路径）；
- 工具返回统一 `{ ok, data? }` 或 `{ ok: false, error }`；业务错误用 `E_<CODE>: <人类可读>` 前缀（如 `E_JAIL`、`E_BINARY`）。

## 2. 本地能力（fs / shell / os / web）

### mcp-fs — 文件系统（监狱根 = env `MCP_FS_ROOTS`，缺省 `process.cwd()`）

| 工具 | 用途 |
| --- | --- |
| `fs.list` | 列目录条目（name/type/size/mtime），递归深度上限 5 |
| `fs.read` | 读文件为 utf-8 文本或 base64（字节上限截断；二进制文件拒绝 `E_BINARY`，需显式 `encoding:"base64"`） |
| `fs.write` | 写文件（文本或 base64 解码字节），返回字节数 + sha256 前 12 位校验和 |
| `fs.move` | 移动/重命名，仅限同一根内（跨根 `E_CROSS_ROOT`） |
| `fs.remove` | 删除文件/目录（目录需 `recursive:true`，返回删除条目数） |
| `fs.search` | glob 搜文件（`**/*.ts`，自实现匹配器），可选对 ≤1MB 文本文件逐个 grep 正则，结果 ≤200 条 |
| `fs.tree` | 目录树形文本（深度 ≤3，≤300 行） |

### mcp-shell — 终端（根 = env `MCP_SHELL_ROOTS`）

| 工具 | 用途 |
| --- | --- |
| `shell.exec` | 执行命令行（Windows `cmd /c`，其余 `/bin/sh -c`），cwd 限定根内；返回 exitCode/stdout/stderr/durationMs，输出 64KB 截断 |
| `shell.which` | 在 PATH 上定位可执行文件（缺失返回 `found:false` 而非报错） |

### mcp-os — 系统信息（只读，无监狱）

| 工具 | 用途 |
| --- | --- |
| `os.info` | 机器信息（platform/arch/cpus/内存/主机名），刻意不含用户名与 home 路径 |
| `os.disk` | 指定路径的文件系统用量（statfs：总/空闲字节） |
| `os.env` | 按名读取环境变量；`KEY/TOKEN/SECRET/PASSWORD` 类敏感键值一律脱敏为 `***` |

### mcp-web — 网络读取（只读，无监狱；不做搜索）

| 工具 | 用途 |
| --- | --- |
| `web.fetch` | 抓取 http/https URL（≤5 次重定向；HTML 剥标签抽正文），返回 status/contentType/text |
| `web.dns` | 域名解析为 IPv4/IPv6 地址（node:dns；无结果报 `E_DNS`） |

## 3. 文本数据（json / csv / text / diff / regex / markdown / code / math）

### mcp-json — JSON 处理（纯文本，无监狱）

| 工具 | 用途 |
| --- | --- |
| `json.validate` | 校验 JSON：成功返回统计（键数/深度/类型计数），失败报行/列位置 |
| `json.format` | 按指定缩进重排 JSON（0 = 压缩单行）；拒绝 >1MB 输入 |
| `json.query` | 按路径（`$.a.b[0].c`）取值 |
| `json.set` | 在路径上设值并返回新文档（缺失的中间容器自动创建） |
| `json.stats` | 文档统计：递归键数/最大深度/字节数/各类型计数 |

### mcp-csv — CSV 处理（纯文本，无监狱）

| 工具 | 用途 |
| --- | --- |
| `csv.parse` | 解析 CSV 文本为行数组（处理引号/转义/自定义分隔符） |
| `csv.stringify` | 行数组拼 CSV 文本（仅含分隔符/引号/换行的字段加引号） |
| `csv.filter` | 按列过滤行（equals/contains/gt/lt；双方为数字时数值比较） |
| `csv.tojson` | CSV 转对象数组（表头为键） |

### mcp-text — 文本处理（纯文本，无监狱）

| 工具 | 用途 |
| --- | --- |
| `text.stats` | 文本统计：字符（码点）/词（CJK 一字一词）/UTF-8 字节/行数/阅读时长（2.5 词每秒） |
| `text.case` | 大小写转换：camel/pascal/snake/kebab/title/upper/lower/sentence |
| `text.slug` | 生成 URL slug（小写、非字母数字折叠为分隔符，保留 unicode 字母） |
| `text.lines` | 行操作：sort/uniq/dedupe/reverse/trim/number/shuffle（种子化可复现） |
| `text.wrap` | 按宽度软换行（不拆词，CJK 任意处可断，超长词硬断） |
| `text.extract` | 正则抽取匹配（≤100 条），可取捕获组或命名组 |

### mcp-diff — 差异比较（文件模式根 = env `MCP_DIFF_ROOTS`）

| 工具 | 用途 |
| --- | --- |
| `diff.texts` | 两段文本 LCS diff（行/词模式）：unified diff + 增删改统计 + 结构化 patch |
| `diff.files` | 监狱根内两文件 diff（输出同 diff.texts，带文件标签） |
| `diff.similarity` | 两文本相似度 0-100（多行按行 LCS，单行按字符） |

### mcp-regex — 正则助手（纯文本，无监狱）

| 工具 | 用途 |
| --- | --- |
| `regex.build` | 校验正则源码并给启发式解释（锚点/命名组/类/量词），坏输入不抛错 |
| `regex.test` | 正则跑文本，返回 ≤50 个匹配（索引/捕获组/命名组，隐含全局） |
| `regex.escape` | 转义字面串，使其在正则中原样匹配 |
| `regex.cheatsheet` | 正则速查：锚点/类/量词/分组/环视/flag + 常用现成模式 |

### mcp-markdown — Markdown 结构（纯文本，无监狱）

| 工具 | 用途 |
| --- | --- |
| `md.outline` | 抽标题骨架（ATX `#`..`######`，带级别/文本/行号；跳过代码块内标题） |
| `md.toc` | 生成 markdown 目录（锚点链接列表） |
| `md.frontmatter` | 解析首部 YAML frontmatter |
| `md.tables` | 抽管道表格（表头 + `---` 分隔 + 数据行，带行号） |
| `md.links` | 收集行内链接与图片（带行号，跳过代码块） |

### mcp-code — 源码分析（输入为文本，无监狱）

| 工具 | 用途 |
| --- | --- |
| `code.stats` | 行分类统计：代码/注释/空行 + 注释率（按语言注释语法） |
| `code.symbols` | 提取函数/类/导入（TS/JS/Py/Go/Rust/Java/C 正则启发式，行号准确） |
| `code.todos` | 找 TODO/FIXME/HACK/XXX/NOTE 标记（带尾文与行号） |
| `code.languages` | 支持的语言表（扩展名/注释语法/探测提示） |

### mcp-math — 数学计算（纯计算，无监狱）

| 工具 | 用途 |
| --- | --- |
| `math.eval` | 算术表达式求值（无 eval：`+ - * / % ^`、min/max/round/sqrt/log 等、pi/e） |
| `math.stats` | 数列统计：count/sum/mean/median/min/max/样本方差/样本标准差 |
| `math.base` | 2-36 进制整数互转（BigInt 精确） |
| `math.round` | 定精度舍入（0-15 位；nearest/floor/ceil，处理浮点误差） |
| `math.percentage` | part/total 百分比（定小数位，如 25/200 → 12.5%） |

## 4. 媒体素材（media / assets / image / font）

### mcp-media — ffmpeg 工具箱（输出根 = env `MCP_MEDIA_ROOTS`；ffmpeg 缺失 → `E_BINARY`，不崩溃）

| 工具 | 用途 |
| --- | --- |
| `media.probe` | ffprobe 探测：时长/分辨率/fps/编解码/容器/各流摘要 |
| `media.convert` | ffmpeg 转码/剪切（`-ss`/`-t`）/缩放（`-vf`）等；旗标白名单 + 值黑名单校验，25s 超时杀进程 |
| `media.thumbnail` | 抽单帧 PNG（`-ss` 前置快速 seek） |
| `media.extractAudio` | 抽音轨：copy 保原编码 / wav 解码 16kHz 单声道 |
| `media.gif` | 视频段生成 GIF（fps + lanczos 缩放 + palettegen/paletteuse 单步链） |
| `media.concat` | 同编码参数文件拼接（临时 ffconcat 清单 + `-c copy`） |

### mcp-assets — 素材库（根 = env `MCP_ASSETS_ROOTS`）

| 工具 | 用途 |
| --- | --- |
| `assets.index` | 扫描图片/音频/视频/字体建索引（大小/时长/图片宽高），缓存于内存 + `<root>/.assets-index.json` |
| `assets.search` | 按名称子串（不区分大小写）+ 类型过滤搜索引，≤50 条 |
| `assets.info` | 单文件详情：类型/大小/图片宽高/音视频时长/字体族名（解析 sfnt name 表） |

### mcp-image — 位图处理（根 = env `MCP_IMAGE_ROOTS`；@napi-rs/canvas）

| 工具 | 用途 |
| --- | --- |
| `image.info` | 图片尺寸/类型/文件大小（不改文件） |
| `image.resize` | 缩放（只给宽或高时等比推导），重编码 png/jpeg/webp |
| `image.crop` | 矩形裁剪（边界 clamp，完全出界 `E_RANGE`） |
| `image.compose` | overlay 按 (x,y) 与透明度合成到 base（画布 = base 尺寸） |
| `image.palette` | 主色提取：64x64 采样 + 每通道 4bit 量化 → top-N 颜色与占比 |

### mcp-font — 字体服务（根 = env `MCP_FONT_ROOTS`；@napi-rs/canvas）

| 工具 | 用途 |
| --- | --- |
| `font.list` | 列全部已注册字体族（系统 + `font.register` 注册）与样式变体 |
| `font.check` | 检查字体族名是否已注册（canvas 文本可用） |
| `font.register` | 注册监狱根内 ttf/otf 为别名（幂等，重复报 `alreadyRegistered`） |
| `font.measure` | 文本测量：宽度/ink 上升下降/近似高度（给定族、字号、字重） |
| `font.best` | 在候选字体中二分找 ≤maxWidth 的最大字号（字幕/排版适配） |

## 5. 开发工具（sqlite / git / crypto）

### mcp-sqlite — SQLite（库文件根 = env `MCP_SQLITE_ROOTS`；bun:sqlite 内置，零原生依赖）

| 工具 | 用途 |
| --- | --- |
| `sqlite.exec` | 执行写语句（INSERT/UPDATE/DELETE/DDL，多语句字符串 OK），返回 changes + lastInsertRowid |
| `sqlite.query` | 只读 SELECT/PRAGMA/EXPLAIN/WITH（可带位置参数），行数截断 100 |
| `sqlite.tables` | 列库内表/视图（sqlite_master，跳过 `sqlite_*` 内部表） |
| `sqlite.schema` | 单表结构：CREATE 语句 + PRAGMA table_info 列明细 |
| `sqlite.close` | 关闭并逐出连接缓存（后续调用自动重开） |

### mcp-git — Git 仓库（根 = env `MCP_GIT_ROOTS`；全部只读，git 缺失 → `E_BINARY`）

| 工具 | 用途 |
| --- | --- |
| `git.version` | 报告已装 git 版本（兼作二进制可用性探测） |
| `git.status` | 工作区状态（porcelain -b）：分支/领先落后/逐文件变更码 |
| `git.log` | 列提交（hash/作者/日期/主题；limit/作者子串过滤/起始 ref） |
| `git.diff` | 工作区（默认）/暂存（`staged:true`）/对某 ref 的 unified diff + numstat 统计，输出 ≤64KB |
| `git.branches` | 列本地与远程分支（当前检出 + 远程标记） |
| `git.tags` | 按创建时间列 tag（新 → 旧，limit 截断） |
| `git.show` | 看提交 patch 或某 ref 下某文件内容（`<ref>:<path>`），≤64KB |

### mcp-crypto — 哈希与编码（纯 node:crypto，无监狱）

| 工具 | 用途 |
| --- | --- |
| `crypto.hash` | md5/sha1/sha256/sha384/sha512 哈希（内容指纹/去重键/校验和） |
| `crypto.hmac` | HMAC 摘要（sha1/sha256/sha512 + 密钥；API 签名调试） |
| `crypto.base64` | utf8 文本与标准 base64 严格互转（非法字符拒绝） |
| `crypto.uuid` | 生成 v4 UUID（crypto 随机；占位资产/场景/任务 ID） |
| `crypto.random` | 生成密码学随机串（alphanumeric/hex/base64/numeric 字符集） |
| `crypto.jwt` | 解码 JWT，或给定密钥时验 HS256 签名（常数时间比较）；报告过期 |

## 6. 生成转换（color / plot / subtitle / archive / time）

### mcp-color — 颜色计算（纯计算，无监狱）

| 工具 | 用途 |
| --- | --- |
| `color.parse` | 解析任意颜色（hex/`rgb()`/`hsl()`）→ hex + rgb + hsl；坏输入报错不抛异常 |
| `color.convert` | 颜色转 hex/rgb/hsl/css 字符串形式 |
| `color.contrast` | WCAG 两色对比度 + AA/AAA 判定（4.5/7/3 阈值）；字幕与文字上视频检查 |
| `color.luminance` | 相对亮度（WCAG 0-1）与感知亮度（luma 0-100） |
| `color.palette` | 从基色导调色板（HSL 旋转：互补/类似/三角/四方；或明度阶梯：单色/深浅） |
| `color.mix` | 线性 RGB 空间混色（ratio 0 = a、1 = b）→ hex |
| `color.harmonize` | 调色板体检：最小相邻对比度/平均饱和度 + 可行动建议 |

### mcp-plot — 图表 SVG（可选落盘根 = env `MCP_PLOT_ROOTS`）

| 工具 | 用途 |
| --- | --- |
| `plot.bar` | 柱状图 SVG（轴/网格/值标签/可选标题） |
| `plot.line` | 折线图 SVG（单序列 points 或多序列 series ≤4 自动配色，可选半透明面积） |
| `plot.pie` | 饼/环图 SVG（弧路径 + 百分比标签 + 右侧图例） |
| `plot.preview` | 一个工具预览任意图型（分发给 bar/line/pie 生成器；全 `<text>`，render-svg 可消费） |

### mcp-subtitle — SRT/WebVTT 字幕（纯文本，无监狱）

| 工具 | 用途 |
| --- | --- |
| `subtitle.parse` | 解析 SRT/WebVTT（自动识别格式）为毫秒时间轴 cue 列表 |
| `subtitle.stringify` | cue 列表渲染回规范 SRT/WebVTT 文本 |
| `subtitle.shift` | 全部 cue 时间平移 offsetMs（负值 clamp 0，保格式） |
| `subtitle.info` | 字幕质检：条数/时长/CPS 阅读速度/最长 cue + 告警（>20 cps、>84 字符） |
| `subtitle.scale` | 时间线缩放（1.2 = 慢 20%、0.5 = 双倍速，保格式） |
| `subtitle.merge` | 合并两份字幕：concat 顺接 / overlay 双语同轴叠放 |

### mcp-archive — tar.gz 打包（根 = env `MCP_ARCHIVE_ROOTS`；纯 TS 手写 ustar + gzip，零依赖）

| 工具 | 用途 |
| --- | --- |
| `archive.pack` | 目录打包 `.tar.gz`（路径相对被包目录） |
| `archive.list` | 列 `.tar`/`.tar.gz` 条目（gzip 魔数识别格式；前 500 条） |
| `archive.extract` | 解包到 destDir；两遍校验拒绝 tar-slip（`../`、绝对路径、符号链接与设备条目） |

### mcp-time — 时间与时区（纯 Intl 实现，跨平台，无监狱）

| 工具 | 用途 |
| --- | --- |
| `time.now` | 当前时间：请求时区的 ISO 字符串/epoch ms/偏移 |
| `time.convert` | 时间戳（ISO 8601 或 epoch ms）转时区：本地 ISO + 偏移 |
| `time.format` | 按 locale 与日期/时间样式格式化（Intl.DateTimeFormat 预设） |
| `time.duration` | 毫秒时长（或两时间戳之差）人性化 |
| `time.parse` | 解析并校验 ISO 8601（或 epoch ms）：UTC ISO + 历法分量 |
| `time.zones` | 列 IANA 时区（可按子串过滤），含系统默认时区 |

## 7. 基础设施（lite / host / bridge）

| 包 | 角色 | 关键 API |
| --- | --- | --- |
| `@videoos/mcp-lite` | 协议原语包（25 个服务器的共享地基，不依赖主线 `@videoos/mcp`） | `defineTool`（zod 入参 → JSON Schema，一步到位）、`ok/err/ToolError`、`runStdioServer`、`jailFromEnv`、`truncateBytes/truncateList`、`withTimeout`、`spawnLiteServer`（E2E 测试器） |
| `@videoos/mcp-host` | 客户端宿主：spawn 子进程、聚合工具、统一调用 | `loadHostConfig(path)`、`McpHost`（`start/stop/listTools/callTool/on("log")`） |
| `mcp-bridge` | 插件工具 → stdio MCP 桥（进程内加载 PluginHost，见 [plugins.md](./plugins.md)） | env `MCP_PLUGIN_ROOTS`（冒号/分号多根，缺省 `<repo>/plugins`） |

写一个新服务器只需 `defineTool` + `runStdioServer`（约 30 行起步），规范见 [agent-kit/CONVENTIONS.md](../../agent-kit/CONVENTIONS.md) §1。

## 8. 安全模型

**路径监狱（jail）** —— 凡落盘/读盘的服务器，根来自 env `MCP_<NAME>_ROOTS`（冒号或分号分隔多根；缺省 `process.cwd()`；相对路径相对 `roots[0]`）。所有用户路径先 `resolve`，必须仍落在某根内，否则 `E_JAIL`：

| 服务器 | env | 说明 |
| --- | --- | --- |
| mcp-fs | `MCP_FS_ROOTS` | 读写/移动/删除/搜索全走监狱 |
| mcp-shell | `MCP_SHELL_ROOTS` | `shell.exec` 的 cwd 限定根内 |
| mcp-media | `MCP_MEDIA_ROOTS` | ffmpeg 一切输出必须落在根内 |
| mcp-assets | `MCP_ASSETS_ROOTS` | 索引扫描范围 |
| mcp-image | `MCP_IMAGE_ROOTS` | 读图与写图 |
| mcp-font | `MCP_FONT_ROOTS` | 注册字体的来源目录 |
| mcp-sqlite | `MCP_SQLITE_ROOTS` | 库文件位置 |
| mcp-git | `MCP_GIT_ROOTS` | 仓库位置 |
| mcp-plot | `MCP_PLOT_ROOTS` | 可选 SVG 落盘目录 |
| mcp-archive | `MCP_ARCHIVE_ROOTS` | 打包来源与解包目标 |
| mcp-diff | `MCP_DIFF_ROOTS` | `diff.files` 的两文件 |

监狱三连测（`..` 穿越、绝对路径逃逸、符号链接逃逸）是每个带监狱服务器的 E2E 必测项。

**其余防线**：

- 截断：文本输出走 `truncateBytes`（默认 ≤64KB，多字节安全），列表各有上限（fs.search ≤200、sqlite.query 行 ≤100、text.extract ≤100、assets.search/regex.test ≤50、archive.list ≤500），响应恒带 `truncated:true`；
- 超时：慢操作 `withTimeout`（shell.exec 默认 20s、media.convert 25s、web.fetch 15s）；宿主层每次 call 默认 30s（`timeoutMs` 可配，超时返回 `timeout after Nms`，只杀本次等待不杀进程）；
- 外部二进制缺失：ffmpeg/ffprobe/git 未安装 → `err("E_BINARY: ...")` 结构化错误，服务器存活不崩溃；
- 注入防御：git 的 ref/作者参数拒 `-` 前缀（防选项注入）；sqlite.query 只放行 SELECT/PRAGMA/EXPLAIN/WITH（写语句引导走 exec）；media.convert 旗标白名单 + 值黑名单（绝对路径、`/dev/*`、协议 URL、subtitles/drawtext 等读文件滤镜）；archive.extract 两遍校验防 tar-slip；
- 脱敏：`os.env` 的敏感键值（KEY/TOKEN/SECRET/PASSWORD）一律 `***`；`os.info` 不含用户名路径。

## 9. 用 mcp-host 拉起：mcp.json 配置教程

全量配置已收录在 [`agent-kit/mcp.json`](../../agent-kit/mcp.json)（25 个服务器全部列出，默认只开 `fs`/`shell`/`time`/`bridge` 四个示范，`fs` 的 env 用 `MCP_FS_ROOTS: "."` 占位——启动时即当前工作目录）。字段如下：

| 字段（`servers.<name>` 内） | 类型 | 说明 |
| --- | --- | --- |
| `command` | string | 可执行文件（本仓库全部条目用 `"bun"`） |
| `args` | string[] | 如 `["run", "packages/mcp-fs/src/index.ts"]`（Windows 路径用正斜杠） |
| `env` | object? | 追加到 `process.env` 之上的变量（各监狱根写这里） |
| `enabled` | boolean? | 默认 `true`；`false` 时 `start()` 跳过并记一条 log |
| `timeoutMs` | int? | 单次 call 超时，默认 30000 |
| `allowedTools` | string[]? | 工具白名单（原始名或 `"<server>.<name>"` 全名）；缺省 = 全部 |
| 顶层 `restartBackoff` | int? | 崩溃重启退避基数 ms（默认 1000 → 1s/2s/4s 指数退避） |

节选（完整版看 agent-kit/mcp.json）：

```json
{
  "servers": {
    "fs":    { "command": "bun", "args": ["run", "packages/mcp-fs/src/index.ts"], "env": { "MCP_FS_ROOTS": "." }, "enabled": true },
    "shell": { "command": "bun", "args": ["run", "packages/mcp-shell/src/index.ts"], "enabled": true },
    "time":  { "command": "bun", "args": ["run", "packages/mcp-time/src/index.ts"], "enabled": true },
    "bridge":{ "command": "bun", "args": ["run", "packages/mcp-bridge/src/index.ts"], "enabled": true },
    "media": { "command": "bun", "args": ["run", "packages/mcp-media/src/index.ts"], "enabled": false }
  }
}
```

宿主行为（`@videoos/mcp-host`）：

- `loadHostConfig(path)`：读文件 → JSON 语法 → zod 严格校验；未知字段报错且带 `servers > <name> > <field>` 路径；
- `start()` 依次 spawn + initialize（10s 握手超时）+ tools/list；`enabled:false` 跳过；
- 工具名冲突时以 `"<server>.<name>"` 全名暴露，全名恒可寻址，原名宽容路由到第一个提供者；
- 进程意外退出 → 自动重启（指数退避 1s/2s/4s；3 次/60s 滚动窗口超限标记 unhealthy 并从 listTools 排除）；
- `callTool(name, args)` → `{ ok, data? }` / `{ ok: false, error }`；`on("log", cb)` 每次调用记 `{ server, tool, ok, ms, error? }`。

编程接入（一条命令体验全家桶）：

```bash
cd <仓库根目录>
bun -e 'import { loadHostConfig, McpHost } from "./packages/mcp-host/src/index";
const host = new McpHost(await loadHostConfig("agent-kit/mcp.json"));
await host.start();
console.log(host.listTools().map((t) => `${t.server}.${t.name}`).join("\n"));
const r = await host.callTool("time.now", { timeZone: "Asia/Shanghai" });
console.log(r.ok ? r.data.iso : r.error);
await host.stop();'
```

## 10. Claude Desktop / Cursor 接入

每个服务器都是独立 stdio 进程，`command` + `args` 直接指向入口文件即可（无需构建；bun 在 PATH 上即可，Windows 路径一律正斜杠）。

Claude Desktop（`claude_desktop_config.json`）：

```json
{
  "mcpServers": {
    "videoos-fs": {
      "command": "bun",
      "args": ["run", "D:/videoos/packages/mcp-fs/src/index.ts"],
      "env": { "MCP_FS_ROOTS": "D:/videos" }
    },
    "videoos-time": {
      "command": "bun",
      "args": ["run", "D:/videoos/packages/mcp-time/src/index.ts"]
    },
    "videoos-plugins": {
      "command": "bun",
      "args": ["run", "D:/videoos/packages/mcp-bridge/src/index.ts"],
      "env": { "MCP_PLUGIN_ROOTS": "D:/videoos/plugins" }
    }
  }
}
```

Cursor（`~/.cursor/mcp.json`，或项目级 `.cursor/mcp.json`）同款 `mcpServers` 结构：

```json
{
  "mcpServers": {
    "videoos-shell": {
      "command": "bun",
      "args": ["run", "/home/you/videoos/packages/mcp-shell/src/index.ts"],
      "env": { "MCP_SHELL_ROOTS": "/home/you/videoos" }
    }
  }
}
```

要点：带监狱的服务器务必显式给 `MCP_<NAME>_ROOTS`（缺省是服务器的 `process.cwd()`，通常不是你想要的范围）；`mcp-bridge` 用于把插件工具暴露给 MCP 客户端（见 [plugins.md §6](./plugins.md)）。主线 VAP 的 31 个视频编辑工具（compile/render/test）走另一个服务器 `videoos mcp`，见 [docs/mcp-guide.md](../mcp-guide.md)——两者互补，不冲突。
