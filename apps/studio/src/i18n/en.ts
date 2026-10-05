// English master dictionary = common (existing UI) + chat (chat subsystem); section ownership is exclusive (test-enforced).
import { mergeDicts, type Dictionary } from "./core";
import { enChat } from "./locales/en-chat";
import { enCommon } from "./locales/en-common";

export const en: Dictionary = mergeDicts(enCommon, enChat);
