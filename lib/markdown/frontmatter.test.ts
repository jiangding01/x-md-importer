// lib/markdown/frontmatter.ts 单测:extractTitle / extractCover / parseMarkdownWithoutTitle。
// 覆盖范围见 SKILL 任务描述 §frontmatter.test.ts。测试按当前实际行为编写;
// 若发现疑似生产 bug,以注释标注(不修改生产代码),并在最终报告汇总。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { extractCover, extractTitle, parseMarkdownWithoutTitle } from './frontmatter';
import { parseMarkdown } from './parser';
import type { ImportBlock } from '../bridge/protocol';

/** P4:去掉文章标题块后的正文块(取代旧 stripFirstH1 的文本层删行)。 */
const strip = (md: string, opts?: Parameters<typeof parseMarkdownWithoutTitle>[1]): ImportBlock[] =>
  parseMarkdownWithoutTitle(md, opts);

/** 块的简写形态,断言用。 */
const shapeOf = (blocks: ImportBlock[]): string[] =>
  blocks.map((b) => (b.kind === 'text' ? `${b.type}:${b.text}` : b.kind === 'image' ? `img:${b.source}` : b.entityType));

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

  it('去标题不触碰 frontmatter:只去掉正文里的 `# 真标题` 块', () => {
    const md = '---\n# 元数据区\nfoo: bar\n---\n\n# 真标题\n\n正文';
    expect(shapeOf(strip(md))).toEqual(['unstyled:正文']);
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

  it('去掉的正是那行缩进 H1', () => {
    expect(strip('  # 标题\n\n正文')).toEqual(parseMarkdown('正文'));
  });

  it('缩进围栏内的 `# x` 仍被跳过(forEachContentLine 的围栏判定同步放宽)', () => {
    expect(extractTitle('  ```\n  # 假标题\n  ```\n\n# 真标题')).toEqual({
      title: '真标题',
      source: 'h1',
    });
  });
});

describe('parseMarkdownWithoutTitle(P4:按块去标题)', () => {
  it('去掉被抽为标题的那一块,不动其余内容', () => {
    const md = '# 标题\n\n正文第一段。\n\n正文第二段。';
    expect(strip(md)).toEqual(parseMarkdown('正文第一段。\n\n正文第二段。'));
  });

  it('不动代码块内的 # x(即使它长得像 H1)', () => {
    const md = '# 真标题\n\n```\n# 这是代码注释,不是标题\n```\n';
    expect(strip(md)).toEqual(parseMarkdown('```\n# 这是代码注释,不是标题\n```\n'));
  });

  it('无 H1 时与 parseMarkdown 完全一致', () => {
    const md = '只有正文,没有标题。';
    expect(strip(md)).toEqual(parseMarkdown(md));
  });

  it('CRLF 文档照常', () => {
    expect(strip('# 标题\r\n\r\n正文一\r\n\r\n正文二')).toEqual(parseMarkdown('正文一\n\n正文二'));
  });

  // 审查复现:旧 stripFirstH1 在文本层删行,相邻行重新拼接后解析结果变了。
  it('`# 标题\\n---\\n作者\\n---`:分割线与 setext 作者行保留(删行后首行 `---` 曾被当 frontmatter)', () => {
    expect(shapeOf(strip('# 标题\n---\n作者:张三\n---\n\n正文'))).toEqual([
      'DIVIDER',
      'header-one:作者:张三',
      'unstyled:正文',
    ]);
  });

  it('`导语\\n# 标题\\n正文`:导语与正文保持两段(删行后曾合并成一段)', () => {
    expect(shapeOf(strip('导语\n# 标题\n正文'))).toEqual(['unstyled:导语', 'unstyled:正文']);
  });

  it('`- 要点\\n# 标题\\n正文`:正文不被吸进列表项', () => {
    expect(shapeOf(strip('- 要点\n# 标题\n正文'))).toEqual(['unordered-list-item:要点', 'unstyled:正文']);
  });

  it('`- 项\\n# 标题\\n  续行`:续行不变成列表松散续段(「换成空行」方案的反例)', () => {
    expect(shapeOf(strip('- 项\n# 标题\n  续行'))).toEqual(['unordered-list-item:项', 'unstyled:续行']);
  });

  it('语料不变量:去掉的恰是一个文本等于标题的 header-one,其余块与全文解析逐一相等', () => {
    // 去掉样例的 frontmatter(它带 title,extractTitle 会取 frontmatter 而非 H1;去不去标题由调用方
    // 按来源决定,这里只验「按 H1 去」的不变量)。
    const raw = readFileSync(new URL('../../docs/qa/测试样例-全格式.md', import.meta.url), 'utf8');
    const corpus = raw.replace(/^---\n[\s\S]*?\n---\n/, '');
    for (const md of [corpus, `# 首标题\n\n${corpus}`, `导语\n${corpus}`]) {
      const title = extractTitle(md);
      expect(title?.source).toBe('h1');
      if (title?.source !== 'h1') continue;
      const full = parseMarkdown(md);
      const body = strip(md);
      const k = full.findIndex((b) => b.kind === 'text' && b.type === 'header-one' && b.text.trim() === title.title);
      expect(k).toBeGreaterThanOrEqual(0);
      expect(body).toEqual(full.filter((_, i) => i !== k));
    }
  });
});

describe('setext 一级标题的抽取与移除', () => {
  it('setext H1(===)可作文章标题,source 仍为 h1', () => {
    expect(extractTitle('我的标题\n===\n\n正文')).toEqual({ title: '我的标题', source: 'h1' });
  });

  it('setext H2(---)不作标题(与 ATX 的 ## 一致)', () => {
    expect(extractTitle('我的标题\n---\n\n正文')).toBeNull();
  });

  it('去掉 setext 标题块(正文行 + 下划线整体),下划线不残留', () => {
    expect(strip('我的标题\n===\n\n正文')).toEqual(parseMarkdown('正文'));
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

  it('多行段落上方的 setext 不认(整段才是标题,取末行会截断)', () => {
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
  // 不切分则封面查找必败,且与 parser 对同一语法的处理(主循环 `![[x|alt]]` 图片分支)不一致。
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

// ===========================================================================
// 修复方案 2026-10-23(v0.5.0 打 tag 前):P3 / P7 / P6
// ===========================================================================

// P3:标题判定单一来源——findFirstH1 只认 parseLines 经 forEachContentLine.onHeading 上报的标题,
// 不再有自己的 isParagraphLine / setextUnderlineLevel / standalone 启发式。
describe('P3 标题判定与解析同源(定点)', () => {
  /** md 中 header-one 块的文本(trim 后),用于「两侧一致」断言。 */
  const headerTexts = (md: string): string[] =>
    parseMarkdown(md).flatMap((b) => (b.kind === 'text' && b.type === 'header-one' ? [b.text.trim()] : []));

  it('`标题 #\\n===`:setext 不剥 ATX 闭合井号,标题为「标题 #」', () => {
    const md = '标题 #\n===';
    expect(extractTitle(md)).toEqual({ title: '标题 #', source: 'h1' });
    expect(headerTexts(md)).toEqual(['标题 #']);
    expect(strip(md)).toEqual([]);
  });

  it('`- item\\n标题\\n===`:lazy 续行里的 `===` 不构成标题(两侧都不认)', () => {
    const md = '- item\n标题\n===';
    expect(extractTitle(md)).toBeNull();
    expect(headerTexts(md)).toEqual([]);
    expect(strip(md)).toEqual(parseMarkdown(md));
  });

  it('`- \\n标题\\n===`:空项后的段落是标题', () => {
    const md = '- \n标题\n===';
    expect(extractTitle(md)).toEqual({ title: '标题', source: 'h1' });
    expect(headerTexts(md)).toEqual(['标题']);
    expect(strip(md)).toEqual(parseMarkdown('- '));
  });

  it('`> a\\nb\\n===`:两侧一致认作标题「b」(引用 lazy 属旧行为,本次不动)', () => {
    const md = '> a\nb\n===';
    expect(extractTitle(md)).toEqual({ title: 'b', source: 'h1' });
    expect(headerTexts(md)).toEqual(['b']);
    expect(strip(md)).toEqual(parseMarkdown('> a'));
  });

  it('`标题\\n===`:单行 setext 照常', () => {
    expect(extractTitle('标题\n===')).toEqual({ title: '标题', source: 'h1' });
    expect(strip('标题\n===\n正文')).toEqual(parseMarkdown('正文'));
  });

  it('`$$\\n# x\\n$$`:公式内的 `# x` 不是标题,去标题不改公式', () => {
    const md = '$$\n# x\n$$\n\n正文';
    expect(extractTitle(md)).toBeNull();
    expect(strip(md)).toEqual(parseMarkdown(md));
  });

  it('第一个标题不合格(二级 / 多行 setext / 纯文本为空)时继续找下一个', () => {
    expect(extractTitle('## 二级\n\n第一行\n第二行\n===\n\n# [](u)\n\n# 真标题')).toEqual({
      title: '真标题',
      source: 'h1',
    });
  });
});

// L1(独立审查):未闭合的开栏行 / `$$` 起行下方紧跟 `===` 时,正文按 setext 渲染成标题「```」/「$$」,
// 但它显然不是作者意图的文章标题——标题抽取跳过它、继续找下一个(正文解析不改)。
describe('L1 setext 标题文本为开栏行 / `$$` 时不作文章标题', () => {
  for (const [md, rest] of [
    ['```\n===\n# 真标题\n正文', '```\n===\n正文'],
    ['$$\n===\n# 真标题', '$$\n==='],
    ['~~~\n===\n# 真标题', '~~~\n==='],
  ] as const) {
    it(`${JSON.stringify(md)} → 标题「真标题」,去掉的是 \`# 真标题\` 块`, () => {
      expect(extractTitle(md)).toEqual({ title: '真标题', source: 'h1' });
      expect(strip(md)).toEqual(parseMarkdown(rest));
    });
  }

  it('正文解析不变:未闭合开栏行 + `===` 仍是 header-one', () => {
    const h = parseMarkdown('```\n===\n# 真标题')[0];
    expect(h?.kind === 'text' ? [h.type, h.text] : null).toEqual(['header-one', '```']);
  });
});

describe('P3/P4 不变量:去掉的标题块与 extractTitle 一致(行级模糊)', () => {
  const alphabet = ['- a', '- ', '> q', '标题', '===', '--', '---', '```', '$$', '# h', '## h', '2024. x', '$$ x', 'y $$', ''];

  it('extractTitle(h1) 时,parseMarkdownWithoutTitle 恰去掉全文解析中一个文本为该标题的 header-one,其余块不变', () => {
    // mulberry32(32 位整数运算):`seed * 1103515245` 式浮点 LCG 会超出 2^53 精度、退化成短周期。
    let seed = 20261026;
    const rnd = () => {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const failures: string[] = [];
    let checked = 0;
    for (let t = 0; t < 3000; t += 1) {
      const n = 1 + Math.floor(rnd() * 8);
      const md = Array.from({ length: n }, () => alphabet[Math.floor(rnd() * alphabet.length)] ?? '').join('\n');
      const title = extractTitle(md);
      const full = parseMarkdown(md);
      const body = strip(md);
      if (title?.source !== 'h1') {
        if (JSON.stringify(body) !== JSON.stringify(full)) failures.push(md);
        continue;
      }
      checked += 1;
      const ok = full.some(
        (b, k) =>
          b.kind === 'text' &&
          b.type === 'header-one' &&
          b.text.trim() === title.title &&
          JSON.stringify(full.filter((_, i) => i !== k)) === JSON.stringify(body),
      );
      if (!ok) failures.push(md);
    }
    expect(failures.slice(0, 5)).toEqual([]);
    expect(checked).toBeGreaterThan(100); // 防空转:确有足量带标题的样本
  });
});

describe('P7 标题抽取只取决于自身解析开关', () => {
  // obsidianImg=true:`![[a.png]]` 是图片块,`标题\n===` 单行 setext → 标题;
  // obsidianImg=false:`![[a.png]]` 是段落行,与 `标题` 组成多行 setext → 不作文章标题。
  const md = '![[a.png]]\n标题\n===';

  it('残留开关 true / false 两种前置下,结果只取决于自身 opts', () => {
    for (const residue of [true, false]) {
      parseMarkdown('x', { obsidianImg: residue });
      expect([residue, extractTitle(md)]).toEqual([residue, { title: '标题', source: 'h1' }]);
      parseMarkdown('x', { obsidianImg: residue });
      expect([residue, extractTitle(md, { obsidianImg: false })]).toEqual([residue, null]);
      parseMarkdown('x', { obsidianImg: residue });
      expect([residue, strip(md)]).toEqual([residue, parseMarkdown('![[a.png]]')]);
      parseMarkdown('x', { obsidianImg: residue });
      expect([residue, strip(md, { obsidianImg: false })]).toEqual([residue, parseMarkdown(md, { obsidianImg: false })]);
    }
  });
});

// P6:cover 值按「整值恰为一个图片 / wiki 链接」判定,复用 parser 的整行图片匹配,不再用贪婪正则。
describe('P6 extractCover 整值判定', () => {
  const cover = (v: string) => extractCover(`---\ncover: ${v}\n---\n正文`);

  it('单图 / 带链接图 / wiki 形态 → 取地址', () => {
    expect(cover('![a](x.png)')).toBe('x.png');
    expect(cover('[![a](x.png)](http://l)')).toBe('x.png');
    expect(cover('![[a.png]]')).toBe('a.png');
    expect(cover('[[a.png]]')).toBe('a.png');
    expect(cover('![[a.png|300]]')).toBe('a.png');
  });

  it('两张图 / 两个 wiki / 畸形 → null(与正文「整行一张图」口径一致)', () => {
    expect(cover('![a](x.png) ![b](y.png)')).toBeNull();
    expect(cover('![[a.png]] ![[b.png]]')).toBeNull();
    expect(cover('[[a.png]] [[b.png]]')).toBeNull();
    expect(cover('![a](x.png')).toBeNull();
  });

  it('纯路径按原样作为路径', () => {
    expect(cover('a.png')).toBe('a.png');
  });
});
