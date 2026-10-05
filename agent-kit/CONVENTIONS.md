# Agent Kit 贡献约定（CONVENTIONS）

> 本文是 Agent Kit 领地内**所有代码的工程契约**。子代理/贡献者在写任何 `packages/mcp-*`、`skills/*`、
> `plugins/*` 代码前必须读完本文。与 `agent-kit/SPEC.md`（项目规格）互补：SPEC 定**做什么**，本文定**怎么写**。

## 0. 领地与红线（先读 SPEC §0.2）

- **允许**：`packages/mcp-*`、`packages/plugin-kit`、`skills/**`、`plugins/**`、`docs/agent-kit/**`、`agent-kit/**`、`.github/workflows/agent-kit-ci.yml`
- **禁止**：`apps/**`、`packages/{agent,mcp,core,vir,dsl,compiler,render-canvas,render-svg,cache,encode,qa,workspace,server}/**`、既有 CI/Release 工作流、根 `package.json`/`tsconfig.json`/`SPEC.md`/`README.md`
- **红线**：任何提交不得让主 CI（`ci.yml`：根 typecheck + `bun test packages apps`）变红。新包源码位于 `packages/*/src`，会被根 tsconfig 自动纳入 typecheck；新包测试会被 `bun test packages` 自动收集 —— 写完必须本地全绿再交。

## 1. MCP 服务器包（`packages/mcp-<name>/`）统一布局

```
packages/mcp-<name>/
├── package.json          # 见下方模板；deps: @videoos/mcp-lite=workspace:* + zod + （按需 @napi-rs/canvas）
├── src/
│   ├── index.ts          # 入口：定义 tools → await runStdioServer(tools, { serverName: "mcp-<name>" })
│   └── index.test.ts     # 协议级 E2E（spawn 真子进程）
└── (可选) test-server.ts # 仅当需要与 src/index.ts 不同的测试夹具
```

`package.json` 模板（zod 版本必须 `^3.25.0`，与锁文件一致，禁止新依赖）：

```json
{
  "name": "@videoos/mcp-<name>",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "bun test" },
  "dependencies": { "@videoos/mcp-lite": "workspace:*", "zod": "^3.25.0" }
}
```

### 1.1 工具定义规范（强制）

全部工具用 `defineTool`（zod 校验 + JSON Schema + 错误标准化一步到位）：

```ts
import { defineTool, runStdioServer, ok, jailFromEnv, truncateBytes } from "@videoos/mcp-lite";
import { z } from "zod";

const jail = await jailFromEnv("MCP_<NAME>_ROOTS");   // 落盘工具必须有监狱；env 名 = MCP_<大写名>_ROOTS

const tools = [
  defineTool(
    "<domain>.<verb>",                                   // 命名：小写域前缀.动词，如 fs.read / csv.parse
    "<一句英文 description：做什么 + 何时用>",
    z.object({                                           // 入参恒为 z.object(...)
      path: z.string().describe("relative to jail root or absolute inside roots"),
      maxBytes: z.number().int().min(1).max(1_048_576).default(65_536).describe("output cap"),
    }),
    ({ path, maxBytes }) => {                            // runner：同步或 async
      const abs = await jail.resolve(path);              // 越狱自动抛 ToolError("E_JAIL")
      const { text, truncated } = truncateBytes(content, maxBytes);
      return ok({ text, truncated });                    // ok(data) / err("E_CODE: msg")
    },
  ),
];

await runStdioServer(tools, { serverName: "mcp-<name>", serverVersion: "0.1.0" });
```

规则清单：

1. **命名**：`domain.verb`（`fs.write`、`media.probe`、`csv.parse`）；域 = 包名去掉 `mcp-` 前缀。
2. **zod 一切入参**；`.describe()` 每个字段（LLM 读 schema 自助）。
3. **错误**：`err("E_<CODE>: <人类可读>")` —— E_ 前缀大写蛇形；runner 内抛 `new ToolError("E_CODE", msg)` 同效。
4. **路径监狱**：任何读写文件系统的工具先 `await jail.resolve(userPath)`；根来自 `MCP_<NAME>_ROOTS`（冒号/分号分隔多根；缺省 `process.cwd()`）。相对路径相对 `roots[0]`。
5. **截断**：文本输出走 `truncateBytes`（默认 ≤ 64KB），列表走 `truncateList`（≤ 200 条）或自定上限，响应带 `truncated: true`。
6. **超时**：可能慢的操作（进程/网络/大文件）用 `withTimeout(promise, 20_000)`；超时返回 `TIMEOUT: ...` 而非挂死。
7. **不崩溃**：外部依赖缺失（ffmpeg/git 未安装）→ `err("E_BINARY: ffmpeg not found")`，绝不炸服务器。
8. **无状态优先**：工具间不共享可变全局；确需缓存（assets 索引等）用模块级 Map 并在文档注明。
9. **资源限制**：递归深度 ≤ 5；文件读取 ≤ 1MB（base64 场景 ≤ 8MB）；输出总量有上限。
10. **入口必须是顶层 await 的 `runStdioServer`**（src/index.ts 顶部可先做异步初始化，如 `await jailFromEnv(...)`）。

### 1.2 测试规范（协议级 E2E，强制）

唯一姿势：`spawnLiteServer` spawn 真子进程，走完整 JSON-RPC 握手：

```ts
import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnLiteServer } from "@videoos/mcp-lite/testing";

const SERVER = join(import.meta.dir, "index.ts");   // spawn 的是 src/index.ts 本身

describe("mcp-<name> (E2E)", () => {
  it("tool happy path", async () => {
    const root = mkdtempSync(join(tmpdir(), "mcp-name-"));
    writeFileSync(join(root, "a.txt"), "hello");
    const server = await spawnLiteServer(SERVER, { env: { MCP_<NAME>_ROOTS: root } });
    try {
      expect(server.tools.map((t) => t.name)).toContain("<domain>.<verb>");
      const result = await server.call("<domain>.<verb>", { path: "a.txt" });
      expect(result.ok).toBe(true);
      expect((result.data as { text: string }).text).toContain("hello");
    } finally {
      await server.close();                           // 必须 finally close
    }
  }, 20_000);                                         // 每个 E2E it 显式 20s 超时
});
```

- 测试**必须离线**：不起真实外网请求；需要 HTTP 的用 `node:http` 起本地 mock。
- 每个 it 都要 `try/finally close()`；每个 E2E it 显式传 `20_000` 超时。
- 涉及路径的断言用 `node:path` 的 `join`（跨平台）；Windows 上会跑的包（fs/shell/os/time/…）避免 POSIX-only 断言。
- 失败路径必须测：越狱 `E_JAIL`、非法入参（-32602 经 call() 返回 `{ok:false, error:"JSON-RPC -32602: …"}`）、外部二进制缺失（可跳过：`const hasFfmpeg = …; hasFfmpeg ? it(...) : it.skip(...)`，但 CI ubuntu 必须真跑 ffmpeg 用例）。

### 1.3 zod 3.25.76 陷阱（必读）

本仓库锁定的 zod@3.25.76 是「v3 兼容层」包：`import { z } from "zod"` 的运行时 API 与经典 v3 相同，但**包装器内部字段名不同**：

- `ZodOptional/ZodDefault/ZodNullable` 的内层 schema 在 `_def.innerType`（**不是** `_def.type`）
- 自定义 zod 内省代码请参考 `@videoos/mcp-lite` 的 `zodToJsonSchema`（packages/mcp-lite/src/tool.ts）
- 泛型约束写 `T extends z.ZodTypeAny`（不要写 `z.ZodObject<any, any, any>`）

## 2. SKILL.md 契约（摘要，全文见 SPEC §4）

- frontmatter：`name`（=目录名，kebab）、`version`（x.y.z）、`description`（英文 ≤ 160 字符，说"做什么"）、`trigger`（英文，说"何时用"，与 description 不同）
- 章节必需：`# Title`、`Goal:`、`## Workflow`、`## Recipes`；推荐追加 `## QA gates`、`## Anti-patterns`
- `## Workflow` 必须出现字样 `compile.run` 与 `test.run`；禁止发明不存在的 VAP 工具名
- Recipes 代码块 ≥ 2 个（```ts）；**DSL 白名单方法**（唯一允许的 `v.`/`s.` 调用）：
  `v.scene` `v.transition` `s.beat` `s.text` `s.rect` `s.ellipse` `s.image` `s.camera` `s.audio`
  （`defineVideo` 是普通导入函数，不算 `v./s.` 前缀）
- 真实 VAP 工具名可引用（Workflow/正文，非代码块）：storyboard.plan / storyboard.toScenes / compile.run / compile.diagnostics / compile.vir / render.preview / render.final / render.range / render.status / render.cancel / test.run / test.results / scene.list / scene.inspect / scene.modify / layer.inspect / layer.modify / inspect.frame / diff.frames / asset.add / asset.list / audio.list / audio.set / cache.stats / cache.clear / check.overflow / check.missingAssets / transaction.begin / transaction.commit / transaction.rollback / transaction.list / project.*（compile 包内）
- 禁止 emoji、禁止 `sk-`/`ghp_`/`github_pat_` 等密钥样文
- 交稿前自校：`bun run agent-kit/scripts/check-skills.ts` 必须 PASS

## 3. 验证命令（每个包/技能交稿前必须全绿）

```bash
bunx tsc -p tsconfig.json --noEmit        # 根 typecheck（新包自动纳入）
bun test packages/<name>                  # 本包测试
bun run agent-kit/scripts/check-skills.ts # 改了 skills/ 时
bun test packages apps                    # 全仓回归（交 PR 前）
```

## 4. 提交约定

- Conventional Commits + 里程碑前缀：`AK-M3: mcp-fs + mcp-shell (…)`
- 一次提交一件事；push 前 `git pull --rebase`
- 新文件头注释：1–3 行中文说明"是什么 + 关键设计点"（与仓库现有风格一致）
