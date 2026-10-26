import { Fragment, type CSSProperties, type ReactNode } from 'react';
import type { ImportBlock, InlineStyleRange, LinkRange, TextBlock } from '@/lib/bridge/protocol';
import { parseMarkdown } from './parser';

/**
 * 预览(第三批 C3 / O2):按解析产出渲染「写进 X 的样子」,替代 react-markdown + remark-gfm。
 * 此前预览走完整 CommonMark,与本项目解析器的子集语义系统性不一致(H4–6、嵌套列表、裸 URL 等),
 * 只能挂一句「以能力面板为准」;现在预览与写入同一份块序列,所见即所写:
 *  - header-one(源 H1 / H2)、header-two(源 H3)为两级标题;H4+ 本就是整段加粗的段落;
 *  - 列表按 X 的实际效果扁平显示(X 忽略 Draft depth,见 HANDOFF §5 真机结论);
 *  - 行内代码保留反引号(X 无行内代码,写入也是原样);代码块无高亮;
 *  - 图片为占位框,不发任何网络请求;链接只放行 http(s) / mailto,点击不跳转。
 * 不使用 dangerouslySetInnerHTML:所有文本按 React 文本节点转义。
 */

const headingSize = { 1: '17px', 2: '14.5px' } as const;

function heading(level: 1 | 2): CSSProperties {
  return {
    font: `600 ${headingSize[level]}/1.5 var(--fDisp)`,
    color: 'var(--ink)',
    margin: level === 1 ? '0 0 12px' : '18px 0 8px',
  };
}

const para: CSSProperties = { font: '400 12px/1.85 var(--fUI)', color: 'var(--ink)', margin: '0 0 10px', whiteSpace: 'pre-wrap' };
const listItem: CSSProperties = { font: '400 12px/1.85 var(--fUI)', color: 'var(--ink)', marginBottom: 2, whiteSpace: 'pre-wrap' };
const list: CSSProperties = { margin: '0 0 12px', paddingLeft: 18 };
const quote: CSSProperties = {
  borderLeft: '2px solid var(--acc)',
  margin: '0 0 12px',
  padding: '2px 0 2px 12px',
  color: 'var(--ink2)',
  font: '400 11.5px/1.8 var(--fUI)',
  whiteSpace: 'pre-wrap',
};
const pre: CSSProperties = {
  background: 'var(--p2)',
  borderRadius: 8,
  padding: '11px 13px',
  overflow: 'auto',
  font: '400 10.5px/1.7 var(--fMono)',
  color: 'var(--ink)',
  margin: '0 0 12px',
};
const cell: CSSProperties = {
  border: '1px solid var(--line)',
  padding: '5px 9px',
  font: '400 10.5px var(--fUI)',
  color: 'var(--ink)',
  textAlign: 'left',
};
const placeholder: CSSProperties = {
  minHeight: 90,
  borderRadius: 8,
  margin: '4px 0 12px',
  padding: '0 10px',
  border: '1px solid var(--line)',
  background: 'repeating-linear-gradient(45deg,var(--p2) 0 10px,transparent 10px 20px)',
  display: 'grid',
  placeItems: 'center',
  font: '500 8.5px var(--fMono)',
  color: 'var(--ink3)',
  letterSpacing: '1px',
  wordBreak: 'break-all',
};

/** 一段同样式的文本(行内样式 / 链接区间的边界切出来的最小单元)。 */
export interface InlineSegment {
  text: string;
  bold: boolean;
  italic: boolean;
  strike: boolean;
  href: string | null;
}

/**
 * 按样式与链接区间的全部边界把文本切段。offset / length 与解析器同为 UTF-16 码元(见 HANDOFF §8),
 * 解析器不会把区间边界落在代理对中间,故按码元切片不会切坏 emoji。
 */
export function inlineSegments(text: string, ranges: InlineStyleRange[], links: LinkRange[]): InlineSegment[] {
  const cuts = new Set<number>([0, text.length]);
  for (const r of [...ranges, ...links]) {
    cuts.add(Math.max(0, Math.min(text.length, r.offset)));
    cuts.add(Math.max(0, Math.min(text.length, r.offset + r.length)));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const covers = (r: { offset: number; length: number }, a: number) => r.offset <= a && a < r.offset + r.length;
  const segs: InlineSegment[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (a === b) continue;
    const on = (style: InlineStyleRange['style']) => ranges.some((r) => r.style === style && covers(r, a));
    segs.push({
      text: text.slice(a, b),
      bold: on('BOLD'),
      italic: on('ITALIC'),
      strike: on('STRIKETHROUGH'),
      href: links.find((l) => covers(l, a))?.url ?? null,
    });
  }
  return segs;
}

/** 链接协议白名单(沿用 react-markdown 默认 urlTransform 的防护):其余协议(javascript: / data: 等)不生成 href。 */
export function safeHref(url: string): string | null {
  return /^(https?:|mailto:)/i.test(url.trim()) ? url : null;
}

/** 相邻同类列表项合成一组,其余块各自一项。 */
export type BlockGroup =
  | { kind: 'list'; ordered: boolean; items: TextBlock[] }
  | { kind: 'block'; block: ImportBlock };

export function groupBlocks(blocks: ImportBlock[]): BlockGroup[] {
  const out: BlockGroup[] = [];
  for (const b of blocks) {
    const ordered = b.kind === 'text' && b.type === 'ordered-list-item';
    if (b.kind === 'text' && (ordered || b.type === 'unordered-list-item')) {
      const last = out[out.length - 1];
      if (last?.kind === 'list' && last.ordered === ordered) last.items.push(b);
      else out.push({ kind: 'list', ordered, items: [b] });
      continue;
    }
    out.push({ kind: 'block', block: b });
  }
  return out;
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

/** MARKDOWN atomic 里的 GFM 表格原文 → 表头 + 数据行;不是表格(如围栏代码)返回 null。 */
export function parseTableMarkdown(markdown: string): { header: string[]; rows: string[][] } | null {
  // 先认围栏(与 capability 的代码块判定同口径):代码正文首行恰好形似分隔行时不能当表格。
  if (/^(`{3,}|~{3,})/.test(markdown)) return null;
  const lines = markdown.split('\n').filter((l) => l.trim() !== '');
  if (lines.length < 2 || !/^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[1]!)) return null;
  return { header: splitRow(lines[0]!), rows: lines.slice(2).map(splitRow) };
}

function Inline({ text, ranges, links }: { text: string; ranges: InlineStyleRange[]; links: LinkRange[] }) {
  return (
    <>
      {inlineSegments(text, ranges, links).map((s, i) => {
        let node: ReactNode = s.text;
        if (s.strike) node = <s>{node}</s>;
        if (s.italic) node = <em>{node}</em>;
        if (s.bold) node = <strong style={{ fontWeight: 600 }}>{node}</strong>;
        const href = s.href === null ? null : safeHref(s.href);
        if (href !== null) {
          node = (
            <a href={href} onClick={(e) => e.preventDefault()} style={{ textDecoration: 'underline', textUnderlineOffset: 3 }}>
              {node}
            </a>
          );
        }
        return <Fragment key={i}>{node}</Fragment>;
      })}
    </>
  );
}

/** 表格单元格按行内语法渲染(X 的 MARKDOWN 渲染器同样识别单元格里的粗体 / 链接等)。 */
function CellInline({ text }: { text: string }) {
  const b = parseMarkdown(text)[0];
  if (!b || b.kind !== 'text') return <>{text}</>;
  return <Inline text={b.text} ranges={b.inlineStyleRanges} links={b.links} />;
}

function Block({ block }: { block: ImportBlock }) {
  if (block.kind === 'image') {
    return <div style={placeholder}>IMAGE · {block.alt || block.source}</div>;
  }
  if (block.kind === 'atomic') {
    switch (block.entityType) {
      case 'DIVIDER':
        return <hr style={{ border: 'none', borderTop: '1px solid var(--line)', margin: '16px 0' }} />;
      case 'LATEX':
        return <pre style={{ ...pre, textAlign: 'center' }}>{block.text}</pre>;
      case 'TWEET':
        return <div style={placeholder}>TWEET · {block.data.url}</div>;
      case 'MARKDOWN': {
        const table = parseTableMarkdown(block.data.markdown);
        if (table) {
          return (
            <div style={{ overflow: 'auto', margin: '0 0 12px' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr>
                    {table.header.map((h, i) => (
                      <th key={i} style={{ ...cell, background: 'var(--p2)', fontWeight: 600 }}>
                        <CellInline text={h} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((r, i) => (
                    <tr key={i}>
                      {r.map((c, j) => (
                        <td key={j} style={cell}>
                          <CellInline text={c} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        // 围栏代码:原文首行是开栏(带语言)、末行是闭栏,预览只显示代码本体。
        const lines = block.data.markdown.split('\n');
        return <pre style={pre}>{lines.slice(1, -1).join('\n')}</pre>;
      }
    }
  }
  const inline = <Inline text={block.text} ranges={block.inlineStyleRanges} links={block.links} />;
  switch (block.type) {
    case 'header-one':
      return <h2 style={heading(1)}>{inline}</h2>;
    case 'header-two':
      return <h3 style={heading(2)}>{inline}</h3>;
    case 'blockquote':
      return <blockquote style={quote}>{inline}</blockquote>;
    default:
      return <p style={para}>{inline}</p>;
  }
}

/** 纯渲染(无 hooks),供单测直接 renderToStaticMarkup;编辑卡的外壳见 sidepanel 的 DraftPreview。 */
export function BlockList({ blocks }: { blocks: ImportBlock[] }) {
  return (
    <>
      {groupBlocks(blocks).map((g, i) => {
        if (g.kind === 'block') return <Block key={i} block={g.block} />;
        const items = g.items.map((b, j) => (
          <li key={j} style={listItem}>
            <Inline text={b.text} ranges={b.inlineStyleRanges} links={b.links} />
          </li>
        ));
        return g.ordered ? <ol key={i} style={list}>{items}</ol> : <ul key={i} style={list}>{items}</ul>;
      })}
    </>
  );
}
