import { describe, it, expect } from 'vitest';
import {
  parseMarkdown,
  forEachContentLine,
  inlinePlainText,
  parseMarkdownWithMeta,
  isUnclosedFence,
} from './parser';
import { extractTitle } from './frontmatter';
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

  it('H4 空标题不产出块(第三批 P12:此前产出无 BOLD 的空段落)', () => {
    expect(parseMarkdown('####  ')).toEqual([]);
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

// B3-5(P2-7):`- - -` / `* * *` / `___` 是 CommonMark 的标准分割线,此前分别落成
// 垃圾列表项(`* * *` 还是「单空格 + ITALIC」的纯垃圾块)与段落字面量。
// 只放宽**字符集与内部空格**,divider 依旧要求顶格(见 RE_DIVIDER 注释:放开缩进会让
// `- item\n  ---` 变分割线)。
describe('分割线变体(B3-5)', () => {
  it('下划线 `___` 顶格成 DIVIDER', () => {
    expect(asAtomic(parseMarkdown('___')[0]).entityType).toBe('DIVIDER');
    expect(asAtomic(parseMarkdown('_____')[0]).entityType).toBe('DIVIDER');
  });

  it('空格分隔的 `- - -` / `* * *` / `_ _ _` 成 DIVIDER', () => {
    for (const md of ['- - -', '* * *', '_ _ _', '-  -  -', '- - - - -']) {
      expect([md, asAtomic(parseMarkdown(md)[0]).entityType]).toEqual([md, 'DIVIDER']);
    }
  });

  it('尾随空白不阻断 DIVIDER', () => {
    expect(asAtomic(parseMarkdown('--- ')[0]).entityType).toBe('DIVIDER');
  });

  it('不足三个标记 / 混合字符不是 DIVIDER', () => {
    // `- -` 只有两个标记 → 仍走列表分支(与本改动前逐字节一致);`-*-` 谁都不是 → 段落。
    expect(asText(parseMarkdown('- -')[0]).type).toBe('unordered-list-item');
    expect(asText(parseMarkdown('-*-')[0]).type).toBe('unstyled');
  });

  // 四象限回归:段落下方的 `---` 归 setext(下划线),`- - -` 归 hr(不是下划线形态)。
  it('四象限 · 段落 + `- - -` → 段落 + hr', () => {
    const blocks = parseMarkdown('前面一段\n- - -\n后面一段');
    expect(asText(blocks[0]).type).toBe('unstyled');
    expect(asText(blocks[0]).text).toBe('前面一段');
    expect(asAtomic(blocks[1]).entityType).toBe('DIVIDER');
    expect(asText(blocks[2]).text).toBe('后面一段');
  });

  it('四象限 · 段落 + `---` → setext 标题(优先级不变)', () => {
    const blocks = parseMarkdown('前面一段\n---\n后面一段');
    expect(asText(blocks[0]).type).toBe('header-one');
    expect(asText(blocks[0]).text).toBe('前面一段');
    expect(asText(blocks[1]).text).toBe('后面一段');
  });

  it('四象限 · 顶格 `***` / `___` / `- - -`(独立成块)→ hr', () => {
    for (const md of ['***', '___', '- - -']) {
      expect([md, asAtomic(parseMarkdown(md)[0]).entityType]).toEqual([md, 'DIVIDER']);
    }
  });

  it('四象限 · 缩进的 `  ---` / `  - - -` 维持现状(不是 DIVIDER)', () => {
    // 缩进形态一律不升格为分割线:`  ---` 落段落、`  - - -` 落列表项(均与改动前一致)。
    expect(asText(parseMarkdown('  ---')[0]).type).toBe('unstyled');
    expect(asText(parseMarkdown('  - - -')[0]).type).toBe('unordered-list-item');
    // 列表项下方缩进的 `---` 不得变成分割线(RE_DIVIDER 顶格约束的存在理由)
    const blocks = parseMarkdown('- item\n  ---');
    expect(asText(blocks[0]).type).toBe('unordered-list-item');
    expect(blocks.every((b) => b.kind !== 'atomic')).toBe(true);
  });

  it('`* * *` 不再落成列表项 + ITALIC 垃圾块', () => {
    const blocks = parseMarkdown('* * *');
    expect(blocks).toHaveLength(1);
    expect(asAtomic(blocks[0]).entityType).toBe('DIVIDER');
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

  it('不在列表中时 ≥4 空格缩进不算列表项(review 修复:粘贴的缩进代码不被拆解)', () => {
    // CommonMark:列表最多缩进 3 格,≥4 格属缩进代码块领域。放开缩进匹配后若无此门槛,
    // 正文里粘贴的 4 空格缩进代码/日志会被硬拆成列表项、丢掉原始缩进语境。
    const blocks = parseMarkdown('前面一段话\n    - 粘贴代码里的破折号行\n    - 第二行');
    expect(blocks).toHaveLength(1);
    const only = asText(blocks[0]);
    expect(only.type).toBe('unstyled');
    expect(only.text).toContain('- 粘贴代码里的破折号行');
  });

  it('已在列表中时 ≥4 空格照常算嵌套项(门槛只对「起头」生效)', () => {
    expect(shape('- 一级\n    - 四空格二级')).toEqual(['ul:0', 'ul:1']);
  });

  it('≤3 空格缩进仍可打断段落起列表(与 CommonMark 一致)', () => {
    const blocks = parseMarkdown('前面一段话\n  - 两空格列表');
    expect(blocks).toHaveLength(2);
    expect(asText(blocks[1]).type).toBe('unordered-list-item');
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

// B3-11(P2-13):CommonMark 只允许 `1.` 打断段落。此前任意数字都能打断,
// 软折行段落里以「2024. 」开头的行被硬切成列表项,原编号还被 X 重编为 1(内容失真)。
describe('有序列表打断段落的收紧(B3-11)', () => {
  it('段落中的 `2024. ` 行不再打断段落(整段并为一个 unstyled 块)', () => {
    const blocks = parseMarkdown('那年冬天特别冷,\n2024. 冬天的第一场雪来得很晚,\n我们都记得。');
    expect(blocks).toHaveLength(1);
    const b = asText(blocks[0]);
    expect(b.type).toBe('unstyled');
    expect(b.text).toBe('那年冬天特别冷,\n2024. 冬天的第一场雪来得很晚,\n我们都记得。');
  });

  it('`1.` 仍可打断段落(与 CommonMark 一致)', () => {
    const blocks = parseMarkdown('前面一段\n1. 第一项\n2. 第二项');
    expect(asText(blocks[0]).type).toBe('unstyled');
    expect(asText(blocks[1]).type).toBe('ordered-list-item');
    expect(asText(blocks[2]).type).toBe('ordered-list-item');
  });

  it('独立起块时任意数字仍是有序列表(只收紧「打断段落」这一处)', () => {
    expect(asText(parseMarkdown('2024. 年度总结')[0]).type).toBe('ordered-list-item');
    expect(asText(parseMarkdown('前面一段\n\n3. 第三项')[1]).type).toBe('ordered-list-item');
  });

  it('无序列表仍可被任意标记打断(不受本收紧影响)', () => {
    expect(asText(parseMarkdown('前面一段\n- 项目')[1]).type).toBe('unordered-list-item');
  });

  it('setext 联动:`2024. ` 行成为合法段落行后,其下 `---` 把整段升格为标题', () => {
    const blocks = parseMarkdown('前面一段\n2024. 冬\n---');
    expect(blocks).toHaveLength(1);
    const b = asText(blocks[0]);
    expect(b.type).toBe('header-one');
    expect(b.text).toBe('前面一段\n2024. 冬');
  });

  // P3:setext 下划线不能是列表项的 lazy 续行(CommonMark §4.3 Example 93/94),`===` 并入列表项、不产生标题;
  // extractTitle 经 onHeading 与解析同源,同样不认标题(见 frontmatter.test.ts P3 用例)。
  it('块首的 `2024. 冬` + `===`:`===` 作为 lazy 续行并入有序列表项', () => {
    const blocks = parseMarkdown('2024. 冬\n===');
    expect(blocks).toHaveLength(1);
    const b = asText(blocks[0]);
    expect(b.type).toBe('ordered-list-item');
    expect(b.text).toBe('冬\n===');
  });
});

describe('setext 标题', () => {
  it('=== 下划线 → header-one,下划线行被吃掉', () => {
    const blocks = parseMarkdown('我的标题\n===\n\n正文');
    expect(asText(blocks[0]).type).toBe('header-one');
    expect(asText(blocks[0]).text).toBe('我的标题');
    expect(asText(blocks[1]).text).toBe('正文');
  });

  it('--- 下划线 → header-one(与 ATX 的 ## 同归 header-one)', () => {
    const blocks = parseMarkdown('我的标题\n---\n\n正文');
    expect(blocks).toHaveLength(2);
    expect(asText(blocks[0]).type).toBe('header-one');
    expect(asText(blocks[0]).text).toBe('我的标题');
  });

  it('下划线长度不限(单个 = 或 - 也算)', () => {
    expect(asText(parseMarkdown('A\n=')[0]).type).toBe('header-one');
    expect(asText(parseMarkdown('B\n-')[0]).type).toBe('header-one');
  });

  it('setext 正文必须是段落行:列表/ATX 标题/引用下方的 --- 仍是 DIVIDER', () => {
    for (const md of ['- 列表项\n---', '# ATX\n---', '> 引用\n---']) {
      const blocks = parseMarkdown(md);
      expect([md, asAtomic(blocks[1]).entityType]).toEqual([md, 'DIVIDER']);
    }
  });

  it('缩进的下划线不算 setext(与 DIVIDER 同样严格要求顶格)', () => {
    const blocks = parseMarkdown('标题\n  ---');
    expect(blocks).toHaveLength(1);
    expect(asText(blocks[0]).type).toBe('unstyled');
  });

  it('多行段落 + 下划线 → 整段升格为标题', () => {
    const b = asText(parseMarkdown('第一行\n第二行\n===')[0]);
    expect(b.type).toBe('header-one');
    expect(b.text).toBe('第一行\n第二行');
  });

  it('真表格不受影响(分隔行含竖线,不是 setext 下划线)', () => {
    expect(asAtomic(parseMarkdown('| A | B |\n| --- | --- |\n| 1 | 2 |')[0]).entityType).toBe('MARKDOWN');
    expect(asAtomic(parseMarkdown('| A |\n| --- |\n| 1 |')[0]).entityType).toBe('MARKDOWN');
  });

  it('行内样式在 setext 标题内正常解析', () => {
    const b = asText(parseMarkdown('带**粗体**的标题\n===')[0]);
    expect(b.text).toBe('带粗体的标题');
    const r = req(b.inlineStyleRanges[0]);
    expect(b.text.slice(r.offset, r.offset + r.length)).toBe('粗体');
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

  // B3-2(P1-5):X 官方「复制链接」默认带 `?s=20`,旧正则 `\/?$` 收尾 → 100% 漏判,
  // 整行落成 unstyled 死文本(连 LINK 都不是)。
  it('带 query 参数(X 分享按钮默认形态)的推文识别', () => {
    const b = asAtomic(parseMarkdown('https://x.com/u/status/123?s=20')[0]);
    expect(b.entityType).toBe('TWEET');
    if (b.entityType === 'TWEET') expect(b.data.tweetId).toBe('123');
  });

  it('带 fragment 的推文识别', () => {
    expect(asAtomic(parseMarkdown('https://x.com/u/status/123#m')[0]).entityType).toBe('TWEET');
  });

  it('mobile. 子域识别', () => {
    const b = asAtomic(parseMarkdown('https://mobile.twitter.com/u/status/456')[0]);
    expect(b.entityType).toBe('TWEET');
    if (b.entityType === 'TWEET') expect(b.data.tweetId).toBe('456');
  });

  it('行尾空白不再阻断识别(匹配前 trim)', () => {
    expect(asAtomic(parseMarkdown('https://x.com/u/status/123  ')[0]).entityType).toBe('TWEET');
    expect(asAtomic(parseMarkdown('  https://x.com/u/status/123')[0]).entityType).toBe('TWEET');
  });

  // 行为外溢(有意接受,测试钉住语义):`(?:[/?#]\S*)?` 尾缀让子路径链接也成 TWEET 块。
  // X 的嵌入卡片按 tweetId 渲染,渲染结果与主帖一致,故可接受。
  it('/photo/1、/analytics 等子路径链接也成为 TWEET 块(有意的行为外溢)', () => {
    const photo = asAtomic(parseMarkdown('https://x.com/u/status/123/photo/1')[0]);
    expect(photo.entityType).toBe('TWEET');
    if (photo.entityType === 'TWEET') expect(photo.data.tweetId).toBe('123');
    expect(asAtomic(parseMarkdown('https://x.com/u/status/123/analytics')[0]).entityType).toBe('TWEET');
  });

  it('status 段非纯数字 / 含空格仍不匹配', () => {
    expect(asText(parseMarkdown('https://x.com/u/status/abc')[0]).type).toBe('unstyled');
    expect(asText(parseMarkdown('https://x.com/u/status/123 后面还有字')[0]).type).toBe('unstyled');
  });

  it('段落下方紧跟带 query 的推文行 → 段落在此断开(isBlockBoundary 同步)', () => {
    const blocks = parseMarkdown('前面一段\nhttps://x.com/u/status/123?s=20\n后面一段');
    expect(asText(blocks[0]).text).toBe('前面一段');
    expect(asAtomic(blocks[1]).entityType).toBe('TWEET');
    expect(asText(blocks[2]).text).toBe('后面一段');
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
    // 'a | b' 后接纯 '---'(无竖线)→ 上行不是表头。
    // **历史行为翻转**:此前产出「段落 + DIVIDER」;setext 支持落地后,紧邻段落的 `---`
    // 按 CommonMark 是 setext 下划线(且 2 单元格表头 vs 1 单元格分隔行本就不构成 GFM 表格),
    // 故整体升格为标题。空行隔开的 `---` 仍是 DIVIDER(见下一条)。
    const blocks = parseMarkdown('a | b\n---');
    expect(blocks).toHaveLength(1);
    expect(asText(blocks[0]).type).toBe('header-one');
    expect(asText(blocks[0]).text).toBe('a | b');
  });

  it('空行隔开的连字符行仍是 DIVIDER(setext 只吃紧邻段落的下划线)', () => {
    const blocks = parseMarkdown('一段话\n\n---\n\n另一段');
    expect(asText(blocks[0]).type).toBe('unstyled');
    expect(asAtomic(blocks[1]).entityType).toBe('DIVIDER');
    expect(asText(blocks[2]).text).toBe('另一段');
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

  it('未闭合围栏(第二批 P2):按 CommonMark 到文末都是代码,补齐闭栏', () => {
    const blocks = parseMarkdown('```js\ncode');
    expect(blocks).toHaveLength(1);
    const b = asAtomic(blocks[0]);
    if (b.entityType !== 'MARKDOWN') throw new Error('期望 MARKDOWN');
    expect(b.data.markdown).toBe('```js\ncode\n```');
    expect(isUnclosedFence(b)).toBe(true);
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

describe('数学块 $$ (LATEX atomic)', () => {
  it('多行 $$ 公式产生 LATEX atomic,公式本体在 text', () => {
    const md = '$$\nE = mc^2\n$$';
    const blocks = parseMarkdown(md);
    expect(blocks).toHaveLength(1);
    const b = asAtomic(blocks[0]);
    expect(b.entityType).toBe('LATEX');
    if (b.entityType === 'LATEX') {
      expect(b.text).toBe('E = mc^2');
      expect(b.data).toEqual({});
    }
  });

  it('多行公式保留内部换行', () => {
    const md = '$$\n\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}\n$$';
    const b = asAtomic(parseMarkdown(md)[0]);
    if (b.entityType === 'LATEX') {
      expect(b.text).toBe('\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}');
    }
  });

  it('同行闭合 $$ 公式 $$ 也识别', () => {
    const b = asAtomic(parseMarkdown('$$ E = mc^2 $$')[0]);
    expect(b.entityType).toBe('LATEX');
    if (b.entityType === 'LATEX') expect(b.text).toBe('E = mc^2');
  });

  it('公式内的 --- 不被拆成分割线(整段吃进 LATEX)', () => {
    const md = '$$\na --- b\n$$';
    const blocks = parseMarkdown(md);
    expect(blocks).toHaveLength(1);
    const b = asAtomic(blocks[0]);
    expect(b.entityType).toBe('LATEX');
    if (b.entityType === 'LATEX') expect(b.text).toBe('a --- b');
  });

  it('未闭合 $$ 回退为普通段落文本(不产 LATEX)', () => {
    const blocks = parseMarkdown('$$\nE = mc^2');
    expect(blocks.some((b) => b.kind === 'atomic' && b.entityType === 'LATEX')).toBe(false);
    expect(asText(blocks[0]).type).toBe('unstyled');
  });

  it('空公式 $$\\n\\n$$ 回退为文本(不产空 LATEX)', () => {
    const blocks = parseMarkdown('$$\n\n$$');
    expect(blocks.some((b) => b.kind === 'atomic' && b.entityType === 'LATEX')).toBe(false);
  });

  it('行首 $$100 不误判为数学块(行内双美元假阳性防线)', () => {
    const blocks = parseMarkdown('$$100 涨到 $$200 了');
    expect(blocks.some((b) => b.kind === 'atomic' && b.entityType === 'LATEX')).toBe(false);
    expect(asText(blocks[0]).type).toBe('unstyled');
  });

  it('围栏内的 $$ 不被当数学块(围栏优先保护)', () => {
    const md = '```\n$$\nx\n$$\n```';
    const blocks = parseMarkdown(md);
    expect(blocks).toHaveLength(1);
    expect(asAtomic(blocks[0]).entityType).toBe('MARKDOWN');
  });

  it('缩进的 $$ 不是数学块起行(须顶格)', () => {
    const blocks = parseMarkdown('  $$\nx\n  $$');
    expect(blocks.some((b) => b.kind === 'atomic' && b.entityType === 'LATEX')).toBe(false);
  });

  it('$$ 前后的段落各自成块', () => {
    const md = '前言\n\n$$\nx = 1\n$$\n\n后语';
    const blocks = parseMarkdown(md);
    expect(asText(blocks[0]).text).toBe('前言');
    expect(asAtomic(blocks[1]).entityType).toBe('LATEX');
    expect(asText(blocks[2]).text).toBe('后语');
  });

  it('$$ 起行终止上文段落收集(无空行分隔也不吞入段落)', () => {
    const md = '一段话\n$$\nx\n$$';
    const blocks = parseMarkdown(md);
    expect(asText(blocks[0]).text).toBe('一段话');
    expect(asAtomic(blocks[1]).entityType).toBe('LATEX');
  });

  it('同行公式尾随空白不污染公式体(review 边界:slice(2,-2) 须先 trimEnd)', () => {
    // `$$ x $$` 后跟空格时,若直接 line.slice(2,-2),-2 被尾随空格顶偏 → 切出 "x $$" 脏结果。
    const b = asAtomic(parseMarkdown('$$ E = mc^2 $$   ')[0]);
    expect(b.entityType).toBe('LATEX');
    if (b.entityType === 'LATEX') expect(b.text).toBe('E = mc^2');
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

// B3-1(P1-4):CommonMark 的可选 title(`url "标题"`)是 Typora/Pandoc/HTML→md 的默认输出,
// 未剥离时整个 `url "标题"` 进 source → 远程 fetch 404 / 本地 vault 查不到,整图降级。
describe('图片 destination 的可选 title 剥离', () => {
  it('双引号 title 被剥离', () => {
    const b = asImage(parseMarkdown('![描述](https://h/a.png "标题")')[0]);
    expect(b.source).toBe('https://h/a.png');
    expect(b.alt).toBe('描述');
  });

  it('单引号 title 被剥离', () => {
    expect(asImage(parseMarkdown("![](https://h/a.png 'title')")[0]).source).toBe('https://h/a.png');
  });

  it('title 与 URL 之间多个空格 / Tab 同样剥离', () => {
    expect(asImage(parseMarkdown('![](a.png   "t")')[0]).source).toBe('a.png');
    expect(asImage(parseMarkdown('![](a.png\t"t")')[0]).source).toBe('a.png');
  });

  it('`(标题)` 形态**不剥**——与 `photo (1).png` 这类文件名歧义,保守起见原样保留', () => {
    expect(asImage(parseMarkdown('![](photo (1).png)')[0]).source).toBe('photo (1).png');
  });

  it('含空格的本地路径(无引号)不被误截', () => {
    expect(asImage(parseMarkdown('![](my file.png)')[0]).source).toBe('my file.png');
  });

  it('`<>` 包裹分支不受影响:尖括号内原样,`>` 之后的 title 本就被忽略', () => {
    expect(asImage(parseMarkdown('![](<images/a b.png> "标题")')[0]).source).toBe('images/a b.png');
  });

  it('带链接图片 `[![](img "t")](link)` 的内层图片同样剥 title', () => {
    const b = asImage(parseMarkdown('[![说明](https://i/img.png "标题")](https://link)')[0]);
    expect(b.source).toBe('https://i/img.png');
    expect(b.alt).toBe('说明');
  });
});

// A1:带链接图片行改为括号配对扫描(matchLinkedImageLine),杜绝旧正则两段贪婪 `.+` 把
// 一行多图 / 尾随内容吞进 source。错误形态须整行回落段落(文本一字不丢),合法单张仍识别。
describe('带链接图片行:一行多张 / 尾随内容不认作独占行图片', () => {
  it('推文转 md 的两张链接图并排 → 不是 image 块,文本完整保留', () => {
    const md =
      '[![a](https://pbs.twimg.com/1.jpg)](https://x.com/u/status/1/photo/1) [![b](https://pbs.twimg.com/2.jpg)](https://x.com/u/status/1/photo/2)';
    const blocks = parseMarkdown(md);
    expect(blocks.some((b) => b.kind === 'image')).toBe(false);
    const b = asText(blocks[0]);
    expect(b.text).toContain('https://pbs.twimg.com/1.jpg');
    expect(b.text).toContain('https://pbs.twimg.com/2.jpg');
  });

  it('链接图后跟裸图 `[![a](i.png)](http://l) ![b](y.png)` → 不是 image 块,b 不丢', () => {
    const md = '[![a](i.png)](http://l) ![b](y.png)';
    const blocks = parseMarkdown(md);
    expect(blocks.some((b) => b.kind === 'image')).toBe(false);
    const b = asText(blocks[0]);
    expect(b.text).toContain('i.png');
    expect(b.text).toContain('![b](y.png)');
  });

  it('链接图后跟括号注释 `[![a](i.png)](http://l)(注:见原文)` → 不是 image 块,注释不丢', () => {
    const md = '[![a](i.png)](http://l)(注:见原文)';
    const blocks = parseMarkdown(md);
    expect(blocks.some((b) => b.kind === 'image')).toBe(false);
    const b = asText(blocks[0]);
    expect(b.text).toContain('(注:见原文)');
  });

  it('单张带 title 带链接 `[![alt](src "title")](https://link)` 仍识别为 image', () => {
    const blocks = parseMarkdown('[![alt](https://i/a.png "title")](https://link)');
    expect(blocks).toHaveLength(1);
    const b = asImage(blocks[0]);
    expect(b.source).toBe('https://i/a.png');
    expect(b.alt).toBe('alt');
  });

  it('外层链接 URL 含括号 `[![a](i.png)](http://l/f(1))` 识别正确', () => {
    const blocks = parseMarkdown('[![a](i.png)](http://l/f(1))');
    expect(blocks).toHaveLength(1);
    const b = asImage(blocks[0]);
    expect(b.source).toBe('i.png');
    expect(b.alt).toBe('a');
  });

  it('内层图片 URL 含括号 `[![a](http://h/f(1).png)](http://l)` 识别正确', () => {
    const b = asImage(parseMarkdown('[![a](http://h/f(1).png)](http://l)')[0]);
    expect(b.source).toBe('http://h/f(1).png');
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

// B3-6(P2-8):CommonMark 允许块级元素前有 0-3 个空格。此前一律要求顶格,缩进的标题/引用/
// 围栏全部降级成段落,前导空格还以字面量进正文。divider / setext / 块级公式**仍维持顶格**
// (它们的顶格约束是有意的,见各自注释)。
describe('0-3 空格缩进的块级元素(B3-6)', () => {
  it('缩进 1-3 空格的 ATX 标题仍是标题,前导空格不进文本', () => {
    for (const md of [' # 标题', '  # 标题', '   # 标题']) {
      const b = asText(parseMarkdown(md)[0]);
      expect([md, b.type, b.text]).toEqual([md, 'header-one', '标题']);
    }
    expect(asText(parseMarkdown('   ### 三级')[0]).type).toBe('header-two');
  });

  it('缩进 ≥4 空格的 `#` 仍是段落,且原样保留缩进(粘贴的代码/日志不毁)', () => {
    const b = asText(parseMarkdown('    # 不是标题')[0]);
    expect(b.type).toBe('unstyled');
    expect(b.text).toBe('    # 不是标题');
  });

  it('缩进 1-3 空格的引用仍是 blockquote', () => {
    for (const md of [' > 引用', '  > 引用', '   > 引用']) {
      const b = asText(parseMarkdown(md)[0]);
      expect([md, b.type, b.text]).toEqual([md, 'blockquote', '引用']);
    }
  });

  it('缩进围栏成代码块,且**语言标记不丢**(info 规范化正则须同步放宽)', () => {
    const b = asAtomic(parseMarkdown('  ```ts\nconst x = 1;\n  ```')[0]);
    expect(b.entityType).toBe('MARKDOWN');
    if (b.entityType === 'MARKDOWN') {
      expect(b.data.markdown.startsWith('```ts')).toBe(true);
      expect(b.data.markdown).toContain('const x = 1;');
    }
  });

  it('缩进的闭栏行仍能闭合(matchFenceClose 须同步放宽,否则整段吞进正文)', () => {
    const blocks = parseMarkdown('```\ncode\n  ```\n围栏之后的正文');
    expect(asAtomic(blocks[0]).entityType).toBe('MARKDOWN');
    expect(asText(blocks[1]).text).toBe('围栏之后的正文');
  });

  it('缩进围栏内部的内容不被解析(与顶格围栏一致)', () => {
    const b = asAtomic(parseMarkdown('   ```\n# 里面的井号\n---\n   ```')[0]);
    expect(b.entityType).toBe('MARKDOWN');
    if (b.entityType === 'MARKDOWN') expect(b.data.markdown).toContain('# 里面的井号');
  });

  it('段落行的前导空白逐行剥离,最多 3 列', () => {
    const b = asText(parseMarkdown('  段落第一行\n   段落第二行\n段落第三行')[0]);
    expect(b.type).toBe('unstyled');
    expect(b.text).toBe('段落第一行\n段落第二行\n段落第三行');
  });

  it('段落里 ≥4 空格的行原样保留(粘贴的缩进日志不被剥)', () => {
    const b = asText(parseMarkdown('日志如下:\n    2026-08-18 ERROR x\n     缩进更深的一行')[0]);
    expect(b.text).toBe('日志如下:\n    2026-08-18 ERROR x\n     缩进更深的一行');
  });

  it('前导空白剥离发生在行内解析之前,offset 不错位', () => {
    const b = asText(parseMarkdown('  **粗体**开头')[0]);
    expect(b.text).toBe('粗体开头');
    expect(b.inlineStyleRanges).toEqual([{ offset: 0, length: 2, style: 'BOLD' }]);
  });

  it('divider / setext / 块级公式维持顶格(不随本条放宽)', () => {
    expect(asText(parseMarkdown('  ---')[0]).type).toBe('unstyled'); // 不是 DIVIDER
    expect(asText(parseMarkdown('标题\n  ===')[0]).type).toBe('unstyled'); // 不是 setext
    expect(asText(parseMarkdown('  $$ x $$')[0]).type).toBe('unstyled'); // 不是 LATEX
  });

  it('缩进标题可打断段落(isBlockBoundary 随 RE_HEADING/RE_BLOCKQUOTE 同步)', () => {
    const blocks = parseMarkdown('前面一段\n  # 标题\n  > 引用');
    expect(asText(blocks[0]).text).toBe('前面一段');
    expect(asText(blocks[1]).type).toBe('header-one');
    expect(asText(blocks[2]).type).toBe('blockquote');
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

  it('未闭合围栏(第二批 P2):开栏行到文末整段跳过(与解析一致,都是代码)', () => {
    const lines = ['正文', '```', 'x'];
    const visited: string[] = [];
    forEachContentLine(lines, (line) => {
      visited.push(line);
    });
    expect(visited).toEqual(['正文']);
  });

  // B3-3(P1-6):frontmatter 跳过是**显式开关**,默认不跳——语义不隐式变更,
  // 需要跳过的消费方(标题抽取链)自己声明,免得别的消费方被悄悄改语义。
  it('默认不跳过 frontmatter(语义不变)', () => {
    const lines = ['---', '# 元数据区', 'foo: bar', '---', '# 真标题'];
    const visited: string[] = [];
    forEachContentLine(lines, (line) => {
      visited.push(line);
    });
    expect(visited).toEqual(lines);
  });

  it('skipFrontmatter=true 时跳过文首 frontmatter 整块', () => {
    const lines = ['---', '# 元数据区', 'foo: bar', '---', '# 真标题'];
    const visited: string[] = [];
    forEachContentLine(
      lines,
      (line) => {
        visited.push(line);
      },
      { skipFrontmatter: true },
    );
    expect(visited).toEqual(['# 真标题']);
  });

  it('skipFrontmatter=true 时 index 仍是**原始行下标**(splice 才不会删错行)', () => {
    const lines = ['---', 'foo: bar', '---', '正文', '# 真标题'];
    const seen: Array<[string, number]> = [];
    forEachContentLine(
      lines,
      (line, index) => {
        seen.push([line, index]);
      },
      { skipFrontmatter: true },
    );
    expect(seen).toEqual([
      ['正文', 3],
      ['# 真标题', 4],
    ]);
  });

  it('skipFrontmatter=true 但无 frontmatter → 从头遍历', () => {
    const lines = ['# 标题', '正文'];
    const visited: string[] = [];
    forEachContentLine(
      lines,
      (line) => {
        visited.push(line);
      },
      { skipFrontmatter: true },
    );
    expect(visited).toEqual(['# 标题', '正文']);
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

describe('批次三 code review 修复回归', () => {
  it('推文链接后直接接 CJK 正文(无空格)→ 整行回落普通文本,正文一字不丢', () => {
    const blocks = parseMarkdown('https://x.com/user/status/123?s=20这条推文说得好');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind).toBe('text');
    expect((blocks[0] as { text: string }).text).toContain('这条推文说得好');
  });

  it('推文链接尾随句号「。」→ 不匹配 TWEET,整行保留', () => {
    const blocks = parseMarkdown('https://x.com/user/status/123?s=20。');
    expect(blocks[0]!.kind).toBe('text');
  });

  it('纯 ASCII query 推文链接仍是 TWEET 块(收口不误伤)', () => {
    const blocks = parseMarkdown('https://x.com/user/status/123?s=20&t=abc');
    expect(blocks[0]!.kind).toBe('atomic');
  });

  it('闭栏行尾随全角空格 U+3000(CJK 输入法常见)仍闭合围栏', () => {
    const blocks = parseMarkdown('```js\nconst a = 1;\n```　\n\n正文');
    expect(blocks[0]!.kind).toBe('atomic'); // 代码块完整成块
    expect(blocks.some((b) => b.kind === 'text' && (b as { text: string }).text === '正文')).toBe(true);
  });

  it('Tab 分隔的分割线 `-\\t-\\t-` 与尾随 Tab 的 `- - -\\t` 均识别为 hr', () => {
    for (const md of ['-\t-\t-', '- - -\t']) {
      const blocks = parseMarkdown(md);
      expect(blocks).toHaveLength(1);
      expect(blocks[0]!.kind).toBe('atomic');
    }
  });
});

// ===========================================================================
// 发版前 P1 修复(解析层 A2/A3/A4/A7)
// ===========================================================================

describe('A2 强调符的最小 flanking 规则', () => {
  it('性能:大量未闭合 ** 后跟转义标点仍线性(< 100ms)', () => {
    const t0 = performance.now();
    parseMarkdown('**a '.repeat(5000) + '\\_');
    expect(performance.now() - t0).toBeLessThan(100);
  });

  it('两侧带空格的星号是乘号,原样保留且不设样式', () => {
    const b = inlineOf('2 * 3 * 4');
    expect(b.text).toBe('2 * 3 * 4');
    expect(b.inlineStyleRanges).toEqual([]);
  });

  it('两侧带空格的下划线 / 双波浪号原样保留', () => {
    for (const md of ['a _ b _ c', 'x ~~ y ~~ z', 'a ** b ** c', 'a *** b *** c']) {
      const b = inlineOf(md);
      expect([md, b.text, b.inlineStyleRanges]).toEqual([md, md, []]);
    }
  });

  it('跨行的「空格 * 空格」不被当成斜体', () => {
    const b = asText(parseMarkdown('价格 * 数量\n总价 * 2')[0]);
    expect(b.text).toBe('价格 * 数量\n总价 * 2');
    expect(b.inlineStyleRanges).toEqual([]);
  });

  it('闭符号前是空白的候选被跳过:`**a ** b**` → 整段加粗 `a ** b`(CommonMark)', () => {
    const b = inlineOf('**a ** b**');
    expect(b.text).toBe('a ** b');
    expect(b.inlineStyleRanges).toEqual([{ offset: 0, length: 6, style: 'BOLD' }]);
  });

  it('`***a** b*` → 斜体包住「加粗 a + 空格 b」(CommonMark),不丢字符', () => {
    const b = inlineOf('***a** b*');
    expect(b.text).toBe('a b');
    expect(sliceRange(b.text, stylesOf(b, 'BOLD')[0])).toBe('a');
    expect(sliceRange(b.text, stylesOf(b, 'ITALIC')[0])).toBe('a b');
  });

  it('`***a* b**` → 加粗包住「斜体 a + 空格 b」(已有行为不回归)', () => {
    const b = inlineOf('***a* b**');
    expect(b.text).toBe('a b');
    expect(sliceRange(b.text, stylesOf(b, 'ITALIC')[0])).toBe('a');
    expect(sliceRange(b.text, stylesOf(b, 'BOLD')[0])).toBe('a b');
  });

  it('紧贴内容的强调照常生效(词内 `a*b*c`、CJK)', () => {
    expect(sliceRange(inlineOf('a*b*c').text, stylesOf(inlineOf('a*b*c'), 'ITALIC')[0])).toBe('b');
    const b = inlineOf('这是**重点**内容');
    expect(b.text).toBe('这是重点内容');
    expect(sliceRange(b.text, stylesOf(b, 'BOLD')[0])).toBe('重点');
  });

  it('嵌套样式不回归', () => {
    const t1 = inlineOf('***a***');
    expect(t1.text).toBe('a');
    expect(stylesOf(t1, 'BOLD')).toHaveLength(1);
    expect(stylesOf(t1, 'ITALIC')).toHaveLength(1);
    const t2 = inlineOf('**a _b_ c**');
    expect(t2.text).toBe('a b c');
    expect(sliceRange(t2.text, stylesOf(t2, 'ITALIC')[0])).toBe('b');
    const t3 = inlineOf('*a **b** c*');
    expect(t3.text).toBe('a b c');
    expect(sliceRange(t3.text, stylesOf(t3, 'BOLD')[0])).toBe('b');
    expect(sliceRange(t3.text, stylesOf(t3, 'ITALIC')[0])).toBe('a b c');
  });
});

describe('A3 列表项续行', () => {
  it('缩进续行并入当前项(以 \\n 连接),不再成独立段落', () => {
    const blocks = parseMarkdown('- 第一行\n  第二行(续行)\n- 下一项');
    expect(blocks).toHaveLength(2);
    const first = asText(blocks[0]);
    expect(first.type).toBe('unordered-list-item');
    expect(first.text).toBe('第一行\n第二行(续行)');
    expect(asText(blocks[1]).text).toBe('下一项');
  });

  it('lazy 续行(不缩进)同样并入', () => {
    const blocks = parseMarkdown('- a\ncontinued');
    expect(blocks).toHaveLength(1);
    expect(asText(blocks[0]).text).toBe('a\ncontinued');
  });

  it('续行里的行内样式 offset 以拼接后的文本计算', () => {
    const b = asText(parseMarkdown('1. 开头\n   **粗**尾')[0]);
    expect(b.type).toBe('ordered-list-item');
    expect(b.text).toBe('开头\n粗尾');
    expect(sliceRange(b.text, stylesOf(b, 'BOLD')[0])).toBe('粗');
  });

  it('任务项的续行:前缀平移后区间仍精确', () => {
    const b = asText(parseMarkdown('- [ ] 待办\n  **续**')[0]);
    expect(b.task).toBe('todo');
    expect(b.text).toBe('☐ 待办\n续');
    expect(sliceRange(b.text, stylesOf(b, 'BOLD')[0])).toBe('续');
  });

  it('子项不被吸收,嵌套 depth 不回归', () => {
    const blocks = parseMarkdown('- a\n  续\n  - b\n    续b\n- c');
    expect(blocks.map((x) => [asText(x).text, asText(x).depth ?? 0])).toEqual([
      ['a\n续', 0],
      ['b\n续b', 1],
      ['c', 0],
    ]);
  });

  it('块边界(标题/引用/分割线)终止续行', () => {
    const blocks = parseMarkdown('- a\n# 标题\n- b\n> 引用\n- c\n---');
    expect(blocks.map((x) => (x.kind === 'text' ? x.type : asAtomic(x).entityType))).toEqual([
      'unordered-list-item',
      'header-one',
      'unordered-list-item',
      'blockquote',
      'unordered-list-item',
      'DIVIDER',
    ]);
  });

  it('松散列表下缩进 ≥ 内容列的段落剥掉前导空白(独立段落)', () => {
    const blocks = parseMarkdown('- a\n\n    para under a\n- b');
    expect(asText(blocks[1]).type).toBe('unstyled');
    expect(asText(blocks[1]).text).toBe('para under a');
  });
});

describe('A4 列表内缩进围栏', () => {
  it('列表项下 4 空格缩进的围栏成代码块,并按开栏缩进剥每行', () => {
    const md = '1. 安装\n\n    ```bash\n    npm i\n      --save\n    ```\n\n2. 运行';
    const blocks = parseMarkdown(md);
    expect(blocks).toHaveLength(3);
    const code = asAtomic(blocks[1]);
    expect(code.entityType).toBe('MARKDOWN');
    if (code.entityType === 'MARKDOWN') expect(code.data.markdown).toBe('```bash\nnpm i\n  --save\n```');
    expect(asText(blocks[2]).text).toBe('运行');
  });

  it('不足开栏缩进的行剥到尽量多', () => {
    const b = asAtomic(parseMarkdown('- x\n\n    ```\n  half\nzero\n    ```')[1]);
    if (b.entityType === 'MARKDOWN') expect(b.data.markdown).toBe('```\nhalf\nzero\n```');
  });

  it('紧贴列表项(无空行)的缩进围栏同样识别,不被续行吸收', () => {
    const blocks = parseMarkdown('- 步骤\n    ```\n    code\n    ```');
    expect(blocks).toHaveLength(2);
    expect(asText(blocks[0]).text).toBe('步骤');
    expect(asAtomic(blocks[1]).entityType).toBe('MARKDOWN');
  });

  it('不在列表语境时 ≥4 空格的围栏仍不认(缩进代码领域,行为不变)', () => {
    const blocks = parseMarkdown('正文\n\n    ```\n    code\n    ```');
    expect(blocks.every((b) => b.kind === 'text')).toBe(true);
  });

  it('forEachContentLine 与解析同步跳过列表内缩进围栏', () => {
    const lines = '1. 安装\n\n    ```\n    # 注释\n    ```\n# 真标题'.split('\n');
    const visited: string[] = [];
    forEachContentLine(lines, (line) => {
      visited.push(line);
    });
    expect(visited).toEqual(['1. 安装', '', '# 真标题']);
  });

  it('列表语境下顶格围栏按自身缩进判容器:缩进 4 的 ``` 不是闭栏(开/闭同口径)', () => {
    const md = '- a\n\n```\n# x\n    ```\n# y\n```';
    const blocks = parseMarkdown(md);
    const md2 = blocks.filter((b) => b.kind === 'atomic');
    expect(md2).toHaveLength(1);
    const code = asAtomic(md2[0]);
    expect(code.entityType).toBe('MARKDOWN');
    if (code.entityType === 'MARKDOWN') expect(code.data.markdown).toBe('```\n# x\n    ```\n# y\n```');
    expect(extractTitle(md)?.title).not.toBe('y');
  });
});

describe('A7 inlinePlainText', () => {
  it('剥行内标记与 ATX 闭合井号', () => {
    expect(inlinePlainText('**粗** 标题')).toBe('粗 标题');
    expect(inlinePlainText('[链接](http://a) 标题')).toBe('链接 标题');
    expect(inlinePlainText('标题 ##')).toBe('标题');
    expect(inlinePlainText('C#')).toBe('C#');
  });
});

describe('解析层 P2 收尾(A12–A14)', () => {
  it('A12 闭合扫描跳过转义 \\*:`*a\\*b* c` → 斜体覆盖 a*b', () => {
    const b = inlineOf('*a\\*b* c');
    expect(b.text).toBe('a*b c');
    const it = stylesOf(b, 'ITALIC');
    expect(it).toHaveLength(1);
    expect(sliceRange(b.text, it[0])).toBe('a*b');
  });

  it('A12 转义 \\_ 不当闭合符:`_a\\_b_ c` → 斜体覆盖 a_b', () => {
    const b = inlineOf('_a\\_b_ c');
    expect(b.text).toBe('a_b c');
    expect(sliceRange(b.text, stylesOf(b, 'ITALIC')[0])).toBe('a_b');
  });

  it('A12 转义 \\** 不当双星闭合:`**a\\**b** c` → 加粗覆盖 a**b', () => {
    // 转义只吃一个 `*`,剩下的 `*b**` 里 `**` 才是闭合
    const b = inlineOf('**a\\**b** c');
    expect(b.text).toBe('a**b c');
    expect(sliceRange(b.text, stylesOf(b, 'BOLD')[0])).toBe('a**b');
  });

  it('A12 转义 * 越过后仍找到真正闭符:`*x\\* 之后* z` → 斜体覆盖 x* 之后', () => {
    const b = inlineOf('*x\\* 之后* z');
    expect(b.text).toBe('x* 之后 z');
    expect(stylesOf(b, 'ITALIC').map((r) => sliceRange(b.text, r))).toEqual(['x* 之后']);
  });

  it('A12 无闭符时转义星号原样输出(不吞反斜杠后的字符)', () => {
    expect(inlineOf('*a\\*b').text).toBe('*a*b');
  });

  it('A13 CJK 词内下划线不作斜体:`报告_终版_修订` 原样保留', () => {
    const b = inlineOf('报告_终版_修订');
    expect(b.text).toBe('报告_终版_修订');
    expect(stylesOf(b, 'ITALIC')).toHaveLength(0);
  });

  it('A13 既有 ASCII 词内规避不回归', () => {
    expect(inlineOf('snake_case_name').text).toBe('snake_case_name');
    expect(inlineOf('__init__').text).toBe('__init__');
    const b = inlineOf('前 _斜体_ 后');
    expect(sliceRange(b.text, stylesOf(b, 'ITALIC')[0])).toBe('斜体');
  });

  it('A14 同行两段 `$$..$$` 不判单行公式块,回落普通段落', () => {
    const blocks = parseMarkdown('$$a^2$$ 与 $$b^2$$');
    expect(blocks).toHaveLength(1);
    const b = asText(blocks[0]);
    expect(b.type).toBe('unstyled');
    expect(b.text).toBe('$$a^2$$ 与 $$b^2$$');
  });

  it('A14 正常单行公式不回归', () => {
    const b = asAtomic(parseMarkdown('$$ E = mc^2 $$')[0]);
    expect(b.entityType).toBe('LATEX');
  });
});

// ===========================================================================
// 修复方案 2026-10-23(v0.5.0 打 tag 前):P3 / P7 / P1 / P2 / P5
// ===========================================================================

describe('P3 setext 下划线不作列表项的 lazy 续行', () => {
  it('`- item\\n标题\\n===`:整体是一个列表项,不产生标题(CommonMark Example 93/94)', () => {
    const blocks = parseMarkdown('- item\n标题\n===');
    expect(blocks).toHaveLength(1);
    const b = asText(blocks[0]);
    expect(b.type).toBe('unordered-list-item');
    expect(b.text).toBe('item\n标题\n===');
  });

  it('`--` / `-` 同为 lazy 续行;`---` 仍被分割线规则拦下', () => {
    expect(parseMarkdown('- a\n--').map((x) => asText(x).text)).toEqual(['a\n--']);
    expect(parseMarkdown('- a\n-').map((x) => asText(x).text)).toEqual(['a\n-']);
    const hr = parseMarkdown('- a\n---');
    expect(asText(hr[0]).text).toBe('a');
    expect(asAtomic(hr[1]).entityType).toBe('DIVIDER');
  });

  it('空项 `- ` 后的段落 + `===` 仍是标题(空项不吸收续行)', () => {
    const blocks = parseMarkdown('- \n标题\n===');
    expect(asText(blocks[1]).type).toBe('header-one');
    expect(asText(blocks[1]).text).toBe('标题');
  });
});

describe('forEachContentLine · onHeading 上报(P3)', () => {
  type Seen = [number, number, number, string, string];
  const headingsOf = (md: string, opts: Parameters<typeof forEachContentLine>[2] = {}): Seen[] => {
    const seen: Seen[] = [];
    forEachContentLine(md.split('\n'), () => true, {
      ...opts,
      onHeading: (start, end, level, kind, raw) => {
        seen.push([start, end, level, kind, raw]);
      },
    });
    return seen;
  };

  it('ATX:半开区间 [start, end) 为 1 行,level 按源 `#` 数,raw 为 `#` 之后的内容(含闭合井号)', () => {
    expect(headingsOf('# 一级\n## 二级 ##\n#### 四级')).toEqual([
      [0, 1, 1, 'atx', '一级'],
      [1, 2, 2, 'atx', '二级 ##'],
      [2, 3, 4, 'atx', '四级'],
    ]);
  });

  it('setext:区间覆盖正文行 + 下划线;raw 为段落文本', () => {
    expect(headingsOf('标题\n===')).toEqual([[0, 2, 1, 'setext', '标题']]);
    expect(headingsOf('a\nb\n---')).toEqual([[0, 3, 2, 'setext', 'a\nb']]);
  });

  it('setext 的 raw 剥掉列表缩进(`- a\\n\\n  b\\n===` → `b`)', () => {
    expect(headingsOf('- a\n\n  b\n===')).toEqual([[2, 4, 1, 'setext', 'b']]);
  });

  it('围栏 / 公式 / frontmatter 内的 `# x` 不上报', () => {
    expect(headingsOf('```\n# a\n```\n$$\n# b\n$$\n# c')).toEqual([[6, 7, 1, 'atx', 'c']]);
    expect(headingsOf('---\n# 注释\n---\n# 正文')).toEqual([[3, 4, 1, 'atx', '正文']]);
  });

  it('列表 lazy 续行里的 `===` 不上报(与 parseMarkdown 同源)', () => {
    expect(headingsOf('- item\n标题\n===')).toEqual([]);
  });
});

describe('P7 forEachContentLine 不继承残留解析开关', () => {
  // obsidianImg 决定 `![[x]]` 是否打断列表续行 → 决定后面缩进 4 的 ``` 是否处于列表语境(A4)→ 围栏是否成立。
  const lines = ['- a', '![[x.png]]', '    ```', '    # 注释', '    ```', '# 真标题'];
  const visit = (opts?: Parameters<typeof forEachContentLine>[2]): string[] => {
    const visited: string[] = [];
    forEachContentLine(
      lines,
      (line) => {
        visited.push(line);
      },
      opts,
    );
    return visited;
  };

  it('结果只取决于自身 opts:残留 true/false 两种前置下一致', () => {
    for (const residue of [true, false]) {
      parseMarkdown('x', { obsidianImg: residue });
      expect([residue, visit()]).toEqual([residue, lines]); // 默认 obsidianImg=true:图片行打断列表,无围栏
      parseMarkdown('x', { obsidianImg: residue });
      expect([residue, visit({ obsidianImg: false })]).toEqual([residue, ['- a', '![[x.png]]', '# 真标题']]);
    }
  });
});

describe('P5 列表续行里序号非 1 的有序行', () => {
  const shape = (md: string) =>
    parseMarkdown(md).map((x) => [asText(x).type, asText(x).depth ?? 0, asText(x).text]);

  it('缩进 ≥ 内容列的 `2024. 冬天很冷` 作为续行吸收(不切成有序子项)', () => {
    expect(shape('- 去年\n  2024. 冬天很冷')).toEqual([['unordered-list-item', 0, '去年\n2024. 冬天很冷']]);
    expect(shape('1. a\n   2024. 冬')).toEqual([['ordered-list-item', 0, 'a\n2024. 冬']]);
    expect(shape('- a\n- b\n  3. c')).toEqual([
      ['unordered-list-item', 0, 'a'],
      ['unordered-list-item', 0, 'b\n3. c'],
    ]);
  });

  it('缩进 < 内容列 → 交主循环(兄弟项 / 跳出)', () => {
    expect(shape('1. 步骤一\n   - 细节\n2. 步骤二')).toEqual([
      ['ordered-list-item', 0, '步骤一'],
      ['unordered-list-item', 1, '细节'],
      ['ordered-list-item', 0, '步骤二'],
    ]);
    expect(shape('1. a\n   - b\n   - c\n2. d\n3. e')).toEqual([
      ['ordered-list-item', 0, 'a'],
      ['unordered-list-item', 1, 'b'],
      ['unordered-list-item', 1, 'c'],
      ['ordered-list-item', 0, 'd'],
      ['ordered-list-item', 0, 'e'],
    ]);
    expect(shape('- a\n  1. b\n  3. c')).toEqual([
      ['unordered-list-item', 0, 'a'],
      ['ordered-list-item', 1, 'b'],
      ['ordered-list-item', 1, 'c'],
    ]);
  });

  it('未缩进的 `2024. 冬天很冷` 保持现状(无序项后接有序列表,与 commonmark.js 一致)', () => {
    expect(shape('- 去年\n2024. 冬天很冷')).toEqual([
      ['unordered-list-item', 0, '去年'],
      ['ordered-list-item', 0, '冬天很冷'],
    ]);
  });
});

describe('P1/P2 闭符扫描记忆化(性能,行为零差异由差分模糊在仓库外验收)', () => {
  /** 先用小输入预热一次,再取 3 次最小耗时(ms)。 */
  const minMs = (s: string): number => {
    parseMarkdown('a ~~b~~ *c* **d** _e_ `f` [g](h)');
    let best = Number.POSITIVE_INFINITY;
    for (let k = 0; k < 3; k += 1) {
      const t0 = performance.now();
      parseMarkdown(s);
      best = Math.min(best, performance.now() - t0);
    }
    return best;
  };
  const cases: Array<[string, string]> = [
    ['P1 `**x \\`y\\` ` × 8000', '**x `y` '.repeat(8000)],
    ['P1 `调用 *args 与 \\`f()\\` 。` × 8000', '调用 *args 与 `f()` 。'.repeat(8000)],
    ['P2 `a` + 50000 个 `~`', 'a' + '~'.repeat(50000)],
    ['P2 20000 个 `*` + `a`', '*'.repeat(20000) + 'a'],
  ];
  for (const [name, s] of cases) {
    // 超时放宽到 60s:改前每次 >2s,3 次取最小会超默认 5s,放宽是为了让红灯落在断言而非超时上。
    it(`${name} < 300ms`, () => {
      expect(minMs(s)).toBeLessThan(300);
    }, 60_000);
  }

  it('同字符串内起扫的边角钉住现状(记忆化不能整串套用起点结果)', () => {
    // `***a*`:`*` 从串中起扫跳过 `**`、闭于末尾 `*`;外层斜体包住 `**a`(内层 `**` 无闭合按字面)
    const b = inlineOf('***a*');
    expect(b.text).toBe('**a');
    expect(stylesOf(b, 'ITALIC').map((r) => sliceRange(b.text, r))).toEqual(['**a']);
    // `x**a*`:从 `**` 串末起扫时串末自身即可闭合(但不满足 close > start),须单独判定;斜体只落在 a
    const c = inlineOf('x**a*');
    expect(c.text).toBe('x*a');
    expect(stylesOf(c, 'ITALIC').map((r) => sliceRange(c.text, r))).toEqual(['a']);
  });
});

// ===========================================================================
// 2026-10-26 全面审查第一批(docs/review/修复方案-2026-10-26.md)
// ===========================================================================

/** 块的简写形态:文本块 `type:text`,LATEX `LATEX:公式`,其余 atomic `类型`,图片 `img:src`。 */
const shapeOf = (blocks: ImportBlock[]): string[] =>
  blocks.map((b) => {
    if (b.kind === 'text') return `${b.type}:${b.text}`;
    if (b.kind === 'image') return `img:${b.source}`;
    return b.entityType === 'LATEX' ? `LATEX:${b.text}` : b.entityType;
  });

describe('P1 `$$` 公式不跨空行配对,认带内容的起行 / 闭合行', () => {
  it('审查复现 1:`$$ a+b` 起行 + 裸闭合成公式,后面的正文段落不被吞', () => {
    expect(shapeOf(parseMarkdown('$$ a+b\n$$\n\n正文段落\n\n$$\nc\n$$'))).toEqual([
      'LATEX:a+b',
      'unstyled:正文段落',
      'LATEX:c',
    ]);
  });

  it('审查复现 2:裸起行 + `E=mc^2 $$` 闭合行成公式,正文不被吞', () => {
    expect(shapeOf(parseMarkdown('$$\nE=mc^2 $$\n\n正文\n\n$$\ny\n$$'))).toEqual([
      'LATEX:E=mc^2',
      'unstyled:正文',
      'LATEX:y',
    ]);
  });

  it('裸起行的闭合搜索遇空行即止:不与下一段的 `$$` 配对,正文保留', () => {
    const blocks = parseMarkdown('$$\nx\n\n正文\n\n$$');
    expect(blocks.some((b) => b.kind === 'atomic' && b.entityType === 'LATEX')).toBe(false);
    expect(shapeOf(blocks)).toContain('unstyled:正文');
  });

  it('多行公式(含 aligned)照常:同一段落内的裸起行 + 裸闭合', () => {
    expect(shapeOf(parseMarkdown('$$\na &= b \\\\\nc &= d\n$$'))).toEqual(['LATEX:a &= b \\\\\nc &= d']);
  });

  it('带内容的起行 + 多行体 + 裸闭合:起行内容并入公式首行', () => {
    expect(shapeOf(parseMarkdown('$$ \\begin{aligned}\na &= b\n\\end{aligned}\n$$'))).toEqual([
      'LATEX:\\begin{aligned}\na &= b\n\\end{aligned}',
    ]);
  });

  it('带内容的起行 + 带内容的闭合行不放行(`$$100 … 200$$` 口语双美元防线)', () => {
    const blocks = parseMarkdown('$$100 涨到\n下一行 200$$');
    expect(blocks.some((b) => b.kind === 'atomic' && b.entityType === 'LATEX')).toBe(false);
  });

  it('带内容的起行未闭合(或闭合在空行之后)→ 原样保留为文本', () => {
    expect(shapeOf(parseMarkdown('$$100 涨到 200 了'))).toEqual(['unstyled:$$100 涨到 200 了']);
    const blocks = parseMarkdown('$$ a+b\n\n$$\nc\n$$');
    expect(shapeOf(blocks)).toEqual(['unstyled:$$ a+b', 'LATEX:c']);
  });

  it('闭合行带内容但本身以 `$$` 开头时不当闭合行(继续找)', () => {
    expect(shapeOf(parseMarkdown('$$\na\n$$ b\n$$'))).toEqual(['LATEX:a\n$$ b']);
  });

  it('带内容的起行只在段落续行内找闭合:遇列表 / 引用 / 标题 / setext 下划线即止(check 审查 A)', () => {
    for (const md of ['$$100 涨\n- 项\n$$', '$$100 涨\n> q\n$$', '$$100 涨\n# 标题\n$$', '$$100 涨\n===\n正文\n$$']) {
      const blocks = parseMarkdown(md);
      expect([md, blocks.some((b) => b.kind === 'atomic' && b.entityType === 'LATEX')]).toEqual([md, false]);
    }
    // 段落续行照常并入公式
    expect(shapeOf(parseMarkdown('$$ a+b\n= c \\cdot d\n$$'))).toEqual(['LATEX:a+b\n= c \\cdot d']);
  });

  it('裸起行保持宽松:公式体里以 `- ` 开头的行(如 `- b + c`)照常并入', () => {
    expect(shapeOf(parseMarkdown('$$\nx =\n- b + c\n$$'))).toEqual(['LATEX:x =\n- b + c']);
  });

  it('段落中间的 `$$ a+b` 仍被段落吸收(不打断段落,与 isBlockBoundary 口径一致)', () => {
    const blocks = parseMarkdown('前文\n$$ a+b\n后文');
    expect(shapeOf(blocks)).toEqual(['unstyled:前文\n$$ a+b\n后文']);
  });
});

describe('P5 引用块内的围栏代码原样保留', () => {
  it('审查复现:引用里的 Python 代码不被强调符改写,产出 MARKDOWN 代码块', () => {
    const blocks = parseMarkdown('> ```py\n> def f(*args, **kwargs): return a*b*c\n> ```');
    expect(blocks).toHaveLength(1);
    const b = asAtomic(blocks[0]);
    expect(b.entityType).toBe('MARKDOWN');
    if (b.entityType === 'MARKDOWN') {
      expect(b.data.markdown).toBe('```py\ndef f(*args, **kwargs): return a*b*c\n```');
    }
  });

  it('前后的引用文字仍是 blockquote 块,代码块夹在中间', () => {
    const md = '> 前言\n> ```\n> x = 1\n> ```\n> 后记';
    expect(shapeOf(parseMarkdown(md))).toEqual(['blockquote:前言', 'MARKDOWN', 'blockquote:后记']);
  });

  it('~~~ 围栏、info 规范化、代码内的空引用行', () => {
    const b = asAtomic(parseMarkdown('> ~~~plain&#x20;text\n> a\n>\n> b\n> ~~~')[0]);
    if (b.entityType !== 'MARKDOWN') throw new Error('期望 MARKDOWN');
    expect(b.data.markdown).toBe('~~~plain\na\n\nb\n~~~');
  });

  it('引用结束仍未闭栏:按容器结束闭合(CommonMark),补齐闭栏', () => {
    const blocks = parseMarkdown('> ```js\n> let a = b*c*d\n\n正文');
    const b = asAtomic(blocks[0]);
    if (b.entityType !== 'MARKDOWN') throw new Error('期望 MARKDOWN');
    expect(b.data.markdown).toBe('```js\nlet a = b*c*d\n```');
    expect(shapeOf(blocks.slice(1))).toEqual(['unstyled:正文']);
  });

  it('引用里只有开栏、随即结束:不产空代码块,按原逻辑作引用文字', () => {
    expect(shapeOf(parseMarkdown('> ```\n正文'))).toEqual(['blockquote:```', 'unstyled:正文']);
  });

  it('引用里已闭合的空围栏照常成代码块(与顶层同口径)', () => {
    expect(shapeOf(parseMarkdown('> ```\n> ```'))).toEqual(['MARKDOWN']);
  });

  it('forEachContentLine 跳过引用内的围栏区间(代码里的 `# x` 不作标题)', () => {
    const seen: number[] = [];
    forEachContentLine('> ```\n> # x\n> ```\n正文'.split('\n'), (_l, i) => {
      seen.push(i);
    });
    expect(seen).toEqual([3]);
  });
});

describe('P4 parseMarkdownWithMeta:标题上报带块下标', () => {
  it('blockIndex 指向产出序列中对应的标题块,块序列与 parseMarkdown 一致', () => {
    const md = '前言\n\n# A\n\n段\n\nB\n===\n\n- x\n### C';
    const { blocks, headings } = parseMarkdownWithMeta(md);
    expect(blocks).toEqual(parseMarkdown(md));
    expect(headings.map((h) => [h.raw, h.blockIndex])).toEqual([
      ['A', 1],
      ['B', 3],
      ['C', 5],
    ]);
    for (const h of headings) expect(asText(blocks[h.blockIndex]).text).toBe(h.raw);
  });

  it('解析开关只作用于本次调用(P7:不残留模块级开关)', () => {
    parseMarkdownWithMeta('![[a.png]]', { obsidianImg: false });
    expect(parseMarkdownWithMeta('![[a.png]]').blocks[0]?.kind).toBe('image');
  });
});

// ===========================================================================
// 2026-10-26 全面审查第二批阶段 A(docs/review/修复方案-2026-10-26-第二批.md)
// ===========================================================================

describe('第二批 P2 未闭合围栏:到文末都是代码', () => {
  it('审查复现:代码里的 `# 注释` / `*args` / `- x` 原样进代码块,不成标题 / 列表', () => {
    const md = '正文\n\n```python\n# 注释\ndef f(*args, **kw): pass\n- x';
    const blocks = parseMarkdown(md);
    expect(shapeOf(blocks)).toEqual(['unstyled:正文', 'MARKDOWN']);
    const b = asAtomic(blocks[1]);
    if (b.entityType !== 'MARKDOWN') throw new Error('期望 MARKDOWN');
    expect(b.data.markdown).toBe('```python\n# 注释\ndef f(*args, **kw): pass\n- x\n```');
    expect(extractTitle(md)).toBeNull();
  });

  it('正文中段的未闭合围栏:其后全部进同一个代码块(内容逐字保留)', () => {
    const blocks = parseMarkdown('前言\n\n~~~\na\n\n# h\n正文 *x*');
    expect(shapeOf(blocks)).toEqual(['unstyled:前言', 'MARKDOWN']);
    const b = asAtomic(blocks[1]);
    if (b.entityType === 'MARKDOWN') expect(b.data.markdown).toBe('~~~\na\n\n# h\n正文 *x*\n~~~');
  });

  it('已闭合围栏不打标记;列表内缩进的未闭合围栏维持原行为(按文本)', () => {
    expect(isUnclosedFence(parseMarkdown('```\nx\n```')[0]!)).toBe(false);
    expect(shapeOf(parseMarkdown('- a\n  ```\n  x'))).toEqual(['unordered-list-item:a', 'unstyled:```\nx']);
  });

  it('文末孤立的开栏行(其后无内容)不产空代码块,按原逻辑作文本(check 审查)', () => {
    expect(shapeOf(parseMarkdown('正文\n\n```'))).toEqual(['unstyled:正文', 'unstyled:```']);
    expect(shapeOf(parseMarkdown('正文\n```js\n\n'))).toEqual(['unstyled:正文', 'unstyled:```js']);
  });

  it('大量未闭合开栏行线性完成(原 P10 块级 O(n²) 随之消失)', () => {
    const md = '```js\n'.repeat(20000);
    const t0 = performance.now();
    const blocks = parseMarkdown(md);
    expect(performance.now() - t0).toBeLessThan(500);
    expect(blocks).toHaveLength(1);
  });
});

describe('第二批 P3 HTML 注释块不写入', () => {
  it('审查复现:注释里的 `# TODO` / `- 说明` 不进正文,文章标题取真标题', () => {
    const md = '<!--\n# TODO: 替换成项目名\n- 说明\n-->\n\n# 真正的标题\n\n正文';
    expect(shapeOf(parseMarkdown(md))).toEqual(['header-one:真正的标题', 'unstyled:正文']);
    expect(extractTitle(md)).toEqual({ title: '真正的标题', source: 'h1' });
  });

  it('单行注释;注释可打断段落;`-->` 之后同行的正文照常写入', () => {
    expect(shapeOf(parseMarkdown('<!-- x -->\n正文'))).toEqual(['unstyled:正文']);
    expect(shapeOf(parseMarkdown('前文\n<!-- x -->\n后文'))).toEqual(['unstyled:前文', 'unstyled:后文']);
    expect(shapeOf(parseMarkdown('<!-- a\nb --> 尾巴 *斜*'))).toEqual(['unstyled:尾巴 斜']);
  });

  it('未闭合注释不吞后文:按文本写入(避免整篇静默丢失)', () => {
    expect(shapeOf(parseMarkdown('<!-- 未闭合\n正文'))).toEqual(['unstyled:<!-- 未闭合\n正文']);
  });

  it('围栏代码里的 `<!--` 不受影响;行内注释维持字面量', () => {
    const b = asAtomic(parseMarkdown('```\n<!-- x -->\n```')[0]);
    if (b.entityType === 'MARKDOWN') expect(b.data.markdown).toBe('```\n<!-- x -->\n```');
    expect(shapeOf(parseMarkdown('正文 <!-- x --> 续'))).toEqual(['unstyled:正文 <!-- x --> 续']);
  });

  it('parseMarkdownWithMeta 报告丢弃的注释块数;forEachContentLine 跳过注释区间', () => {
    expect(parseMarkdownWithMeta('<!-- a -->\n\n<!--\nb\n-->\n正文').htmlComments).toBe(2);
    const seen: number[] = [];
    forEachContentLine('<!--\n# x\n-->\n正文'.split('\n'), (_l, i) => {
      seen.push(i);
    });
    expect(seen).toEqual([3]);
  });
});

describe('第二批 P8 强调符不跨进链接目标', () => {
  it('`**注意 [链接](https://a.com/a**b) 结束**`:链接保留、URL 不变、整段加粗', () => {
    const b = inlineOf('**注意 [链接](https://a.com/a**b) 结束**');
    expect(b.text).toBe('注意 链接 结束');
    expect(b.links.map((l) => [sliceRange(b.text, l), l.url])).toEqual([['链接', 'https://a.com/a**b']]);
    expect(stylesOf(b, 'BOLD').map((r) => sliceRange(b.text, r))).toEqual(['注意 链接 结束']);
  });

  it('`*[Python](…/Python_*)*`:链接保留,斜体包住链接文字', () => {
    const b = inlineOf('*[Python](https://en.wikipedia.org/wiki/Python_*)*');
    expect(b.text).toBe('Python');
    expect(b.links[0]?.url).toBe('https://en.wikipedia.org/wiki/Python_*');
    expect(stylesOf(b, 'ITALIC').map((r) => sliceRange(b.text, r))).toEqual(['Python']);
  });

  it('`_参见 [文档](https://a.com/my_doc)_`:斜体不被 URL 里的 `_` 截断', () => {
    const b = inlineOf('_参见 [文档](https://a.com/my_doc)_');
    expect(b.text).toBe('参见 文档');
    expect(stylesOf(b, 'ITALIC').map((r) => sliceRange(b.text, r))).toEqual(['参见 文档']);
    expect(b.links[0]?.url).toBe('https://a.com/my_doc');
  });

  it('链接文字内的强调照常;未成链接的 `[` 不跳过', () => {
    const b = inlineOf('[**粗**](https://u.com) 与 *a [b c*');
    expect(stylesOf(b, 'BOLD').map((r) => sliceRange(b.text, r))).toEqual(['粗']);
    expect(stylesOf(b, 'ITALIC').map((r) => sliceRange(b.text, r))).toEqual(['a [b c']);
  });
});

describe('第二批 P9 链接 title 里的 `)` 不截断 URL', () => {
  it('双引号 / 单引号 title', () => {
    for (const md of ['[a](https://a.com "title with ) paren")', "[a](https://a.com 'x ) y')"]) {
      const b = inlineOf(md);
      expect([md, b.text, b.links.map((l) => l.url)]).toEqual([md, 'a', ['https://a.com']]);
    }
  });

  it('URL 自身的括号配对不变', () => {
    expect(inlineOf('[w](https://en.wikipedia.org/wiki/A_(b))').links[0]?.url).toBe('https://en.wikipedia.org/wiki/A_(b)');
  });
});

// ===========================================================================
// 2026-10-26 全面审查第三批阶段 A(docs/review/修复方案-2026-10-26-第三批.md)
// ===========================================================================

describe('第三批 P6 列表项内的非列表块不清空列表层级', () => {
  const depthOf = (md: string, text: string) => {
    const b = parseMarkdown(md).find((x) => x.kind === 'text' && x.text === text);
    return b && b.kind === 'text' ? (b.depth ?? 0) : undefined;
  };
  it('列表内缩进的代码块 / 图片之后,子项仍按嵌套层级计', () => {
    expect(depthOf('- a\n  ```js\n  x\n  ```\n  - b', 'b')).toBe(1);
    expect(depthOf('- a\n  ![](x.png)\n  - b', 'b')).toBe(1);
  });
  it('顶格的块照旧结束列表:之后的列表从 0 起算', () => {
    expect(depthOf('- a\n  - a2\n\n```\nx\n```\n\n  - b', 'b')).toBe(0);
    expect(depthOf('- a\n\n正文\n\n  - b', 'b')).toBe(0);
  });
});

describe('第三批 P12 空 ATX 标题不产出块', () => {
  it('`#`、`# #`、`#### ####`、`##   ` 都是空标题,不产出块', () => {
    for (const md of ['#', '# #', '#### ####', '##   ']) {
      expect([md, parseMarkdown(md)]).toEqual([md, []]);
    }
  });
  it('空标题可打断段落;`#标题`(无空格)仍是段落;`# 标题 #`、`# C#` 照常', () => {
    expect(shapeOf(parseMarkdown('正文\n#\n后文'))).toEqual(['unstyled:正文', 'unstyled:后文']);
    expect(shapeOf(parseMarkdown('#标题'))).toEqual(['unstyled:#标题']);
    expect(shapeOf(parseMarkdown('# 标题 #'))).toEqual(['header-one:标题']);
    expect(shapeOf(parseMarkdown('# C#'))).toEqual(['header-one:C#']);
  });
});

describe('第三批 O5 parseMarkdown 不残留模块级开关', () => {
  it('parseMarkdown 带非默认开关后,不传开关的 inlinePlainText 仍按默认值解析', () => {
    parseMarkdown('x', { wikilink: false });
    expect(inlinePlainText('[[a]]')).toBe('a');
  });
});
