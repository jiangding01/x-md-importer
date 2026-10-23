// lib/markdown/capability.ts 单测:capability / firstTitle。
// capability() 基于 parseMarkdown 的块级产出统计(而非独立正则),本文件重点覆盖
// 模块注释中提到的历史回归点。测试按当前实际行为编写;若发现疑似生产 bug,
// 以注释标注(不修改生产代码),并在最终报告汇总。
import { describe, expect, it } from 'vitest';
import { capability, firstTitle } from './capability';
import { parseMarkdown } from './parser';
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

describe('capability · 随 parser 口径自动跟随(B3-11)', () => {
  it('软折行段落里的 `2024. ` 行不再虚增列表计数', () => {
    const md = '那年冬天特别冷,\n2024. 冬天的第一场雪来得很晚。';
    expect(find(capability(md, false), '列表')).toBeUndefined();
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

// B3-4(P1-7):`images()` 已删除(全文正则口径与真实写入不一致),其用例随之移除;
// 权限申请侧的替代覆盖见 lib/bridge/imagePermissions.test.ts。

describe('capability · 多级列表(depth > 0)', () => {
  it('嵌套一层的列表项计入多级列表,顶层项不计', () => {
    const md = '- a\n  - b\n';
    const items = capability(md, false);
    expect(find(items, '多级列表')?.count).toBe(1);
  });

  it('无嵌套的平层列表不出现多级列表条目', () => {
    const md = '- a\n- b\n- c\n';
    const items = capability(md, false);
    expect(find(items, '多级列表')).toBeUndefined();
  });

  it('多级列表标 warn 并计入「降级」(真机确认 X 忽略 depth、渲染为扁平)', () => {
    // 2026-07-25 真机:X 不渲染 Draft 的 depth,嵌套项显示成扁平列表、有序列表还会连续重编号。
    // 层级信息确实丢失,故如实标 warn 并计入降级——此前暂标 special 是因为尚未验证,
    // 不该在不知情时断言「已降级」;现在知情了,就该如实说。
    const items = capability('- a\n  - b\n    - c\n', false);
    expect(find(items, '多级列表')?.badge).toBe('warn');
    expect(find(items, '多级列表')?.count).toBe(2);
    const deg = items.filter((c) => c.badge === 'warn').reduce((a, c) => a + c.count, 0);
    expect(deg).toBe(2);
  });
});

describe('capability · 任务列表', () => {
  it('任务项按数量计数,普通列表项不计入', () => {
    const md = '- [ ] todo\n- [x] done\n- 普通项\n';
    const items = capability(md, false);
    expect(find(items, '任务列表')?.count).toBe(2);
    expect(find(items, '列表')?.count).toBe(3); // 三条都仍是列表项(原生计数不受任务标记影响)
  });

  it('无任务标记的文档不出现任务列表条目', () => {
    const md = '- a\n- b\n';
    const items = capability(md, false);
    expect(find(items, '任务列表')).toBeUndefined();
  });

  it('note 随 parseOpts.taskList 切换(symbol vs plain)', () => {
    const md = '- [ ] todo\n';
    const symbol = capability(md, false, { taskList: 'symbol' });
    const plain = capability(md, false, { taskList: 'plain' });
    expect(find(symbol, '任务列表')?.note).toBe('X 无任务列表 · 转 ☑/☐ 符号');
    expect(find(plain, '任务列表')?.note).toBe('X 无任务列表 · 转普通列表项');
  });

  it('未传 parseOpts 时按默认 symbol 模式显示 note', () => {
    const md = '- [ ] todo\n';
    const items = capability(md, false);
    expect(find(items, '任务列表')?.note).toBe('X 无任务列表 · 转 ☑/☐ 符号');
  });
});

describe('capability · 行内图片(仅段落中残留的,不含独占行)', () => {
  it('段落内的行内图片按出现次数计数', () => {
    const md = '文字里有 ![a](x.png) 和 ![b](y.png) 两张行内图片。';
    const items = capability(md, false);
    expect(find(items, '行内图片')?.count).toBe(2);
  });

  it('独占一行的图片已被解析成 ImageBlock,不重复计入行内图片(关键收益:不再靠正则扫全文)', () => {
    const md = '![cover](x.png)\n\n正文里还有 ![inline](y.png) 一张行内图片。';
    const items = capability(md, false);
    expect(find(items, '图片 → 上传')?.count).toBe(1);
    expect(find(items, '行内图片')?.count).toBe(1); // 只计段落里那一张,独占行那张不算
  });

  it('无行内图片的文档不出现该条目', () => {
    const md = '![cover](x.png)\n';
    const items = capability(md, false);
    expect(find(items, '行内图片')).toBeUndefined();
  });

  it('围栏代码块内的 ![]() 不计入行内图片(已单独成 atomic 块,不是文本块)', () => {
    const md = '```\n![x](a.png)\n```\n';
    const items = capability(md, false);
    expect(find(items, '行内图片')).toBeUndefined();
  });
});

describe('capability · 脚注', () => {
  it('文本块内的脚注标记按出现次数计数', () => {
    const md = '这是一段带脚注的正文[^1],还有一个[^note]。';
    const items = capability(md, false);
    expect(find(items, '脚注')?.count).toBe(2);
  });

  it('无脚注标记的文档不出现该条目', () => {
    const md = '普通正文,没有脚注。';
    const items = capability(md, false);
    expect(find(items, '脚注')).toBeUndefined();
  });
});

describe('capability · HTML 块', () => {
  it('以 < + 字母开头的文本块计入 HTML 块', () => {
    const md = '<div>一段 HTML</div>\n';
    const items = capability(md, false);
    expect(find(items, 'HTML 块')?.count).toBe(1);
  });

  it('文本中间出现的 < 不计入(仅块首判定)', () => {
    const md = '这段话里 a < b 只是比较符号。';
    const items = capability(md, false);
    expect(find(items, 'HTML 块')).toBeUndefined();
  });

  it('围栏代码块内的 <div> 不计入 HTML 块(已成 atomic 块)', () => {
    const md = '```\n<div>x</div>\n```\n';
    const items = capability(md, false);
    expect(find(items, 'HTML 块')).toBeUndefined();
  });
});

describe('capability · 数学公式(LATEX atomic,已接原生)', () => {
  it('块级 $$ 公式计入数学公式、标 native(真机 dump 确认 X 有原生 LATEX 块)', () => {
    // 本批之前 $$ 无解析、留在文本块里、面板标 warn「未接」;现 parser 产出 LATEX atomic,
    // 计数从产出块取、badge 落 native。
    const md = '$$\nE = mc^2\n$$\n';
    const items = capability(md, false);
    expect(find(items, '数学公式')?.count).toBe(1);
    expect(find(items, '数学公式')?.badge).toBe('native');
  });

  it('同行闭合 $$ x $$ 也计入原生数学块', () => {
    const items = capability('$$ E = mc^2 $$', false);
    expect(find(items, '数学公式')?.count).toBe(1);
    expect(find(items, '数学公式')?.badge).toBe('native');
  });

  it('无 $$ 的文档不出现该条目', () => {
    const md = '普通正文,没有公式。';
    const items = capability(md, false);
    expect(find(items, '数学公式')).toBeUndefined();
    expect(find(items, '未闭合公式')).toBeUndefined();
  });

  it('行中的 $$ 既不算原生块也不算未闭合(「$$100」口语双美元符的假阳性防线)', () => {
    // 段落文本块,RE_MATH_RESIDUE 只匹配裸 `$$` 行、其后非空不匹配 → 两条都不出现。
    const items = capability('价格从 $$100 涨到 $$200', false);
    expect(find(items, '数学公式')).toBeUndefined();
    expect(find(items, '未闭合公式')).toBeUndefined();
  });

  it('未闭合 $$ 起行降级为文本、计入「未闭合公式」warn(不计原生)', () => {
    // parser 找不到闭合 `$$` → 回退普通段落,文本块以裸 `$$` 起行 → 如实标降级。
    const items = capability('$$\nE = mc^2', false);
    expect(find(items, '数学公式')).toBeUndefined();
    expect(find(items, '未闭合公式')?.count).toBe(1);
    expect(find(items, '未闭合公式')?.badge).toBe('warn');
  });

  it('围栏代码块内的 $$ 不计入(已成 MARKDOWN atomic、既非 LATEX 也非文本残留)', () => {
    const md = '```\n$$\nx\n$$\n```\n';
    const items = capability(md, false);
    expect(find(items, '数学公式')).toBeUndefined();
    expect(find(items, '未闭合公式')).toBeUndefined();
  });
});

describe('capability · setext 标题(已支持,不再是降级项)', () => {
  it('setext 标题被解析成真标题、计入 Heading,不再有「未识别」告警条目', () => {
    // 本项功能落地前:setext 标题退化成普通段落(=== 字面量进正文),能力面板以 warn 告知;
    // 落地后它就是 header-one,告警条目随之移除——面板不该再报一个已经支持的语法。
    const items = capability('我的标题\n===\n\n正文', false);
    expect(find(items, 'setext 标题')).toBeUndefined();
    expect(find(items, '二级标题 → Heading')?.count).toBe(1);
  });

  it('带 frontmatter 的文档不产生任何幽灵标题条目(review 假告警的最终归宿)', () => {
    const items = capability('---\ntitle: T\ntags: x\n---\n真正的正文', false);
    expect(find(items, 'setext 标题')).toBeUndefined();
    expect(find(items, '二级标题 → Heading')).toBeUndefined();
    expect(parseMarkdown('---\ntitle: T\ntags: x\n---\n真正的正文')).toHaveLength(1);
  });
});

describe('capability · parseOpts 透传影响解析结果', () => {
  it('taskList=plain 时任务列表项不再有 ☑/☐ 前缀,但计数不受影响', () => {
    const md = '- [x] done\n';
    const items = capability(md, false, { taskList: 'plain' });
    expect(find(items, '任务列表')?.count).toBe(1);
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

  it('firstTitle 跳过代码围栏,与 frontmatter.extractTitle 行为一致(历史 bug 回归)', () => {
    // 曾经的分裂:firstTitle 用裸正则 `/^#\s+(.+)$/m`,代码块里的 "# fake" 被误当历史条目标题,
    // 而 extractTitle 经 forEachContentLine 正确跳过。现 firstTitle 复用同一 helper,行为统一。
    const md = '```\n# fake title in code\n```\n\n# Real Title\n';
    expect(firstTitle(md, false)).toBe('Real Title');
    expect(extractTitle(md)).toEqual({ title: 'Real Title', source: 'h1' }); // 与 frontmatter.ts 一致
  });

  // B3-12(P2-14):历史条目标题必须与「实际导入的标题」同源,否则 frontmatter-only /
  // setext 标题的文档在记录页显示「未命名草稿」,而 X 上的标题是对的(UI 撒谎)。
  it('frontmatter title 的文档:历史标题与 extractTitle 一致,不再回落默认文案', () => {
    const md = '---\ntitle: FM 标题\n---\n\n正文没有 H1';
    expect(firstTitle(md, false)).toBe('FM 标题');
    expect(extractTitle(md)?.title).toBe('FM 标题');
  });

  it('setext 一级标题的文档:历史标题取到该标题', () => {
    const md = '我的 setext 标题\n===\n\n正文';
    expect(firstTitle(md, false)).toBe('我的 setext 标题');
  });

  it('frontmatter title 优先于正文 H1(与 extractTitle 同序)', () => {
    const md = '---\ntitle: FM\n---\n\n# 正文 H1\n';
    expect(firstTitle(md, false)).toBe('FM');
  });

  it('A7:历史标题剥掉行内 markdown 标记', () => {
    expect(firstTitle('# **粗** 标题 ##\n\n正文', false)).toBe('粗 标题');
  });
});

describe('capability · A15 H4+ 降级只认真标题', () => {
  it('整段加粗段落不误报「四级以下标题 → 粗体段落」', () => {
    const items = capability('**这一整段都是加粗强调**', false);
    expect(find(items, '四级以下标题 → 粗体段落')).toBeUndefined();
    expect(find(items, '粗体 / 斜体 / 删除线')?.count).toBe(1);
  });

  it('H4/H5/H6 各计一次;围栏内的 #### 不计', () => {
    const md = '#### a\n\n##### b\n\n###### c\n\n```\n#### 代码\n```\n\n**整段**';
    expect(find(capability(md, false), '四级以下标题 → 粗体段落')?.count).toBe(3);
  });

  it('isDemotedHeading 标记不进入块的可枚举字段(不污染 protocol)', () => {
    const b = parseMarkdown('#### a')[0];
    expect(Object.keys(b ?? {})).not.toContain('demotedHeading');
    expect(JSON.parse(JSON.stringify(b))).toEqual(b);
  });
});

// P7(修复方案 2026-10-23):firstTitle 透传解析开关,结果只取决于自身 opts,不继承上一次 parseMarkdown 的残留。
describe('firstTitle · 解析开关透传(P7)', () => {
  it('残留开关 true / false 两种前置下结果一致', () => {
    const md = '![[a.png]]\n标题\n===';
    for (const residue of [true, false]) {
      parseMarkdown('x', { obsidianImg: residue });
      expect([residue, firstTitle(md, false)]).toEqual([residue, '标题']);
      parseMarkdown('x', { obsidianImg: residue });
      expect([residue, firstTitle(md, false, { obsidianImg: false })]).toEqual([residue, '未命名草稿']);
    }
  });
});
