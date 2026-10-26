// 第三批 C3(O2):预览按解析产出渲染「写进 X 的样子」,替代 react-markdown。
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BlockList, groupBlocks, inlineSegments, parseTableMarkdown, safeHref } from './BlockPreview';
import { parseMarkdown } from './parser';

const html = (md: string) => renderToStaticMarkup(createElement(BlockList, { blocks: parseMarkdown(md) }));

describe('inlineSegments', () => {
  it('按样式 / 链接边界切段,重叠区间叠加', () => {
    const segs = inlineSegments('abcdef', [
      { offset: 0, length: 4, style: 'BOLD' },
      { offset: 2, length: 4, style: 'ITALIC' },
    ], [{ offset: 3, length: 2, url: 'https://x.com' }]);
    expect(segs).toEqual([
      { text: 'ab', bold: true, italic: false, strike: false, href: null },
      { text: 'c', bold: true, italic: true, strike: false, href: null },
      { text: 'd', bold: true, italic: true, strike: false, href: 'https://x.com' },
      { text: 'e', bold: false, italic: true, strike: false, href: 'https://x.com' },
      { text: 'f', bold: false, italic: true, strike: false, href: null },
    ]);
  });
  it('无样式 → 一段;空文本 → 无段', () => {
    expect(inlineSegments('纯文本', [], [])).toEqual([{ text: '纯文本', bold: false, italic: false, strike: false, href: null }]);
    expect(inlineSegments('', [], [])).toEqual([]);
  });
  it('emoji(代理对)不被切开:offset 以 UTF-16 码元计,与解析器一致', () => {
    const segs = inlineSegments('😀ab', [{ offset: 2, length: 1, style: 'BOLD' }], []);
    expect(segs.map((s) => s.text)).toEqual(['😀', 'a', 'b']);
  });
});

describe('safeHref', () => {
  it('只放行 http(s) / mailto', () => {
    expect(safeHref('https://a.com')).toBe('https://a.com');
    expect(safeHref('HTTP://a.com')).toBe('HTTP://a.com');
    expect(safeHref('mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(safeHref('javascript:alert(1)')).toBe(null);
    expect(safeHref(' JavaScript:alert(1)')).toBe(null);
    expect(safeHref('data:text/html,x')).toBe(null);
    expect(safeHref('./rel')).toBe(null);
  });
});

describe('groupBlocks', () => {
  it('相邻同类列表项合成一组(嵌套层级不缩进,与 X 扁平一致);不同类型断开', () => {
    const g = groupBlocks(parseMarkdown('- a\n  - b\n- c\n\n1. x\n2. y\n\n段落'));
    expect(g.map((x) => (x.kind === 'list' ? `${x.ordered ? 'ol' : 'ul'}:${x.items.length}` : x.block.kind))).toEqual(['ul:3', 'ol:2', 'text']);
  });
});

describe('parseTableMarkdown', () => {
  it('表头 + 分隔行 + 数据行;首尾竖线可省;\\| 转义保留为字面竖线', () => {
    expect(parseTableMarkdown('| A | B |\n|---|---|\n| 1 | a\\|b |\nc | d')).toEqual({ header: ['A', 'B'], rows: [['1', 'a|b'], ['c', 'd']] });
  });
  it('不是表格 → null', () => {
    expect(parseTableMarkdown('```js\nx\n```')).toBe(null);
  });
  it('代码块正文首行形似分隔行也不当表格(先认围栏,与能力计数同口径)', () => {
    expect(parseTableMarkdown('```\n|---|\n| a |\n```')).toBe(null);
    expect(parseTableMarkdown('~~~\n---|---\n~~~')).toBe(null);
  });
});

describe('BlockList 渲染', () => {
  it('标题:H1 / H2 同为一级,H3 为二级,H4+ 为加粗段落', () => {
    const out = html('# 一\n\n## 二\n\n### 三\n\n#### 四');
    expect(out).toMatch(/<h2[^>]*>一<\/h2><h2[^>]*>二<\/h2><h3[^>]*>三<\/h3><p[^>]*><strong[^>]*>四<\/strong><\/p>/);
  });
  it('行内:粗斜删 + 安全链接;javascript: 链接不生成 href', () => {
    const out = html('**粗** _斜_ ~~删~~ [好](https://a.com) [坏](javascript:alert(1))');
    expect(out).toContain('<strong');
    expect(out).toContain('<em>斜</em>');
    expect(out).toContain('<s>删</s>');
    expect(out).toContain('href="https://a.com"');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('坏');
  });
  it('行内代码保留反引号(X 无行内代码,写入也是原样)', () => {
    expect(html('用 `npm i` 安装')).toContain('用 `npm i` 安装');
  });
  it('代码块去掉围栏行;表格渲染为 table;分割线;公式;推文', () => {
    const out = html('```js\nconst a = 1;\n```\n\n| A |\n|---|\n| **1** |\n\n---\n\n$$\nE=mc^2\n$$\n\nhttps://x.com/u/status/123');
    expect(out).toContain('<pre');
    expect(out).toContain('const a = 1;');
    expect(out).not.toContain('```');
    expect(out).toMatch(/<table[\s\S]*<th[^>]*>A<\/th>[\s\S]*<td[^>]*><strong[^>]*>1<\/strong><\/td>/);
    expect(out).toContain('<hr');
    expect(out).toContain('E=mc^2');
    expect(out).toContain('twitter.com/i/web/status/123'); // TWEET 块存的是规范化后的地址(写入 X 用的就是它)
  });
  it('图片为占位框(不发请求),显示 alt 或来源', () => {
    const out = html('![封面](https://a.com/x.png)\n\n![](./local.png)');
    expect(out).not.toContain('<img');
    expect(out).toContain('封面');
    expect(out).toContain('./local.png');
  });
  it('任务列表沿用解析产出的 ☐ / ☑ 前缀', () => {
    expect(html('- [ ] 待办\n- [x] 完成')).toMatch(/☐ 待办[\s\S]*☑ 完成/);
  });
  it('不使用 dangerouslySetInnerHTML:HTML 原样作为文本', () => {
    const out = html('<script>alert(1)</script>');
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });
});
