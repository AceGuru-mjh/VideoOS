// 中文总词典 = common（既有 UI）+ chat（对话子系统）；段所有权互斥（测试保证）。
import { mergeDicts, type Dictionary } from "./core";
import { zhChat } from "./locales/zh-chat";
import { zhCommon } from "./locales/zh-common";

export const zh: Dictionary = mergeDicts(zhCommon, zhChat);
