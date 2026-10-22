// lib/markdown/frontmatter.ts 单测:extractTitle / extractCover / stripFirstH1。
// 覆盖范围见 SKILL 任务描述 §frontmatter.test.ts。测试按当前实际行为编写;
// 若发现疑似生产 bug,以注释标注(不修改生产代码),并在最终报告汇总。
import { describe, expect, it } from 'vitest';
import { extractCover, extractTitle, stripFirstH1 } from './frontmatter';
import { parseMarkdown } from './parser';

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

// B3-9(P2-11):YAML block scalar 与行内注释此前直接进标题——`title: >` 产出标题 `">"`,
// `title: 我的标题 # 草稿` 把注释一起写进 X。
describe('extractTitle · YAML block scalar 与行内注释(B3-9)', () => {
  it('title 值为 `>` / `|` 及其变体 → 视为未命中,回落 H1', () => {
    for (const v of ['>', '|', '>-', '|-', '>+', '|+', '>2']) {
      const md = `---\ntitle: ${v}\n  多行标题\n---\n\n# 真标题\n`;
      expect([v, extractTitle(md)]).toEqual([v, { title: '真标题', source: 'h1' }]);
    }
  });

  it('行内注释被剥离(`#` 前有空白且值未加引号)', () => {
    expect(extractTitle('---\ntitle: 我的标题 # 草稿\n---\n')).toEqual({
      title: '我的标题',
      source: 'frontmatter',
    });
  });

  it('`title: 前端 #1 技巧` 按 YAML 语义截为「前端」', () => {
    expect(extractTitle('---\ntitle: 前端 #1 技巧\n---\n')).toEqual({
      title: '前端',
      source: 'frontmatter',
    });
  });

  it('`#` 前无空白(如 `C#`)不剥', () => {
    expect(extractTitle('---\ntitle: C# 入门\n---\n')?.title).toBe('C# 入门');
  });

  it('加引号的值不剥注释,闭引号之后的注释丢弃', () => {
    expect(extractTitle('---\ntitle: "前端 #1 技巧"\n---\n')?.title).toBe('前端 #1 技巧');
    expect(extractTitle('---\ntitle: "我的标题" # 草稿\n---\n')?.title).toBe('我的标题');
  });

  it('加引号的 `title: ">"` 是字面量,不当 block scalar', () => {
    expect(extractTitle('---\ntitle: ">"\n---\n')).toEqual({ title: '>', source: 'frontmatter' });
  });

  it('值本身就是注释(`title: # 注释`)→ 视为空,回落 H1', () => {
    expect(extractTitle('---\ntitle: # 注释\n---\n\n# 真标题\n')).toEqual({
      title: '真标题',
      source: 'h1',
    });
  });

  it('注释剥离**不外溢到 cover**(共用 stripQuotes,不许截断含 # 的封面路径)', () => {
    expect(extractCover('---\ncover: assets/图 #1.png\n---\n')).toBe('assets/图 #1.png');
    expect(extractCover('---\ncover: assets/a#1.png\n---\n')).toBe('assets/a#1.png');
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

describe('extractTitle · H1 抽取跳过文首 frontmatter(B3-3 / P1-6)', () => {
  // `# 注释` 是合法 YAML 注释(Obsidian 模板常见)。此前 findFirstH1 从第 0 行扫起,
  // frontmatter 内的注释被抽成文章标题;h1Handle=remove 时还会从 frontmatter **内部**删行。
  it('frontmatter 内的 YAML 注释 `# x` 不被当作标题', () => {
    const md = '---\n# 元数据区\nfoo: bar\n---\n\n# 真标题\n';
    expect(extractTitle(md)).toEqual({ title: '真标题', source: 'h1' });
  });

  it('frontmatter 内的注释 + 正文无 H1 → null(不误抽)', () => {
    const md = '---\n# 元数据区\nfoo: bar\n---\n\n只有正文。\n';
    expect(extractTitle(md)).toBeNull();
  });

  it('frontmatter 末行 + 闭合 `---` 不构成 setext 标题', () => {
    // 闭合行是 `---`(二级)本就不作标题,这里钉住的是「frontmatter 体不进标题扫描」这条口径。
    const md = '---\nfoo: bar\n---\n\n正文';
    expect(extractTitle(md)).toBeNull();
  });

  it('stripFirstH1 不从 frontmatter 内部删行', () => {
    const md = '---\n# 元数据区\nfoo: bar\n---\n\n# 真标题\n\n正文';
    const stripped = stripFirstH1(md);
    expect(stripped).toContain('# 元数据区'); // frontmatter 完整保留
    expect(stripped).not.toContain('# 真标题');
  });
});

// B3-6(P2-8):H1 判定必须与 parser 的 RE_HEADING 同步放宽,否则出现
// 「parser 认成标题、extractTitle 抽不到」的分裂(HANDOFF §8 记过两次同类教训)。
describe('extractTitle · 0-3 空格缩进的 H1(B3-6)', () => {
  it('缩进 1-3 空格的 `# x` 仍被抽为标题', () => {
    for (const md of [' # 标题', '  # 标题', '   # 标题']) {
      expect([md, extractTitle(md)]).toEqual([md, { title: '标题', source: 'h1' }]);
    }
  });

  it('缩进 ≥4 空格的 `# x` 不作标题(与 parser 一致:那是缩进代码领域)', () => {
    expect(extractTitle('    # 不是标题')).toBeNull();
  });

  it('stripFirstH1 删掉的正是那行缩进 H1', () => {
    expect(stripFirstH1('  # 标题\n\n正文')).toBe('\n正文');
  });

  it('缩进围栏内的 `# x` 仍被跳过(forEachContentLine 的围栏判定同步放宽)', () => {
    expect(extractTitle('  ```\n  # 假标题\n  ```\n\n# 真标题')).toEqual({
      title: '真标题',
      source: 'h1',
    });
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

describe('setext 一级标题的抽取与移除', () => {
  it('setext H1(===)可作文章标题,source 仍为 h1', () => {
    expect(extractTitle('我的标题\n===\n\n正文')).toEqual({ title: '我的标题', source: 'h1' });
  });

  it('setext H2(---)不作标题(与 ATX 的 ## 一致)', () => {
    expect(extractTitle('我的标题\n---\n\n正文')).toBeNull();
  });

  it('stripFirstH1 删掉 setext 的两行(正文行 + 下划线)', () => {
    // 只删 1 行会把 `===` 孤零零留在正文,再被解析成段落/分割线。
    expect(stripFirstH1('我的标题\n===\n\n正文')).toBe('\n正文');
    expect(parseMarkdown(stripFirstH1('我的标题\n===\n\n正文'))).toHaveLength(1);
  });

  it('frontmatter title 优先于 setext H1(优先级不变)', () => {
    expect(extractTitle('---\ntitle: FM\n---\n正文标题\n===')).toEqual({
      title: 'FM',
      source: 'frontmatter',
    });
  });

  it('ATX H1 在前时仍取 ATX(先到先得,不因 setext 支持而改变顺序)', () => {
    expect(extractTitle('# ATX 标题\n\nsetext 标题\n===')).toEqual({
      title: 'ATX 标题',
      source: 'h1',
    });
  });

  it('代码围栏内的 setext 不被误抽为标题', () => {
    expect(extractTitle('```\n假标题\n===\n```\n\n正文')).toBeNull();
  });

  it('多行段落上方的 setext 不认(避免 stripFirstH1 按固定行数删错)', () => {
    // 「第一行 / 第二行 / ===」整段才是标题,取末行会截断、删 2 行会留下孤儿行,
    // 这类写法极罕见,宁可不认(标题留在正文)也不误伤。
    expect(extractTitle('第一行\n第二行\n===')).toBeNull();
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

  // B3-10(P2-12):`![[path|alt]]` 的 `|alt` 是图注/尺寸,不是路径的一部分。
  // 不切分则封面查找必败,且与 parser 对同一语法的处理(matchObsidianImageLine)不一致。
  it('`![[path|alt]]` 剥壳后再切掉 `|别名`', () => {
    expect(extractCover('---\ncover: "![[assets/a.png|封面图]]"\n---\n')).toBe('assets/a.png');
    expect(extractCover('---\ncover: ![[a.png|300]]\n---\n')).toBe('a.png');
  });

  it('`[[path|alt]]`(无 !)同样切掉别名', () => {
    expect(extractCover('---\ncover: [[assets/b.png|别名]]\n---\n')).toBe('assets/b.png');
  });

  it('无 `|` 的 wiki 路径不受影响', () => {
    expect(extractCover('---\ncover: ![[assets/c.png]]\n---\n')).toBe('assets/c.png');
  });
});

describe('批次三 code review 修复回归 · 引号内转义', () => {
  it('双引号值内的 \\" 转义引号不截断标题', () => {
    const r = extractTitle('---\ntitle: "He said \\"hi\\" ok"\n---\n\n正文');
    expect(r?.title).toContain('hi');
    expect(r?.title).toContain('ok');
  });

  it("单引号值内的 '' 转义引号不截断标题", () => {
    const r = extractTitle("---\ntitle: 'It''s me'\n---\n\n正文");
    expect(r?.title).toContain('s me');
  });

  it('带转义引号的值后跟行内注释仍正确剥离注释', () => {
    const r = extractTitle('---\ntitle: "a \\"b\\" c" # 草稿\n---\n\n正文');
    expect(r?.title).not.toContain('草稿');
    expect(r?.title).toContain('c');
  });
});

describe('A6/A7 发版前修复', () => {
  it('cover `![x](a.png "t")` 剥掉 title(复用 parser.normalizeImageSrc)', () => {
    expect(extractCover('---\ncover: ![x](a.png "t")\n---')).toBe('a.png');
    expect(extractCover("---\ncover: ![x](<a b.png> 't')\n---")).toBe('a b.png');
  });

  it('H1 抽标题剥掉行内 markdown 标记与 ATX 闭合井号', () => {
    expect(extractTitle('# **粗** 标题')?.title).toBe('粗 标题');
    expect(extractTitle('# [链接](http://a) 标题')?.title).toBe('链接 标题');
    expect(extractTitle('# 标题 ##')?.title).toBe('标题');
    expect(extractTitle('# C#')?.title).toBe('C#');
  });

  it('setext 标题同样剥行内标记', () => {
    expect(extractTitle('*斜* 标题\n===\n\n正文')?.title).toBe('斜 标题');
  });

  it('标题文本与 parser 产出的 header-one 文本一致', () => {
    const md = '# **粗** [链](http://a) 标题 ##';
    const h = parseMarkdown(md)[0];
    expect(h?.kind === 'text' ? h.text : null).toBe(extractTitle(md)?.title);
  });
});
