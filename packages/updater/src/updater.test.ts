// Updater 集成测试（全离线）：内存 provider + 注入 fetch + 临时 baseDir + 真 tar 归档。
// 覆盖：getUpdateState（可用/无 Release/24h 节流/force/禁用 env）、upgradeTo 全链路
//（选资产/下载/校验/解压/切换/LRU）、回滚、安全拒绝（无校验和/哈希不符/无资产）。
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Updater, UpdaterError, detectInstallMode, resolveUpdateMode, shouldAutoInstall } from "./index";
import type { UpdateProvider, UpgradeResult, FetchLike, ReleaseAsset, ReleaseInfo } from "./index";

let base: string;
let work: string;
let CASE_ID = 1;

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "videoos-updater-"));
  work = mkdtempSync(join(tmpdir(), "videoos-updater-work-"));
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
  rmSync(work, { recursive: true, force: true });
});

// ---- 内存 provider ----

function makeRelease(version: string, opts: { prerelease?: boolean; assets?: ReleaseAsset[] } = {}): ReleaseInfo {
  return {
    version,
    tag: `v${version}`,
    channel: opts.prerelease === true ? "beta" : "stable",
    publishedAt: "2026-02-01T00:00:00Z",
    notes: `## v${version}\n- ${version} 更新内容`,
    assets: opts.assets ?? [
      { name: "checksums.txt", url: `mem://dl/${version}/checksums.txt`, size: 200 },
      { name: "videoos-linux-x64.tar.gz", url: `mem://dl/${version}/videoos-linux-x64.tar.gz`, size: 1000 },
    ],
  };
}

class MemoryProvider implements UpdateProvider {
  releases: ReleaseInfo[];
  latestCalls = 0;
  constructor(releases: ReleaseInfo[]) {
    this.releases = releases;
  }
  async latest(channel = "stable"): Promise<ReleaseInfo | null> {
    this.latestCalls += 1;
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

// ---- 真 tar.gz 归档 + 注入 fetch ----

/** 生成一个版本归档：目录内含单文件 `videoos`（内容 = 版本号），返回 {bytes, sha256} */
function buildArchive(version: string): { bytes: Buffer; sha256: string } {
  const srcDir = join(work, `src-${version}`);
  mkdirSync(srcDir, { recursive: true });
  writeFileSync(join(srcDir, "videoos"), `#!/bin/sh\necho ${version}\n`, "utf8");
  const archive = join(work, `videoos-${version}.tar.gz`);
  execFileSync("tar", ["-czf", archive, "-C", srcDir, "videoos"]);
  const bytes = readFileSync(archive);
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
}

/** 组装离线升级环境：provider releases + fetchImpl 按版本提供归档/校验和 */
function makeEnv(versions: string[], opts: { checksumOverride?: (v: string, real: string) => string } = {}): {
  provider: MemoryProvider;
  fetchImpl: FetchLike;
} {
  const archives = new Map<string, { bytes: Buffer; sha256: string }>();
  // newest first（与 GitHub /releases 返回序一致）
  const releases = versions
    .slice()
    .reverse()
    .map((v) => {
      const a = buildArchive(v);
      archives.set(v, a);
      return makeRelease(v, {
        assets: [
          { name: "checksums.txt", url: `mem://dl/${v}/checksums.txt`, size: 100 },
          { name: "videoos-linux-x64.tar.gz", url: `mem://dl/${v}/videoos-linux-x64.tar.gz`, size: a.bytes.byteLength },
        ],
      });
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
    if (name === "checksums.txt") {
      const real = archive.sha256;
      const hash = opts.checksumOverride !== undefined ? opts.checksumOverride(version, real) : real;
      return new Response(`${hash}  videoos-linux-x64.tar.gz\n`);
    }
    return new Response("not found", { status: 404 });
  };
  return { provider, fetchImpl };
}

function freshUpdater(provider: UpdateProvider, fetchImpl: FetchLike, now: () => number): Updater {
  return new Updater({
    currentVersion: "0.3.0",
    baseDir: join(base, `case-${String(CASE_ID++)}`),
    provider,
    fetchImpl,
    platform: "linux",
    arch: "x64",
    now,
  });
}

describe("getUpdateState", () => {
  test("有新版 → available + 类型推导 + update-available 事件", async () => {
    const { provider, fetchImpl } = makeEnv(["0.3.1"]);
    const now = () => 1_000_000;
    const updater = freshUpdater(provider, fetchImpl, now);
    const seen: { latest: string; type: string }[] = [];
    updater.on("update-available", (p) => seen.push({ latest: p.latest, type: p.type }));
    const state = await updater.getUpdateState();
    expect(state.available).toBe(true);
    expect(state.type).toBe("patch");
    expect(state.latest).toBe("0.3.1");
    expect(state.disabled).toBe(false);
    expect(seen).toEqual([{ latest: "0.3.1", type: "patch" }]);
  });

  test("无任何 Release → available false 且 latest=current", async () => {
    const { fetchImpl } = makeEnv([]);
    const updater = freshUpdater(new MemoryProvider([]), fetchImpl, () => 1);
    const state = await updater.getUpdateState();
    expect(state.available).toBe(false);
    expect(state.latest).toBe("0.3.0");
    expect(state.latestRelease).toBeNull();
  });

  test("24h 节流：窗口内命中缓存不发请求，过期/force 重查", async () => {
    const { provider, fetchImpl } = makeEnv(["0.3.1"]);
    let clock = 1_000_000;
    const updater = freshUpdater(provider, fetchImpl, () => clock);
    await updater.getUpdateState();
    expect(provider.latestCalls).toBe(1);
    clock += 60 * 60 * 1000; // +1h：节流
    const cached = await updater.getUpdateState();
    expect(cached.fromCache).toBe(true);
    expect(provider.latestCalls).toBe(1);
    clock += 25 * 60 * 60 * 1000; // 累计 26h：过期
    const refetched = await updater.getUpdateState();
    expect(refetched.fromCache).toBe(false);
    expect(provider.latestCalls).toBe(2);
    const forced = await updater.getUpdateState({ force: true }); // force 无视节流
    expect(forced.fromCache).toBe(false);
    expect(provider.latestCalls).toBe(3);
  });

  test("VIDEOOS_DISABLE_AUTOUPDATE → 不发请求直接不可用态", async () => {
    const boom: UpdateProvider = {
      latest: () => Promise.reject(new Error("should not be called")),
      list: () => Promise.reject(new Error("should not be called")),
      release: () => Promise.reject(new Error("should not be called")),
    };
    const updater = freshUpdater(boom, async () => new Response(null, { status: 500 }), () => 1);
    const saved = process.env.VIDEOOS_DISABLE_AUTOUPDATE;
    try {
      process.env.VIDEOOS_DISABLE_AUTOUPDATE = "1";
      const state = await updater.getUpdateState();
      expect(state.disabled).toBe(true);
      expect(state.available).toBe(false);
    } finally {
      if (saved === undefined) delete process.env.VIDEOOS_DISABLE_AUTOUPDATE;
      else process.env.VIDEOOS_DISABLE_AUTOUPDATE = saved;
    }
  });

  test("beta 渠道：预发布不构成升级目标（type none）", async () => {
    const provider = new MemoryProvider([makeRelease("0.5.0-beta.1", { prerelease: true })]);
    const updater = freshUpdater(provider, async () => new Response(null, { status: 500 }), () => 1);
    await updater.getUpdateState(); // 先缓存 stable（空）
    const beta = new Updater({
      currentVersion: "0.3.0",
      baseDir: updater.baseDir,
      provider,
      channel: "beta",
      platform: "linux",
      arch: "x64",
      now: () => 1,
    });
    const state = await beta.getUpdateState({ force: true });
    expect(state.latest).toBe("0.5.0-beta.1");
    expect(state.available).toBe(false);
    expect(state.type).toBe("none");
  });
});

describe("upgradeTo（下载 → 校验 → 解压 → 切换 → LRU）", () => {
  test("全链路：versions/<v>/ 落位 + current.json 切换 + updated 事件 + 进度回调", async () => {
    const { provider, fetchImpl } = makeEnv(["0.3.1"]);
    const updater = freshUpdater(provider, fetchImpl, () => 2_000_000);
    const events: string[] = [];
    updater.on("updated", (p) => events.push(`updated:${p.from}->${p.to}`));
    updater.on("downloaded", (p) => events.push(`downloaded:${p.name}:${p.bytes}`));
    const progress: number[] = [];
    const result: UpgradeResult = await updater.upgradeTo("0.3.1", {
      onProgress: (received) => {
        progress.push(received);
      },
    });
    expect(existsSync(join(result.path, "videoos"))).toBe(true);
    expect(readFileSync(join(result.path, "videoos"), "utf8")).toContain("0.3.1");
    expect(updater.currentRecord()).toEqual({ version: "0.3.1", switchedAt: 2_000_000, previous: null });
    expect(events[0]?.startsWith("downloaded:videoos-linux-x64.tar.gz:")).toBe(true);
    expect(events.some((e) => e.startsWith("updated:"))).toBe(true);
    expect(updater.listInstalled().map((v) => v.version)).toEqual(["0.3.1"]);
    expect(updater.listInstalled()[0]?.current).toBe(true);
  });

  test("降/升级同一命令；rollback 回到 previous", async () => {
    const { provider, fetchImpl } = makeEnv(["0.3.1", "0.4.0"]);
    const updater = freshUpdater(provider, fetchImpl, () => 3_000_000);
    await updater.upgradeTo("0.3.1");
    await updater.upgradeTo("0.4.0");
    expect(updater.previousVersion()).toBe("0.3.1");
    const rb = await updater.rollback();
    expect(rb).toMatchObject({ from: "0.4.0", to: "0.3.1" });
    expect(updater.currentRecord()?.version).toBe("0.3.1");
  });

  test("LRU：安装第 4 个版本后只剩 3 个（current + 最新两个）", async () => {
    const { provider, fetchImpl } = makeEnv(["0.3.1", "0.4.0", "0.4.1", "0.4.2"]);
    const updater = freshUpdater(provider, fetchImpl, () => 4_000_000);
    await updater.upgradeTo("0.3.1");
    await updater.upgradeTo("0.4.0");
    await updater.upgradeTo("0.4.1");
    const last = await updater.upgradeTo("0.4.2");
    expect(last.removed).toEqual(["0.3.1"]);
    expect(updater.listInstalled().map((v) => v.version).sort()).toEqual(["0.4.0", "0.4.1", "0.4.2"]);
  });

  test("回滚目标已被清理 → ROLLBACK_MISSING", async () => {
    const { provider, fetchImpl } = makeEnv(["0.3.1", "0.4.0", "0.4.1", "0.4.2"]);
    const updater = freshUpdater(provider, fetchImpl, () => 5_000_000);
    await updater.upgradeTo("0.3.1");
    await updater.upgradeTo("0.4.0");
    await updater.upgradeTo("0.4.1");
    await updater.upgradeTo("0.4.2");
    // previous=0.4.1 仍在；伪造已被清理的场景
    rmSync(join(updater.baseDir, "versions", "0.4.1"), { recursive: true, force: true });
    const err = await updater.rollback().catch((e: unknown) => e);
    expect((err as UpdaterError).code).toBe("ROLLBACK_MISSING");
  });

  test("安全拒绝：无校验和资产（NO_CHECKSUM）", async () => {
    const provider = new MemoryProvider([
      makeRelease("0.3.1", { assets: [{ name: "videoos-linux-x64.tar.gz", url: "mem://dl/x/videoos-linux-x64.tar.gz", size: 10 }] }),
    ]);
    const updater = freshUpdater(provider, async () => new Response("x"), () => 1);
    const err = await updater.upgradeTo("0.3.1").catch((e: unknown) => e);
    expect((err as UpdaterError).code).toBe("NO_CHECKSUM");
  });

  test("安全拒绝：哈希不匹配（CHECKSUM_MISMATCH，删除下载缓存）", async () => {
    const { provider, fetchImpl } = makeEnv(["0.3.1"], { checksumOverride: () => "0".repeat(64) });
    const updater = freshUpdater(provider, fetchImpl, () => 1);
    const err = await updater.upgradeTo("0.3.1").catch((e: unknown) => e);
    expect((err as UpdaterError).code).toBe("CHECKSUM_MISMATCH");
    expect(existsSync(join(updater.baseDir, "downloads"))).toBe(false);
    expect(existsSync(join(updater.baseDir, "versions", "0.3.1"))).toBe(false);
  });

  test("无平台资产（NO_ASSET）与版本不存在（NO_RELEASE）", async () => {
    const provider = new MemoryProvider([
      makeRelease("0.3.1", { assets: [{ name: "videoos-darwin-arm64.tar.gz", url: "mem://dl/d/videoos-darwin-arm64.tar.gz", size: 10 }] }),
    ]);
    const updater = freshUpdater(provider, async () => new Response("x"), () => 1);
    expect(((await updater.upgradeTo("0.3.1").catch((e: unknown) => e)) as UpdaterError).code).toBe("NO_ASSET");
    expect(((await updater.upgradeTo("9.9.9").catch((e: unknown) => e)) as UpdaterError).code).toBe("NO_RELEASE");
    expect(((await updater.upgradeTo("not-a-version").catch((e: unknown) => e)) as UpdaterError).code).toBe("BAD_VERSION");
  });
});

describe("OpenCode 语义辅助", () => {
  test("resolveUpdateMode 默认 true；false/notify 值；禁用 env 优先", () => {
    const savedDisable = process.env.VIDEOOS_DISABLE_AUTOUPDATE;
    const savedMode = process.env.VIDEOOS_AUTOUPDATE;
    try {
      delete process.env.VIDEOOS_DISABLE_AUTOUPDATE;
      delete process.env.VIDEOOS_AUTOUPDATE;
      expect(resolveUpdateMode()).toBe(true);
      process.env.VIDEOOS_AUTOUPDATE = "notify";
      expect(resolveUpdateMode()).toBe("notify");
      process.env.VIDEOOS_AUTOUPDATE = "false";
      expect(resolveUpdateMode()).toBe(false);
      process.env.VIDEOOS_AUTOUPDATE = "0";
      expect(resolveUpdateMode()).toBe(false);
      process.env.VIDEOOS_AUTOUPDATE = "weird";
      expect(resolveUpdateMode()).toBe(true);
      process.env.VIDEOOS_AUTOUPDATE = "true";
      process.env.VIDEOOS_DISABLE_AUTOUPDATE = "1";
      expect(resolveUpdateMode()).toBe(false);
    } finally {
      if (savedDisable === undefined) delete process.env.VIDEOOS_DISABLE_AUTOUPDATE;
      else process.env.VIDEOOS_DISABLE_AUTOUPDATE = savedDisable;
      if (savedMode === undefined) delete process.env.VIDEOOS_AUTOUPDATE;
      else process.env.VIDEOOS_AUTOUPDATE = savedMode;
    }
  });

  test("shouldAutoInstall：仅 patch + true + binary-managed", () => {
    expect(shouldAutoInstall("patch", true, "binary-managed")).toBe(true);
    expect(shouldAutoInstall("patch", true, "binary-standalone")).toBe(false);
    expect(shouldAutoInstall("patch", true, "source")).toBe(false);
    expect(shouldAutoInstall("minor", true, "binary-managed")).toBe(false);
    expect(shouldAutoInstall("patch", "notify", "binary-managed")).toBe(false);
    expect(shouldAutoInstall("patch", false, "binary-managed")).toBe(false);
  });

  test("detectInstallMode：注入路径探测三种形态", () => {
    expect(
      detectInstallMode({
        execPath: "/home/u/.local/share/videoos/updater/versions/0.4.0/videoos",
        argv1: undefined,
      }),
    ).toBe("binary-managed");
    expect(
      detectInstallMode({
        execPath: "C:\\videoos\\updater\\versions\\0.4.1\\videoos.exe",
        argv1: undefined,
      }),
    ).toBe("binary-managed");
    expect(detectInstallMode({ execPath: "/usr/local/bin/videoos", argv1: undefined })).toBe("binary-standalone");
  });

  test("detectInstallMode：源码检出（apps/cli/src 或 .git 祖先）", () => {
    expect(
      detectInstallMode({
        execPath: "/home/u/.bun/bin/bun",
        argv1: "/home/z/repos/VideoOS/apps/cli/src/index.ts",
      }),
    ).toBe("source");
    // .git 祖先（向上最多 6 级）
    const repo = join(work, "repo6");
    mkdirSync(join(repo, ".git"), { recursive: true });
    const script = join(repo, "tools", "run.ts");
    mkdirSync(join(repo, "tools"), { recursive: true });
    writeFileSync(script, "", "utf8");
    expect(detectInstallMode({ execPath: "/usr/local/bin/bun", argv1: script })).toBe("source");
    // 版本目录命中优先于 source（managed 最先判定）
    expect(
      detectInstallMode({
        execPath: join(repo, "versions", "1.0.0", "videoos"),
        argv1: script,
      }),
    ).toBe("binary-managed");
  });

  test("markNotified / notifiedVersion：每版本只提示一次的记录", async () => {
    const { provider, fetchImpl } = makeEnv(["0.3.1"]);
    const updater = freshUpdater(provider, fetchImpl, () => 6_000_000);
    expect(updater.notifiedVersion()).toBeNull();
    await updater.getUpdateState();
    updater.markNotified("0.3.1");
    expect(updater.notifiedVersion()).toBe("0.3.1");
  });
});
