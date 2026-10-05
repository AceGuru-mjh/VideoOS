// 任务卡（#51）：Agent 每步一张紧凑卡 —— 状态图标 + 本地化标签 + 耗时 + 产物数。
// 标签本地化模式（重要）：taskCardLabels 是「平铺 dotted-key 映射」
// （{"compile.run": "编译"}）。t() 按点路径逐段下钻无法命中这种平铺键
// （t("chat.taskCardLabels.compile.run") 会找 labels.compile.run → miss），
// 因此按 locale 直接挑选总词典（zh / en），再用 section() 取原始记录整表查词；
// 未知 step 回退协议层稳定英文 label（card.label）。
import { useMemo } from "react";
import { section } from "../i18n/core";
import { useI18n } from "../i18n";
import { en } from "../i18n/en";
import { zh } from "../i18n/zh";
import type * as api from "../api";
import { fmtDuration } from "./ui";

export function useTaskCardLabels(): Record<string, string> {
  const { locale } = useI18n();
  return useMemo(() => section(locale === "zh" ? zh : en, "chat.taskCardLabels") ?? {}, [locale]);
}

export function TaskCardView({
  card,
  expanded,
  onToggleExpand,
}: {
  card: api.TaskCardEntry;
  /** 该卡产物是否已展开（由父级 MessageView 持有） */
  expanded: boolean;
  /** 点击带产物的已完成卡 → 请求父级展开/收起其产物 */
  onToggleExpand: (card: api.TaskCardEntry) => void;
}): JSX.Element {
  const labels = useTaskCardLabels();
  const label = labels[card.step] ?? card.label;
  const artifactCount = card.artifacts?.length ?? 0;
  const expandable = card.status === "done" && artifactCount > 0;

  return (
    <button
      type="button"
      className={`task-card ${card.status}${expandable ? " clickable" : ""}${expanded ? " expanded" : ""}`}
      title={expandable ? label : undefined}
      disabled={!expandable}
      aria-expanded={expandable ? expanded : undefined}
      onClick={expandable ? () => onToggleExpand(card) : undefined}
    >
      <span className="tc-icon" aria-hidden="true">
        {card.status === "running" ? <span className="spinner" /> : card.status === "pending" ? "○" : card.status === "done" ? "●" : "●"}
      </span>
      <span className="tc-label">{label}</span>
      {card.durationMs !== undefined ? <span className="tc-duration">{fmtDuration(card.durationMs)}</span> : null}
      {artifactCount > 0 ? <span className="tc-count">{artifactCount}</span> : null}
    </button>
  );
}
