// AnalyticsPanel（可视化套件 · Task 2-d）：项目分析仪表盘。
// 数据源：GET /api/analytics/project + /api/analytics/usage（上次编译产物的只读聚合）。
// 布局：概览统计卡 → 图层构成（柱+环）→ 复杂度仪表 → 调色板/字体 → 转场 → 最近活动。
// 三态：loading / unavailable（旧服务端）/ available:false（先编译引导）；编译完成事件自动刷新。
import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "../api";
import { useStudio } from "../store";
import { useI18n } from "../i18n";
import { Button, Chip, Section } from "./ui";
import {
  BarChart,
  ColorSwatchList,
  DonutChart,
  Gauge,
  HBarList,
  Legend,
  StatCard,
  fmtChartNumber,
  fmtDuration,
  seriesColor,
} from "./charts";

/** 图层类型显示名（i18n key：analytics.layer.<kind>） */
const LAYER_KINDS: api.AnalyticsLayerKind[] = ["text", "rect", "ellipse", "image", "audio", "camera", "transition", "group"];

/** 最近活动条数上限（服务端已截断 20；此处再保险） */
const RECENT_LIMIT = 20;

function timeAgo(iso: string | null, now: number): string {
  if (iso === null) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const diff = Math.max(0, now - t);
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

export function AnalyticsPanel(): JSX.Element {
  const { t } = useI18n();
  const project = useStudio((s) => s.project);
  const compiling = useStudio((s) => s.compiling);
  const analyticsProject = useStudio((s) => s.analyticsProject);
  const analyticsUsage = useStudio((s) => s.analyticsUsage);
  const analyticsLoading = useStudio((s) => s.analyticsLoading);
  const analyticsError = useStudio((s) => s.analyticsError);
  const analyticsLoadedAt = useStudio((s) => s.analyticsLoadedAt);
  const refreshAnalytics = useStudio((s) => s.refreshAnalytics);
  const runCompile = useStudio((s) => s.runCompile);
  const [copiedHex, setCopiedHex] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // 首挂载 + 每次面板可见时拉快照；10s 轮询（渲染中事件统计会动）
  useEffect(() => {
    void refreshAnalytics();
    const poll = window.setInterval(() => {
      void refreshAnalytics();
      setNow(Date.now());
    }, 10_000);
    return () => window.clearInterval(poll);
  }, [refreshAnalytics]);

  // 编译中 → 编译结束再刷一次（compile 事件会更新 lastCompile 聚合）
  const prevCompiling = useState(compiling)[0];
  useEffect(() => {
    if (prevCompiling && !compiling) void refreshAnalytics();
  }, [compiling, prevCompiling, refreshAnalytics]);

  const copyHex = useCallback((hex: string): void => {
    void navigator.clipboard?.writeText(hex).then(
      () => {
        setCopiedHex(hex);
        window.setTimeout(() => setCopiedHex(null), 1400);
      },
      () => setCopiedHex(null),
    );
  }, []);

  // ---------------------------------------------------------------- 派生数据
  const available = analyticsProject !== null && analyticsProject.available === true;
  const data = available ? (analyticsProject as api.ProjectAnalyticsAvailable) : null;

  const layerChartData = useMemo(() => {
    if (data === null) return [];
    return data.layerTypes.map((lt) => ({ label: t(`analytics.layer.${lt.type}`), value: lt.count }));
  }, [data, t]);

  const transitionData = useMemo(() => {
    if (data === null) return [];
    return data.transitions.types.map((tt) => ({ label: tt.type, value: tt.count }));
  }, [data]);

  const fontData = useMemo(() => {
    if (data === null) return [];
    return data.fontsUsed.map((f) => ({ label: f.font, value: f.count }));
  }, [data]);

  const usageByType = useMemo(() => {
    if (analyticsUsage === null) return [];
    return analyticsUsage.byType.slice(0, 8).map((tc) => ({ label: tc.type, value: tc.count }));
  }, [analyticsUsage]);

  const layerTotal = layerChartData.reduce((acc, d) => acc + d.value, 0);

  // ---------------------------------------------------------------- 三态渲染
  if (analyticsProject === null && analyticsUsage === null) {
    // 旧服务端（无 /api/analytics/* 端点）→ 引导升级
    return (
      <div className="analytics-panel">
        <div className="analytics-empty">
          <span className="analytics-empty-glyph" aria-hidden="true">⊘</span>
          <p>{t("analytics.endpointMissing")}</p>
        </div>
      </div>
    );
  }

  if (analyticsLoading && data === null && analyticsUsage === null) {
    return (
      <div className="analytics-panel">
        <div className="analytics-empty">
          <span className="spinner" role="status" />
          <p>{t("analytics.loading")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="analytics-panel">
      {/* ---- 工具条：刷新 / 数据截至 / 错误条 ---- */}
      <div className="analytics-toolbar">
        <Button
          small
          disabled={analyticsLoading}
          onClick={() => {
            void refreshAnalytics();
            setNow(Date.now());
          }}
          title={t("analytics.refreshHint")}
        >
          {analyticsLoading ? t("analytics.refreshing") : t("analytics.refresh")}
        </Button>
        {analyticsLoadedAt !== null ? (
          <span className="analytics-stale" title={new Date(analyticsLoadedAt).toLocaleString()}>
            {t("analytics.asOf", { time: new Date(analyticsLoadedAt).toLocaleTimeString() })}
          </span>
        ) : null}
        {analyticsError !== null && analyticsError !== "analytics-unavailable" ? (
          <Chip tone="warn" title={analyticsError}>
            {t("analytics.partialError")}
          </Chip>
        ) : null}
      </div>

      {analyticsError === "analytics-unavailable" && data === null ? (
        <div className="analytics-warn-bar" role="status">{t("analytics.endpointMissing")}</div>
      ) : null}

      {data === null ? (
        // available:false（或仍 null）→ 先编译引导态
        <div className="analytics-empty">
          <span className="analytics-empty-glyph" aria-hidden="true">∑</span>
          <p>{t("analytics.needCompile")}</p>
          {project !== null ? (
            <Button variant="primary" disabled={compiling} onClick={() => void runCompile()}>
              {compiling ? t("topbar.compiling") : t("topbar.compile")}
            </Button>
          ) : (
            <p className="analytics-dim">{t("analytics.needProject")}</p>
          )}
        </div>
      ) : (
        <>
          {/* ---- 概览统计卡 ---- */}
          <div className="analytics-stat-grid">
            <StatCard label={t("analytics.stat.scenes")} value={fmtChartNumber(data.summary.sceneCount)} />
            <StatCard
              label={t("analytics.stat.duration")}
              value={fmtDuration(data.summary.durationSeconds)}
              sub={t("analytics.stat.longestScene", {
                name: data.summary.longestScene.name,
                duration: fmtDuration(data.summary.longestScene.duration),
              })}
            />
            <StatCard
              label={t("analytics.stat.layers")}
              value={fmtChartNumber(data.summary.layerCount)}
              sub={t("analytics.stat.avgPerScene", { n: (data.summary.layerCount / Math.max(1, data.summary.sceneCount)).toFixed(1) })}
            />
            <StatCard
              label={t("analytics.stat.avgScene")}
              value={fmtDuration(data.summary.avgSceneDuration)}
              sub={t("analytics.stat.project", { name: data.project.name })}
            />
          </div>

          {/* ---- 图层构成：柱 + 环 ---- */}
          <div className="analytics-two-col">
            <Section title={t("analytics.layerComposition")}>
              {layerChartData.length > 0 ? (
                <>
                  <BarChart data={layerChartData} height={190} />
                  <Legend items={LAYER_KINDS.slice(0, 5).map((k) => ({ label: t(`analytics.layer.${k}`) }))} />
                </>
              ) : (
                <div className="viz-empty">—</div>
              )}
            </Section>
            <Section title={t("analytics.layerShare")}>
              <div className="analytics-donut-row">
                <DonutChart
                  data={layerChartData}
                  size={150}
                  centerValue={fmtChartNumber(layerTotal)}
                  centerLabel={t("analytics.stat.layers").toLowerCase()}
                />
                <ul className="analytics-donut-legend" role="list">
                  {layerChartData.map((d, i) => (
                    <li key={d.label}>
                      <span className="viz-legend-dot" aria-hidden="true" style={{ background: seriesColor(i) }} />
                      <span className="viz-legend-label">{d.label}</span>
                      <span className="analytics-donut-count">
                        {layerTotal > 0 ? `${Math.round((d.value / layerTotal) * 100)}%` : "0%"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </Section>
          </div>

          {/* ---- 复杂度仪表 + 因子 ---- */}
          <div className="analytics-two-col">
            <Section title={t("analytics.complexity")}>
              <div className="analytics-gauge-row">
                <Gauge value={data.complexity.score} label={t("analytics.complexityScore")} ariaLabel={t("analytics.complexityAria", { score: data.complexity.score })} />
                <ul className="analytics-factor-list" role="list">
                  {data.complexity.factors.map((f) => (
                    <li key={f.label}>
                      <span className="analytics-factor-label">{f.label}</span>
                      <span className="analytics-factor-track" aria-hidden="true">
                        <span className="analytics-factor-fill" style={{ width: `${Math.min(100, Math.round(f.weight * 100))}%` }} />
                      </span>
                      <span className="analytics-factor-num">{Math.round(f.weight * 100)}%</span>
                    </li>
                  ))}
                </ul>
              </div>
              <p className="analytics-hint">{t("analytics.complexityHint")}</p>
            </Section>

            {/* ---- 转场 ---- */}
            <Section title={t("analytics.transitions")}>
              {transitionData.length > 0 ? (
                <div className="analytics-donut-row">
                  <DonutChart
                    data={transitionData}
                    size={150}
                    centerValue={fmtChartNumber(data.transitions.count)}
                    centerLabel={t("analytics.transitionCount").toLowerCase()}
                  />
                  <ul className="analytics-donut-legend" role="list">
                    {transitionData.map((d, i) => (
                      <li key={d.label}>
                        <span className="viz-legend-dot" aria-hidden="true" style={{ background: seriesColor(i) }} />
                        <span className="viz-legend-label">{d.label}</span>
                        <span className="analytics-donut-count">×{d.value}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="viz-empty">{t("analytics.noTransitions")}</div>
              )}
            </Section>
          </div>

          {/* ---- 调色板 / 字体 ---- */}
          <div className="analytics-two-col">
            <Section title={t("analytics.palette")}>
              <ColorSwatchList colors={data.topColors} onCopy={copyHex} />
              {copiedHex !== null ? <p className="analytics-copied">{t("analytics.copied", { hex: copiedHex })}</p> : null}
            </Section>
            <Section title={t("analytics.fonts")}>
              {fontData.length > 0 ? (
                <HBarList data={fontData} />
              ) : (
                <div className="viz-empty">{t("analytics.defaultFontsOnly")}</div>
              )}
            </Section>
          </div>
        </>
      )}

      {/* ---- 最近活动（usage；独立于 compile 可用性） ---- */}
      {analyticsUsage !== null ? (
        <Section
          title={t("analytics.activity")}
          actions={
            <span className="analytics-toolbar-meta">
              {t("analytics.activityTotal", { total: fmtChartNumber(analyticsUsage.total) })}
            </span>
          }
        >
          <div className="analytics-activity-stats">
            <StatCard label={t("analytics.activityStat.compile")} value={fmtChartNumber(analyticsUsage.compileCount)} tone="accent" />
            <StatCard label={t("analytics.activityStat.render")} value={fmtChartNumber(analyticsUsage.renderEvents)} />
            <StatCard label={t("analytics.activityStat.test")} value={fmtChartNumber(analyticsUsage.testRuns)} />
          </div>
          {usageByType.length > 0 ? (
            <div className="analytics-usage-chart">
              <HBarList data={usageByType} rowHeight={22} />
            </div>
          ) : (
            <div className="viz-empty">{t("analytics.noActivity")}</div>
          )}
          {analyticsUsage.recent.length > 0 ? (
            <ul className="analytics-recent" role="list">
              {analyticsUsage.recent.slice(-RECENT_LIMIT).reverse().map((ev, i) => (
                <li key={`${ev.type}-${i}`} className="analytics-recent-row">
                  <span className={`analytics-recent-dot analytics-recent-${ev.type.startsWith("render-error") || ev.type.startsWith("compile-error") ? "err" : ev.type.startsWith("render") ? "accent" : "ok"}`} aria-hidden="true" />
                  <span className="analytics-recent-type">{ev.type}</span>
                  <span className="analytics-recent-summary" title={ev.summary}>
                    {ev.summary}
                  </span>
                  <span className="analytics-recent-ago">{timeAgo(ev.at, now)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </Section>
      ) : null}
    </div>
  );
}
