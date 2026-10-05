// AdvancedSettingsPage (S6, v0.2 §5 issue #57): the settings center 高级 page —
// 配置编辑器 (「编辑 JSON」 modal: full nine-section JSON, client-side
// validation, PUT /api/settings full replace → re-apply), 日志查看器 (last
// 100 server events from GET /api/events, mono, auto-scroll bottom, refresh),
// 缓存统计 (direct tool invocation cache.stats → pretty JSON) and 关于
// (server version from /api/health, repo link, settings data dir hint).
import { useEffect, useRef, useState } from "react";
import * as api from "../../api";
import { useStudio } from "../../store";
import { SETTINGS_SECTIONS, type SettingsValues } from "../../settings";
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

/** JSON.parse + nine-section presence check → readable error or the object */
function validateSettingsJson(text: string): { values: SettingsValues } | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { error: `JSON 解析失败：${err instanceof Error ? err.message : String(err)}` };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: "顶层必须是 JSON 对象（九大类设置）" };
  }
  const obj = parsed as Record<string, unknown>;
  const missing = SETTINGS_SECTIONS.filter((s) => obj[s] === undefined || obj[s] === null || typeof obj[s] !== "object");
  if (missing.length > 0) {
    return { error: `缺少设置节：${missing.join("、")}（PUT 为全量替换，九节必须齐全）` };
  }
  return { values: parsed as SettingsValues };
}

export function AdvancedSettingsPage(): JSX.Element {
  const values = useStudio((s) => s.settings.values);
  const applySettingsValues = useStudio((s) => s.applySettingsValues);

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
    const checked = validateSettingsJson(jsonText);
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
      setJsonError(`保存失败：${api.errorMessage(e)}`);
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
        setCacheError(`查询失败：${res.error ?? "未知错误"}`);
      }
    } catch (e) {
      setCacheError(`查询失败：${api.errorMessage(e)}（需先打开项目）`);
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
      <SettingsSection title="配置编辑器" hint="直接编辑九大类设置的 JSON（全量替换，客户端校验后 PUT）">
        <div className="set-danger-row">
          <Button onClick={openJson} disabled={values === null}>
            编辑 JSON
          </Button>
          <span className="set-row-hint inline">包含 general / providers / agent / render / mcp / skills / interface / privacy / advanced</span>
        </div>
      </SettingsSection>

      <SettingsSection title="日志查看器" hint="服务端事件环形缓冲（最近 100 条）">
        <div className="set-danger-row">
          <Button small ghost disabled={eventsBusy} onClick={() => void loadEvents()}>
            {eventsBusy ? <Spinner /> : null}
            刷新
          </Button>
          {events === null ? <span className="set-row-hint inline">事件服务不可用</span> : <span className="set-row-hint inline">{events.length} 条</span>}
        </div>
        <div className="set-log" ref={logRef} role="log" aria-label="服务端事件日志">
          {events === null ? (
            <div className="set-log-empty">事件服务不可用 — 需要运行中的 VideoOS 服务端。</div>
          ) : events.length === 0 ? (
            <div className="set-log-empty">暂无事件 — 打开项目 / 发送消息后产生。</div>
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

      <SettingsSection title="缓存统计" hint="当前项目 .video/cache 内容寻址缓存（entries / bytes / 命名空间细分）">
        <div className="set-danger-row">
          <Button small ghost disabled={cacheBusy} onClick={() => void loadCacheStats()}>
            {cacheBusy ? <Spinner /> : null}
            查询缓存统计
          </Button>
          {cacheError !== null ? <span className="set-row-hint inline err">{cacheError}</span> : null}
        </div>
        {cacheResult !== null ? (
          <pre className="set-pre mono">{cacheResult}</pre>
        ) : null}
      </SettingsSection>

      <SettingsSection title="关于" hint="VideoOS Studio · 对话式视频创作 Agent">
        <div className="set-about">
          <div className="set-about-row">
            <span className="set-about-k">版本</span>
            <span className="set-about-v mono">{version ?? "未知（服务端不可达）"}</span>
          </div>
          <div className="set-about-row">
            <span className="set-about-k">源码仓库</span>
            <a className="set-about-link" href="https://github.com/AceGuru-mjh/VideoOS" target="_blank" rel="noreferrer">
              github.com/AceGuru-mjh/VideoOS
            </a>
          </div>
          <div className="set-about-row">
            <span className="set-about-k">设置存储</span>
            <span className="set-about-v">
              服务端数据目录（VIDEOOS_DATA_DIR，默认 &lt;服务端工作目录&gt;/.videoos）下的 settings.json；API Key 单独存于 settings.secure.json（0600）
            </span>
          </div>
          <div className="set-about-row">
            <span className="set-about-k">问题反馈</span>
            <a className="set-about-link" href="https://github.com/AceGuru-mjh/VideoOS/issues" target="_blank" rel="noreferrer">
              GitHub Issues
            </a>
          </div>
        </div>
      </SettingsSection>

      {jsonOpen ? (
        <Modal title="编辑配置 JSON" wide onClose={() => (jsonBusy ? undefined : setJsonOpen(false))}>
          <p className="wiz-confirm-text">
            全量替换九大类设置（PUT /api/settings）。语法与九节齐全性在此校验，字段值由服务端 schema 最终校验；providers API Key 不在此文件中。
          </p>
          <textarea
            className="set-json-text mono"
            rows={18}
            spellCheck={false}
            value={jsonText}
            aria-label="设置 JSON"
            onChange={(e) => setJsonText(e.target.value)}
          />
          {jsonError !== null ? (
            <div className="set-error" role="alert">
              {jsonError}
            </div>
          ) : null}
          <div className="wiz-actions end">
            <Button disabled={jsonBusy} onClick={() => setJsonOpen(false)}>
              取消
            </Button>
            <Button small ghost disabled={jsonBusy} onClick={openJson} title="重新载入当前设置（放弃未保存的修改）">
              重置文本
            </Button>
            <Button variant="primary" disabled={jsonBusy || jsonText.trim().length === 0} onClick={() => void saveJson()}>
              {jsonBusy ? "保存中…" : "保存全部"}
            </Button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
