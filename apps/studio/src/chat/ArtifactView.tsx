// artifact 内联渲染（#51）：code / preview-frame / qa / video / text 五类。
// 服务端形状见 packages/server/src/chat/types.ts ChatArtifact；qa 报告按宽松形状防御式解析。
import { useState } from "react";
import * as api from "../api";
import { useI18n } from "../i18n";
import { Badge, CodeBlock } from "./ui";

/** video artifact：绝对路径 → /renders/<basename> 静态流（服务端挂载渲染产物目录） */
export function videoUrl(path: string): string {
  return `/renders/${api.basename(path)}`;
}

/** QA 报告宽松行（result 或 suite.result 条目；未知字段忽略） */
interface LooseQaRow {
  name: string;
  passed: boolean;
  message?: string;
}

function parseQaRows(report: unknown): LooseQaRow[] {
  if (report === null || typeof report !== "object") return [];
  const r = report as { results?: unknown; suites?: unknown };
  const rows: LooseQaRow[] = [];
  const pushRow = (v: unknown): void => {
    if (v === null || typeof v !== "object") return;
    const row = v as { name?: unknown; passed?: unknown; message?: unknown };
    if (typeof row.name === "string" && typeof row.passed === "boolean") {
      rows.push({ name: row.name, passed: row.passed, ...(typeof row.message === "string" ? { message: row.message } : {}) });
    }
  };
  if (Array.isArray(r.results)) {
    for (const v of r.results) pushRow(v);
  } else if (Array.isArray(r.suites)) {
    // 服务端 QaReport 形状：{ suites: [{ results: [...] }] }
    for (const suite of r.suites) {
      if (suite === null || typeof suite !== "object") continue;
      const results = (suite as { results?: unknown }).results;
      if (Array.isArray(results)) for (const v of results) pushRow(v);
    }
  }
  return rows;
}

function QaArtifact({ report }: { report: unknown }): JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const r = report !== null && typeof report === "object" ? (report as { totalPassed?: unknown; totalFailed?: unknown }) : {};
  const passed = typeof r.totalPassed === "number" ? r.totalPassed : null;
  const failed = typeof r.totalFailed === "number" ? r.totalFailed : null;
  const rows = parseQaRows(report);
  const failures = rows.filter((row) => !row.passed);

  return (
    <div className="artifact artifact-qa">
      <div className="qa-summary">
        {passed !== null ? <Badge tone="ok">{t("chat.qa.passed", { n: passed })}</Badge> : null}
        {failed !== null ? <Badge tone={failed > 0 ? "err" : "dim"}>{t("chat.qa.failed", { n: failed })}</Badge> : null}
        {failures.length > 0 ? (
          <button type="button" className="qa-toggle" onClick={() => setOpen((v) => !v)}>
            {open ? t("chat.qa.hideFailures") : t("chat.qa.showFailures")}
          </button>
        ) : null}
        {rows.length === 0 ? <span className="qa-nodetail">{t("chat.qa.noResults")}</span> : null}
      </div>
      {open && failures.length > 0 ? (
        <table className="qa-table">
          <tbody>
            {failures.map((row, i) => (
              <tr key={i}>
                <td className="qa-name">{row.name}</td>
                <td className="qa-msg">{row.message ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

export function ArtifactView({ artifact }: { artifact: api.ChatArtifact }): JSX.Element | null {
  switch (artifact.type) {
    case "code":
      return (
        <div className="artifact">
          <CodeBlock code={artifact.content ?? ""} lang={artifact.language} title={artifact.title} />
        </div>
      );
    case "preview-frame":
      if (artifact.pngBase64 === undefined) return null;
      return (
        <figure className="artifact">
          {artifact.title !== undefined ? <figcaption className="artifact-title">{artifact.title}</figcaption> : null}
          <img
            className="artifact-frame"
            src={`data:image/png;base64,${artifact.pngBase64}`}
            alt={artifact.title ?? "preview frame"}
            loading="lazy"
          />
        </figure>
      );
    case "qa":
      return <QaArtifact report={artifact.report} />;
    case "video":
      if (artifact.path === undefined) return null;
      return (
        <figure className="artifact">
          {artifact.title !== undefined ? <figcaption className="artifact-title">{artifact.title}</figcaption> : null}
          <video className="artifact-video" controls preload="metadata" src={videoUrl(artifact.path)} />
        </figure>
      );
    case "text":
      return <pre className="artifact-text">{artifact.content ?? ""}</pre>;
    default:
      return null;
  }
}
