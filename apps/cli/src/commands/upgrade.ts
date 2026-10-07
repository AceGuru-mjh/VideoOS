// videoos upgrade：OpenCode 式自更新（GitHub Releases 单渠道 · sha256 强制校验 · 版本目录 + 原子切换 + 回滚）
//
// 语义（对齐 OpenCode）：
//   videoos upgrade             检查并安装（源码模式 → 提示 git pull；二进制 → 下载校验安装，重启生效）
//   videoos upgrade --check     只检查（跳过 24h 节流）
//   videoos upgrade --list [n]  最近 n 个 Release
//   videoos upgrade 0.4.0       安装指定版本（升级/降级同一命令）
//   videoos upgrade --rollback  回滚到上一版本（保留最近 3 版）
//
// 命令结束时另有静默提示（notifyUpdateIfNeeded，update-notifier 风格：24h 节流、失败静默、
// 每版本只提示一次；patch + 受管二进制 + autoupdate=true → 后台静默安装）。
import process from "node:process";
import readline from "node:readline";
import type { Command } from "commander";
import {
  Updater,
  UpdaterError,
  detectInstallMode,
  resolveUpdateMode,
  shouldAutoInstall,
  RELEASES_PAGE_URL,
} from "@videoos/updater";
import type { Channel, InstallMode, UpdateState } from "@videoos/updater";
import { color, fail, formatBytes, isInteractive } from "../util";

/** commander 选项（--list [count] 的 count 为可选值：boolean|string；version 为位置参数） */
export interface UpgradeOptions {
  version?: string;
  check?: boolean;
  list?: string | boolean;
  rollback?: boolean;
  yes?: boolean;
  json?: boolean;
  channel?: string;
}

/** 测试注入口：默认构造真实 Updater；测试传 provider/fetchImpl/baseDir 内存实现 */
export interface UpgradeDeps {
  makeUpdater?: (channel: Channel) => Updater;
}

function makeDefaultUpdater(channel: Channel): Updater {
  return new Updater({ channel });
}

function parseChannel(raw: string | undefined): Channel {
  if (raw === undefined || raw === "stable") return "stable";
  if (raw === "beta") return "beta";
  throw new UpdaterError("BAD_CHANNEL", `未知渠道 "${raw}"（支持 stable | beta）`);
}

function installModeLabel(mode: InstallMode): string {
  switch (mode) {
    case "source":
      return "源码模式（git 检出，git pull 更新）";
    case "binary-managed":
      return "受管二进制（versions/ 目录 · 支持自动更新与回滚）";
    default:
      return "独立二进制";
  }
}

function typeLabel(type: UpdateState["type"]): string {
  switch (type) {
    case "patch":
      return "补丁更新";
    case "minor":
      return "功能更新";
    case "major":
      return "重大更新";
    default:
      return "无更新";
  }
}

/** TTY 交互确认（管道 / CI 等非交互环境一律拒绝，除非 --yes） */
async function confirm(question: string): Promise<boolean> {
  if (!isInteractive) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await new Promise<boolean>((resolveAnswer) => {
      rl.question(question, (answer) => resolveAnswer(/^[yY]/.test(answer.trim())));
    });
  } finally {
    rl.close();
  }
}

/** 下载进度（仅交互式终端；一行覆盖式） */
function progressPrinter(): { update: (received: number, total: number) => void; done: () => void } {
  let lastLen = 0;
  return {
    update(received: number, total: number): void {
      if (!isInteractive) return;
      const line = total > 0 ? `↓ ${formatBytes(received)} / ${formatBytes(total)}` : `↓ ${formatBytes(received)}`;
      process.stdout.write(`\r${" ".repeat(lastLen)}\r${color.gray(line)}`);
      lastLen = line.length;
    },
    done(): void {
      if (!isInteractive || lastLen === 0) return;
      process.stdout.write(`\r${" ".repeat(lastLen)}\r`);
    },
  };
}

/** 检查并打印当前/最新（--check 与默认路径共用）；返回 null 表示检查失败已打印错误 */
async function checkSummary(updater: Updater, force: boolean): Promise<UpdateState | null> {
  try {
    return await updater.getUpdateState({ force });
  } catch (err) {
    fail(
      err instanceof UpdaterError
        ? err.message
        : `检查更新失败：${err instanceof Error ? err.message : String(err)}（离线？可稍后重试或 --list 查看）`,
    );
    return null;
  }
}

function printSummary(state: UpdateState, installMode: InstallMode): void {
  console.log("");
  console.log(`  当前版本   ${color.bold(state.current)}`);
  console.log(`  最新版本   ${state.latest}${state.available ? color.yellow(`（${typeLabel(state.type)}）`) : ""}`);
  console.log(`  渠道       ${state.channel}${state.fromCache ? color.gray("（24h 节流缓存）") : ""}`);
  console.log(`  安装形态   ${installModeLabel(installMode)}`);
  if (state.disabled) console.log(color.gray("  （VIDEOOS_DISABLE_AUTOUPDATE 已设置 —— 自动更新关闭）"));
  console.log("");
}

export async function runUpgrade(
  options: UpgradeOptions,
  deps: UpgradeDeps = {},
): Promise<void> {
  const makeUpdater = deps.makeUpdater ?? makeDefaultUpdater;

  // 0) --channel 校验（提前失败，避免网络请求后才发现）
  let channel: Channel;
  try {
    channel = parseChannel(options.channel);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
    return;
  }

  // 1) 回滚
  if (options.rollback === true) {
    const updater = makeUpdater(channel);
    try {
      const rb = await updater.rollback();
      console.log(color.green(`✓ 已回滚 v${rb.from} → v${rb.to}`));
      console.log(color.gray(`  ${rb.path}`));
      console.log(color.gray("  重启 videoos 后生效；再次回滚可继续 videoos upgrade --rollback"));
    } catch (err) {
      fail(err instanceof UpdaterError ? err.message : `回滚失败：${String(err)}`);
    }
    return;
  }

  // 2) Release 列表
  if (options.list !== undefined) {
    const count = typeof options.list === "string" ? Number.parseInt(options.list, 10) : 10;
    const updater = makeUpdater(channel);
    try {
      const releases = await updater.listReleases(Number.isFinite(count) && count > 0 ? count : 10);
      if (releases.length === 0) {
        console.log(color.yellow("没有可用 Release（仓库尚未发布版本）"));
        return;
      }
      console.log(color.bold(`最近 ${releases.length} 个 Release（渠道 ${channel}）：`));
      for (const r of releases) {
        const date = r.publishedAt !== null ? r.publishedAt.slice(0, 10) : "          ";
        const latestTag = r.channel === "beta" ? color.yellow("  prerelease") : "";
        console.log(`  v${r.version.padEnd(10)} ${date}${latestTag}`);
      }
      console.log(color.gray(`\n  安装：videoos upgrade <version> · 主页：${RELEASES_PAGE_URL}`));
    } catch (err) {
      fail(`拉取 Release 列表失败：${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  // 3) 检查（--check 强制跳过节流；默认也检查但走 24h 节流）
  const updater = makeUpdater(channel);
  const installMode = detectInstallMode();
  const state = await checkSummary(updater, options.check === true);
  if (state === null) return;

  // --json：机器可读输出（CI / 脚本消费）
  if (options.json === true) {
    console.log(
      JSON.stringify(
        {
          current: state.current,
          latest: state.latest,
          available: state.available,
          type: state.type,
          channel: state.channel,
          installMode,
          disabled: state.disabled,
        },
        null,
        2,
      ),
    );
    return;
  }

  printSummary(state, installMode);

  // 4) 指定版本安装（升级/降级同一命令）
  if (typeof options.version === "string" && options.version.length > 0) {
    await installVersion(updater, options.version, options.yes === true);
    return;
  }

  // 5) --check 到此为止
  if (options.check === true) {
    if (state.available) {
      console.log(
        installMode === "source"
          ? color.yellow(`↻ 源码模式更新：git pull && bun install（当前 ${state.current} → 最新 ${state.latest}）`)
          : color.yellow(`↻ 运行 videoos upgrade 安装 ${state.latest}`),
      );
    } else {
      console.log(color.green(`✓ 已是最新版本（v${state.current}）`));
    }
    return;
  }

  // 6) 默认：有新版 → 按安装形态升级；无新版 → 提示
  if (!state.available) {
    console.log(color.green(`✓ 已是最新版本（v${state.current}）`));
    return;
  }
  if (installMode === "source") {
    console.log(color.yellow(`↻ 检测到新版本 v${state.latest}（当前 v${state.current}）`));
    console.log(color.gray("  源码模式请在仓库目录执行：git pull && bun install"));
    console.log(color.gray("  （或 videoos upgrade <version> 安装二进制发行版到用户目录）"));
    return;
  }
  await installVersion(updater, state.latest, options.yes === true);
}

/** 安装指定版本（确认 → 下载（进度）→ 校验 → 解压 → 切换） */
async function installVersion(updater: Updater, version: string, yes: boolean): Promise<void> {
  const confirmed =
    yes ||
    (await confirm(`安装 v${version.startsWith("v") ? version : `v${version}`}？[y/N] `));
  if (!confirmed) {
    console.log(color.gray("已取消（非交互环境请加 --yes）"));
    return;
  }
  const progress = progressPrinter();
  try {
    const result = await updater.upgradeTo(version, {
      onProgress: (received, total) => progress.update(received, total),
    });
    progress.done();
    console.log(color.green(`✓ 已安装 v${result.to} → ${result.path}`));
    if (result.removed.length > 0) {
      console.log(color.gray(`  LRU 清理旧版本：${result.removed.map((v) => `v${v}`).join(", ")}`));
    }
    console.log(color.gray("  重启 videoos 后生效；不满意可 videoos upgrade --rollback"));
  } catch (err) {
    progress.done();
    fail(err instanceof UpdaterError ? err.message : `安装失败：${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// 命令结束后的静默更新提示（index.ts 主入口调用；update-notifier 语义）
// ---------------------------------------------------------------------------

/** 3s 超时包装：慢网/离线不拖命令后腿 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), ms);
      // node: Timeout.unref()；bun 同型；浏览器端无（不会走到）
      (timer as { unref?: () => void }).unref?.();
    }),
  ]);
}

/**
 * 每条命令结束后调用（fire-and-forget，失败完全静默）：
 *   - 24h 节流内直接用缓存（无网络请求、零延迟）
 *   - 有新版本且未就该版本提示过 → 打一行黄色提示（每版本只提示一次）
 *   - OpenCode 自动装判定（patch + autoupdate=true + 受管二进制）→ 后台静默安装，完成提示重启
 */
export async function notifyUpdateIfNeeded(): Promise<void> {
  try {
    if (resolveUpdateMode() === false) return;
    const installMode = detectInstallMode();
    const updater = new Updater();
    const state = await withTimeout(updater.getUpdateState(), 3000);
    if (!state.available) return;
    if (updater.notifiedVersion() === state.latest) return;
    updater.markNotified(state.latest);
    if (shouldAutoInstall(state.type, resolveUpdateMode(), installMode)) {
      const result = await withTimeout(updater.upgradeTo(state.latest), 120_000).catch(() => null);
      if (result !== null) {
        console.log(color.green(`✓ 已自动更新到 v${result.to}（补丁级 · OpenCode 语义）—— 重启 videoos 后生效`));
        return;
      }
    }
    console.log(color.yellow(`↻ VideoOS 有新版本 v${state.latest}（当前 v${state.current}）：videoos upgrade 更新`));
  } catch {
    // 离线 / 限流 / 超时 —— 全部静默（不打扰主命令输出）
  }
}

export function registerUpgradeCommand(program: Command): void {
  program
    .command("upgrade")
    .description("🔄 自更新：检查 / 安装 / 回滚（GitHub Releases · sha256 校验 · 版本目录）")
    .argument("[version]", "目标版本（如 0.4.0；升级/降级同一命令）")
    .option("--check", "只检查更新（跳过 24h 节流），不安装")
    .option("--list [count]", "列出最近 count 个 Release（默认 10）")
    .option("--rollback", "回滚到上一个已安装版本（保留最近 3 版）")
    .option("-y, --yes", "跳过确认直接安装（非交互/CI 场景）")
    .option("--json", "机器可读输出（--check 搭配，供脚本消费）")
    .option("--channel <channel>", "更新渠道：stable | beta（默认 stable）")
    .action(async (version: string | undefined, options: UpgradeOptions) => {
      await runUpgrade({ ...options, ...(version !== undefined ? { version } : {}) });
    });
}
