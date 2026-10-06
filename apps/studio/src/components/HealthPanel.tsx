// HealthPanel（可视化套件 · Task 2-d）：系统健康仪表盘。
// 数据源：GET /api/analytics/health（进程/运行时/WS/会话/MCP/Skills/Provider/渲染快照）。
// 布局：状态总览卡（uptime/版本/运行时）→ 内存双环 + KV 网格 → 生态位（MCP/Skills/Providers）
//       → 渲染任务实时卡（进度环 + 场景 + 错误）。5s 轮询；渲染进行中 2s 加密轮询。
import { useEffect, useMemo, useState } from "react";
import * as api from "../api";
import { useStudio } from "../store";
import { useI18n } from "../i18n";
import { Chip, Section } from "./ui";
import { KVGrid, ProgressRing, StatCard, fmtMB, fmtUptime } from "./charts";

/** 健康面板轮询间隔（ms）；渲染进行中加密到 2s */
const POLL_MS = 5_000;
const POLL_RENDERING_MS = 2_000;

/** 内存占用比例的安全上限（RSS 超过 4GB 视为满格——启发式展示，非精确配额） */
const RSS_FULL_MB = 4096;

function VersionChip({ version, runtime }: { version: string; runtime: api.RuntimeInfo }): JSX.Element {
  const { t } = useI18n();
  return (
    <span className="analytics-version-chip" title={`${runtime.version}${runtime.bun !== null ? ` / bun ${runtime.bun}` : ""}`}>
      <Chip tone="info" title={t("analytics.health.serverVersion")}>
        server v{version}
      </Chip>
      {runtime.bun !== null ? <Chip tone="default">bun {runtime.bun}</Chip> : null}
    </span>
  );
}

export function HealthPanel(): JSX.Element {
  const { t } = useI18n();
  const analyticsHealth = useStudio((s) => s.analyticsHealth);
  const refreshAnalytics = useStudio((s) => s.refreshAnalytics);
  const setDockTab = useStudio((s) => s.setDockTab);
  const [tick, setTick] = useState(0);

  // 轮询：mount 立即拉一次；渲染中 2s，平时 5s（tick 驱动依赖重排）
  const rendering = analyticsHealth?.render.running === true;
  useEffect(() => {
    void refreshAnalytics();
    const poll = window.setInterval(() => {
      void refreshAnalytics();
      setTick((n) => n + 1);
    }, rendering ? POLL_RENDERING_MS : POLL_MS);
    return () => window.clearInterval(poll);
  }, [refreshAnalytics, rendering]);

  // uptime 秒表：本地每秒 +1 平滑走针（不必等下一次轮询）
  const [uptimeSec, setUptimeSec] = useState(analyticsHealth?.uptimeSeconds ?? 0);
  useEffect(() => {
    if (analyticsHealth !== null) setUptimeSec(analyticsHealth.uptimeSeconds);
  }, [analyticsHealth]);
  useEffect(() => {
    const timer = window.setInterval(() => setUptimeSec((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const mem = useMemo(() => {
    if (analyticsHealth === null) return null;
    const { rss, heapUsed, heapTotal } = analyticsHealth.memoryMB;
    const heapFrac = heapTotal > 0 ? heapUsed / heapTotal : 0;
    return { rss, heapUsed, heapTotal, heapFrac };
  }, [analyticsHealth]);

  if (analyticsHealth === null) {
    return (
      <div className="analytics-panel">
        <div className="analytics-empty">
          <span className="analytics-empty-glyph" aria-hidden="true">⊗</span>
          <p>{t("analytics.endpointMissing")}</p>
        </div>
      </div>
    );
  }

  const h = analyticsHealth;
  const renderProgress = h.render.progress;
  const renderFrac =
    renderProgress !== null && renderProgress.totalFrames > 0
      ? renderProgress.frame / renderProgress.totalFrames
      : 0;
  const renderTone = h.render.error !== null ? "err" : h.render.running ? "accent" : "ok";
  const heapTone: "ok" | "warn" | "err" = mem !== null && mem.heapFrac > 0.9 ? "err" : mem !== null && mem.heapFrac > 0.75 ? "warn" : "ok";

  return (
    <div className="analytics-panel health-panel" data-tick={tick}>
      {/* ---- 状态总览 ---- */}
      <div className="analytics-stat-grid">
        <StatCard
          label={t("analytics.health.status")}
          value={t("analytics.health.statusOk")}
          tone="ok"
          right={<VersionChip version={h.version} runtime={h.runtime} />}
          title={`${h.runtime.version}${h.runtime.bun !== null ? ` / bun ${h.runtime.bun}` : ""}`}
        />
        <StatCard label={t("analytics.health.uptime")} value={fmtUptime(uptimeSec)} sub={t("analytics.health.uptimeSince")} />
        <StatCard
          label={t("analytics.health.ws")}
          value={fmtMB(0) === "0 MB" ? String(h.wsConnections) : String(h.wsConnections)}
          tone={h.wsConnections > 0 ? "accent" : "default"}
          sub={t("analytics.health.wsHint")}
        />
        <StatCard label={t("analytics.health.sessions")} value={String(h.sessions.count)} sub={t("analytics.health.sessionsHint")} />
      </div>

      {/* ---- 内存 ---- */}
      <Section title={t("analytics.health.memory")}>
        <div className="analytics-gauge-row">
          <div className="health-mem-rings">
            <div className="health-mem-ring">
              <ProgressRing
                value={h.memoryMB.rss}
                max={RSS_FULL_MB}
                size={84}
                thickness={8}
                tone="var(--accent)"
                ariaLabel={t("analytics.health.rssAria", { used: fmtMB(h.memoryMB.rss) })}
              />
              <div className="health-mem-ring-label">
                <span className="health-mem-num">{fmtMB(h.memoryMB.rss)}</span>
                <span className="health-mem-sub">RSS</span>
              </div>
            </div>
            <div className="health-mem-ring">
              <ProgressRing
                value={h.memoryMB.heapUsed}
                max={Math.max(h.memoryMB.heapTotal, 1)}
                size={84}
                thickness={8}
                tone={heapTone === "err" ? "var(--err)" : heapTone === "warn" ? "var(--warn)" : "var(--ok)"}
                ariaLabel={t("analytics.health.heapAria", {
                  used: fmtMB(h.memoryMB.heapUsed),
                  total: fmtMB(h.memoryMB.heapTotal),
                })}
              />
              <div className="health-mem-ring-label">
                <span className="health-mem-num">{fmtMB(h.memoryMB.heapUsed)}</span>
                <span className="health-mem-sub">
                  heap / {fmtMB(h.memoryMB.heapTotal)}
                </span>
              </div>
            </div>
          </div>
          <div className="health-kv">
            <KVGrid
              items={[
                { k: t("analytics.health.heapTotal"), v: fmtMB(h.memoryMB.heapTotal) },
                {
                  k: t("analytics.health.heapUsed"),
                  v: `${fmtMB(h.memoryMB.heapUsed)} (${Math.round((h.memoryMB.heapUsed / Math.max(1, h.memoryMB.heapTotal)) * 100)}%)`,
                  tone: heapTone,
                },
                { k: t("analytics.health.rss"), v: fmtMB(h.memoryMB.rss) },
                { k: t("analytics.health.node"), v: h.runtime.version },
              ]}
            />
          </div>
        </div>
      </Section>

      {/* ---- 生态位：MCP / Skills / Providers ---- */}
      <Section title={t("analytics.health.ecosystem")}>
        <div className="analytics-stat-grid three">
          <StatCard
            label={t("analytics.health.mcp")}
            value={`${h.mcp.enabled}/${h.mcp.servers}`}
            tone={h.mcp.enabled > 0 ? "accent" : "default"}
            sub={t("analytics.health.mcpHint")}
          />
          <StatCard
            label={t("analytics.health.skills")}
            value={h.skills !== null ? `${h.skills.enabled}/${h.skills.total}` : "—"}
            tone={h.skills !== null && h.skills.enabled > 0 ? "accent" : "default"}
            sub={t("analytics.health.skillsHint")}
          />
          <StatCard
            label={t("analytics.health.providers")}
            value={`${h.providers.configured}/${h.providers.count}`}
            tone={h.providers.configured > 0 ? "ok" : "warn"}
            sub={t("analytics.health.providersHint")}
          />
        </div>
        <div className="health-eco-bars">
          <EcoBar label={t("analytics.health.mcp")} value={h.mcp.enabled} total={h.mcp.servers} />
          {h.skills !== null ? <EcoBar label={t("analytics.health.skills")} value={h.skills.enabled} total={h.skills.total} /> : null}
          <EcoBar label={t("analytics.health.providers")} value={h.providers.configured} total={h.providers.count} />
        </div>
      </Section>

      {/* ---- 渲染任务 ---- */}
      <Section
        title={t("analytics.health.render")}
        actions={
          h.render.running ? (
            <Chip tone="accent" title={h.render.startedAt ?? undefined}>
              {t("analytics.health.renderRunning")}
            </Chip>
          ) : h.render.error !== null ? (
            <Chip tone="err" title={h.render.error}>
              {t("analytics.health.renderError")}
            </Chip>
          ) : (
            <Chip tone="ok">{t("analytics.health.renderIdle")}</Chip>
          )
        }
      >
        <div className="analytics-gauge-row">
          <div className="health-render-ring">
            <ProgressRing
              value={renderFrac * 100}
              max={100}
              size={96}
              thickness={9}
              tone={renderTone === "err" ? "var(--err)" : renderTone === "accent" ? "var(--accent)" : "var(--ok)"}
              ariaLabel={t("analytics.health.renderAria", {
                frame: renderProgress?.frame ?? 0,
                total: renderProgress?.totalFrames ?? 0,
              })}
            />
            <div className="health-mem-ring-label">
              <span className="health-mem-num">
                {renderProgress !== null
                  ? `${Math.round(renderFrac * 100)}%`
                  : h.render.running
                    ? "…"
                    : t("analytics.health.renderNone")}
              </span>
              <span className="health-mem-sub">
                {renderProgress !== null
                  ? `${renderProgress.frame}/${renderProgress.totalFrames}f`
                  : h.render.scene !== null
                    ? h.render.scene
                    : "—"}
              </span>
            </div>
          </div>
          <div className="health-kv">
            <KVGrid
              items={[
                { k: t("analytics.health.renderPhase"), v: renderProgress?.phase ?? "—" },
                { k: t("analytics.health.renderScene"), v: h.render.scene ?? "—" },
                { k: t("analytics.health.renderStarted"), v: h.render.startedAt !== null ? new Date(h.render.startedAt).toLocaleTimeString() : "—" },
                {
                  k: t("analytics.health.renderError"),
                  v: h.render.error !== null ? (h.render.error.length > 60 ? `${h.render.error.slice(0, 59)}…` : h.render.error) : "—",
                  tone: h.render.error !== null ? "err" : undefined,
                },
              ]}
            />
            {h.render.running ? (
              <button
                type="button"
                className="btn small analytics-goto-render"
                onClick={() => setDockTab("events")}
              >
                {t("analytics.health.viewEvents")}
              </button>
            ) : null}
          </div>
        </div>
      </Section>
    </div>
  );
}

/** 生态位横向占比条（label + 分段条 + n/m 计数） */
function EcoBar({ label, value, total }: { label: string; value: number; total: number }): JSX.Element {
  const frac = total > 0 ? value / total : 0;
  return (
    <div className="health-eco-bar" role="img" aria-label={`${label}: ${value}/${total}`}>
      <span className="health-eco-label">{label}</span>
      <span className="health-eco-track" aria-hidden="true">
        <span className="health-eco-fill" style={{ width: `${Math.round(frac * 100)}%` }} />
      </span>
      <span className="health-eco-count">
        {value}/{total}
      </span>
    </div>
  );
}
