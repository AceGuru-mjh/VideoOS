// PrivacySettingsPage (S6, v0.2 §5 issue #57): the settings center 隐私与数据
// page — telemetry (默认关闭) / crashReports / logLevel / retention numbers
// (PATCH settings.privacy, instant save) and the 一键清除 row: 清除全部会话
// (confirm → DELETE each session → refresh), 清除缓存 (confirm → direct tool
// invocation cache.clear → result summary) and 恢复默认设置 (ResetButton).
import { useState } from "react";
import * as api from "../../api";
import { useStudio } from "../../store";
import { Button, Modal, Spinner } from "../ui";
import { NumberField, SelectField, SettingsError, SettingsRow, SettingsSection, SwitchRow, useSectionPatch } from "./fields";
import { ResetButton } from "./ResetButton";

export function PrivacySettingsPage(): JSX.Element {
  const values = useStudio((s) => s.settings.values);
  const sessions = useStudio((s) => s.sessions);
  const loadSessions = useStudio((s) => s.loadSessions);
  const { error, patch } = useSectionPatch("privacy");

  const [confirmSessions, setConfirmSessions] = useState(false);
  const [clearingSessions, setClearingSessions] = useState(false);
  const [sessionsResult, setSessionsResult] = useState<string | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  const [confirmCache, setConfirmCache] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);
  const [cacheResult, setCacheResult] = useState<string | null>(null);
  const [cacheError, setCacheError] = useState<string | null>(null);

  if (values === null) return <div className="set-loading">设置加载中…</div>;
  const privacy = values.privacy;
  if (privacy === undefined) return <div className="set-loading">设置加载中…</div>;

  const clearSessions = async (): Promise<void> => {
    if (clearingSessions) return;
    setClearingSessions(true);
    setSessionsError(null);
    let deleted = 0;
    let failed = 0;
    for (const s of useStudio.getState().sessions) {
      try {
        await api.deleteSession(s.id);
        deleted += 1;
      } catch {
        failed += 1;
      }
    }
    await loadSessions();
    setClearingSessions(false);
    setConfirmSessions(false);
    setSessionsResult(failed > 0 ? `已删除 ${deleted} 个会话，${failed} 个失败` : `已删除 ${deleted} 个会话`);
  };

  const clearCache = async (): Promise<void> => {
    if (clearingCache) return;
    setClearingCache(true);
    setCacheError(null);
    try {
      const res = await api.invokeTool("cache.clear", {});
      if (res.ok) {
        const data = (res.data ?? {}) as { cacheRoot?: unknown; cleared?: unknown };
        const root = typeof data.cacheRoot === "string" ? data.cacheRoot : "";
        setCacheResult(`缓存已清空${root.length > 0 ? ` — ${root}` : ""}`);
        setConfirmCache(false);
      } else {
        setCacheError(`清除失败：${res.error ?? "未知错误"}`);
      }
    } catch (e) {
      setCacheError(`清除失败：${api.errorMessage(e)}（渲染缓存属于项目，需先在 IDE 或对话中打开项目）`);
    } finally {
      setClearingCache(false);
    }
  };

  return (
    <>
      <SettingsSection title="隐私" hint="VideoOS 默认不发送任何遥测数据">
        <SettingsRow label="遥测数据" hint="匿名使用统计 — 已默认关闭，开启后将随服务端运行上报">
          <SwitchRow checked={privacy.telemetry} onChange={(v) => void patch("telemetry", v)} label="发送匿名遥测" />
        </SettingsRow>
        <SettingsRow label="崩溃报告" hint="运行异常时自动附带上下文上报，帮助定位问题">
          <SwitchRow checked={privacy.crashReports} onChange={(v) => void patch("crashReports", v)} label="发送崩溃报告" />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="日志与会话保留" hint="超出保留期的数据在服务端启动时清理">
        <SettingsRow label="日志级别" htmlFor="set-loglevel">
          <SelectField
            id="set-loglevel"
            value={privacy.logLevel}
            ariaLabel="服务端日志级别"
            width={220}
            options={[
              { value: "debug", label: "debug · 全量" },
              { value: "info", label: "info（默认）" },
              { value: "warn", label: "warn · 仅警告" },
              { value: "error", label: "error · 仅错误" },
            ]}
            onChange={(v) => void patch("logLevel", v)}
          />
        </SettingsRow>
        <SettingsRow label="日志保留" htmlFor="set-logdays" hint="服务端日志文件的保留天数（1-365）">
          <NumberField id="set-logdays" value={privacy.logRetentionDays} min={1} max={365} unit="天" ariaLabel="日志保留天数" onCommit={(v) => void patch("logRetentionDays", v)} />
        </SettingsRow>
        <SettingsRow label="会话保留" htmlFor="set-sessiondays" hint="历史对话的保留天数，0 表示永久保留">
          <NumberField id="set-sessiondays" value={privacy.sessionRetentionDays} min={0} max={3650} unit="天" ariaLabel="会话保留天数" onCommit={(v) => void patch("sessionRetentionDays", v)} />
        </SettingsRow>
      </SettingsSection>
      <SettingsError error={error} />

      <SettingsSection title="一键清除" hint="破坏性操作 — 均需二次确认">
        <div className="set-danger-row">
          <Button className="danger" onClick={() => { setSessionsError(null); setConfirmSessions(true); }} disabled={sessions.length === 0}>
            清除全部会话
          </Button>
          <span className="set-row-hint inline">
            {sessions.length > 0 ? `将删除当前服务端的 ${sessions.length} 个对话及其全部消息` : "当前没有已保存的会话"}
          </span>
        </div>
        {sessionsResult !== null ? <div className="set-ok-line">{sessionsResult}</div> : null}
        <SettingsError error={sessionsError} />
        <div className="set-danger-row">
          <Button className="danger" onClick={() => { setCacheError(null); setConfirmCache(true); }}>
            清除渲染缓存
          </Button>
          <span className="set-row-hint inline">删除当前项目 .video/cache 的内容寻址缓存（下次渲染重新生成）</span>
        </div>
        {cacheResult !== null ? <div className="set-ok-line">{cacheResult}</div> : null}
        <SettingsError error={cacheError} />
        <div className="set-danger-row">
          <ResetButton label="恢复默认设置" />
          <span className="set-row-hint inline">九大类设置恢复为出厂默认值（API Key 安全存储保留）</span>
        </div>
      </SettingsSection>

      {confirmSessions ? (
        <Modal title="清除全部会话" onClose={() => (clearingSessions ? undefined : setConfirmSessions(false))}>
          <p className="wiz-confirm-text">
            将删除当前服务端保存的全部 {sessions.length} 个对话（含消息与任务记录），此操作不可撤销。确定继续吗？
          </p>
          <div className="wiz-actions end">
            <Button disabled={clearingSessions} onClick={() => setConfirmSessions(false)}>
              取消
            </Button>
            <Button variant="primary" disabled={clearingSessions} onClick={() => void clearSessions()}>
              {clearingSessions ? <Spinner label="清除中…" /> : "全部删除"}
            </Button>
          </div>
        </Modal>
      ) : null}

      {confirmCache ? (
        <Modal title="清除渲染缓存" onClose={() => (clearingCache ? undefined : setConfirmCache(false))}>
          <p className="wiz-confirm-text">将删除当前项目 .video/cache 下的全部缓存帧与产物。缓存命中可加速重复渲染，清除后下次渲染将全量重算。确定继续吗？</p>
          {cacheError !== null ? (
            <div className="set-error" role="alert">
              {cacheError}
            </div>
          ) : null}
          <div className="wiz-actions end">
            <Button disabled={clearingCache} onClick={() => setConfirmCache(false)}>
              取消
            </Button>
            <Button variant="primary" disabled={clearingCache} onClick={() => void clearCache()}>
              {clearingCache ? <Spinner label="清除中…" /> : "清除缓存"}
            </Button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
