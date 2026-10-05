// Markdown-lite 渲染器（#51 assistant 消息正文）—— 零依赖、XSS 安全：
// 全部内容以 React 子节点构建（文本自动转义），绝不使用 dangerouslySetInnerHTML。
// 支持：``` 围栏代码块（含语言标签 + 复制）、#..#### 标题、-/* 与 1. 列表、段落；
// 行内：`code`、**bold**、*italic*、[text](http(s)://url)。
import type { ReactNode } from "react";
import { CodeBlock } from "./ui";

/** 行内标记：`code` / **bold** / *italic* / [text](http url) —— 非嵌套（lite） */
const INLINE_RE = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let i = 0;
  INLINE_RE.lastIndex = 0;
  for (let m = INLINE_RE.exec(text); m !== null; m = INLINE_RE.exec(text)) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const key = `${keyPrefix}-${i}`;
    if (m[1] !== undefined) {
      nodes.push(
        <code key={key} className="md-inline-code">
          {m[1]}
        </code>,
      );
    } else if (m[2] !== undefined) {
      nodes.push(<strong key={key}>{m[2]}</strong>);
    } else if (m[3] !== undefined) {
      nodes.push(<em key={key}>{m[3]}</em>);
    } else if (m[4] !== undefined && m[5] !== undefined) {
      nodes.push(
        <a key={key} href={m[5]} target="_blank" rel="noopener noreferrer">
          {m[4]}
        </a>,
      );
    }
    last = m.index + m[0].length;
    i += 1;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

type Segment = { kind: "code"; lang: string; code: string } | { kind: "text"; raw: string };

/** 先切出 ``` 围栏段（围栏内可含空行），剩余按空行分块 */
function splitSegments(src: string): Segment[] {
  const segments: Segment[] = [];
  const fence = /```([^\n`]*)\n?([\s\S]*?)(?:```|$)/g;
  let last = 0;
  for (let m = fence.exec(src); m !== null; m = fence.exec(src)) {
    if (m.index > last) segments.push({ kind: "text", raw: src.slice(last, m.index) });
    segments.push({ kind: "code", lang: m[1].trim(), code: m[2].replace(/\n$/, "") });
    last = fence.lastIndex;
  }
  if (last < src.length) segments.push({ kind: "text", raw: src.slice(last) });
  return segments;
}

const UL_RE = /^[-*]\s+/;
const OL_RE = /^\d+\.\s+/;
const H_RE = /^(#{1,4})\s+(.*)$/;

/** 一个文本块（无空行）→ 标题 / 列表 / 段落 */
function renderBlock(block: string, key: string): JSX.Element[] {
  const lines = block.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const head = H_RE.exec(lines[0]);
  if (head !== null && lines.length === 1) {
    return [
      <h4 key={key} className="md-h">
        {renderInline(head[2], key)}
      </h4>,
    ];
  }
  if (lines.every((l) => UL_RE.test(l))) {
    return [
      <ul key={key}>
        {lines.map((l, i) => (
          <li key={`${key}-${i}`}>{renderInline(l.replace(UL_RE, ""), `${key}-${i}`)}</li>
        ))}
      </ul>,
    ];
  }
  if (lines.every((l) => OL_RE.test(l))) {
    return [
      <ol key={key}>
        {lines.map((l, i) => (
          <li key={`${key}-${i}`}>{renderInline(l.replace(OL_RE, ""), `${key}-${i}`)}</li>
        ))}
      </ol>,
    ];
  }
  return [
    <p key={key}>
      {renderInline(lines.join("\n"), key)}
    </p>,
  ];
}

/** markdown-lite → 块级 React 元素数组（由调用方包进 .md-content 容器） */
export function MarkdownLite({ content }: { content: string }): JSX.Element[] {
  const out: JSX.Element[] = [];
  let blockIndex = 0;
  for (const seg of splitSegments(content)) {
    if (seg.kind === "code") {
      out.push(<CodeBlock key={`code-${blockIndex}`} code={seg.code} lang={seg.lang} />);
      blockIndex += 1;
      continue;
    }
    for (const block of seg.raw.split(/\n{2,}/)) {
      if (block.trim().length === 0) continue;
      for (const el of renderBlock(block, `b-${blockIndex}`)) out.push(el);
      blockIndex += 1;
    }
  }
  return out;
}
