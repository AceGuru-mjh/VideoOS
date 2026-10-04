// VideoOS Studio — Electron 主进程。
// 架构（SPEC §1.1）：Electron 壳（Node）+ bun sidecar 视频引擎。
// 视频引擎（@videoos/server 全量 bundle）必须由 bun 运行 —— 项目 DSL 是 .ts，
// createVapContext 动态 import 依赖 bun 的原生 TS 加载；Node 无法执行。
// 端口协议：sidecar 启动后在 stdout 打印 `VIDEOOS_SERVER_READY {"port":N}`。
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import process from "node:process";

let mainWindow: BrowserWindow | null = null;
let server: ChildProcess | null = null;
let serverPort = 0;

/** 打包资源路径 vs 开发路径 */
function bunExe(): string {
  return app.isPackaged ? join(process.resourcesPath, "bun", "bun.exe") : "bun";
}
function serverEntry(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "server", "server.mjs")
    : join(__dirname, "server.mjs");
}
function studioDistDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "studio")
    : join(__dirname, "..", "..", "studio", "dist");
}

/** 启动视频引擎 sidecar，解析端口 */
function startVideoServer(): Promise<number> {
  const args = [serverEntry()];
  const projectArg = process.env.VIDEOOS_PROJECT;
  if (projectArg !== undefined && projectArg.length > 0) args.push("--project", projectArg);

  return new Promise<number>((resolvePromise, rejectPromise) => {
    let child: ChildProcess;
    try {
      child = spawn(bunExe(), args, {
        cwd: app.getPath("userData"),
        env: { ...process.env, VIDEOOS_STUDIO_DIST: studioDistDir() },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (err) {
      rejectPromise(new Error(`failed to spawn video engine: ${err instanceof Error ? err.message : String(err)}`));
      return;
    }
    server = child;

    let pending = "";
    const timer = setTimeout(() => {
      rejectPromise(new Error("video engine boot timeout (20s)"));
    }, 20_000);

    child.stdout?.on("data", (chunk: Buffer) => {
      pending += chunk.toString("utf8");
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("VIDEOOS_SERVER_READY ")) {
          clearTimeout(timer);
          try {
            const info = JSON.parse(line.slice("VIDEOOS_SERVER_READY ".length)) as { port: number };
            serverPort = info.port;
            resolvePromise(info.port);
          } catch {
            clearTimeout(timer);
            rejectPromise(new Error(`bad readiness line from engine: ${line.trim()}`));
          }
          return;
        }
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      console.error(`[videoos-engine] ${chunk.toString("utf8").trim()}`);
    });
    child.on("exit", (code) => {
      if (serverPort === 0) {
        clearTimeout(timer);
        rejectPromise(new Error(`video engine exited during boot (code ${String(code)})`));
      } else {
        console.error(`[videoos-engine] exited (code ${String(code)}) — quitting`);
        app.quit();
      }
    });
  });
}

function createWindow(port: number): void {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1180,
    minHeight: 720,
    backgroundColor: "#0B0F16",
    title: "VideoOS Studio",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  void mainWindow.loadURL(`http://127.0.0.1:${String(port)}/`);
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  // 外链一律走系统浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://127.0.0.1:") || url.startsWith("http://localhost:")) {
      return { action: "allow" };
    }
    void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  if (!app.isPackaged) {
    mainWindow.webContents.once("did-finish-load", () => {
      mainWindow?.webContents.openDevTools({ mode: "detach" });
    });
  }
}

// ---- 桌面桥（preload 暴露给 Studio UI）----
ipcMain.handle("desktop:select-project-root", async (): Promise<string | null> => {
  const picked = await dialog.showOpenDialog({
    title: "Open VideoOS project",
    properties: ["openDirectory"],
  });
  if (picked.canceled || picked.filePaths.length === 0) return null;
  return picked.filePaths[0] ?? null;
});
ipcMain.handle("desktop:select-directory", async (): Promise<string | null> => {
  const picked = await dialog.showOpenDialog({
    title: "Choose a folder",
    properties: ["openDirectory", "createDirectory"],
  });
  if (picked.canceled || picked.filePaths.length === 0) return null;
  return picked.filePaths[0] ?? null;
});
ipcMain.handle("desktop:app-info", (): { version: string; platform: string } => ({
  version: app.getVersion(),
  platform: process.platform,
}));

// ---- 生命周期 ----
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow !== null) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    startVideoServer()
      .then((port) => {
        createWindow(port);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        dialog.showErrorBox("VideoOS Studio — engine failed", `Video engine failed to start:\n${message}`);
        app.quit();
      });
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0 && serverPort !== 0) createWindow(serverPort);
    });
  });
}

app.on("window-all-closed", () => {
  app.quit();
});
app.on("before-quit", () => {
  if (server !== null && server.exitCode === null) {
    try {
      server.kill();
    } catch {
      // best-effort
    }
  }
});
