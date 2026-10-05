// ChatView（#51 主 UI）：三栏布局 —— 左 240px 会话 / 中弹性对话流 / 右 300px 栏
// （两侧均可收起；≤900px 右栏隐藏、≤640px 会话栏变为抽屉覆盖层）。
// 挂载时：loadSessions + 恢复/新建初始会话（无会话则建一个「新对话」），
// 并预取 skills 与 settings（@ 补全与 autoTrigger/mergeTools 开关即取即用）。
// 无项目时可正常浏览会话 —— ChatFlow 顶部给出「打开项目」提示，不阻断对话。
import { useEffect, useState } from "react";
import { useStudio } from "../store";
import { useI18n } from "../i18n";
import { Button } from "../components/ui";
import { ChatFlow } from "./ChatFlow";
import { RightRail } from "./RightRail";
import { SessionList } from "./SessionList";

/** StrictMode 双调用效应防护：会话引导只跑一次 */
let chatViewBooted = false;

export function ChatView(): JSX.Element {
  const { t } = useI18n();
  const sessions = useStudio((s) => s.chatSessions);
  const activeSessionId = useStudio((s) => s.activeSessionId);
  const railCollapsed = useStudio((s) => s.railCollapsed);
  const sessionsCollapsed = useStudio((s) => s.sessionsCollapsed);
  const setRailCollapsed = useStudio((s) => s.setRailCollapsed);
  const setSessionsCollapsed = useStudio((s) => s.setSessionsCollapsed);
  const createSession = useStudio((s) => s.createSession);

  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (chatViewBooted) return;
    chatViewBooted = true;
    const st = useStudio.getState();
    void st.loadSkills();
    void st.loadSettings();
    void (async () => {
      await st.loadSessions();
      const s = useStudio.getState();
      if (s.activeSessionId !== null) return;
      if (s.chatSessions.length > 0) {
        await s.selectSession(s.chatSessions[0].id);
      } else {
        await s.createSession(t("chat.newChat"));
      }
    })();
  }, [t]);

  const activeTitle = sessions.find((s) => s.id === activeSessionId)?.title ?? t("chat.sessionTitle");

  return (
    <main
      className={`chat-layout${sessionsCollapsed ? " sessions-collapsed" : ""}${railCollapsed ? " rail-collapsed" : ""}${drawerOpen ? " drawer-open" : ""}`}
    >
      <aside className="session-col" aria-label={t("chat.sessionsTitle")}>
        <header className="section-header session-col-head">
          <span>{t("chat.sessionsTitle")}</span>
          <span className="section-actions">
            <Button small ghost title={t("chat.newChat")} onClick={() => void createSession(t("chat.newChat"))}>
              + {t("chat.newChat")}
            </Button>
          </span>
        </header>
        <SessionList />
      </aside>
      {drawerOpen ? <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} aria-hidden="true" /> : null}
      <section className="chat-center">
        <div className="chat-toolbar">
          <button
            type="button"
            className="icon-btn drawer-toggle-btn"
            title={t("modes.openDrawer")}
            aria-label={t("modes.openDrawer")}
            onClick={() => setDrawerOpen(true)}
          >
            ≡
          </button>
          <button
            type="button"
            className="icon-btn sessions-toggle-btn"
            title={t("modes.toggleSessions")}
            aria-label={t("modes.toggleSessions")}
            onClick={() => setSessionsCollapsed(!sessionsCollapsed)}
          >
            {sessionsCollapsed ? "»" : "«"}
          </button>
          <span className="chat-toolbar-title" title={activeTitle}>
            {activeTitle}
          </span>
          <button
            type="button"
            className="icon-btn rail-toggle-btn"
            title={t("modes.toggleRail")}
            aria-label={t("modes.toggleRail")}
            onClick={() => setRailCollapsed(!railCollapsed)}
          >
            {railCollapsed ? "«" : "»"}
          </button>
        </div>
        <ChatFlow />
      </section>
      <aside className="rail-col">
        <RightRail />
      </aside>
    </main>
  );
}
