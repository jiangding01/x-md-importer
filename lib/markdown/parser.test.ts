import { describe, it, expect } from 'vitest';
import {
  parseMarkdown,
  isImageLine,
  stripFirstImageLine,
  forEachContentLine,
} from './parser';
import type {
  ImportBlock,
  TextBlock,
  AtomicBlock,
  ImageBlock,
  InlineStyleRange,
} from '../bridge/protocol';

// ---------------------------------------------------------------------------
// 断言辅助:窄化联合类型 + 按区间切片校验 offset/length 的精确性。
// ---------------------------------------------------------------------------

/** 断言块为文本块并返回窄化后的 TextBlock。 */
function asText(b: ImportBlock | undefined): TextBlock {
  if (!b || b.kind !== 'text') throw new Error(`期望文本块,实为 ${b?.kind}`);
  return b;
}

/** 断言块为 atomic 块并返回窄化后的 AtomicBlock。 */
function asAtomic(b: ImportBlock | undefined): AtomicBlock {
  if (!b || b.kind !== 'atomic') throw new Error(`期望 atomic 块,实为 ${b?.kind}`);
  return b;
}

/** 断言块为图片块并返回窄化后的 ImageBlock。 */
function asImage(b: ImportBlock | undefined): ImageBlock {
  if (!b || b.kind !== 'image') throw new Error(`期望图片块,实为 ${b?.kind}`);
  return b;
}

/** 断言值存在(收窄可选索引访问),否则抛错。 */
function req<T>(x: T | undefined): T {
  if (x === undefined) throw new Error('期望值存在,实为 undefined');
  return x;
}

/** 按 range 从 text 切片(UTF-16 码元),用于校验 offset/length 命中的正是预期子串。 */
function sliceRange(text: string, r: { offset: number; length: number } | undefined): string {
  const rr = req(r);
  return text.slice(rr.offset, rr.offset + rr.length);
}

/** 解析单行内文本,返回唯一文本块(便于行内断言)。 */
function inlineOf(md: string): TextBlock {
  const blocks = parseMarkdown(md);
  expect(blocks).toHaveLength(1);
  return asText(blocks[0]);
}

/** 取某 style 的所有区间。 */
function stylesOf(b: TextBlock, style: InlineStyleRange['style']): InlineStyleRange[] {
  return b.inlineStyleRanges.filter((r) => r.style === style);
}

// ===========================================================================

describe('块级映射', () => {
  it('H1 映射为 header-one', () => {
    const b = asText(parseMarkdown('# 标题')[0]);
    expect(b.type).toBe('header-one');
    expect(b.text).toBe('标题');
  });

  it('H2 映射为 header-one', () => {
    expect(asText(parseMarkdown('## 标题')[0]).type).toBe('header-one');
  });

  it('H3 映射为 header-two', () => {
    expect(asText(parseMarkdown('### 标题')[0]).type).toBe('header-two');
  });

  it('H4 降级为 unstyled 且整段加 BOLD', () => {
    const b = asText(parseMarkdown('#### 小标题')[0]);
    expect(b.type).toBe('unstyled');
    expect(b.text).toBe('小标题');
    expect(b.inlineStyleRanges).toEqual([{ offset: 0, length: 3, style: 'BOLD' }]);
  });

  it('H5/H6 同样降级为 unstyled + 全段 BOLD', () => {
    for (const md of ['##### 五级', '###### 六级']) {
      const b = asText(parseMarkdown(md)[0]);
      expect(b.type).toBe('unstyled');
      expect(stylesOf(b, 'BOLD')).toEqual([{ offset: 0, length: 2, style: 'BOLD' }]);
    }
  });

  it('标题去除可选的 ATX 闭合井号', () => {
    expect(asText(parseMarkdown('# 标题 #')[0]).text).toBe('标题');
  });

  it('H4 空标题不产生 BOLD 区间', () => {
    // '#### ' 内容为空,inline.text.length 为 0 → 不 push BOLD
    const empty = asText(parseMarkdown('####  ')[0]);
    expect(empty.text).toBe('');
    expect(empty.inlineStyleRanges).toEqual([]);
  });

  it('引用逐行独立成 blockquote 块', () => {
    const blocks = parseMarkdown('> 第一行\n> 第二行');
    expect(blocks).toHaveLength(2);
    expect(asText(blocks[0]).type).toBe('blockquote');
    expect(asText(blocks[0]).text).toBe('第一行');
    expect(asText(blocks[1]).text).toBe('第二行');
  });

  it('引用剥离尖括号及其后一个空格', () => {
    expect(asText(parseMarkdown('>无空格')[0]).text).toBe('无空格');
    expect(asText(parseMarkdown('> 有空格')[0]).text).toBe('有空格');
  });

  it('无序列表识别 - * + 三种标记', () => {
    for (const mark of ['-', '*', '+']) {
      const b = asText(parseMarkdown(`${mark} 项目`)[0]);
      expect(b.type).toBe('unordered-list-item');
      expect(b.text).toBe('项目');
    }
  });

  it('有序列表映射为 ordered-list-item', () => {
    const b = asText(parseMarkdown('1. 第一项')[0]);
    expect(b.type).toBe('ordered-list-item');
    expect(b.text).toBe('第一项');
  });

  it('三连字符分割线产生 DIVIDER', () => {
    expect(asAtomic(parseMarkdown('---')[0]).entityType).toBe('DIVIDER');
  });

  it('三连星号独占行是 DIVIDER 而非加粗', () => {
    const b = asAtomic(parseMarkdown('***')[0]);
    expect(b.entityType).toBe('DIVIDER');
  });

  it('更多连字符/星号仍为 DIVIDER', () => {
    expect(asAtomic(parseMarkdown('-----')[0]).entityType).toBe('DIVIDER');
    expect(asAtomic(parseMarkdown('*****')[0]).entityType).toBe('DIVIDER');
  });
});

describe('嵌套列表 depth', () => {
  /** 把解析结果压成 `type简写:depth` 序列,便于一行断言整段列表的层级形状。 */
  const shape = (md: string): string[] =>
    parseMarkdown(md).map((b) => {
      const t = asText(b);
      const tag = t.type === 'unordered-list-item' ? 'ul' : t.type === 'ordered-list-item' ? 'ol' : t.type;
      return `${tag}:${t.depth ?? 0}`;
    });

  it('2 空格为一级缩进', () => {
    expect(shape('- 一级\n  - 二级\n    - 三级')).toEqual(['ul:0', 'ul:1', 'ul:2']);
  });

  it('4 空格为一级缩进(栈式换算,不假定固定单位)', () => {
    expect(shape('- 一级\n    - 二级\n        - 三级')).toEqual(['ul:0', 'ul:1', 'ul:2']);
  });

  it('Tab 缩进按 4 列计,与空格等效', () => {
    expect(shape('- 一级\n\t- 二级\n\t\t- 三级')).toEqual(['ul:0', 'ul:1', 'ul:2']);
  });

  it('缩进回退时层级正确回落', () => {
    expect(shape('- a\n  - b\n    - c\n  - d\n- e')).toEqual(['ul:0', 'ul:1', 'ul:2', 'ul:1', 'ul:0']);
  });

  it('有序/无序混合嵌套共用同一缩进栈', () => {
    expect(shape('- 一级\n  1. 二级\n  2. 二级第二项\n- 回到一级')).toEqual([
      'ul:0',
      'ol:1',
      'ol:1',
      'ul:0',
    ]);
  });

  it('顶层项不写 depth 字段(产出形状与本特性引入前一致)', () => {
    const b = asText(parseMarkdown('- 顶层')[0]);
    expect(b.depth).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(b, 'depth')).toBe(false);
  });

  it('depth 截顶到 4(Draft 默认样式只到 depth4)', () => {
    const md = '- 1\n  - 2\n    - 3\n      - 4\n        - 5\n          - 6';
    expect(shape(md)).toEqual(['ul:0', 'ul:1', 'ul:2', 'ul:3', 'ul:4', 'ul:4']);
  });

  it('列表间的空行不重置层级(松散列表)', () => {
    expect(shape('- a\n\n  - b')).toEqual(['ul:0', 'ul:1']);
  });

  it('非列表块结束列表,后续列表从 depth 0 重新起算', () => {
    expect(shape('- a\n  - b\n\n普通段落\n\n- 新列表')).toEqual([
      'ul:0',
      'ul:1',
      'unstyled:0',
      'ul:0',
    ]);
  });

  it('整体缩进的列表首层即 depth 0', () => {
    expect(shape('  - a\n  - b')).toEqual(['ul:0', 'ul:0']);
  });

  it('嵌套项的行内样式与文本正常解析(缩进不污染内容)', () => {
    const b = asText(parseMarkdown('- 一级\n  - **粗**二级')[1]);
    expect(b.depth).toBe(1);
    expect(b.text).toBe('粗二级');
    expect(b.inlineStyleRanges).toEqual([{ offset: 0, length: 1, style: 'BOLD' }]);
  });

  it('标记后为全角空格/NBSP 仍是列表项(中文输入法常见,勿收窄分隔符)', () => {
    // 分隔符必须保持 `\s`:收窄成 `[ \t]` 会让 `-　项目` 掉进段落分支、
    // 正文留下字面量「-　项目」——正是本次迭代要消灭的那类内容错乱。
    const full = asText(parseMarkdown('-　项目')[0]); // 全角空格
    expect(full.type).toBe('unordered-list-item');
    expect(full.text).toBe('项目');
    const nbsp = asText(parseMarkdown('1. 项目')[0]); // NBSP + 有序列表
    expect(nbsp.type).toBe('ordered-list-item');
    expect(nbsp.text).toBe('项目');
    // 缩进 + 全角空格组合:层级与内容都要对
    const nested = asText(parseMarkdown('- 一级\n  -　二级')[1]);
    expect(nested.type).toBe('unordered-list-item');
    expect(nested.depth).toBe(1);
    expect(nested.text).toBe('二级');
  });

  it('历史行为翻转:缩进列表项此前退化为含字面量的段落,现为嵌套列表项', () => {
    // 引入 depth 前 `  - 二级` 不匹配顶格列表正则,落到段落分支、
    // 正文里留下字面量 "  - 二级"(内容错乱)。此断言钉住修复后的正确行为。
    const blocks = parseMarkdown('- 一级\n  - 二级');
    expect(blocks).toHaveLength(2);
    const second = asText(blocks[1]);
    expect(second.type).toBe('unordered-list-item');
    expect(second.text).toBe('二级');
    expect(second.text).not.toContain('-');
  });
});

describe('任务列表', () => {
  it('symbol 模式(默认):未勾选 [ ] 转 ☐ 前缀', () => {
    const b = asText(parseMarkdown('- [ ] 任务')[0]);
    expect(b.text).toBe('☐ 任务');
    expect(b.task).toBe('todo');
  });

  it('symbol 模式:已勾选 [x] 转 ☑ 前缀', () => {
    const b = asText(parseMarkdown('- [x] 任务')[0]);
    expect(b.text).toBe('☑ 任务');
    expect(b.task).toBe('done');
  });

  it('symbol 模式:大写 [X] 同样识别为已勾选', () => {
    const b = asText(parseMarkdown('- [X] 任务')[0]);
    expect(b.text).toBe('☑ 任务');
    expect(b.task).toBe('done');
  });

  it('plain 模式:不加符号,标记被剥掉', () => {
    const b = asText(parseMarkdown('- [ ] 任务', { taskList: 'plain' })[0]);
    expect(b.text).toBe('任务');
    expect(b.task).toBe('todo');
  });

  it('plain 模式:已勾选同样剥掉标记、不加符号', () => {
    const b = asText(parseMarkdown('- [x] 任务', { taskList: 'plain' })[0]);
    expect(b.text).toBe('任务');
    expect(b.task).toBe('done');
  });

  it('offset 平移:symbol 前缀不破坏加粗区间(- [ ] **粗**尾巴)', () => {
    const b = asText(parseMarkdown('- [ ] **粗**尾巴')[0]);
    expect(b.text).toBe('☐ 粗尾巴');
    const bold = req(b.inlineStyleRanges.find((r) => r.style === 'BOLD'));
    expect(b.text.slice(bold.offset, bold.offset + bold.length)).toBe('粗');
  });

  it('有序任务项 1. [ ] xxx 同样生效', () => {
    const b = asText(parseMarkdown('1. [ ] 待办')[0]);
    expect(b.type).toBe('ordered-list-item');
    expect(b.text).toBe('☐ 待办');
    expect(b.task).toBe('todo');
  });

  it('嵌套任务项:depth 与 task 同时正确', () => {
    const blocks = parseMarkdown('- [ ] a\n  - [x] b');
    const a = asText(blocks[0]);
    const bb = asText(blocks[1]);
    expect(a.depth).toBeUndefined();
    expect(a.task).toBe('todo');
    expect(bb.depth).toBe(1);
    expect(bb.task).toBe('done');
  });

  it('非任务项不受影响:无 task 字段、文本无符号', () => {
    const b = asText(parseMarkdown('- 普通项')[0]);
    expect(b.text).toBe('普通项');
    expect(b.task).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(b, 'task')).toBe(false);
  });

  it('边界:[x] 后无空格不算任务项,原样保留字面量', () => {
    const b = asText(parseMarkdown('- [x]没有空格')[0]);
    expect(b.text).toBe('[x]没有空格');
    expect(b.task).toBeUndefined();
  });

  it('加 ☐/☑ 前缀后 offset 在 emoji/代理对/CJK 下仍精确', () => {
    // offset 单位是 UTF-16 码元(见 HANDOFF §8):emoji/𝄞 等 BMP 外字符占 2 码元,
    // 前缀平移若按「字符数」而非码元算,这些场景会整体错位。用 text 切片反证区间落点。
    const cases: Array<[string, string]> = [
      ['- [ ] **粗**尾', '粗'],
      ['- [x] 🎉🎉**粗体**尾', '粗体'],
      ['- [ ] 中文**强调**中文', '强调'],
      ['- [x] 👨‍👩‍👧‍👦家庭**abc**', 'abc'],
      ['- [x] 𝄞乐**音**符', '音'],
    ];
    for (const [md, expected] of cases) {
      const b = asText(parseMarkdown(md)[0]);
      const r = req(b.inlineStyleRanges[0]);
      expect([md, b.text.slice(r.offset, r.offset + r.length)]).toEqual([md, expected]);
    }
  });

  it('加前缀后链接区间同样精确平移', () => {
    const b = asText(parseMarkdown('- [ ] 前缀[链接文字](https://a.com)后缀')[0]);
    const l = req(b.links[0]);
    expect(b.text.slice(l.offset, l.offset + l.length)).toBe('链接文字');
    expect(l.url).toBe('https://a.com');
  });

  it('任务标记后为全角空格仍生效(中文输入法常见)', () => {
    // 与列表标记的分隔符同理:收窄成 `[ \t]` 会让 `- [x]　完成` 退化成
    // 带字面量 `[x]` 的普通列表项。
    const b = asText(parseMarkdown('- [x]　完成')[0]);
    expect(b.task).toBe('done');
    expect(b.text).toBe('☑ 完成');
  });
});

describe('推文 URL', () => {
  it('x.com 独占行推文转 TWEET 并归一 url', () => {
    const b = asAtomic(parseMarkdown('https://x.com/user/status/12345')[0]);
    expect(b.entityType).toBe('TWEET');
    if (b.entityType === 'TWEET') {
      expect(b.data.tweetId).toBe('12345');
      expect(b.data.url).toBe('https://twitter.com/i/web/status/12345');
    }
  });

  it('twitter.com 推文同样识别', () => {
    const b = asAtomic(parseMarkdown('https://twitter.com/u/status/99')[0]);
    expect(b.entityType).toBe('TWEET');
  });

  it('带 www 前缀的推文识别', () => {
    const b = asAtomic(parseMarkdown('https://www.x.com/u/status/77')[0]);
    expect(b.entityType).toBe('TWEET');
    if (b.entityType === 'TWEET') expect(b.data.tweetId).toBe('77');
  });

  it('带 query 参数的推文不匹配,降级为段落', () => {
    const b = asText(parseMarkdown('https://x.com/u/status/123?s=20')[0]);
    expect(b.type).toBe('unstyled');
    expect(b.text).toBe('https://x.com/u/status/123?s=20');
  });
});

describe('GFM 表格', () => {
  it('表头+分隔行+数据行整段塞入 MARKDOWN atomic', () => {
    const md = '| A | B |\n| --- | --- |\n| 1 | 2 |';
    const blocks = parseMarkdown(md);
    expect(blocks).toHaveLength(1);
    const b = asAtomic(blocks[0]);
    expect(b.entityType).toBe('MARKDOWN');
    if (b.entityType === 'MARKDOWN') expect(b.data.markdown).toBe(md);
  });

  it('紧跟正文的表格与前段落分离为两块', () => {
    const md = '一段正文\n| A | B |\n| --- | --- |\n| 1 | 2 |';
    const blocks = parseMarkdown(md);
    expect(blocks).toHaveLength(2);
    expect(asText(blocks[0]).text).toBe('一段正文');
    expect(asAtomic(blocks[1]).entityType).toBe('MARKDOWN');
  });

  it('纯连字符行不含竖线,不误判为表格分隔', () => {
    // 'a | b' 后接纯 '---'(无竖线)→ 上行不是表头,'---' 是 DIVIDER
    const blocks = parseMarkdown('a | b\n---');
    expect(asText(blocks[0]).text).toBe('a | b');
    expect(asAtomic(blocks[1]).entityType).toBe('DIVIDER');
  });

  it('表格遇空行结束,后续正文另起一块', () => {
    const md = '| A |\n| --- |\n| 1 |\n\n后续';
    const blocks = parseMarkdown(md);
    expect(asAtomic(blocks[0]).entityType).toBe('MARKDOWN');
    expect(asText(blocks[1]).text).toBe('后续');
  });
});

describe('代码围栏', () => {
  it('反引号围栏产生 MARKDOWN atomic', () => {
    const md = '```\ncode\n```';
    const b = asAtomic(parseMarkdown(md)[0]);
    expect(b.entityType).toBe('MARKDOWN');
    if (b.entityType === 'MARKDOWN') expect(b.data.markdown).toBe('```\ncode\n```');
  });

  it('波浪号围栏同样识别', () => {
    const b = asAtomic(parseMarkdown('~~~\ncode\n~~~')[0]);
    expect(b.entityType).toBe('MARKDOWN');
  });

  it('反引号与波浪号围栏不互相闭合', () => {
    const md = '```\ncode\n~~~\nmore\n```';
    const b = asAtomic(parseMarkdown(md)[0]);
    if (b.entityType === 'MARKDOWN') {
      expect(b.data.markdown).toBe('```\ncode\n~~~\nmore\n```');
    }
  });

  it('闭栏数量必须不小于开栏', () => {
    // 开栏 5 个反引号,内部 3 个反引号不足以闭合,须再遇 5 个才闭合
    const md = '`````\nx\n```\ny\n`````';
    const blocks = parseMarkdown(md);
    expect(blocks).toHaveLength(1);
    const b = asAtomic(blocks[0]);
    if (b.entityType === 'MARKDOWN') {
      expect(b.data.markdown).toContain('```\ny');
    }
  });

  it('闭栏必须是裸行,尾随非空白不闭合', () => {
    // '``` extra' 不是合法闭栏,须继续到真正的裸 '```'
    const md = '```\na\n``` extra\nb\n```';
    const b = asAtomic(parseMarkdown(md)[0]);
    if (b.entityType === 'MARKDOWN') {
      expect(b.data.markdown).toBe('```\na\n``` extra\nb\n```');
    }
  });

  it('闭栏允许尾随空白', () => {
    const md = '```\na\n```   ';
    const blocks = parseMarkdown(md);
    expect(blocks).toHaveLength(1);
    expect(asAtomic(blocks[0]).entityType).toBe('MARKDOWN');
  });

  it('未闭合围栏降级为普通段落文本', () => {
    const blocks = parseMarkdown('```js\ncode');
    expect(asText(blocks[0]).type).toBe('unstyled');
    expect(blocks.some((b) => b.kind === 'atomic')).toBe(false);
  });

  it('info 归一:HTML 实体空格转义后只取第一词', () => {
    const b = asAtomic(parseMarkdown('```plain&#x20;text\ncode\n```')[0]);
    if (b.entityType === 'MARKDOWN') {
      expect(b.data.markdown).toBe('```plain\ncode\n```');
    }
  });

  it('info 归一:含空格的语言串只取第一词', () => {
    const b = asAtomic(parseMarkdown('```plain text\ncode\n```')[0]);
    if (b.entityType === 'MARKDOWN') {
      expect(b.data.markdown.split('\n')[0]).toBe('```plain');
    }
  });

  it('围栏内的块级标记不被解析', () => {
    const md = '```\n# 不是标题\n> 不是引用\n---\n```';
    const blocks = parseMarkdown(md);
    expect(blocks).toHaveLength(1);
    expect(asAtomic(blocks[0]).entityType).toBe('MARKDOWN');
  });
});

describe('图片行', () => {
  it('裸图片行产生图片块', () => {
    const b = asImage(parseMarkdown('![描述](https://h/a.png)')[0]);
    expect(b.source).toBe('https://h/a.png');
    expect(b.alt).toBe('描述');
    expect(b.fallbackText).toBe('![描述](https://h/a.png)');
  });

  it('尖括号包裹含空格路径保留空格(历史修复)', () => {
    const b = asImage(parseMarkdown('![](<images/a b.png>)')[0]);
    expect(b.source).toBe('images/a b.png');
    expect(b.alt).toBe('');
  });

  it('尖括号内含右括号不被误判为闭合', () => {
    const b = asImage(parseMarkdown('![](<a(b).png>)')[0]);
    expect(b.source).toBe('a(b).png');
  });

  it('带链接图片取内层图片 URL,丢弃外层链接', () => {
    const b = asImage(parseMarkdown('[![说明](https://i/img.png)](https://link)')[0]);
    expect(b.source).toBe('https://i/img.png');
    expect(b.alt).toBe('说明');
  });

  it('Obsidian 内嵌图片 ![[x]] 识别为图片', () => {
    const b = asImage(parseMarkdown('![[note.png]]')[0]);
    expect(b.source).toBe('note.png');
    expect(b.alt).toBe('');
  });

  it('Obsidian ![[x|alt]] 切分路径与图注', () => {
    const b = asImage(parseMarkdown('![[a.png|说明]]')[0]);
    expect(b.source).toBe('a.png');
    expect(b.alt).toBe('说明');
  });

  it('一行多图不匹配裸图片,降级为段落', () => {
    const b = asText(parseMarkdown('![a](x) ![b](y)')[0]);
    expect(b.type).toBe('unstyled');
    expect(b.text).toBe('![a](x) ![b](y)');
  });

  it('空 src 不产生图片块', () => {
    const b = asText(parseMarkdown('![]()')[0]);
    expect(b.type).toBe('unstyled');
    expect(b.text).toBe('![]()');
  });

  it('obsidianImg=false 时 ![[x]] 当普通文本处理', () => {
    const blocks = parseMarkdown('![[note.png]]', { obsidianImg: false });
    const b = asText(blocks[0]);
    expect(b.type).toBe('unstyled');
    expect(b.text).toBe('![[note.png]]');
  });
});

describe('isImageLine', () => {
  it('裸/带链接/Obsidian 图片行均返回 true', () => {
    expect(isImageLine('![](x.png)')).toBe(true);
    expect(isImageLine('[![](i.png)](l)')).toBe(true);
    expect(isImageLine('![[x.png]]')).toBe(true);
  });

  it('前后空白被 trim 后仍识别', () => {
    expect(isImageLine('   ![](x.png)   ')).toBe(true);
  });

  it('普通文本与空 src 返回 false', () => {
    expect(isImageLine('普通文本')).toBe(false);
    expect(isImageLine('![]()')).toBe(false);
  });
});

describe('行内样式 offset 精确性', () => {
  it('加粗区间切片等于内部文本', () => {
    const b = inlineOf('前**粗体**后');
    expect(b.text).toBe('前粗体后');
    const bold = stylesOf(b, 'BOLD');
    expect(bold).toHaveLength(1);
    expect(sliceRange(b.text, bold[0])).toBe('粗体');
  });

  it('斜体区间切片精确', () => {
    const b = inlineOf('a*i*b');
    expect(b.text).toBe('aib');
    const it2 = stylesOf(b, 'ITALIC');
    expect(sliceRange(b.text, it2[0])).toBe('i');
  });

  it('删除线区间切片精确', () => {
    const b = inlineOf('x~~del~~y');
    expect(b.text).toBe('xdely');
    const st = stylesOf(b, 'STRIKETHROUGH');
    expect(sliceRange(b.text, st[0])).toBe('del');
  });

  it('***x*** 同时命中 BOLD 与 ITALIC 且区间一致', () => {
    const b = inlineOf('***重***');
    expect(b.text).toBe('重');
    expect(sliceRange(b.text, stylesOf(b, 'BOLD')[0])).toBe('重');
    expect(sliceRange(b.text, stylesOf(b, 'ITALIC')[0])).toBe('重');
  });

  it('链接内嵌加粗:样式与链接区间各自精确', () => {
    const b = inlineOf('[前**粗**后](https://h)');
    expect(b.text).toBe('前粗后');
    expect(b.links).toHaveLength(1);
    expect(sliceRange(b.text, b.links[0])).toBe('前粗后');
    expect(req(b.links[0]).url).toBe('https://h');
    const bold = stylesOf(b, 'BOLD');
    expect(sliceRange(b.text, bold[0])).toBe('粗');
  });

  it('转义星号输出字面星号且不产生样式', () => {
    const b = inlineOf('a\\*b\\*c');
    expect(b.text).toBe('a*b*c');
    expect(b.inlineStyleRanges).toEqual([]);
  });

  it('code span 保护内部星号不被解析', () => {
    const b = inlineOf('前`a*b*c`后');
    expect(b.text).toBe('前`a*b*c`后');
    expect(b.inlineStyleRanges).toEqual([]);
  });

  it('snake_case 词内下划线不触发斜体', () => {
    const b = inlineOf('foo_bar_baz');
    expect(b.text).toBe('foo_bar_baz');
    expect(stylesOf(b, 'ITALIC')).toEqual([]);
  });

  it('词首下划线斜体正常生效并切片精确', () => {
    const b = inlineOf('_斜_');
    expect(b.text).toBe('斜');
    expect(sliceRange(b.text, stylesOf(b, 'ITALIC')[0])).toBe('斜');
  });
});

describe('行内样式:代理对(UTF-16)对齐', () => {
  it('emoji 之后的加粗区间按码元对齐,切片精确', () => {
    const b = inlineOf('😀**x**');
    expect(b.text).toBe('😀x');
    const bold = stylesOf(b, 'BOLD');
    // 😀 占 2 个 UTF-16 码元,故 offset 应为 2
    expect(req(bold[0]).offset).toBe(2);
    expect(req(bold[0]).length).toBe(1);
    expect(sliceRange(b.text, bold[0])).toBe('x');
  });

  it('CJK-B 区字符之后的斜体区间码元对齐', () => {
    // U+20000 属基本多文种平面之外,占 2 个 UTF-16 码元
    const b = inlineOf('\u{20000}*y*');
    expect(b.text).toBe('\u{20000}y');
    const it2 = stylesOf(b, 'ITALIC');
    expect(req(it2[0]).offset).toBe(2);
    expect(sliceRange(b.text, it2[0])).toBe('y');
  });

  it('emoji 位于加粗区间内部时长度含代理对', () => {
    const b = inlineOf('**😀**');
    expect(b.text).toBe('😀');
    const bold = stylesOf(b, 'BOLD');
    expect(bold[0]).toEqual({ offset: 0, length: 2, style: 'BOLD' });
    expect(sliceRange(b.text, bold[0])).toBe('😀');
  });
});

describe('行内代码降级(历史修复)', () => {
  it('反引号内容保留字面反引号,不产生 CODE 样式', () => {
    const b = inlineOf('这是 `code` 片段');
    expect(b.text).toBe('这是 `code` 片段');
    expect(stylesOf(b, 'CODE')).toEqual([]);
    expect(b.inlineStyleRanges).toEqual([]);
  });

  it('多反引号 code span 边界完整保留', () => {
    const b = inlineOf('``a`b``');
    expect(b.text).toBe('``a`b``');
    expect(b.inlineStyleRanges).toEqual([]);
  });

  it('code span 内部的强调标记不被解析', () => {
    const b = inlineOf('`**x**`');
    expect(b.text).toBe('`**x**`');
    expect(b.inlineStyleRanges).toEqual([]);
  });
});

describe('链接', () => {
  it('基本链接产生 LINK 区间', () => {
    const b = inlineOf('看[文档](https://h/doc)吧');
    expect(b.text).toBe('看文档吧');
    expect(b.links).toHaveLength(1);
    expect(sliceRange(b.text, b.links[0])).toBe('文档');
    expect(req(b.links[0]).url).toBe('https://h/doc');
  });

  it('尖括号包裹的 url 被剥离', () => {
    const b = inlineOf('[t](<https://h/x>)');
    expect(req(b.links[0]).url).toBe('https://h/x');
  });

  it('裸 url 的 title 被剥离', () => {
    const b = inlineOf('[t](https://h/x "标题")');
    expect(req(b.links[0]).url).toBe('https://h/x');
  });

  it('javascript: scheme 不产生 LINK,文本保留', () => {
    const b = inlineOf('[点我](javascript:alert(1))');
    expect(b.text).toBe('点我');
    expect(b.links).toEqual([]);
  });

  it('data: scheme 不产生 LINK', () => {
    const b = inlineOf('[x](data:text/html,abc)');
    expect(b.text).toBe('x');
    expect(b.links).toEqual([]);
  });

  it('mailto/相对路径/锚点均放行', () => {
    expect(req(inlineOf('[m](mailto:a@b.com)').links[0]).url).toBe('mailto:a@b.com');
    expect(req(inlineOf('[r](/path/x)').links[0]).url).toBe('/path/x');
    expect(req(inlineOf('[a](#anchor)').links[0]).url).toBe('#anchor');
    expect(req(inlineOf('[d](./rel)').links[0]).url).toBe('./rel');
  });
});

describe('frontmatter', () => {
  it('标准 frontmatter 块被跳过,只留正文', () => {
    const blocks = parseMarkdown('---\ntitle: 标题\ncover: a.png\n---\n正文');
    expect(blocks).toHaveLength(1);
    expect(asText(blocks[0]).text).toBe('正文');
  });

  it('闭合 --- 在首个空行之后则不吞正文(历史修复)', () => {
    const blocks = parseMarkdown('---\n\n正文\n\n---');
    expect(blocks).toHaveLength(3);
    expect(asAtomic(blocks[0]).entityType).toBe('DIVIDER');
    expect(asText(blocks[1]).text).toBe('正文');
    expect(asAtomic(blocks[2]).entityType).toBe('DIVIDER');
  });

  it('正文中的 --- 仍作为分割线', () => {
    const blocks = parseMarkdown('正文\n\n---\n\n更多');
    expect(asText(blocks[0]).text).toBe('正文');
    expect(asAtomic(blocks[1]).entityType).toBe('DIVIDER');
    expect(asText(blocks[2]).text).toBe('更多');
  });

  it('缩进的 --- 不触发 frontmatter 跳过', () => {
    // isFmDelim 要求顶格 ^---,缩进行不匹配 → 不进入 frontmatter 分支;
    // 缩进 ---(带前导空格)也不是 DIVIDER,故整段并为一个段落,title 行未被当元数据吞掉。
    const blocks = parseMarkdown('  ---\ntitle: x\n  ---\n正文');
    expect(blocks).toHaveLength(1);
    const b = asText(blocks[0]);
    expect(b.text).toContain('title: x');
    expect(b.text).toContain('正文');
  });
});

describe('对抗与边界', () => {
  it('深度嵌套链接不抛异常也不超时,降级纯文本', () => {
    const s = '['.repeat(5000) + 'x' + '](u)'.repeat(5000);
    let blocks: ImportBlock[] = [];
    expect(() => {
      blocks = parseMarkdown(s);
    }).not.toThrow();
    expect(blocks).toHaveLength(1);
    expect(req(blocks[0]).kind).toBe('text');
  });

  it('深度嵌套强调不抛异常', () => {
    const s = '*'.repeat(400) + 'x' + '*'.repeat(400);
    expect(() => parseMarkdown(s)).not.toThrow();
  });

  it('空文档返回空数组', () => {
    expect(parseMarkdown('')).toEqual([]);
  });

  it('纯空行文档返回空数组', () => {
    expect(parseMarkdown('   \n\n  \n')).toEqual([]);
  });

  it('CRLF 换行被正确切分', () => {
    const blocks = parseMarkdown('# 标题\r\n\r\n正文');
    expect(asText(blocks[0]).type).toBe('header-one');
    expect(asText(blocks[0]).text).toBe('标题');
    expect(asText(blocks[1]).text).toBe('正文');
  });
});

describe('forEachContentLine', () => {
  it('跳过围栏内部的行,只访问围栏外的行', () => {
    const lines = ['外1', '```', '# 内部', '内2', '```', '外3'];
    const visited: string[] = [];
    forEachContentLine(lines, (line) => {
      visited.push(line);
    });
    expect(visited).toEqual(['外1', '外3']);
  });

  it('visitor 返回 true 时提前停止', () => {
    const lines = ['a', 'b', 'c'];
    const visited: string[] = [];
    forEachContentLine(lines, (line) => {
      visited.push(line);
      return line === 'b';
    });
    expect(visited).toEqual(['a', 'b']);
  });

  it('未闭合围栏的开栏行按普通内容访问', () => {
    const lines = ['```', 'x'];
    const visited: string[] = [];
    forEachContentLine(lines, (line) => {
      visited.push(line);
    });
    expect(visited).toEqual(['```', 'x']);
  });
});

describe('stripFirstImageLine', () => {
  it('删除正文第一张独占行图片', () => {
    const md = '开头\n![](a.png)\n结尾';
    expect(stripFirstImageLine(md)).toBe('开头\n结尾');
  });

  it('无图片时原样返回', () => {
    const md = '只有文字\n没有图片';
    expect(stripFirstImageLine(md)).toBe(md);
  });

  it('不删除代码块内部的图片行', () => {
    const md = '```\n![](inside.png)\n```\n![](real.png)';
    const result = stripFirstImageLine(md);
    expect(result).toContain('![](inside.png)');
    expect(result).not.toContain('![](real.png)');
  });

  it('删除带链接图片行', () => {
    const md = '[![](i.png)](l)\n正文';
    expect(stripFirstImageLine(md)).toBe('正文');
  });
});

describe('wikilink 开关', () => {
  it('默认开启时 [[x]] 转为纯文本', () => {
    const b = inlineOf('见[[目标]]处');
    expect(b.text).toBe('见目标处');
    expect(b.links).toEqual([]);
  });

  it('默认开启时 [[目标|别名]] 取别名', () => {
    const b = inlineOf('[[target|别名]]');
    expect(b.text).toBe('别名');
  });

  it('关闭时 [[x]] 保留字面量', () => {
    const b = inlineOf('见[[目标]]处');
    // 上面已验证开启行为;此处显式关闭
    const off = asText(parseMarkdown('见[[目标]]处', { wikilink: false })[0]);
    expect(off.text).toBe('见[[目标]]处');
    // 断言两者不同,证明开关生效
    expect(off.text).not.toBe(b.text);
  });

  it('关闭时 [[x|y]] 也保留字面量', () => {
    const off = asText(parseMarkdown('[[t|y]]', { wikilink: false })[0]);
    expect(off.text).toBe('[[t|y]]');
  });
});
