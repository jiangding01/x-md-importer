import type { CSSProperties } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useI18n } from '@/lib/i18n/useI18n';

const headingSize: Record<number, string> = { 1: '17px', 2: '14.5px', 3: '13px', 4: '12px', 5: '11.5px', 6: '11px' };

function heading(level: number): CSSProperties {
  return {
    font: `600 ${headingSize[level]}/1.5 var(--fDisp)`,
    color: 'var(--ink)',
    margin: level === 1 ? '0 0 12px' : '18px 0 8px',
  };
}

const cell: CSSProperties = {
  border: '1px solid var(--line)',
  padding: '5px 9px',
  font: '400 10.5px var(--fUI)',
  color: 'var(--ink)',
  textAlign: 'left',
};

const inlineCode: CSSProperties = {
  font: '500 10.5px var(--fMono)',
  background: 'var(--p2)',
  padding: '1.5px 5px',
  borderRadius: 5,
  color: 'var(--accInk)',
};

const components: Components = {
  h1: ({ children }) => <h1 style={heading(1)}>{children}</h1>,
  h2: ({ children }) => <h2 style={heading(2)}>{children}</h2>,
  h3: ({ children }) => <h3 style={heading(3)}>{children}</h3>,
  h4: ({ children }) => <h4 style={heading(4)}>{children}</h4>,
  h5: ({ children }) => <h5 style={heading(5)}>{children}</h5>,
  h6: ({ children }) => <h6 style={heading(6)}>{children}</h6>,
  p: ({ children }) => (
    <p style={{ font: '400 12px/1.85 var(--fUI)', color: 'var(--ink)', margin: '0 0 10px' }}>{children}</p>
  ),
  strong: ({ children }) => <strong style={{ fontWeight: 600 }}>{children}</strong>,
  em: ({ children }) => <em>{children}</em>,
  del: ({ children }) => <del>{children}</del>,
  a: ({ children, href }) => (
    <a
      href={href}
      onClick={(e) => e.preventDefault()}
      style={{ textDecoration: 'underline', textUnderlineOffset: 3 }}
    >
      {children}
    </a>
  ),
  ul: ({ children }) => <ul style={{ margin: '0 0 12px', paddingLeft: 18 }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ margin: '0 0 12px', paddingLeft: 18 }}>{children}</ol>,
  li: ({ children }) => (
    <li style={{ font: '400 12px/1.85 var(--fUI)', color: 'var(--ink)', marginBottom: 2 }}>{children}</li>
  ),
  blockquote: ({ children }) => (
    <blockquote
      style={{
        borderLeft: '2px solid var(--acc)',
        margin: '0 0 12px',
        padding: '2px 0 2px 12px',
        color: 'var(--ink2)',
        font: '400 11.5px/1.8 var(--fUI)',
      }}
    >
      {children}
    </blockquote>
  ),
  hr: () => <hr style={{ border: 'none', borderTop: '1px solid var(--line)', margin: '16px 0' }} />,
  pre: ({ children }) => (
    <pre
      style={{
        background: 'var(--p2)',
        borderRadius: 8,
        padding: '11px 13px',
        overflow: 'auto',
        font: '400 10.5px/1.7 var(--fMono)',
        color: 'var(--ink)',
        margin: '0 0 12px',
      }}
    >
      {children}
    </pre>
  ),
  code: ({ children, className }) => {
    const text = String(children ?? '');
    const isBlock = /language-/.test(className ?? '') || text.includes('\n');
    if (isBlock) return <code className={className}>{children}</code>;
    return <code style={inlineCode}>{children}</code>;
  },
  table: ({ children }) => (
    <div style={{ overflow: 'auto', margin: '0 0 12px' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>{children}</table>
    </div>
  ),
  th: ({ children }) => <th style={{ ...cell, background: 'var(--p2)', fontWeight: 600 }}>{children}</th>,
  td: ({ children }) => <td style={cell}>{children}</td>,
  img: ({ alt, src }) => (
    <div
      style={{
        height: 90,
        borderRadius: 8,
        margin: '4px 0 12px',
        border: '1px solid var(--line)',
        background: 'repeating-linear-gradient(45deg,var(--p2) 0 10px,transparent 10px 20px)',
        display: 'grid',
        placeItems: 'center',
        font: '500 8.5px var(--fMono)',
        color: 'var(--ink3)',
        letterSpacing: '1px',
      }}
    >
      IMAGE · {alt || src}
    </div>
  ),
};

/** 去除顶部 frontmatter（--- ... ---），与设计稿预览一致。 */
function stripFrontmatter(src: string): string {
  const lines = src.split('\n');
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) return lines.slice(end + 1).join('\n');
  }
  return src;
}

export function Preview({ md }: { md: string }) {
  const { lang } = useI18n();
  if (!md.trim()) {
    return (
      <div style={{ padding: '30px 0', textAlign: 'center', font: '400 11px var(--fUI)', color: 'var(--ink3)' }}>
        {lang === 'en' ? 'Nothing to preview yet' : '暂无内容可预览'}
      </div>
    );
  }
  return (
    <Markdown remarkPlugins={[remarkGfm]} components={components}>
      {stripFrontmatter(md)}
    </Markdown>
  );
}
