// 第二批 W6:「是否涉及本地图」与封面来源的判定,素材板与写入流程共用一份。
import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../markdown/parser';
import { pickCoverSource, usesLocalImage } from './importPlan';

describe('pickCoverSource', () => {
  it('frontmatter cover 优先;否则正文首图(带下标);关掉设置封面 → null', () => {
    const md = '---\ncover: ./c.png\n---\n![](https://a.com/x.png)';
    const blocks = parseMarkdown(md);
    expect(pickCoverSource(md, blocks, true)).toEqual({ source: './c.png', bodyIndex: null });
    const md2 = '正文\n\n![](https://a.com/x.png)';
    const b2 = parseMarkdown(md2);
    expect(pickCoverSource(md2, b2, true)).toEqual({ source: 'https://a.com/x.png', bodyIndex: 1 });
    expect(pickCoverSource(md2, b2, false)).toBeNull();
  });
});

describe('usesLocalImage', () => {
  it('正文本地图 / 本地封面 → true;远程 / dataURI → false', () => {
    expect(usesLocalImage(parseMarkdown('![](./a.png)'), null)).toBe(true);
    expect(usesLocalImage(parseMarkdown('正文'), './c.png')).toBe(true);
    expect(usesLocalImage(parseMarkdown('![](https://a.com/a.png)'), 'https://a.com/c.png')).toBe(false);
    expect(usesLocalImage(parseMarkdown('正文'), null)).toBe(false);
  });
});
