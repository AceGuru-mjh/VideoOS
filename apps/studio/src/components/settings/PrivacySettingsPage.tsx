// PrivacySettingsPage (S6, v0.2 §5 issue #57): the settings center 隐私与数据
// page — telemetry (默认关闭) / crashReports / logLevel / retention numbers
// (PATCH settings.privacy, instant save) and the 一键清除 row: 清除全部会话
// (confirm → DELETE each session → refresh), 清除缓存 (confirm → direct tool
// invocation cache.clear → result summary) and 恢复默认设置 (ResetButton).
// i18n: settings.privacy.* keys; store section errors render via
// useApiErrorMessage (bare/“CODE: detail” forms); async result/error strings
// are localized at set time (16-r6/17-c set-time snapshot 惯例).
import { useState } from "react";
import * as api from "../../api";
import { useStudio } from "../../store";
import { useI18n } from "../../i18n";
import { useApiErrorMessage } from "../../i18n/errors";
import { Button, Modal, Spinner } from "../ui";
import { NumberField, SelectField, SettingsError, SettingsRow, SettingsSection, SwitchRow, useSectionPatch } from "./fields";
import { ResetButton } from "./ResetButton";

export function PrivacySettingsPage(): JSX.Element {
  const values = useStudio((s) => s.settings.values);
  const sessions = useStudio((s) => s.sessions);
  const loadSessions = useStudio((s) => s.loadSessions);
  const { error, patch } = useSectionPatch("privacy");
  const { t } = useI18n();
  const errText = useApiErrorMessage();

  const [confirmSessions, setConfirmSessions] = useState(false);
  const [clearingSessions, setClearingSessions] = useState(false);
  const [sessionsResult, setSessionsResult] = useState<string | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  const [confirmCache, setConfirmCache] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);
  const [cacheResult, setCacheResult] = useState<string | null>(null);
  const [cacheError, setCacheError] = useState<string | null>(null);

  if (values === null) return <div className="set-loading">{t("settings.loading")}</div>;
  const privacy = values.privacy;
  if (privacy === undefined) return <div className="set-loading">{t("settings.loading")}</div>;

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
    setSessionsResult(
      failed > 0
        ? t("settings.privacy.sessionsDeletedFailed", { deleted, failed })
        : t("settings.privacy.sessionsDeleted", { n: deleted }),
    );
  };

  const clearCache = async (): Promise<void> => {
    if (clearingCache) return;
    setClearingCache(true);
    setCacheError(null);
    try {
      const res = await api.invokeTool("cache.clear", {});
      if (res.ok) {
        const data = (res.data ?? {}) as { cacheRoot?: unknown };
        const root = typeof data.cacheRoot === "string" ? data.cacheRoot : "";
        setCacheResult(t("settings.privacy.cacheCleared") + (root.length > 0 ? ` — ${root}` : ""));
        setConfirmCache(false);
      } else {
        setCacheError(t("settings.privacy.clearFailed", { msg: res.error ?? t("settings.unknownError") }));
      }
    } catch (e) {
      const raw = api.errorMessage(e);
      setCacheError(t("settings.privacy.clearFailedNoProject", { msg: errText(raw) ?? raw }));
    } finally {
      setClearingCache(false);
    }
  };

  return (
    <>
      <SettingsSection title={t("settings.privacy.title")} hint={t("settings.privacy.hint")}>
        <SettingsRow label={t("settings.privacy.telemetryLabel")} hint={t("settings.privacy.telemetryRowHint")}>
          <SwitchRow checked={privacy.telemetry} onChange={(v) => void patch("telemetry", v)} label={t("settings.privacy.telemetrySwitch")} />
        </SettingsRow>
        <SettingsRow label={t("settings.privacy.crashLabel")} hint={t("settings.privacy.crashRowHint")}>
          <SwitchRow checked={privacy.crashReports} onChange={(v) => void patch("crashReports", v)} label={t("settings.privacy.crashSwitch")} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t("settings.privacy.retentionTitle")} hint={t("settings.privacy.retentionHint")}>
        <SettingsRow label={t("settings.privacy.logLevelLabel")} htmlFor="set-loglevel">
          <SelectField
            id="set-loglevel"
            value={privacy.logLevel}
            ariaLabel={t("settings.privacy.logLevelAria")}
            width={220}
            options={[
              { value: "debug", label: t("settings.privacy.logLevelDebug") },
              { value: "info", label: t("settings.privacy.logLevelInfo") },
              { value: "warn", label: t("settings.privacy.logLevelWarn") },
              { value: "error", label: t("settings.privacy.logLevelError") },
            ]}
            onChange={(v) => void patch("logLevel", v)}
          />
        </SettingsRow>
        <SettingsRow label={t("settings.privacy.logRetentionLabel")} htmlFor="set-logdays" hint={t("settings.privacy.logRetentionHint")}>
          <NumberField id="set-logdays" value={privacy.logRetentionDays} min={1} max={365} unit={t("settings.privacy.logRetentionUnit")} ariaLabel={t("settings.privacy.logRetentionAria")} onCommit={(v) => void patch("logRetentionDays", v)} />
        </SettingsRow>
        <SettingsRow label={t("settings.privacy.sessionRetentionLabel")} htmlFor="set-sessiondays" hint={t("settings.privacy.sessionRetentionHint")}>
          <NumberField id="set-sessiondays" value={privacy.sessionRetentionDays} min={0} max={3650} unit={t("settings.privacy.sessionRetentionUnit")} ariaLabel={t("settings.privacy.sessionRetentionAria")} onCommit={(v) => void patch("sessionRetentionDays", v)} />
        </SettingsRow>
      </SettingsSection>
      <SettingsError error={errText(error)} />

      <SettingsSection title={t("settings.privacy.clearTitle")} hint={t("settings.privacy.clearHint")}>
        <div className="set-danger-row">
          <Button className="danger" onClick={() => { setSessionsError(null); setConfirmSessions(true); }} disabled={sessions.length === 0}>
            {t("settings.privacy.clearSessionsButton")}
          </Button>
          <span className="set-row-hint inline">
            {sessions.length > 0
              ? t("settings.privacy.clearSessionsHint", { n: sessions.length })
              : t("settings.privacy.clearSessionsNone")}
          </span>
        </div>
        {sessionsResult !== null ? <div className="set-ok-line">{sessionsResult}</div> : null}
        <SettingsError error={sessionsError} />
        <div className="set-danger-row">
          <Button className="danger" onClick={() => { setCacheError(null); setConfirmCache(true); }}>
            {t("settings.privacy.clearCacheButton")}
          </Button>
          <span className="set-row-hint inline">{t("settings.privacy.clearCacheHint")}</span>
        </div>
        {cacheResult !== null ? <div className="set-ok-line">{cacheResult}</div> : null}
        <SettingsError error={cacheError} />
        <div className="set-danger-row">
          <ResetButton label={t("settings.privacy.resetLabel")} />
          <span className="set-row-hint inline">{t("settings.privacy.resetHint")}</span>
        </div>
      </SettingsSection>

      {confirmSessions ? (
        <Modal title={t("settings.privacy.confirmSessionsTitle")} onClose={() => (clearingSessions ? undefined : setConfirmSessions(false))}>
          <p className="wiz-confirm-text">{t("settings.privacy.confirmSessionsText", { n: sessions.length })}</p>
          <div className="wiz-actions end">
            <Button disabled={clearingSessions} onClick={() => setConfirmSessions(false)}>
              {t("settings.cancel")}
            </Button>
            <Button variant="primary" disabled={clearingSessions} onClick={() => void clearSessions()}>
              {clearingSessions ? <Spinner label={t("settings.privacy.clearing")} /> : t("settings.privacy.deleteAll")}
            </Button>
          </div>
        </Modal>
      ) : null}

      {confirmCache ? (
        <Modal title={t("settings.privacy.confirmCacheTitle")} onClose={() => (clearingCache ? undefined : setConfirmCache(false))}>
          <p className="wiz-confirm-text">{t("settings.privacy.confirmCacheText")}</p>
          {cacheError !== null ? (
            <div className="set-error" role="alert">
              {cacheError}
            </div>
          ) : null}
          <div className="wiz-actions end">
            <Button disabled={clearingCache} onClick={() => setConfirmCache(false)}>
              {t("settings.cancel")}
            </Button>
            <Button variant="primary" disabled={clearingCache} onClick={() => void clearCache()}>
              {clearingCache ? <Spinner label={t("settings.privacy.clearing")} /> : t("settings.privacy.confirmCacheButton")}
            </Button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
