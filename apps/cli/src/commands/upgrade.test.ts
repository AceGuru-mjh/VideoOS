// videoos upgrade 命令测试（全离线）：内存 provider + 注入 fetch + 临时 baseDir + stdout 捕获。
// 覆盖：--check 人类输出 / --check --json 机器输出 / --list / 指定版本安装（--yes）/
// 回滚 / 无新版提示 / 坏渠道友好报错。
import { afterEach, beforeAll, afterAll, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { Updater } from "@videoos/updater";
import type { FetchLike, ReleaseInfo, UpdateProvider } from "@videoos/updater";
import { runUpgrade } from "./upgrade";
import type { UpgradeDeps } from "./upgrade";

let base: string;
let work: string;
let CASE_ID = 1;

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "videoos-upgrade-cmd-"));
  work = mkdtempSync(join(tmpdir(), "videoos-upgrade-work-"));
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
  rmSync(work, { recursive: true, force: true });
});

// ---- 内存 provider + 归档 fetch（与 packages/updater 测试同款语义，独立精简实现） ----

function makeRelease(version: string): ReleaseInfo {
  return {
    version,
    tag: `v${version}`,
    channel: "stable",
    publishedAt: "2026-02-01T00:00:00Z",
    notes: `## v${version}`,
    assets: [
      { name: "checksums.txt", url: `mem://dl/${version}/checksums.txt`, size: 100 },
      { name: "videoos-linux-x64.tar.gz", url: `mem://dl/${version}/videoos-linux-x64.tar.gz`, size: 1000 },
    ],
  };
}

class MemoryProvider implements UpdateProvider {
  releases: ReleaseInfo[];
  constructor(releases: ReleaseInfo[]) {
    this.releases = releases;
  }
  async latest(channel = "stable"): Promise<ReleaseInfo | null> {
    const list = await this.list(1000, channel);
    return list[0] ?? null;
  }
  async list(limit = 10, channel = "stable"): Promise<ReleaseInfo[]> {
    const all = channel === "beta" ? this.releases : this.releases.filter((r) => r.channel === "stable");
    return all.slice(0, limit);
  }
  async release(version: string): Promise<ReleaseInfo | null> {
    const bare = version.startsWith("v") ? version.slice(1) : version;
    return this.releases.find((r) => r.version === bare) ?? null;
  }
}

function makeEnv(versions: string[]): { provider: MemoryProvider; fetchImpl: FetchLike } {
  const archives = new Map<string, { bytes: Buffer; sha256: string }>();
  const releases = versions
    .slice()
    .reverse()
    .map((v) => {
      const srcDir = join(work, `src-${v}`);
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(join(srcDir, "videoos"), `#!/bin/sh\necho ${v}\n`, "utf8");
      const archive = join(work, `videoos-${v}.tar.gz`);
      execFileSync("tar", ["-czf", archive, "-C", srcDir, "videoos"]);
      const bytes = readFileSync(archive);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      archives.set(v, { bytes, sha256 });
      return makeRelease(v);
    });
  const provider = new MemoryProvider(releases);
  const fetchImpl: FetchLike = async (url) => {
    const m = /^mem:\/\/dl\/([^/]+)\/(.+)$/.exec(url);
    if (m === null) return new Response("not found", { status: 404 });
    const version = m[1] ?? "";
    const name = m[2] ?? "";
    const archive = archives.get(version);
    if (archive === undefined) return new Response("not found", { status: 404 });
    if (name === "videoos-linux-x64.tar.gz") return new Response(archive.bytes);
    if (name === "checksums.txt") return new Response(`${archive.sha256}  videoos-linux-x64.tar.gz\n`);
    return new Response("not found", { status: 404 });
  };
  return { provider, fetchImpl };
}

/** 每个 test 一个独立 baseDir（case-N），makeUpdater 共享之 → 状态在 test 内连续（装→回滚） */
function makeDeps(versions: string[]): UpgradeDeps {
  const { provider, fetchImpl } = makeEnv(versions);
  const dir = join(base, `case-${String(CASE_ID++)}`);
  return {
    makeUpdater: () =>
      new Updater({
        currentVersion: "0.3.0",
        baseDir: dir,
        provider,
        fetchImpl,
        platform: "linux",
        arch: "x64",
        now: () => 1_000_000,
      }),
  };
}

// ---- stdout 捕获 ----

let logs: string[];
const origLog = console.log;
const origError = console.error;

beforeEach(() => {
  logs = [];
  console.log = (...args: unknown[]) => {
    logs.push(args.join(" "));
  };
  console.error = (...args: unknown[]) => {
    logs.push(args.join(" "));
  };
});

afterEach(() => {
  console.log = origLog;
  console.error = origError;
  process.exitCode = 0;
});

function output(): string {
  return logs.join("\n");
}

// ---- 测试 ----

describe("videoos upgrade（离线注入）", () => {
  test("--check：打印 当前/最新/类型/渠道/安装形态", async () => {
    await runUpgrade({ check: true }, makeDeps(["0.3.1"]));
    const text = output();
    expect(text).toContain("0.3.0");
    expect(text).toContain("0.3.1");
    expect(text).toContain("补丁更新");
    expect(text).toContain("stable");
  });

  test("--check --json：机器可读输出（current/latest/available/type/installMode）", async () => {
    await runUpgrade({ check: true, json: true }, makeDeps(["0.3.1"]));
    const start = output().indexOf("{");
    expect(start).toBeGreaterThanOrEqual(0);
    const parsed = JSON.parse(output().slice(start)) as {
      current: string;
      latest: string;
      available: boolean;
      type: string;
      channel: string;
      installMode: string;
    };
    expect(parsed.current).toBe("0.3.0");
    expect(parsed.latest).toBe("0.3.1");
    expect(parsed.available).toBe(true);
    expect(parsed.type).toBe("patch");
    expect(parsed.channel).toBe("stable");
    expect(["source", "binary-managed", "binary-standalone"]).toContain(parsed.installMode);
  });

  test("--list：列出 Release（版本号 + 日期）", async () => {
    await runUpgrade({ list: true }, makeDeps(["0.3.1", "0.4.0"]));
    const text = output();
    expect(text).toContain("v0.4.0");
    expect(text).toContain("v0.3.1");
    expect(text).toContain("2026-02-01");
  });

  test("指定版本安装（--yes，非交互）：下载→校验→解压→切换→提示重启生效", async () => {
    const deps = makeDeps(["0.3.1"]);
    await runUpgrade({ version: "0.3.1", yes: true }, deps);
    const text = output();
    expect(text).toContain("已安装 v0.3.1");
    expect(text).toContain("重启 videoos 后生效");
    expect(text).toContain("rollback");
  });

  test("回滚：安装两个版本后 --rollback 回到上一版", async () => {
    const deps = makeDeps(["0.3.1", "0.4.0"]);
    await runUpgrade({ version: "0.3.1", yes: true }, deps);
    await runUpgrade({ version: "0.4.0", yes: true }, deps);
    logs = [];
    await runUpgrade({ rollback: true }, deps);
    const text = output();
    expect(text).toContain("已回滚 v0.4.0 → v0.3.1");
  });

  test("无新版：已是最新提示", async () => {
    await runUpgrade({ check: true }, makeDeps(["0.3.0"]));
    expect(output()).toContain("已是最新版本");
  });

  test("坏渠道：友好报错 + exitCode 1（不抛栈）", async () => {
    await runUpgrade({ channel: "nope" }, makeDeps(["0.3.1"]));
    expect(output()).toContain("stable | beta");
    expect(process.exitCode).toBe(1);
  });

  test("检查失败（provider 抛错）：红色错误 + exitCode 1", async () => {
    const deps = makeDeps(["0.3.1"]);
    const broken: UpgradeDeps = {
      makeUpdater: () =>
        new Updater({
          currentVersion: "0.3.0",
          baseDir: join(base, `case-${String(CASE_ID++)}`),
          provider: {
            latest: async () => {
              throw new Error("network down");
            },
            list: async () => [],
            release: async () => null,
          },
          platform: "linux",
          arch: "x64",
          now: () => 1_000_000,
        }),
    };
    void deps;
    await runUpgrade({ check: true }, broken);
    expect(output()).toContain("检查更新失败");
    expect(process.exitCode).toBe(1);
  });
});
