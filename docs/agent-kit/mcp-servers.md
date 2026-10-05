# 本地 MCP 服务器指南 — 六服务器工具参考 + mcp.json + 安全模型

> Agent Kit 支柱二的操作手册：`@videoos/mcp-host`（客户端宿主）如何拉起六个 `mcp-*` stdio 服务器、
> `mcp.json` 怎么写、23 个工具的精确形状，以及监狱/白名单/超时三层安全模型。
> 契约源：`agent-kit/SPEC.md` §3；实现源：`packages/mcp-lite` / `packages/mcp-host` / `packages/mcp-{fs,shell,os,web,media,assets}`。

## 1. 架构总览

```
宿主应用（CLI / 桌面 / 未来的主线 apps/*）
   │  new McpHost(loadHostConfig("mcp.json"))
   ▼
McpHost（packages/mcp-host）──────── Bun.spawn 子进程 ────────┐
   │  stdin  ← JSON-RPC 逐行                                     │
   │  stdout → JSON-RPC 逐行                                     ▼
   │                            ┌──────────────────────────────────────────┐
   │  listTools() 聚合           │ mcp-fs   mcp-shell  mcp-os              │
   │  callTool(name, args) 路由  │ mcp-web  mcp-media  mcp-assets          │
   │                            │ （每台 = packages/mcp-*/src/index.ts，    │
   │                            │   内部用 @videoos/mcp-lite 组装）        │
   │                            └──────────────────────────────────────────┘
   └─ on("log") 事件流：{ server, tool, ok, ms, error? }
```

线协议是 `@videoos/mcp-lite` 的 JSON-RPC 2.0 **逐行** stdio（`\n` 分隔，无 Content-Length 头），与 `@videoos/mcp` 逐字节兼容：

| 方法 | 行为 |
| --- | --- |
| `initialize` | 返回 `{ protocolVersion: "2025-03-26", capabilities, serverInfo }`；**未初始化先调他法 → `-32002`** |
| `notifications/initialized` | 通知（无 id），静默无响应 |
| `tools/list` | `{ tools: [{ name, description, parameters, inputSchema }] }` —— `parameters` 是本项目契约键，`inputSchema` 是 MCP 标准键，**双键同值输出**兼容两边客户端 |
| `tools/call` | `{ name, arguments }` → result `{ ok, data?, error? }` |

错误码（`JsonRpcErrorCodes`）：`-32700` 解析失败 / `-32600` 非法请求形状 / `-32601` 未知方法（通知静默）/ `-32602` 参数校验失败（**含未知工具**，message 带字段路径）/ `-32603` 服务器内部错误兜底 / `-32002` 未初始化门禁。工具入参用 zod 校验：失败抛 `LiteParamError` → server 映射 `-32602`，message 为 `<字段路径>: <原因>` 的分号串联（如 `maxBytes: ...`）；工具**业务**失败不报错，走 result 级 `{ ok: false, error }`。

## 2. mcp.json 配置参考

`loadHostConfig(path)`（`packages/mcp-host/src/config.ts`）读 JSON → zod **strictObject** 校验（未知字段报清晰错误，逐条列出字段路径）：

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `command` | `string`（非空） | 必填 | 可执行文件；推荐 `process.execPath`（绝对 bun 路径）或 `"bun"` |
| `args` | `string[]` | 必填 | 参数数组；Agent Kit 服务器即 `["run", "packages/mcp-<name>/src/index.ts"]` 或直接脚本路径 |
| `env` | `Record<string, string>` | — | 追加到子进程 env（`{ ...process.env, ...cfg.env }`），放监狱根等配置 |
| `enabled` | `boolean` | `true` | `false` 则 start() 跳过、listTools() 排除 |
| `timeoutMs` | `int` 100..600_000 | `30_000` | 单次 `tools/call` 超时 |
| `allowedTools` | `string[]` | 全部 | 工具白名单；匹配三种写法：暴露名 / 裸名 / `<server>.<name>` 全名 |

完整示例（六台全开；`BUN` 意为 `process.execPath` 的值，写死 `"bun"` 亦可）：

```jsonc
{
  "servers": {
    "fs":     { "command": "bun", "args": ["packages/mcp-fs/src/index.ts"],
                "env": { "MCP_FS_ROOTS": "/home/me/videos" }, "timeoutMs": 20000 },
    "shell":  { "command": "bun", "args": ["packages/mcp-shell/src/index.ts"],
                "env": { "MCP_SHELL_ROOTS": "/home/me/videos" },
                "allowedTools": ["shell.which", "shell.exec"] },
    "os":     { "command": "bun", "args": ["packages/mcp-os/src/index.ts"] },
    "web":    { "command": "bun", "args": ["packages/mcp-web/src/index.ts"] },
    "media":  { "command": "bun", "args": ["packages/mcp-media/src/index.ts"],
                "env": { "MCP_MEDIA_ROOTS": "/home/me/videos" } },
    "assets": { "command": "bun", "args": ["packages/mcp-assets/src/index.ts"],
                "env": { "MCP_ASSETS_ROOTS": "/home/me/assets" }, "enabled": true }
  }
}
```

多根写法：POSIX 用 `:` 或 `;` 分隔（`MCP_FS_ROOTS: "/a:/b"`），Windows 只用 `;`（盘符含冒号）。缺省回落 `process.cwd()`。`mcp-os` 与 `mcp-web` 无监狱 env。

## 3. McpHost 行为契约

- **start()**：依次（非并行）拉起 enabled 服务器：spawn → `initialize` → `notifications/initialized` 通知 → `tools/list`。spawn 失败 / 初始化失败 → 标记 unhealthy 并发 log 事件，**不抛出**（其他服务器照常）。
- **stop()**：每台 SIGTERM → 等 3s 宽限 → SIGKILL；清理计时器、拒绝全部挂起请求；stop 后 `listTools()` 返回 `[]`、callTool 报 `server ... is not running`。无孤儿进程。
- **工具名冲突**：两台及以上存活服务器暴露同名工具时，全部以 `<server>.<tool>` 全名暴露（如双 fs → `alpha.fs.list` / `beta.fs.list`）；`callTool` 接受全名与裸名（裸名仅当无歧义）；裸名歧义 → `{ ok: false, error: "ambiguous tool name ... use the qualified form: alpha.fs.list / beta.fs.list" }`。
- **白名单**：`allowedFor` 判定 exposed / raw / `<server>.<raw>` 任一命中即放行；无白名单 = 全部放行。未命中 → `tool "..." is not in the allowedTools whitelist of server "..."`。
- **call 超时**：`rpc()` 默认 `cfg.timeoutMs ?? 30_000`；到点**只作废本次请求**（pending 拒绝 `timeout after Nms`），**不杀进程** —— 服务器继续服务后续请求。
- **崩溃自愈**：进程意外退出 → 指数退避重启（base 300ms × 2^(n-1)，封顶 5s）；**滚动 60s 窗口内最多 3 次**，超过 → 标记 unhealthy、`listTools()` 排除该服务器，log 事件 `restart budget exhausted (3/min)`。
- **log 事件**：`host.on("log", e => ...)`，`e = { server, tool, ok, ms, error? }`；生命周期用特殊 tool 标记：`(spawn)` / `(init)` / `(crash)` / `(unhealthy)`。
- **stdout 路由**：宿主逐行读子进程 stdout，按响应 id 匹配挂起请求；迟到响应（已超时）丢弃；非 JSON 行（调试输出）忽略。stderr 保留尾 8 行（`stderrTail`）辅助排障。

## 4. 工具参考（六台 × 23 个工具，名称与形状以源码为准）

### 4.1 mcp-fs — 文件系统（监狱根 = `MCP_FS_ROOTS`）

| 工具 | 参数 | 返回 / 默认 / 限制 |
| --- | --- | --- |
| `fs.list` | `path`；`depth?` 1..5（默认 1） | `{ entries: [{ name(相对路径), type: file\|dir, size(目录恒 0), mtime }], root }`；符号链接不跟随（杜绝越狱与循环）；按 name 排序 |
| `fs.read` | `path`；`maxBytes?` 1..16_777_216（默认 65_536）；`encoding?` `utf8`\|`base64`（默认 utf8） | `{ content, truncated, size }`（size 为完整字节长度；超限截断） |
| `fs.write` | `path`；`content`（utf8 文本或 base64）；`createDirs?`（默认 true）；`encoding?` | `{ bytes, sha256 }`（sha256 前 12 位十六进制） |
| `fs.move` | `from`；`to` | `{ moved: true }`；多根监狱跨根拒绝（`cross-root move not allowed`）；EXDEV 自动回退复制+删除 |
| `fs.remove` | `path`；`recursive?`（默认 false） | `{ removed }`（递归计数含目录自身）；非空目录必须 `recursive: true`（否则 `directory not empty (recursive: true required)`） |
| `fs.search` | `root`；`glob`；`contentRegex?`；`maxResults?` 1..10_000（默认 200） | `{ matches: [{ path(相对 root，/ 分隔), size, mtime }], truncated }`；递归深度 ≤ 8，跳过 node_modules/.git；contentRegex 只对 ≤ 1MB 文件做内容正则过滤 |
| `fs.tree` | `path` | `{ tree }`（2 空格缩进文本；目录后缀 `/`、文件带 `(N B)`；目录在前文件在后按字母序；深度 ≤ 3） |

### 4.2 mcp-shell — 受限终端（监狱根 = `MCP_SHELL_ROOTS`）

| 工具 | 参数 | 返回 / 默认 / 限制 |
| --- | --- | --- |
| `shell.exec` | `command`；`cwd?`（默认第一个监狱根）；`timeoutMs?` 100..120_000（默认 20_000）；`maxOutput?` 1..1_048_576（默认 65_536） | `{ exitCode, stdout, stderr, truncated, durationMs, timedOut? }`；超时 → `exitCode: 124` + `timedOut: true` + stderr 追加 `\n[killed: timeout after Nms]`；输出分别封顶 maxOutput（截断后继续排空管道防阻塞） |
| `shell.which` | `command` | `{ found, path }`（Bun.which 于服务器 PATH） |

解释器按平台**固定**（不接受调用方指定）：Windows `cmd /c`，POSIX `/bin/sh -c`。POSIX 下用独立进程组 + 整组 SIGKILL（单杀 sh 会留孤儿占住 stdout 管道）。

### 4.3 mcp-os — 系统信息（无监狱）

| 工具 | 参数 | 返回 / 限制 |
| --- | --- | --- |
| `os.info` | 无 | `{ platform, release, arch, hostname, cpuCount, cpuModel, memTotalBytes, memFreeBytes }` —— **白名单字段，刻意排除用户名/家目录等隐私** |
| `os.disk` | `path?`（默认进程 cwd） | `{ path, totalBytes, freeBytes, availableBytes }`（statfs）；平台不支持 → `{ ok: false }` 不崩溃 |
| `os.env` | `keys` 1..50 | 键值对象；只返回请求**且已设置**的键；键名匹配 `/KEY\|TOKEN\|SECRET\|PASSWORD/i` → 值掩码 `***` |

### 4.4 mcp-web — 网络读取（无监狱；只读，不做搜索）

| 工具 | 参数 | 返回 / 默认 / 限制 |
| --- | --- | --- |
| `web.fetch` | `url`；`maxBytes?` 1024..8_388_608（默认 262_144）；`timeoutMs?` 1000..60_000（默认 15_000） | `{ url(最终地址), status, contentType, text, truncated }`；**仅 http(s)**（否则 `only http(s) URLs are allowed`，重定向每一跳复查协议）；跟随 301/302/303/307/308 ≤ 5 跳（第 6 跳 → `too many redirects (limit 5)`）；`text/html` 剥标签抽正文（去 script/style、只留 body、块级标签 → 换行、实体解码 `&amp;` 最后、折叠空白） |
| `web.dns` | `hostname` | `{ addresses }`（A + AAAA 合并去重，node:dns/promises） |

### 4.5 mcp-media — ffmpeg 工具箱（监狱根 = `MCP_MEDIA_ROOTS`；CI ubuntu 已装 ffmpeg）

ffmpeg/ffprobe 经 PATH 探测（Bun.which）；**缺失 → `{ ok: false, error: "ffmpeg not found" }`，服务器不崩溃**（probe 在 ffmpeg 在位而 ffprobe 缺失的罕见场景报 `"ffprobe not found"`）。ffmpeg 运行统一 30s 超时看护 + kill(9)，失败错误取 stderr 尾部 400 字符。全部输入/输出路径过监狱；输入文件不存在先报 `file not found: <path>`。

| 工具 | 参数 | 返回 / 默认 |
| --- | --- | --- |
| `media.probe` | `path` | `{ container, durationSeconds, bitrate, sizeBytes, streams: [{ type: video\|audio\|other, codec, width?, height?, fps?, sampleRate?, channels? }] }` |
| `media.convert` | `input`；`output`；`args?` `string[]`（默认 []） | `{ output, durationMs }`；**附加参数白名单校验**（§5.4） |
| `media.thumbnail` | `input`；`at?` ≥ 0（默认 1.0，秒）；`output` | 单帧 PNG（`-ss <at> -frames:v 1`）；`{ output, durationMs }` |
| `media.extractAudio` | `input`；`output`；`mode?` `copy`\|`wav`（默认 copy） | copy = `-vn -acodec copy` 流直拷；wav = `-ac 1 -ar 16000`（16kHz 单声道重编码） |
| `media.gif` | `input`；`output`；`start?`；`dur?`；`fps?` 1..30（默认 12）；`width?` 64..1920（默认 480） | `-vf fps=<fps>,scale=<width>:-1:flags=lanczos -loop 0` |
| `media.concat` | `inputs` 2..16；`output` | concat demuxer + `-c copy`；**统一编码参数校验**：主视频 codec+尺寸一致，或全部纯音频且 codec 一致（否则 `concat mismatch (unified encoding parameter validation): ...`）；列表文件写在监狱内紧挨输出，`'` 转义为 `\'`，finally 清理 |

### 4.6 mcp-assets — 素材库（监狱根 = `MCP_ASSETS_ROOTS`）

索引扩展名：图片 png/jpg/jpeg/webp/gif/bmp · 音频 mp3/wav/ogg/m4a/flac/aac · 视频 mp4/mov/webm/mkv/avi · 字体 ttf/otf/woff/woff2。

| 工具 | 参数 | 返回 / 默认 |
| --- | --- | --- |
| `assets.index` | `root`；`refresh?`（默认 false）；`maxEntries?` 1..100_000（默认 2000） | `{ root, entries: [{ name, path(相对 root，/ 分隔), type, sizeBytes, mtimeMs, width?, height?, durationSeconds? }], scannedAt, count }`；扫描深度 ≤ 6，跳过 `.` 开头项与 node_modules；图片尺寸用 `@napi-rs/canvas` loadImage，音视频时长用 ffprobe；**内存缓存 + `<root>/.assets-index.json` 镜像**（镜像以 `.` 开头不会被再索引） |
| `assets.search` | `query`；`type?` `image`\|`audio`\|`video`\|`font` | `{ results(≤ 50 条), total }`；跨**全部已索引根**的名称/相对路径子串匹配（大小写不敏感）；未先 index → `no index yet — call assets.index first` |
| `assets.info` | `path` | `{ name, type, sizeBytes, mtimeMs, ... }`：图片 → `width`/`height`；音视频 → `durationSeconds`/`codec`；字体 → `family`/`fullName`/`subfamily`/`format`（sfnt name 表解析；woff/woff2 或解析失败 → 只报 `format`） |

## 5. 安全模型（监狱 / 白名单 / 超时）

### 5.1 路径监狱（`mcp-fs/src/jail.ts` 为参考实现，fs/shell/media/assets 四台共用逐字拷贝）

- **多根来自 env**：`parseRoots(MCP_*_ROOTS, cwd)` —— Windows 只按 `;`，POSIX 按 `:` 或 `;`；空值回落 cwd。
- **解析流程**：绝对路径原样、相对路径按根逐个尝试 → `resolve` → `realpathBestEffort`（路径不存在时回溯最近存在的祖先再拼回尾部，保留 `..` 的规范化效果）→ 判定必须 `=== root` 或以 `root + sep` 开头。
- **三类逃逸全部拒绝**（`JailError` → `{ ok: false, error: "path escapes jail: <path>" }`）：`..` 穿越（如 `sub/../../outside`）、绝对路径越狱（监狱外绝对路径）、符号链接逃逸（监狱内 symlink 指向监狱外）。**测试三连是硬门槛**（§6）。
- 监狱根自身在创建时也过 realpath（根是 symlink 时比较的是真实路径）。

### 5.2 白名单

- `McpHost.allowedTools`（§3）：per-server 工具白名单，暴露名/裸名/全名三种写法。
- `os.env` 的 keys 是请求级白名单（只返回请求的键）+ 敏感掩码。
- `shell.exec` 解释器固定、cwd 必须在监狱内。

### 5.3 超时与输出封顶（默认值一览）

| 层 | 默认 | 上限/规则 |
| --- | --- | --- |
| host 单次 call | 30_000ms | 可配 100..600_000；超时杀请求不杀进程 |
| `shell.exec` | 20_000ms | 100..120_000；整进程组 SIGKILL，exitCode 124 |
| `web.fetch` | 15_000ms | 1000..60_000 |
| ffmpeg 运行（media 全工具） | 30_000ms | 超时 kill(9)，error `"timeout"` |
| `fs.read` / `shell` 输出 | 65_536 B / 字符 | 超限 `truncated: true` |
| `web.fetch` 正文 | 262_144 B | 恰好读满时多读一次精确判定 truncated |
| `fs.search` / `assets.search` | 200 / 50 条 | 超限截断（search 带 `truncated` / `total`） |

### 5.4 ffmpeg 参数白名单（`checkArgSafety`）

`media.convert` 的每个附加参数：含 `..`、含 `://`、`/dev/` 前缀、或形如绝对路径（`/`、`\\`、`X:\` 开头）且不在监狱内 → 一律 `"unsafe ffmpeg arg"`。输出路径独立过监狱（必须落在根内）。

### 5.5 其他红线

- **web.fetch**：仅 http(s)（初始 + 每一跳重定向复查）、重定向 ≤ 5、字节封顶；**不做搜索**（不引入任何搜索 API key）。
- **本地服务器零密钥**：六台服务器没有任何网络凭据、不需要 key —— 这是它们能作为「本地能力」默认启用的前提。模型供应商的 key 只存在于 model-hub 一侧。
- `os.info` 字段白名单（Object.keys 级别锁定），不含用户名/家目录。

## 6. 测试约定

- **协议级 E2E**：`Bun.spawn` 拉起真服务器进程（`bun <pkg>/src/index.ts`），测试侧自带 JSON-RPC stdio 客户端（`initialize` → `notifications/initialized` → 逐请求等行），断言真实 wire 形状 —— 参照 `packages/mcp-fs/src/fs.test.ts` 的 `spawnMcp` 辅助。mcp-lite 另有单元级测试（readMessages 分块/粘包、错误码、门禁）。
- **夹具**：`mkdtempSync` 建监狱根 + 兄弟目录放「监狱外素材」（outside secret），越狱断言用它；符号链接用 `fs.symlinkSync`，Windows 无特权时回退 `"junction"`，连 junction 也建不了则跳过该子用例。
- **测试侧 spawn 用 `process.execPath`**（绝对 bun 路径）而非裸 `"bun"`：Bun.spawn 按子进程 env 的 PATH 解析裸命令名，改写 PATH 的用例（如 ffmpeg-missing）会 ENOENT。
- **ffmpeg 素材自产**：`ffmpeg -f lavfi -i testsrc=duration=1:size=320x240:rate=10`（视频）/ `-i sine`（音频），不依赖任何二进制素材文件；ffmpeg 缺失环境（PATH 置空目录）断言 `{ ok: false, error: "ffmpeg not found" }` 且服务器存活。
- **Windows CI**：跨平台用例跑 `cmd /c echo hello`（输出同样含 hello）；POSIX-only 用例（进程组击杀、maxOutput 截断时序）用 `it.skipIf(process.platform === "win32")` 跳过；路径断言用 `node:path` + `path.sep`。
- **host 测试**：双服务器拉起 / 工具聚合 / 超时 / 崩溃重启 / 白名单（`packages/mcp-host/src/host.test.ts`，六模式夹具服务器 `test/fixtures/fixture-server.ts`）；集成 E2E `test/integration.test.ts`：六台同拉起 → 23 工具聚合无冲突 → 每台真实调用 → stop 无孤儿；双 fs 冲突 → 全名路由。
