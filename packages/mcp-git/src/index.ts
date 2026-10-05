// @videoos/mcp-git —— Git 只读工具服务器（stdio MCP）：spawn git CLI（本机已装），全部为读操作。
// 关键设计点：cwd 必须监狱内（jailFromEnv("MCP_GIT_ROOTS")）；ref/作者等用户参数禁止以 "-" 开头
//（防选项注入，spawn 无 shell 但仍需防 --exec 类旗标）；二进制缺失 → E_BINARY；输出 ≤64KB 截断。
import { defineTool, runStdioServer, ok, err, jailFromEnv, truncateBytes, ToolError, TimeoutError } from "@videoos/mcp-lite";
import { z } from "zod";
import { spawn, spawnSync } from "node:child_process";
import { stat } from "node:fs/promises";

const jail = await jailFromEnv("MCP_GIT_ROOTS");

const GIT_TIMEOUT_MS = 15_000;
const OUTPUT_CAP_BYTES = 64 * 1024;
const STDERR_CAP = 64 * 1024;

// ---------------------------------------------------------------------------
// 子进程助手
// ---------------------------------------------------------------------------

/** git 可用性（一次性探测缓存） */
let gitAvailable: boolean | undefined;
function hasGit(): boolean {
  if (gitAvailable === undefined) {
    try {
      gitAvailable = spawnSync("git", ["--version"], { timeout: 5_000 }).error === undefined;
    } catch {
      gitAvailable = false;
    }
  }
  return gitAvailable;
}

function requireGit(): void {
  if (!hasGit()) throw new ToolError("E_BINARY", "git not found (install git to enable mcp-git tools)");
}

/** 拒绝旗标样 token（防选项注入：--exec / --upload-pack 等） */
function assertNotFlag(value: string, field: string): void {
  if (value.startsWith("-")) {
    throw new ToolError("E_ARGS", `${field} must not start with "-" (option-like values are rejected): ${JSON.stringify(value)}`);
  }
}

interface ProcResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** 在 cwd 下跑 git；超时杀进程抛 TimeoutError */
function runGit(args: string[], cwd?: string): Promise<ProcResult> {
  return new Promise<ProcResult>((resolve, reject) => {
    const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"], env: process.env });
    let stdout = "";
    let stderr = "";
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, GIT_TIMEOUT_MS);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stdout.length < 1_048_576) stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < STDERR_CAP) stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new ToolError("E_BINARY", `git not found (${error.message})`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (killed) {
        reject(new TimeoutError(GIT_TIMEOUT_MS));
        return;
      }
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

/** 解析 cwd：监狱内 + 必须是已存在目录 */
async function resolveRepo(cwd: string): Promise<string> {
  const abs = await jail.resolve(cwd);
  const dirStat = await stat(abs).catch(() => undefined);
  if (dirStat === undefined || !dirStat.isDirectory()) {
    throw new ToolError("E_NOT_FOUND", `cwd ${JSON.stringify(cwd)} is not an existing directory`);
  }
  return abs;
}

/** 统一的 git 执行：非零退出 → E_GIT（stderr 摘要）；超时 → TIMEOUT */
async function gitOrError(args: string[], cwd?: string): Promise<ProcResult> {
  try {
    const result = await runGit(args, cwd);
    if (result.code !== 0) {
      const summary = result.stderr.trim().split("\n").slice(-4).join(" | ").slice(-800);
      throw new ToolError("E_GIT", summary.length > 0 ? summary : `git exited with code ${result.code}`);
    }
    return result;
  } catch (error) {
    if (error instanceof TimeoutError) {
      throw new ToolError("TIMEOUT", `git ${args[0] ?? ""} timed out after ${GIT_TIMEOUT_MS}ms`);
    }
    throw error;
  }
}

const cwdSchema = z.string().describe("repository directory, relative to jail root or absolute inside roots");
const refSchema = z.string().min(1).describe('a git ref (branch name, tag, or revision like HEAD~1); must not start with "-"');

const tools = [
  defineTool("git.version", "Report the installed git CLI version (also a cheap binary-availability probe).", z.object({}), async () => {
    requireGit();
    const result = await gitOrError(["--version"]);
    return ok({ version: result.stdout.trim() });
  }),
  defineTool(
    "git.status",
    "Working tree status (porcelain -b): current branch, ahead/behind vs upstream, and per-file change codes.",
    z.object({ cwd: cwdSchema }),
    async ({ cwd }) => {
      requireGit();
      const abs = await resolveRepo(cwd);
      const result = await gitOrError(["status", "--porcelain", "-b"], abs);
      const lines = result.stdout.split("\n").filter((l) => l.length > 0);
      const header = lines[0] ?? "## (unknown)";
      const body = header.replace(/^##\s+/, "");
      let branch: string;
      if (body.startsWith("No commits yet on ")) {
        branch = body.replace("No commits yet on ", "").trim(); // 初始仓库：## No commits yet on main
      } else {
        branch = body.split("...")[0]!.split(" ")[0]!;
      }
      let ahead = 0;
      let behind = 0;
      const bracket = header.match(/\[ahead (\d+)(?:, behind (\d+))?\]|\[behind (\d+)\]/);
      if (bracket !== null) {
        ahead = Number(bracket[1] ?? 0);
        behind = Number(bracket[2] ?? bracket[3] ?? 0);
      }
      if (branch === "HEAD") branch = "(detached)";
      const changes = lines.slice(1).map((line) => {
        const status = line.slice(0, 2).trim();
        let path = line.slice(3);
        const renamedFrom = path.includes(" -> ") ? path.split(" -> ")[0] : undefined;
        if (renamedFrom !== undefined) path = path.split(" -> ")[1]!;
        return { status: status.length > 0 ? status : line.slice(0, 2), path, ...(renamedFrom !== undefined ? { renamedFrom } : {}) };
      });
      return ok({ branch, ahead, behind, clean: changes.length === 0, changes });
    },
  ),
  defineTool(
    "git.log",
    "List commits (hash/author/date/subject) with optional limit, author substring filter, and starting ref.",
    z.object({
      cwd: cwdSchema,
      limit: z.number().int().min(1).max(500).describe("max commits to return").default(20),
      author: z.string().describe('substring filter on author name/email (git --author)').optional(),
      ref: refSchema.optional(),
    }),
    async ({ cwd, limit, author, ref }) => {
      requireGit();
      const abs = await resolveRepo(cwd);
      const args = ["log", `-n`, String(limit), "--date=iso", "--pretty=format:%H|%an|%ad|%s"];
      if (author !== undefined) {
        assertNotFlag(author, "author");
        args.push(`--author=${author}`);
      }
      if (ref !== undefined) {
        assertNotFlag(ref, "ref");
        args.push(ref);
      }
      const result = await gitOrError(args, abs);
      const commits = result.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => {
          const p1 = line.indexOf("|");
          const p2 = line.indexOf("|", p1 + 1);
          const p3 = line.indexOf("|", p2 + 1);
          if (p1 < 0 || p2 < 0 || p3 < 0) return undefined;
          return {
            hash: line.slice(0, p1),
            author: line.slice(p1 + 1, p2),
            date: line.slice(p2 + 1, p3),
            subject: line.slice(p3 + 1),
          };
        })
        .filter((c): c is { hash: string; author: string; date: string; subject: string } => c !== undefined);
      return ok({ commits, total: commits.length });
    },
  ),
  defineTool(
    "git.diff",
    "Unified diff of the working tree (default), the index (staged: true), or against a ref; includes numstat file/addition/deletion totals. Output capped at 64KB.",
    z.object({
      cwd: cwdSchema,
      ref: refSchema.describe("diff target ref, e.g. HEAD~1 (omit for working tree)").optional(),
      staged: z.boolean().describe("true = --cached (index vs HEAD)").default(false),
    }),
    async ({ cwd, ref, staged }) => {
      requireGit();
      const abs = await resolveRepo(cwd);
      const range: string[] = [];
      if (staged) range.push("--cached");
      if (ref !== undefined) {
        assertNotFlag(ref, "ref");
        range.push(ref);
      }
      const numstat = await gitOrError(["diff", "--numstat", ...range], abs);
      let files = 0;
      let additions = 0;
      let deletions = 0;
      for (const line of numstat.stdout.split("\n")) {
        if (line.trim().length === 0) continue;
        const [adds, dels] = line.split("\t");
        files++;
        if (adds !== undefined && /^\d+$/.test(adds)) additions += Number(adds);
        if (dels !== undefined && /^\d+$/.test(dels)) deletions += Number(dels);
      }
      const patch = await gitOrError(["diff", ...range], abs);
      const { text, truncated } = truncateBytes(patch.stdout, OUTPUT_CAP_BYTES);
      return ok({ text, truncated, stats: { files, additions, deletions } });
    },
  ),
  defineTool(
    "git.branches",
    "List local and remote branches with current-checkout and remote flags.",
    z.object({ cwd: cwdSchema }),
    async ({ cwd }) => {
      requireGit();
      const abs = await resolveRepo(cwd);
      const result = await gitOrError(
        ["for-each-ref", "--format=%(HEAD)|%(refname)", "refs/heads", "refs/remotes"],
        abs,
      );
      const branches = result.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => {
          const sep = line.indexOf("|");
          const head = sep >= 0 ? line.slice(0, sep) : "";
          const refname = sep >= 0 ? line.slice(sep + 1) : line;
          const remote = refname.startsWith("refs/remotes/");
          const name = remote ? refname.replace("refs/remotes/", "") : refname.replace("refs/heads/", "");
          return { name, current: head === "*", remote };
        });
      return ok({ branches, total: branches.length });
    },
  ),
  defineTool(
    "git.tags",
    "List tags sorted by creation date (newest first), capped at limit.",
    z.object({
      cwd: cwdSchema,
      limit: z.number().int().min(1).max(500).describe("max tags to return").default(50),
    }),
    async ({ cwd, limit }) => {
      requireGit();
      const abs = await resolveRepo(cwd);
      const result = await gitOrError(["tag", "--sort=-creatordate"], abs);
      const tags = result.stdout.split("\n").filter((t) => t.length > 0);
      return ok({ tags: tags.slice(0, limit), total: tags.length, truncated: tags.length > limit });
    },
  ),
  defineTool(
    "git.show",
    "Show a commit (patch) or a file's content at a ref: git show <ref> or git show <ref>:<path>. Output capped at 64KB.",
    z.object({
      cwd: cwdSchema,
      ref: refSchema,
      path: z.string().describe("optional in-repo file path (returns file content at ref instead of the patch)").optional(),
    }),
    async ({ cwd, ref, path }) => {
      requireGit();
      const abs = await resolveRepo(cwd);
      assertNotFlag(ref, "ref");
      let target = ref;
      if (path !== undefined) {
        assertNotFlag(path, "path");
        target = `${ref}:${path}`;
      }
      const result = await gitOrError(["show", target], abs);
      const { text, truncated } = truncateBytes(result.stdout, OUTPUT_CAP_BYTES);
      return ok({ ref, ...(path !== undefined ? { path } : {}), text, truncated });
    },
  ),
];

await runStdioServer(tools, { serverName: "mcp-git", serverVersion: "0.1.0" });
