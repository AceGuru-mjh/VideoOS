// Electron 桌面桥（apps/desktop/src/preload.ts 注入；浏览器/预览模式下不存在）
export {};

declare global {
  interface Window {
    videoosDesktop?: {
      isDesktop: true;
      selectProjectRoot: () => Promise<string | null>;
      selectDirectory: () => Promise<string | null>;
      appInfo: () => Promise<{ version: string; platform: string }>;
    };
  }
}
