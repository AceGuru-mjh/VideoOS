// 单一版本源（Single Source of Truth）：
// 运行时对用户可见的版本（CLI --version、/api/health、桌面 app-info）全部读这里；
// 发版时 release 工作流自动 bump 本常量并同步 apps/*/package.json（提交
// chore(release) 提交 + 打 tag），version.test.ts 在 CI 守护任何漂移。
// 内部库（compiler/render 等 package.json 0.1.x）不属于用户可见版本，不在此管辖。
export const VIDEOOS_VERSION = "0.2.0";
