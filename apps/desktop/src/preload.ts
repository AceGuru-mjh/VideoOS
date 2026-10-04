// 预加载：向 Studio UI 暴露最小桌面桥（contextIsolation 开启，无 nodeIntegration）。
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("videoosDesktop", {
  isDesktop: true as const,
  selectProjectRoot: (): Promise<string | null> => ipcRenderer.invoke("desktop:select-project-root"),
  selectDirectory: (): Promise<string | null> => ipcRenderer.invoke("desktop:select-directory"),
  appInfo: (): Promise<{ version: string; platform: string }> => ipcRenderer.invoke("desktop:app-info"),
});
