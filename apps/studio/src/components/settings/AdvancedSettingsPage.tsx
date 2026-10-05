// AdvancedSettingsPage (S6, v0.2 §5 issue #57): the settings center 高级 page —
// 配置编辑器 (「编辑 JSON」 modal: full nine-section JSON, client-side
// validation, PUT /api/settings full replace → re-apply), 日志查看器 (last
// 100 server events from GET /api/events, mono, auto-scroll bottom, refresh),
// 缓存统计 (direct tool invocation cache.stats → pretty JSON) and 关于
// (server version from /api/health, repo link, settings data dir hint).
// i18n: settings.advanced.* keys; validateSettingsJson is a pure function with
// an injected TranslateFn (McpSettingsPage validateRows 惯例); event summary
// lines stay technical (EventsPanel.summarize mirror). Async error strings are
// localized at set time through useApiErrorMessage.
import { useEffect, useRef, useState } from "react";
import * as api from "../../api";
import { useStudio } from "../../store";
import { SETTINGS_SECTIONS, type SettingsValues } from "../../settings";
import { useI18n } from "../../i18n";
import { useApiErrorMessage } from "../../i18n/errors";
import type { TranslateFn } from "../../i18n/format";
import { Button, Modal, Spinner } from "../ui";
import { SettingsSection } from "./fields";

/** compact one-line payload for the log viewer (mirror of EventsPanel.summarize) */
function eventSummary(e: api.ServerEvent): string {
  switch (e.type) {
    case "server":
      return e.message;
    case "vap":
      return `${e.event.kind}${e.event.tool !== undefined ? ` ${e.event.tool}` : ""}${
        e.event.detail !== undefined ? ` ${JSON.stringify(e.event.detail).slice(0, 110)}` : ""
      }`;
    case "compile":
      return `${e.ok ? "ok" : "FAILED"} · ${e.totalFrames}f / ${e.durationSeconds.toFixed(1)}s`;
    case "render-progress":
      return `${e.phase} · frame ${e.frame}/${e.totalFrames}`;
    case "render-done":
      return `${e.frames} frames · cache ${e.cacheHits}✓/${e.cacheMisses}✗ · ${e.video}`;
    case "render-error":
      return e.error;
    case "test-done":
      return `${e.totalPassed} passed / ${e.totalFailed} failed`;
    case "agent-done":
      return `${e.ok ? "ok" : "FAILED"} · ${e.toolCallCount} tools · ${e.summary.slice(0, 90)}`;
    case "agent-run-start":
      return `run ${e.runId.slice(0, 8)} · session ${e.sessionId.slice(0, 8)}`;
    case "agent-text":
      return `text · ${e.text.slice(0, 100)}`;
    case "agent-tool":
      return `${e.name} ${e.status}${e.durationMs !== undefined ? ` · ${e.durationMs}ms` : ""}`;
    case "agent-run-done":
      return `${e.ok ? "ok" : "stopped"} · ${e.steps} steps${e.error !== undefined ? ` · ${e.error.slice(0, 80)}` : ""}`;
    case "agent-confirm":
      return `${e.tool.name} · confirm ${e.confirmId.slice(0, 8)} · run ${e.runId.slice(0, 8)}`;
    case "agent-resolved":
      return `${e.decision} · ${e.confirmId.slice(0, 8)}`;
  }
}

function eventTime(e: api.ServerEvent): string {
  // only vap events carry a timestamp in the current contract — others show —
  return e.type === "vap" ? e.event.at : "";
}

/** JSON.parse + nine-section presence check → readable error or the object.
 *  Pure module function with an injected translate (t) — 错误文案走
 *  settings.advanced.err* 词典键；列表分隔符随 locale（settings.advanced.sectionsSep）。 */
function validateSettingsJson(text: string, t: TranslateFn): { values: SettingsValues } | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { error: t("settings.advanced.errJsonParse", { msg: err instanceof Error ? err.message : String(err) }) };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: t("settings.advanced.errNotObject") };
  }
  const obj = parsed as Record<string, unknown>;
  const missing = SETTINGS_SECTIONS.filter((s) => obj[s] === undefined || obj[s] === null || typeof obj[s] !== "object");
  if (missing.length > 0) {
    return { error: t("settings.advanced.errMissingSections", { sections: missing.join(t("settings.advanced.sectionsSep")) }) };
  }
  return { values: parsed as SettingsValues };
}

export function AdvancedSettingsPage(): JSX.Element {
  const values = useStudio((s) => s.settings.values);
  const applySettingsValues = useStudio((s) => s.applySettingsValues);
  const { t } = useI18n();
  const errText = useApiErrorMessage();

  // ---- JSON editor --------------------------------------------------------
  const [jsonOpen, setJsonOpen] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [jsonBusy, setJsonBusy] = useState(false);

  const openJson = (): void => {
    setJsonText(values === null ? "" : JSON.stringify(values, null, 2));
    setJsonError(null);
    setJsonOpen(true);
  };

  const saveJson = async (): Promise<void> => {
    if (jsonBusy) return;
    const checked = validateSettingsJson(jsonText, t);
    if ("error" in checked) {
      setJsonError(checked.error);
      return;
    }
    setJsonBusy(true);
    setJsonError(null);
    try {
      const saved = await api.putSettings(checked.values);
      applySettingsValues(saved);
      setJsonOpen(false);
    } catch (e) {
      const raw = api.errorMessage(e);
      setJsonError(t("settings.advanced.errSave", { msg: errText(raw) ?? raw }));
    } finally {
      setJsonBusy(false);
    }
  };

  // ---- log viewer ---------------------------------------------------------
  const [events, setEvents] = useState<api.ServerEvent[] | null>(null);
  const [eventsBusy, setEventsBusy] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);

  const loadEvents = async (): Promise<void> => {
    if (eventsBusy) return;
    setEventsBusy(true);
    const list = await api.fetchEventLog();
    setEvents(list === null ? null : list.slice(-100));
    setEventsBusy(false);
  };

  useEffect(() => {
    void loadEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (logRef.current !== null) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [events]);

  // ---- cache stats ---------------------------------------------------------
  const [cacheBusy, setCacheBusy] = useState(false);
  const [cacheResult, setCacheResult] = useState<string | null>(null);
  const [cacheError, setCacheError] = useState<string | null>(null);

  const loadCacheStats = async (): Promise<void> => {
    if (cacheBusy) return;
    setCacheBusy(true);
    setCacheError(null);
    try {
      const res = await api.invokeTool("cache.stats", {});
      if (res.ok) {
        setCacheResult(JSON.stringify(res.data ?? {}, null, 2));
      } else {
        setCacheError(t("settings.advanced.cacheQueryFailed", { msg: res.error ?? t("settings.unknownError") }));
      }
    } catch (e) {
      const raw = api.errorMessage(e);
      setCacheError(t("settings.advanced.cacheQueryFailedNoProject", { msg: errText(raw) ?? raw }));
    } finally {
      setCacheBusy(false);
    }
  };

  // ---- about ---------------------------------------------------------------
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .getHealth()
      .then((h) => {
        if (alive) setVersion(h.version);
      })
      .catch(() => {
        if (alive) setVersion(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <>
      <SettingsSection title={t("settings.advanced.jsonTitle")} hint={t("settings.advanced.jsonHint")}>
        <div className="set-danger-row">
          <Button onClick={openJson} disabled={values === null}>
            {t("settings.advanced.editJson")}
          </Button>
          <span className="set-row-hint inline">
            {t("settings.advanced.includesPrefix")} {SETTINGS_SECTIONS.join(" / ")}
          </span>
        </div>
      </SettingsSection>

      <SettingsSection title={t("settings.advanced.logsTitle")} hint={t("settings.advanced.logsHint")}>
        <div className="set-danger-row">
          <Button small ghost disabled={eventsBusy} onClick={() => void loadEvents()}>
            {eventsBusy ? <Spinner /> : null}
            {t("settings.advanced.refresh")}
          </Button>
          {events === null ? (
            <span className="set-row-hint inline">{t("settings.advanced.eventsUnavailable")}</span>
          ) : (
            <span className="set-row-hint inline">{t("settings.advanced.eventsCount", { n: events.length })}</span>
          )}
        </div>
        <div className="set-log" ref={logRef} role="log" aria-label={t("settings.advanced.logAria")}>
          {events === null ? (
            <div className="set-log-empty">{t("settings.advanced.logEmptyUnavailable")}</div>
          ) : events.length === 0 ? (
            <div className="set-log-empty">{t("settings.advanced.logEmptyNone")}</div>
          ) : (
            events.map((e, i) => {
              const time = eventTime(e);
              return (
                <div className="set-log-row" key={`${i}-${e.type}`}>
                  <span className="set-log-idx">{String(i + 1).padStart(3, "0")}</span>
                  <span className="set-log-type">{e.type}</span>
                  <span className="set-log-time">{time.length > 0 ? time : "—"}</span>
                  <span className="set-log-text">{eventSummary(e)}</span>
                </div>
              );
            })
          )}
        </div>
      </SettingsSection>

      <SettingsSection title={t("settings.advanced.cacheTitle")} hint={t("settings.advanced.cacheHint")}>
        <div className="set-danger-row">
          <Button small ghost disabled={cacheBusy} onClick={() => void loadCacheStats()}>
            {cacheBusy ? <Spinner /> : null}
            {t("settings.advanced.queryCache")}
          </Button>
          {cacheError !== null ? <span className="set-row-hint inline err">{cacheError}</span> : null}
        </div>
        {cacheResult !== null ? (
          <pre className="set-pre mono">{cacheResult}</pre>
        ) : null}
      </SettingsSection>

      <SettingsSection title={t("settings.advanced.aboutTitle")} hint={t("settings.advanced.aboutHint")}>
        <div className="set-about">
          <div className="set-about-row">
            <span className="set-about-k">{t("settings.advanced.versionLabel")}</span>
            <span className="set-about-v mono">{version ?? t("settings.advanced.versionUnknown")}</span>
          </div>
          <div className="set-about-row">
            <span className="set-about-k">{t("settings.advanced.repoLabel")}</span>
            <a className="set-about-link" href="https://github.com/AceGuru-mjh/VideoOS" target="_blank" rel="noreferrer">
              github.com/AceGuru-mjh/VideoOS
            </a>
          </div>
          <div className="set-about-row">
            <span className="set-about-k">{t("settings.advanced.storageLabel")}</span>
            <span className="set-about-v">{t("settings.advanced.storageValue")}</span>
          </div>
          <div className="set-about-row">
            <span className="set-about-k">{t("settings.advanced.feedbackLabel")}</span>
            <a className="set-about-link" href="https://github.com/AceGuru-mjh/VideoOS/issues" target="_blank" rel="noreferrer">
              GitHub Issues
            </a>
          </div>
        </div>
      </SettingsSection>

      {jsonOpen ? (
        <Modal title={t("settings.advanced.jsonModalTitle")} wide onClose={() => (jsonBusy ? undefined : setJsonOpen(false))}>
          <p className="wiz-confirm-text">{t("settings.advanced.jsonModalText")}</p>
          <textarea
            className="set-json-text mono"
            rows={18}
            spellCheck={false}
            value={jsonText}
            aria-label={t("settings.advanced.jsonTextareaAria")}
            onChange={(e) => setJsonText(e.target.value)}
          />
          {jsonError !== null ? (
            <div className="set-error" role="alert">
              {jsonError}
            </div>
          ) : null}
          <div className="wiz-actions end">
            <Button disabled={jsonBusy} onClick={() => setJsonOpen(false)}>
              {t("settings.cancel")}
            </Button>
            <Button small ghost disabled={jsonBusy} onClick={openJson} title={t("settings.advanced.resetTextTitle")}>
              {t("settings.advanced.resetText")}
            </Button>
            <Button variant="primary" disabled={jsonBusy || jsonText.trim().length === 0} onClick={() => void saveJson()}>
              {jsonBusy ? t("settings.advanced.saving") : t("settings.advanced.saveAll")}
            </Button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
