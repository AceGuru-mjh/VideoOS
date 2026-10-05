// UsagePanel (S5 · v0.2 §6, issue #55): 用量 —— 右栏「用量」页签。
// 本会话 token（prompt/completion 累计 + 占比条）· 最近 N 次任务耗时趋势条
// （悬停详情，按状态着色，最新一次高亮，进行中为 accent 呼吸）· 渲染统计
// （预览/区间/成片 + 产出视频列表）· 缓存（命中率 + cache.stats 快照，解析
// 失败优雅显示「—」）。数字随实时事件即时更新（用量随 run-done 到达）。
import { useMemo } from "react";
import { useStudio } from "../../store";
import { collectRuns, deriveUsage, fmtBytesLocal, fmtK, fmtMs, type UsageRunRow } from "./viz-data";

function StatusDot({ status }: { status: "running" | "ok" | "error" | "stopped" }): JSX.Element {
  return <span className={`up-dot ${status}`} aria-hidden="true" />;
}

function TrendRow({ row, maxMs, latest }: { row: UsageRunRow; maxMs: number; latest: boolean }): JSX.Element {
  const pct = Math.max(4, Math.round((row.totalMs / maxMs) * 100));
  return (
    <div className={`up-trend-row${latest ? " latest" : ""}`} title={row.title}>
      <span className={`up-trend-idx mono${latest ? " latest" : ""}`}>#{row.index}</span>
      <StatusDot status={row.status} />
      <span className="up-trend-track">
        <span className={`up-trend-fill ${row.status}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="up-trend-dur mono">{fmtMs(row.totalMs)}</span>
      <span className="up-trend-tok mono">{row.tokens !== null ? fmtK(row.tokens) : "—"}</span>
    </div>
  );
}

export function UsagePanel(): JSX.Element {
  const messages = useStudio((s) => s.messages);
  const activeRun = useStudio((s) => s.activeRun);
  const currentSessionId = useStudio((s) => s.currentSessionId);

  const snap = useMemo(
    () => deriveUsage(collectRuns(messages, activeRun, currentSessionId)),
    [messages, activeRun, currentSessionId],
  );

  const totalTokens = snap.promptTokens + snap.completionTokens;
  const hasTokens = totalTokens > 0;
  // prompt/completion 占比条（无数据时整条 dim）
  const promptPct = hasTokens ? Math.round((snap.promptTokens / totalTokens) * 100) : 0;

  const cacheTotal =
    snap.cacheHits !== null && snap.cacheMisses !== null ? snap.cacheHits + snap.cacheMisses : null;
  const hitRate = cacheTotal !== null && cacheTotal > 0 ? Math.round(((snap.cacheHits ?? 0) / cacheTotal) * 100) : null;

  const trendRows = snap.trendRuns;
  const latestKey = trendRows.length > 0 ? trendRows[trendRows.length - 1]?.key : undefined;
  const maxMs = trendRows.reduce((m, r) => Math.max(m, r.totalMs), 0);

  return (
    <div className="up-wrap">
      {/* ---- Token 用量 ---- */}
      <section className="ctx-sec up-sec" aria-label="Token 用量">
        <span className="ctx-title">Token 用量</span>
        {hasTokens ? (
          <>
            <div className="up-kv">
              <span className="ctx-k">合计</span>
              <span className="up-kv-v mono" title={`prompt ${snap.promptTokens} + completion ${snap.completionTokens}`}>
                {fmtK(totalTokens)}
              </span>
            </div>
            <div className="up-token-bar" role="img" aria-label={`prompt 占比 ${promptPct}%`}>
              <span className="up-token-fill prompt" style={{ width: `${promptPct}%` }} />
              <span className="up-token-fill completion" />
            </div>
            <div className="up-token-split">
              <span className="up-dot prompt" aria-hidden="true" />
              <span className="mono">{fmtK(snap.promptTokens)}</span>
              <span className="ctx-k">prompt</span>
              <span className="up-dot completion" aria-hidden="true" />
              <span className="mono">{fmtK(snap.completionTokens)}</span>
              <span className="ctx-k">completion</span>
            </div>
          </>
        ) : (
          <div className="ctx-hint">尚无 token 记录 — 用量随任务完成入账。</div>
        )}
      </section>

      {/* ---- 任务趋势 ---- */}
      <section className="ctx-sec up-sec" aria-label="任务趋势">
        <span className="ctx-title">任务趋势（最近 {trendRows.length > 0 ? trendRows.length : 0} 次，共 {snap.totalRuns} 次）</span>
        {trendRows.length === 0 ? (
          <div className="ctx-hint">尚无任务 — 发送消息后此处显示每次任务的耗时。</div>
        ) : (
          <>
            <div className="up-trend-head">
              <span className="ctx-k">#</span>
              <span className="ctx-k up-trend-track-h" />
              <span className="ctx-k">耗时</span>
              <span className="ctx-k">tokens</span>
            </div>
            <div className="up-trend-list">
              {trendRows.map((r) => (
                <TrendRow key={r.key} row={r} maxMs={maxMs > 0 ? maxMs : 1} latest={r.key === latestKey} />
              ))}
            </div>
          </>
        )}
      </section>

      {/* ---- 渲染 ---- */}
      <section className="ctx-sec up-sec" aria-label="渲染统计">
        <span className="ctx-title">渲染</span>
        {snap.previewCalls === 0 && snap.rangeCalls === 0 && snap.finalCalls === 0 ? (
          <div className="ctx-hint">尚无渲染 — 让 Agent 渲染一帧试试。</div>
        ) : (
          <>
            <div className="up-kv" title="render.preview 每次计 1 帧">
              <span className="ctx-k">预览帧</span>
              <span className="up-kv-v mono">
                {snap.previewCalls} 次 · 约 {snap.previewFrames} 帧
              </span>
            </div>
            <div className="up-kv" title="render.range 帧数来自 from/to 或结果 frames">
              <span className="ctx-k">区间渲染</span>
              <span className="up-kv-v mono">{snap.rangeCalls} 次</span>
            </div>
            <div className="up-kv">
              <span className="ctx-k">成片输出</span>
              <span className="up-kv-v mono">{snap.finalCalls} 次</span>
            </div>
            {snap.videos.length > 0 ? (
              <div className="up-videos">
                {snap.videos.map((v) => (
                  <a
                    key={v.url}
                    className="up-video"
                    href={v.url}
                    target="_blank"
                    rel="noreferrer"
                    title={`打开成片 ${v.name}`}
                  >
                    <span className="up-video-glyph" aria-hidden="true">
                      ▶
                    </span>
                    <span className="up-video-name mono">{v.name}</span>
                  </a>
                ))}
              </div>
            ) : null}
          </>
        )}
      </section>

      {/* ---- 缓存 ---- */}
      <section className="ctx-sec up-sec" aria-label="缓存">
        <span className="ctx-title">缓存</span>
        <div className="up-kv" title="render.final 结果中的 cacheHits/cacheMisses 聚合">
          <span className="ctx-k">命中率</span>
          <span className="up-kv-v mono">{hitRate !== null ? `${hitRate}%` : "—"}</span>
        </div>
        <div className="up-kv">
          <span className="ctx-k">命中 / 未命中</span>
          <span className="up-kv-v mono">
            {snap.cacheHits !== null ? String(snap.cacheHits) : "—"} / {snap.cacheMisses !== null ? String(snap.cacheMisses) : "—"}
          </span>
        </div>
        <div className="up-kv" title="cache.stats 最近快照（best-effort）">
          <span className="ctx-k">缓存条目</span>
          <span className="up-kv-v mono">
            {snap.cacheEntries !== null ? `${snap.cacheEntries} 项` : "—"}
            {snap.cacheBytes !== null ? ` · ${fmtBytesLocal(snap.cacheBytes)}` : ""}
          </span>
        </div>
      </section>
    </div>
  );
}
