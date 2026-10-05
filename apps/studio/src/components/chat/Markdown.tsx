// Minimal, dependency-free Markdown renderer (v0.2 §3). Supports headings
// (#/##/###), **bold**, `inline code`, fenced ``` code blocks with a language
// label, unordered/ordered lists and paragraphs. Links render as real anchors
// only for http(s) URLs (rel="noopener noreferrer nofollow"). ALL content is
// built as React elements — raw HTML from message text is never injected.
import { Fragment, type ReactNode } from "react";

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "h"; level: 1 | 2 | 3; text: string }
  | { kind: "code"; lang: string; lines: string[] }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] };

function parseBlocks(src: string): Block[] {
  const lines = src.split(/\r?\n/);
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: Extract<Block, { kind: "ul" | "ol" }> | null = null;

  const flushPara = (): void => {
    if (para.length > 0) {
      blocks.push({ kind: "p", lines: para });
      para = [];
    }
  };
  const flushList = (): void => {
    if (list !== null) {
      blocks.push(list);
      list = null;
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const fence = /^\s*```(.*)$/.exec(line);
    if (fence !== null) {
      flushPara();
      flushList();
      const lang = (fence[1] ?? "").trim();
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i] ?? "")) {
        code.push(lines[i] ?? "");
        i += 1;
      }
      blocks.push({ kind: "code", lang, lines: code });
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading !== null) {
      flushPara();
      flushList();
      blocks.push({ kind: "h", level: heading[1].length as 1 | 2 | 3, text: heading[2] ?? "" });
      continue;
    }
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (ul !== null) {
      flushPara();
      if (list === null || list.kind !== "ul") {
        flushList();
        list = { kind: "ul", items: [] };
      }
      list.items.push(ul[1] ?? "");
      continue;
    }
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ol !== null) {
      flushPara();
      if (list === null || list.kind !== "ol") {
        flushList();
        list = { kind: "ol", items: [] };
      }
      list.items.push(ol[1] ?? "");
      continue;
    }
    if (line.trim().length === 0) {
      flushPara();
      flushList();
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return blocks;
}

const INLINE_RE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|https?:\/\/[^\s)\]]+)/g;

function safeHref(url: string): string | null {
  return /^https?:\/\//.test(url) ? url : null;
}

/** one text line → React nodes (bold / inline code / safe links) */
function renderInline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let n = 0;
  INLINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-${n}`;
    n += 1;
    if (tok.startsWith("**")) {
      nodes.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("`")) {
      nodes.push(
        <code key={key} className="md-code-i">
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith("[")) {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok);
      const href = lm !== null ? safeHref(lm[2] ?? "") : null;
      if (lm !== null && href !== null) {
        nodes.push(
          <a key={key} className="md-a" href={href} target="_blank" rel="noopener noreferrer nofollow">
            {lm[1]}
          </a>,
        );
      } else {
        nodes.push(tok);
      }
    } else {
      const href = safeHref(tok);
      nodes.push(
        href !== null ? (
          <a key={key} className="md-a" href={href} target="_blank" rel="noopener noreferrer nofollow">
            {tok}
          </a>
        ) : (
          tok
        ),
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function renderBlock(b: Block, i: number): ReactNode {
  switch (b.kind) {
    case "p":
      return (
        <p className="md-p" key={i}>
          {b.lines.map((l, j) => (
            <Fragment key={j}>
              {j > 0 ? <br /> : null}
              {renderInline(l, `p${i}-${j}`)}
            </Fragment>
          ))}
        </p>
      );
    case "h": {
      const cls = `md-h md-h${b.level}`;
      const inline = renderInline(b.text, `h${i}`);
      if (b.level === 1) return <h4 className={cls} key={i}>{inline}</h4>;
      if (b.level === 2) return <h5 className={cls} key={i}>{inline}</h5>;
      return <h6 className={cls} key={i}>{inline}</h6>;
    }
    case "code":
      return (
        <div className="md-pre" key={i}>
          {b.lang.length > 0 ? <span className="md-lang">{b.lang}</span> : null}
          <pre>
            <code>{b.lines.join("\n")}</code>
          </pre>
        </div>
      );
    case "ul":
      return (
        <ul className="md-ul" key={i}>
          {b.items.map((it, j) => (
            <li key={j}>{renderInline(it, `ul${i}-${j}`)}</li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol className="md-ol" key={i}>
          {b.items.map((it, j) => (
            <li key={j}>{renderInline(it, `ol${i}-${j}`)}</li>
          ))}
        </ol>
      );
  }
}

export function Markdown({ text }: { text: string }): JSX.Element {
  const blocks = parseBlocks(text);
  return <div className="md">{blocks.map((b, i) => renderBlock(b, i))}</div>;
}
