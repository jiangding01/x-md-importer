// lib/markdown/frontmatter.ts 单测:extractTitle / extractCover / stripFirstH1。
// 覆盖范围见 SKILL 任务描述 §frontmatter.test.ts。测试按当前实际行为编写;
// 若发现疑似生产 bug,以注释标注(不修改生产代码),并在最终报告汇总。
import { describe, expect, it } from 'vitest';
import { extractCover, extractTitle, stripFirstH1 } from './frontmatter';

describe('extractTitle · frontmatter 三键', () => {
  it('title: 命中', () => {
    const md = '---\ntitle: Hello World\n---\n\n正文';
    expect(extractTitle(md)).toEqual({ title: 'Hello World', source: 'frontmatter' });
  });

  it('Title: 命中(大写变体)', () => {
    const md = '---\nTitle: Hello World\n---\n\n正文';
    expect(extractTitle(md)).toEqual({ title: 'Hello World', source: 'frontmatter' });
  });

  it('标题: 命中(中文键)', () => {
    const md = '---\n标题: 你好世界\n---\n\n正文';
    expect(extractTitle(md)).toEqual({ title: '你好世界', source: 'frontmatter' });
  });

  it('大小写不匹配的键(TITLE:)不命中,回落到正文 H1', () => {
    const md = '---\nTITLE: Wrong\n---\n\n# Real Title\n';
    expect(extractTitle(md)).toEqual({ title: 'Real Title', source: 'h1' });
  });
});

describe('extractTitle · 引号剥离', () => {
  it('双引号包裹的值被剥离', () => {
    const md = '---\ntitle: "Quoted Title"\n---\n';
    expect(extractTitle(md)).toEqual({ title: 'Quoted Title', source: 'frontmatter' });
  });

  it('单引号包裹的值被剥离', () => {
    const md = "---\ntitle: 'Quoted Title'\n---\n";
    expect(extractTitle(md)).toEqual({ title: 'Quoted Title', source: 'frontmatter' });
  });
});

describe('extractTitle · 空值与缺失', () => {
  it('title 值为空 → 视为未命中,回落到正文 H1', () => {
    const md = '---\ntitle:\n---\n\n# Fallback H1\n';
    expect(extractTitle(md)).toEqual({ title: 'Fallback H1', source: 'h1' });
  });

  it('title 值为纯空白 → 视为未命中', () => {
    const md = '---\ntitle:    \n---\n\n# Fallback H1\n';
    expect(extractTitle(md)).toEqual({ title: 'Fallback H1', source: 'h1' });
  });

  it('无 frontmatter → 取正文首个 H1', () => {
    const md = '# 只有 H1\n\n正文内容';
    expect(extractTitle(md)).toEqual({ title: '只有 H1', source: 'h1' });
  });

  it('frontmatter 与 H1 都没有 → null', () => {
    const md = '普通段落,没有标题。\n\n另一段。';
    expect(extractTitle(md)).toBeNull();
  });
});

describe('extractTitle · frontmatter 体含空行 → 不认定(与 parser 对齐)', () => {
  it('闭合 --- 出现在首个空行之后 → 不视为 frontmatter,title 键不生效', () => {
    const md = '---\ntitle: Should Not Count\n\n---\n# Real Title\n';
    // frontmatterBody: 遇到空行(第 3 行)先于闭合 --- 返回 null → fromFrontmatter 返回 null。
    // 首行 `---` 本身不匹配 H1 正则(要求 # 开头),故 H1 抽取继续找到 "# Real Title"。
    expect(extractTitle(md)).toEqual({ title: 'Real Title', source: 'h1' });
  });

  it('frontmatter 未闭合(无闭合 ---)→ 不认定', () => {
    const md = '---\ntitle: Never Closed\n\n# Real Title\n';
    expect(extractTitle(md)).toEqual({ title: 'Real Title', source: 'h1' });
  });
});

describe('extractTitle · H1 抽取跳过代码围栏', () => {
  it('``` 围栏内的 # x 不被当作标题', () => {
    const md = '```\n# fake title in code\n```\n\n# Real Title\n';
    expect(extractTitle(md)).toEqual({ title: 'Real Title', source: 'h1' });
  });

  it('~~~ 围栏内的 # x 同样被跳过', () => {
    const md = '~~~\n# fake title\n~~~\n\n# Real Title\n';
    expect(extractTitle(md)).toEqual({ title: 'Real Title', source: 'h1' });
  });

  it('全文唯一的 # 都在代码块内 → 找不到 H1', () => {
    const md = '```\n# only in code\n```\n\n正文,没有标题。';
    expect(extractTitle(md)).toBeNull();
  });

  it('## 二级标题不被当作 H1(仅 # 后紧跟空白才命中)', () => {
    const md = '## 这是二级标题\n\n# 这才是 H1\n';
    expect(extractTitle(md)).toEqual({ title: '这才是 H1', source: 'h1' });
  });
});

describe('stripFirstH1', () => {
  it('删除被抽为标题的那一行,不动其余内容', () => {
    const md = '# 标题\n\n正文第一段。\n\n正文第二段。';
    const stripped = stripFirstH1(md);
    expect(stripped).toBe('\n正文第一段。\n\n正文第二段。');
    expect(stripped).not.toContain('# 标题');
  });

  it('不动代码块内的 # x(即使它长得像 H1)', () => {
    const md = '# 真标题\n\n```\n# 这是代码注释,不是标题\n```\n';
    const stripped = stripFirstH1(md);
    expect(stripped).not.toContain('# 真标题');
    expect(stripped).toContain('# 这是代码注释,不是标题'); // 代码块内容原样保留
  });

  it('无 H1 时原样返回', () => {
    const md = '只有正文,没有标题。';
    expect(stripFirstH1(md)).toBe(md);
  });

  it('CRLF 文档:按行删除后以 \\n 重新拼接(换行风格被规范化,当前实际行为)', () => {
    // 疑似生产 bug 关注点:输入为 CRLF,split(/\r?\n/) 正确切分,但 join('\n') 统一吐出 LF,
    // 结果文档的换行风格从 CRLF 被静默改写成 LF。这里按当前实际行为断言,不代表这是期望行为。
    const md = '# 标题\r\n\r\n正文一\r\n\r\n正文二';
    const stripped = stripFirstH1(md);
    expect(stripped).toBe('\n正文一\n\n正文二'); // 实际输出已无 \r
    expect(stripped).not.toContain('\r');
    expect(stripped.split('\n')).toEqual(['', '正文一', '', '正文二']);
  });
});

describe('extractCover', () => {
  it('普通路径值(无包裹)原样返回', () => {
    const md = '---\ncover: assets/x.png\n---\n';
    expect(extractCover(md)).toBe('assets/x.png');
  });

  it('cover: "![[a.png]]" → 剥壳取 a.png(引号先被 stripQuotes 剥离,再识别 wiki 包裹)', () => {
    const md = '---\ncover: "![[a.png]]"\n---\n';
    expect(extractCover(md)).toBe('a.png');
  });

  it('cover: ![](b.png) → 剥壳取 b.png', () => {
    const md = '---\ncover: ![](b.png)\n---\n';
    expect(extractCover(md)).toBe('b.png');
  });

  it('无 cover 键 → null', () => {
    const md = '---\ntitle: X\n---\n';
    expect(extractCover(md)).toBeNull();
  });

  it('无 frontmatter → null(不从正文兜底,由上层负责)', () => {
    const md = '# 标题\n\n![封面](cover.png)\n';
    expect(extractCover(md)).toBeNull();
  });

  it('Cover / 封面 键变体同样命中', () => {
    expect(extractCover('---\nCover: c1.png\n---\n')).toBe('c1.png');
    expect(extractCover('---\n封面: c2.png\n---\n')).toBe('c2.png');
  });

  it('[[x]](无 ! 的内链)同样剥壳', () => {
    const md = '---\ncover: [[wiki.png]]\n---\n';
    expect(extractCover(md)).toBe('wiki.png');
  });
});
