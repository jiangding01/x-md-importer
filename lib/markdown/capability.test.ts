// lib/markdown/capability.ts 单测:capability / images / firstTitle。
// capability() 基于 parseMarkdown 的块级产出统计(而非独立正则),本文件重点覆盖
// 模块注释中提到的历史回归点。测试按当前实际行为编写;若发现疑似生产 bug,
// 以注释标注(不修改生产代码),并在最终报告汇总。
import { describe, expect, it } from 'vitest';
import { capability, images, firstTitle } from './capability';
import { extractTitle } from './frontmatter';

const find = (items: ReturnType<typeof capability>, label: string) => items.find((it) => it.label === label);

describe('capability · 计数正确性(历史回归)', () => {
  it('纯 --- 分割线不被误计为表格', () => {
    const md = '第一段。\n\n---\n\n第二段。';
    const items = capability(md, false);
    expect(find(items, '分割线 → DIVIDER')?.count).toBe(1);
    expect(find(items, '表格 → 原生表格')).toBeUndefined();
  });

  it('文首 frontmatter 的 --- 不计入分割线', () => {
    const md = '---\ntitle: X\n---\n\n# H\n\n正文';
    const items = capability(md, false);
    // frontmatter 被 parseMarkdown 整体跳过,两条 --- 都不产出 DIVIDER 块
    expect(find(items, '分割线 → DIVIDER')).toBeUndefined();
    expect(find(items, '二级标题 → Heading')?.count).toBe(1);
  });

  it('正文中间的 --- 分割线仍正常计数(不受 frontmatter 跳过逻辑影响)', () => {
    const md = '---\ntitle: X\n---\n\n段落一\n\n---\n\n段落二';
    const items = capability(md, false);
    expect(find(items, '分割线 → DIVIDER')?.count).toBe(1);
  });

  it('1 个 H3 + 3 个 H4 → H3 计 1、H4+ 计 3(不出现减法导致的负数消失)', () => {
    const md = '### Sub\n\n#### One\n\n#### Two\n\n#### Three\n';
    const items = capability(md, false);
    expect(find(items, '三级标题 → Subheading')?.count).toBe(1);
    expect(find(items, '四级以下标题 → 粗体段落')?.count).toBe(3);
  });

  it('~~~ 围栏计代码块,其内容(含 ~~x~~ 语法)不计删除线', () => {
    const md = '~~~\n~~strike~~\nplain\n~~~\n';
    const items = capability(md, false);
    expect(find(items, '代码块 → 原生代码块')?.count).toBe(1);
    expect(find(items, '粗体 / 斜体 / 删除线')).toBeUndefined();
  });

  it('``` 围栏同样计代码块', () => {
    const md = '```ts\nconst x = 1;\n```\n';
    const items = capability(md, false);
    expect(find(items, '代码块 → 原生代码块')?.count).toBe(1);
  });
});

describe('capability · 表格/代码块经 MARKDOWN atomic 区分', () => {
  it('GFM 表格计入表格,不计代码块', () => {
    const md = '| a | b |\n| - | - |\n| 1 | 2 |\n';
    const items = capability(md, false);
    expect(find(items, '表格 → 原生表格')?.count).toBe(1);
    expect(find(items, '代码块 → 原生代码块')).toBeUndefined();
  });

  it('表格与代码块同时出现,各自独立计数', () => {
    const md = '| a | b |\n| - | - |\n| 1 | 2 |\n\n```\ncode\n```\n';
    const items = capability(md, false);
    expect(find(items, '表格 → 原生表格')?.count).toBe(1);
    expect(find(items, '代码块 → 原生代码块')?.count).toBe(1);
  });
});

describe('capability · 行内代码计数', () => {
  it('段落内 `code` 保留反引号,按出现次数计数', () => {
    const md = '这是 `code` 和 `more code`,共两处。';
    const items = capability(md, false);
    expect(find(items, '行内代码')?.count).toBe(2);
  });

  it('围栏代码块内容不计入行内代码(已单独成 atomic 块)', () => {
    const md = '```\n`not inline`\n```\n';
    const items = capability(md, false);
    expect(find(items, '行内代码')).toBeUndefined();
  });
});

describe('capability · 图片计数(独占行才算)', () => {
  it('独占一行的图片计入 imageCount', () => {
    const md = '![alt](x.png)\n';
    const items = capability(md, false);
    expect(find(items, '图片 → 上传')?.count).toBe(1);
  });

  it('段落内嵌的图片(非独占行)不计入 capability 的图片计数', () => {
    const md = '这段文字里有 ![inline](y.png) 一张行内图片,不是独占行。';
    const items = capability(md, false);
    expect(find(items, '图片 → 上传')).toBeUndefined();
  });

  it('一独占 + 一行内混合:仅独占行计 1', () => {
    const md = '![cover](x.png)\n\n正文里还有 ![inline](y.png) 图片。';
    const items = capability(md, false);
    expect(find(items, '图片 → 上传')?.count).toBe(1);
  });
});

describe('capability · 中英文 label 切换', () => {
  it('en=false 使用中文 label,en=true 使用英文 label', () => {
    const md = '# H\n\n- item\n';
    const zh = capability(md, false);
    const en = capability(md, true);
    expect(find(zh, '二级标题 → Heading')).toBeDefined();
    expect(find(en, 'H2 → Heading')).toBeDefined();
    expect(find(zh, 'H2 → Heading')).toBeUndefined();
    expect(find(en, '二级标题 → Heading')).toBeUndefined();
  });
});

describe('capability · 其余块类型', () => {
  it('列表(有序+无序合计)', () => {
    const md = '- a\n- b\n\n1. c\n2. d\n';
    const items = capability(md, false);
    expect(find(items, '列表')?.count).toBe(4);
  });

  it('引用逐行独立成块', () => {
    const md = '> line1\n> line2\n';
    const items = capability(md, false);
    expect(find(items, '引用')?.count).toBe(2);
  });

  it('粗体/斜体/删除线按 range 数计数', () => {
    const md = '**粗体** 和 *斜体* 还有 ~~删除线~~。';
    const items = capability(md, false);
    expect(find(items, '粗体 / 斜体 / 删除线')?.count).toBe(3);
  });

  it('链接计数', () => {
    const md = '[a](https://a.com) 和 [b](https://b.com)';
    const items = capability(md, false);
    expect(find(items, '链接')?.count).toBe(2);
  });

  it('推文嵌入计数', () => {
    const md = 'https://x.com/user/status/1234567890\n';
    const items = capability(md, false);
    expect(find(items, '推文 URL → 嵌入卡片')?.count).toBe(1);
  });
});

describe('capability · 空文档与 count=0 项', () => {
  it('空文档 → 空数组', () => {
    expect(capability('', false)).toEqual([]);
  });

  it('纯段落文本(无任何特殊结构)→ 空数组', () => {
    expect(capability('Hello world, just a plain paragraph.', false)).toEqual([]);
  });

  it('count=0 的项不出现在结果中(仅出现存在的类别)', () => {
    const md = '# H\n';
    const items = capability(md, false);
    const labels = items.map((it) => it.label);
    expect(labels).toEqual(['二级标题 → Heading']);
  });
});

describe('images()', () => {
  it('空文档 → 空数组', () => {
    expect(images('')).toEqual([]);
  });

  it('识别独占行与行内图片(与 capability 的 imageCount 不同,images() 不区分是否独占行)', () => {
    // 疑似设计差异(非必然 bug,记录当前行为):capability() 的 imageCount 基于 parseMarkdown
    // 的块级产出,仅独占行图片计数;而 images() 用独立正则扫描全文,行内图片也会被收进来。
    // 两者语义不同,消费方若混用两个数字可能产生"图片计数对不上"的困惑。
    const md = '![cover](x.png)\n\n正文里还有 ![inline](y.png) 图片。';
    const result = images(md);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.src)).toEqual(['x.png', 'y.png']);
  });

  it('local / remote / data 三种 kind 分类', () => {
    const md = '![a](local.png) ![b](https://example.com/b.png) ![c](data:image/png;base64,AAAA)';
    const result = images(md);
    expect(result).toEqual([
      { src: 'local.png', kind: 'local' },
      { src: 'https://example.com/b.png', kind: 'remote' },
      { src: 'data:image/png;base64,AAAA', kind: 'data' },
    ]);
  });
});

describe('firstTitle()', () => {
  it('取第一个 # H1', () => {
    expect(firstTitle('# 我的标题\n\n正文', false)).toBe('我的标题');
  });

  it('无 H1 时按语言回落默认文案', () => {
    expect(firstTitle('没有标题的正文', false)).toBe('未命名草稿');
    expect(firstTitle('no title body', true)).toBe('Untitled draft');
  });

  it('疑似生产 bug:firstTitle 不跳过代码围栏,与 frontmatter.extractTitle 行为不一致', () => {
    // frontmatter.ts 的 findFirstH1 特意用 forEachContentLine 跳过围栏代码块(见其函数注释),
    // 但 capability.ts 的 firstTitle 用裸正则 `/^#\s+(.+)$/m` 逐行匹配,未做围栏感知。
    // 结果:同一份文档,firstTitle() 会把代码块里的 "# fake" 误当标题,而 extractTitle() 不会。
    // 两个「抽取正文首个 H1」的函数在此产生行为分裂,建议后续复用 frontmatter.ts 的
    // findFirstH1 / forEachContentLine 统一逻辑(与模块顶部注释里提到的"历史修复统一"精神一致)。
    const md = '```\n# fake title in code\n```\n\n# Real Title\n';
    expect(firstTitle(md, false)).toBe('fake title in code'); // 当前实际行为(疑似 bug)
    expect(extractTitle(md)).toEqual({ title: 'Real Title', source: 'h1' }); // 对照:frontmatter.ts 的正确行为
  });
});
