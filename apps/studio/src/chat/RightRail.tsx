// 右栏（#51/#52/#53）：Skills + MCP 两张折叠卡堆叠；
// 预留 S5 可视化面板插槽（preview / timeline / pipeline / usage —— 见下方注释）。
import { useEffect, useState } from "react";
import { useStudio } from "../store";
import { useI18n } from "../i18n";
import { McpPanel } from "./McpPanel";
import { SkillsPanel } from "./SkillsPanel";

export function RightRail(): JSX.Element {
  const { t } = useI18n();
  const railCollapsed = useStudio((s) => s.railCollapsed);
  const loadMcpStatus = useStudio((s) => s.loadMcpStatus);
  const [skillsOpen, setSkillsOpen] = useState(true);
  const [mcpOpen, setMcpOpen] = useState(true);

  // 「可见时」刷新：右栏从折叠恢复展开时重拉 MCP 状态（挂载时 McpPanel 自会拉取）
  useEffect(() => {
    if (!railCollapsed) void loadMcpStatus();
  }, [railCollapsed, loadMcpStatus]);

  return (
    <aside className="chat-rail" aria-label={t("modes.toggleRail")}>
      <SkillsPanel open={skillsOpen} onToggle={() => setSkillsOpen((v) => !v)} />
      <McpPanel open={mcpOpen} onToggle={() => setMcpOpen((v) => !v)} />
      {/* S5 可视化面板插槽：preview / timeline / pipeline / usage 将在此挂载 */}
      <section className="section rail-card rail-placeholder">
        <header className="section-header rail-card-head">
          <span>{t("chat.visualizationTitle")}</span>
        </header>
        <div className="rail-body">
          <span className="empty-note">{t("chat.visualizationComing")}</span>
        </div>
      </section>
    </aside>
  );
}
