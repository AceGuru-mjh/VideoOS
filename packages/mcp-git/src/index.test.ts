// mcp-git 协议级 E2E：spawn 真子进程；夹具 = mkdtemp 临时目录 git init + config user + 两个文件 commit。
// git 缺失时仓库用例自动 skip（本机有 git → 真跑）。
import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { spawnLiteServer } from "@videoos/mcp-lite/testing";

const SERVER = join(import.meta.dir, "index.ts");

const hasGit = (() => {
  try {
    return spawnSync("git", ["--version"], { timeout: 5_000 }).error === undefined;
  } catch {
    return false;
  }
})();

/** 建一个有 1 个提交的测试仓库，返回仓库根目录 */
function makeRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "mcp-git-"));
  const run = (...args: string[]): void => {
    const res = spawnSync("git", args, { cwd: repo, timeout: 15_000 });
    if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
  };
  run("init", "-b", "main");
  run("config", "user.email", "tester@videoos.dev");
  run("config", "user.name", "VideoOS Tester");
  writeFileSync(join(repo, "README.md"), "# demo\nline-a\n");
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "src", "main.ts"), "export const answer = 42;\n");
  run("add", ".");
  run("commit", "-m", "first commit");
  return repo;
}

describe("mcp-git (E2E)", () => {
  it(
    "exposes 7 git tools",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        expect(server.tools.map((t) => t.name).sort()).toEqual([
          "git.branches",
          "git.diff",
          "git.log",
          "git.show",
          "git.status",
          "git.tags",
          "git.version",
        ]);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  (hasGit ? it : it.skip)(
    "git.version reports the CLI version",
    async () => {
      const server = await spawnLiteServer(SERVER);
      try {
        const result = await server.call("git.version", {});
        expect(result.ok).toBe(true);
        expect((result.data as { version: string }).version).toMatch(/^git version \d/);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  (hasGit ? it : it.skip)(
    "status/log/branches describe a freshly committed repo",
    async () => {
      const repo = makeRepo();
      const server = await spawnLiteServer(SERVER, { env: { MCP_GIT_ROOTS: repo } });
      try {
        const status = await server.call("git.status", { cwd: "." });
        expect(status.ok).toBe(true);
        expect(status.data).toMatchObject({ branch: "main", ahead: 0, behind: 0, clean: true, changes: [] });

        const log = await server.call("git.log", { cwd: "." });
        expect(log.ok).toBe(true);
        const logData = log.data as { commits: Array<{ hash: string; author: string; date: string; subject: string }>; total: number };
        expect(logData.total).toBe(1);
        expect(logData.commits[0]!.hash).toMatch(/^[0-9a-f]{40}$/);
        expect(logData.commits[0]!.author).toBe("VideoOS Tester");
        expect(logData.commits[0]!.subject).toBe("first commit");
        expect(logData.commits[0]!.date).toMatch(/^\d{4}-\d{2}-\d{2}/);

        const branches = await server.call("git.branches", { cwd: "." });
        const branchesData = branches.data as { branches: Array<{ name: string; current: boolean; remote: boolean }>; total: number };
        expect(branchesData.branches).toContainEqual({ name: "main", current: true, remote: false });

        const authorFilter = await server.call("git.log", { cwd: ".", author: "Tester" });
        expect((authorFilter.data as { total: number }).total).toBe(1);
        const authorNone = await server.call("git.log", { cwd: ".", author: "nobody-here" });
        expect((authorNone.data as { total: number }).total).toBe(0);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  (hasGit ? it : it.skip)(
    "status shows changes and diff reports patch text + numstat totals (worktree, staged, ref)",
    async () => {
      const repo = makeRepo();
      writeFileSync(join(repo, "README.md"), "# demo\nline-a-changed\n");
      writeFileSync(join(repo, "notes.txt"), "untracked\n");
      const server = await spawnLiteServer(SERVER, { env: { MCP_GIT_ROOTS: repo } });
      try {
        const status = await server.call("git.status", { cwd: "." });
        expect(status.ok).toBe(true);
        const statusData = status.data as { clean: boolean; changes: Array<{ status: string; path: string }> };
        expect(statusData.clean).toBe(false);
        const byPath = new Map(statusData.changes.map((c) => [c.path, c.status]));
        expect(byPath.get("README.md")).toBe("M");
        expect(byPath.get("notes.txt")).toBe("??");

        const diff = await server.call("git.diff", { cwd: "." });
        expect(diff.ok).toBe(true);
        const diffData = diff.data as { text: string; truncated: boolean; stats: { files: number; additions: number; deletions: number } };
        expect(diffData.text).toContain("line-a");
        expect(diffData.text).toContain("-line-a");
        expect(diffData.stats).toEqual({ files: 1, additions: 1, deletions: 1 });
        expect(diffData.truncated).toBe(false);

        // staged diff：暂存后 worktree diff 变空、--cached 有内容
        spawnSync("git", ["add", "README.md"], { cwd: repo, timeout: 10_000 });
        const unstaged = await server.call("git.diff", { cwd: "." });
        expect(((unstaged.data as { stats: { files: number } }).stats).files).toBe(0);
        const staged = await server.call("git.diff", { cwd: ".", staged: true });
        expect(((staged.data as { stats: { files: number } }).stats).files).toBe(1);
        expect((staged.data as { text: string }).text).toContain("+line-a-changed");

        // ref diff：与 HEAD 的差异
        const refDiff = await server.call("git.diff", { cwd: ".", ref: "HEAD" });
        expect(((refDiff.data as { stats: { files: number } }).stats).files).toBe(1);
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  (hasGit ? it : it.skip)(
    "tags and show return repo content",
    async () => {
      const repo = makeRepo();
      spawnSync("git", ["tag", "-a", "v1.0.0", "-m", "first release"], { cwd: repo, timeout: 10_000 });
      spawnSync("git", ["tag", "lightweight-tip"], { cwd: repo, timeout: 10_000 });
      const server = await spawnLiteServer(SERVER, { env: { MCP_GIT_ROOTS: repo } });
      try {
        const tags = await server.call("git.tags", { cwd: "." });
        expect(tags.ok).toBe(true);
        const tagsData = tags.data as { tags: string[]; total: number; truncated: boolean };
        expect(tagsData.total).toBe(2);
        expect(tagsData.tags).toContain("v1.0.0");
        expect(tagsData.tags).toContain("lightweight-tip");
        expect(tagsData.truncated).toBe(false);

        const limited = await server.call("git.tags", { cwd: ".", limit: 1 });
        expect((limited.data as { tags: string[]; truncated: boolean }).tags.length).toBe(1);
        expect((limited.data as { truncated: boolean }).truncated).toBe(true);

        const showFile = await server.call("git.show", { cwd: ".", ref: "HEAD", path: "src/main.ts" });
        expect(showFile.ok).toBe(true);
        const showFileData = showFile.data as { text: string; truncated: boolean };
        expect(showFileData.text).toContain("export const answer = 42;");
        expect(showFileData.truncated).toBe(false);

        const showCommit = await server.call("git.show", { cwd: ".", ref: "HEAD" });
        expect((showCommit.data as { text: string }).text).toContain("first commit");
      } finally {
        await server.close();
      }
    },
    20_000,
  );

  (hasGit ? it : it.skip)(
    "errors: non-repo (E_GIT), jail escape (E_JAIL), flag-like refs (E_ARGS)",
    async () => {
      const repo = makeRepo();
      const notRepo = mkdtempSync(join(tmpdir(), "mcp-git-empty-"));
      const server = await spawnLiteServer(SERVER, { env: { MCP_GIT_ROOTS: `${repo}:${notRepo}` } });
      try {
        const noRepo = await server.call("git.status", { cwd: notRepo });
        expect(noRepo.ok).toBe(false);
        expect(noRepo.error).toContain("E_GIT");

        const outside = await server.call("git.status", { cwd: "/etc" });
        expect(outside.ok).toBe(false);
        expect(outside.error).toContain("E_JAIL");

        const missing = await server.call("git.status", { cwd: "no-such-dir" });
        expect(missing.ok).toBe(false);
        expect(missing.error).toContain("E_NOT_FOUND");

        const flagRef = await server.call("git.show", { cwd: ".", ref: "--exec=evil" });
        expect(flagRef.ok).toBe(false);
        expect(flagRef.error).toContain("E_ARGS");
      } finally {
        await server.close();
      }
    },
    20_000,
  );
});
