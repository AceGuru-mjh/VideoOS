// VideoOS Studio 桌面自动更新（v0.4 · OpenCode 式语义）。
//
// 链路：electron-updater（GitHub provider ← app-update.yml ← electron-builder publish 配置）
// + CI 已上传的 latest.yml（NSIS 差分元数据，含 sha512/blockmap）。
// 语义（对齐 OpenCode desktop）：
//   - 仅打包版检查（开发模式直接跳过，吞 dev-updater-config 错误）
//   - autoDownload=false —— 绝不偷偷下载；发现新版 → 用户确认 → 下载 →「重启安装」
//   - autoInstallOnAppQuit=false —— 不趁退出偷装
//   - 下载产物 sha512 由 electron-updater 自动校验
//   - VIDEOOS_DISABLE_AUTOUPDATE 环境变量一键关闭；VIDEOOS_UPDATER_CHANNEL=beta 切预发布
import { app, dialog } from "electron";
import process from "node:process";
import { compareVersions, isVersion } from "@videoos/updater";

/** electron-updater 的 checkForUpdates 结果（跨小版本字段稳定的最小形状） */
interface UpdateCheckResultLike {
  updateInfo?: { version?: string };
}

/**
 * 初始化桌面自动更新（main.ts 在窗口就绪后调用；完全 fire-and-forget，任何失败静默）。
 * 绝不阻塞启动：所有网络/对话框都在异步流程里，异常一路吞掉（离线/无 Release/限流均无感）。
 */
export function initDesktopUpdater(): void {
  // 开发模式：无 app-update.yml，electron-updater 会抛 dev 配置错误 —— 直接跳过
  if (!app.isPackaged) return;
  // 用户显式禁用（与 CLI 同一开关）
  if (process.env.VIDEOOS_DISABLE_AUTOUPDATE !== undefined && process.env.VIDEOOS_DISABLE_AUTOUPDATE !== "") return;

  void runUpdateFlow().catch(() => {
    // 离线 / 限流 / latest.yml 拉取失败 —— 更新不可用绝不打扰用户
  });
}

async function runUpdateFlow(): Promise<void> {
  // 动态 import：主包外部化（--external:electron-updater），运行时从 app node_modules 解析
  const { autoUpdater } = await import("electron-updater");

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = process.env.VIDEOOS_UPDATER_CHANNEL === "beta";
  autoUpdater.logger = null;

  // 1) 检查（GitHub Releases latest.yml）
  const result = (await autoUpdater.checkForUpdates()) as UpdateCheckResultLike | null;
  const remote = result?.updateInfo?.version;
  if (typeof remote !== "string" || !isVersion(remote)) return;
  const current = app.getVersion();
  if (!isVersion(current) || compareVersions(current, remote) >= 0) return;

  // 2) 确认（绝不偷偷下载）
  const ask = await dialog.showMessageBox({
    type: "info",
    title: "VideoOS Studio 更新",
    message: `发现新版本 v${remote}（当前 v${current}）`,
    detail: "下载并安装更新吗？下载完成后会提示重启安装。\n（更新来自 GitHub Releases，安装包经 sha512 校验）",
    buttons: ["下载并安装", "稍后"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (ask.response !== 0) return;

  // 3) 下载（NSIS 差分下载，blockmap 只取变更块）
  await autoUpdater.downloadUpdate();

  // 4) 重启安装（用户可拒绝，保留到下次启动再提示）
  const ready = await dialog.showMessageBox({
    type: "info",
    title: "VideoOS Studio 更新就绪",
    message: `v${remote} 已下载完成（完整性已校验）`,
    detail: "立即重启并安装？稍后安装将在下次启动时再次提示。",
    buttons: ["重启并安装", "稍后"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (ready.response === 0) {
    // before-quit 钩子会负责终止 bun sidecar —— 现有生命周期逻辑天然兼容
    autoUpdater.quitAndInstall();
  }
}
