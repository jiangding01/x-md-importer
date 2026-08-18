// lib/markdown/Preview.tsx 的纯函数单测(B3-7 / P2-9)。
// 只测 stripFrontmatterForPreview——组件渲染依赖 DOM,不在本单测层(见 vitest.config.ts 注释)。
import { describe, expect, it } from 'vitest';
import { stripFrontmatterForPreview } from './Preview';
import { frontmatterBodyStart } from './parser';

describe('stripFrontmatterForPreview', () => {
  it('LF 文档:剥掉文首 frontmatter', () => {
    expect(stripFrontmatterForPreview('---\ntitle: X\n---\n\n正文')).toBe('\n正文');
  });

  it('CRLF 文档同样剥掉(旧实现 split(\\n) 后首行是 `---\\r`,整块当正文渲染)', () => {
    const out = stripFrontmatterForPreview('---\r\ntitle: X\r\n---\r\n\r\n正文');
    expect(out).not.toContain('title: X');
    expect(out).toContain('正文');
  });

  it('无 frontmatter 时原样返回(含 CRLF 风格不被改写)', () => {
    const md = '# 标题\r\n\r\n正文';
    expect(stripFrontmatterForPreview(md)).toBe(md);
  });

  it('闭合 `---` 在首个空行之后 → 不认作 frontmatter(与 parser 同源)', () => {
    // 旧实现的 indexOf('---', 1) 会把中间正文当 frontmatter 剥掉。
    const md = '---\n\n正文\n\n---';
    expect(stripFrontmatterForPreview(md)).toBe(md);
  });

  it('未闭合的 frontmatter 不剥', () => {
    const md = '---\ntitle: 未闭合\n\n正文';
    expect(stripFrontmatterForPreview(md)).toBe(md);
  });

  it('剥离起点与 parser 的 frontmatterBodyStart 完全一致', () => {
    for (const md of ['---\ntitle: X\n---\n正文', '正文', '---\n\n正文\n\n---']) {
      const lines = md.split(/\r?\n/);
      const expected = frontmatterBodyStart(lines) === 0 ? md : lines.slice(frontmatterBodyStart(lines)).join('\n');
      expect([md, stripFrontmatterForPreview(md)]).toEqual([md, expected]);
    }
  });
});
