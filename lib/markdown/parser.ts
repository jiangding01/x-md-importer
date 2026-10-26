/**
 * Markdown → ImportBlock 解析器(M1)。纯函数、零依赖、named export。
 *
 * 产出精确符合 lib/bridge/protocol.ts 的契约:文本块(TextBlock)带干净文本 +
 * inlineStyleRanges / links 区间;特殊块(AtomicBlock)覆盖 MARKDOWN(围栏代码)、
 * DIVIDER(分割线)、TWEET(独占行推文)。块级/行内规则与《技术方案设计.md》§4.2
 * 映射矩阵、以及 docs/research/xposter-analysis.md §8.1 手写解析器边界对齐。
 *
 * 扫描顺序(块级):先围栏代码块保护内容 → 再分割线 / 推文 → 剩余交给标题 / 引用 /
 * 列表 / 段落。行内规则对每个文本块的原文再解析,offset/length 基于「剥掉标记后的
 * 最终文本」——这是本模块的核心难点。
 */

import type { ImportBlock, InlineStyleRange, LinkRange, TextBlock, TextBlockType } from '../bridge/protocol';

/** 行内解析的中间产物:干净文本 + 样式区间 + 链接区间(offset 相对自身 text)。 */
interface InlineResult {
  text: string;
  inlineStyleRanges: InlineStyleRange[];
  links: LinkRange[];
}

/** 围栏描述:围栏字符(` 或 ~)与数量,用于闭合匹配(闭合需同字符且数量 ≥ 开栏)。 */
interface Fence {
  char: string;
  len: number;
  /** 开栏行的前导缩进列宽:生成 MARKDOWN 块时按它剥每行前导空白(CommonMark,A4)。 */
  indent: number;
  /** 本围栏允许的最大缩进(开/闭栏同口径):顶层 3;列表语境且开栏缩进 ≥ 内容列时为「列表内容列 + 3」(A4)。 */
  maxIndent: number;
}

// ---------------------------------------------------------------------------
// 块级正则(集中定义,块级判定与「段落边界探测」共用同一套,避免规则漂移)
// ---------------------------------------------------------------------------

/**
 * 分割线:3 个以上**同一个**标记字符(`-` / `*` / `_`),字符之间允许空格,尾随空白允许。
 * B3-5(P2-7)放宽了字符集与内部空格——`- - -` / `* * *` / `___` 都是 CommonMark 的标准写法,
 * 此前分别落成垃圾列表项(`* * *` 是「单空格 + ITALIC」的纯垃圾块)与段落字面量。
 *
 * **仍要求顶格,不容前导空白**:放开缩进会让 `- item` 下方缩进的 `  ---` 变成分割线,
 * 把列表硬切两半(这条约束是有意的,setext 下划线 RE_SETEXT_* 与块级公式同理)。
 */
const RE_DIVIDER = /^([-*_])([ \t]*\1){2,}[ \t]*$/;
/**
 * 独占一行的推文链接。尾缀 `(?:[/?#]\S*)?`(B3-2 / P1-5)是必需的:X 官方「复制链接」默认
 * 产出 `?s=20`,旧的 `\/?$` 收尾让这个**最常见形态 100% 漏判**,整行落成 unstyled 死文本。
 * `mobile.` 子域同理(移动端复制)。
 *
 * **有意的行为外溢**:该尾缀让 `/status/123/photo/1`、`/analytics` 等子路径链接也成为 TWEET 块
 * ——X 的嵌入卡片按 tweetId 渲染,结果与主帖一致,故接受(测试钉住此语义)。
 */
// 尾缀只认**可打印 ASCII**(`[!-~]`)而非 `\S`(review 修复):中文写作常见「URL 直接接正文」
// (`…?s=20这条推文说得好`),`\S*` 会把正文吞进 TWEET 块静默删掉;ASCII 收口后这类行
// 整行回落普通文本,内容一字不丢。
const RE_TWEET = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/[^/]+\/status\/(\d+)(?:[/?#][!-~]*)?$/;
/** 独占一行单张裸图片的**前缀** `![alt](`(alt 不含 `]`);其后 src 由 matchImageLine 括号配对扫描。 */
const RE_IMAGE_LINE_HEAD = /^!\[([^\]]*)\]\(/;
/**
 * 独占一行「带链接图片」`[![alt](imgUrl)](linkUrl)` 的**前缀** `[![alt](`(推文转 md 常见:
 * 图片外套一层指向媒体页的链接)。其后内层图片 URL、`](`、外层链接 URL 由 matchLinkedImageLine
 * 括号配对扫描——旧版整行正则 `(.+)\)\]\((.+)\)$` 两段贪婪,会把一行两张链接图 / 链接图后跟
 * 裸图或尾随文本整行吞成一张 source 畸形的图(A1)。
 */
const RE_LINKED_IMAGE_LINE_HEAD = /^\[!\[([^\]]*)\]\(/;
/**
 * 独占一行的 Obsidian 内嵌图片 `![[path]]` 或 `![[path|alt]]`(wiki 风格)。
 * path 是相对文件夹的本地路径,由 content 侧 File System Access 读取(见 lib/bridge/localVault)。
 * 组1 = `path` 或 `path|alt`——由主循环的图片分支(及 frontmatter.extractCover 的 wikiTarget)再切分 `|`。
 * 导出供 frontmatter.extractCover 复用(P6),cover 值与正文同一套「整行恰为一张 wiki 图」判定。
 */
export const RE_OBSIDIAN_IMAGE_LINE = /^!\[\[([^\]]+)\]\]$/;
/**
 * ATX 标题 / 引用:允许 CommonMark 的 **0-3 空格缩进**(B3-6 / P2-8)。此前要求顶格,
 * 缩进一格的标题、引用整块降级成段落,前导空格还以字面量进正文。≥4 空格仍不认——那是
 * 缩进代码块的领域(用户粘贴的缩进日志/代码不该被拆成标题)。
 * **注意**:divider / setext / 块级公式**不**随之放宽,它们的顶格约束是有意的(见各自注释)。
 */
// 第三批 P12:`#` 后可以直接行尾(空标题,CommonMark),故内容组可选。
const RE_HEADING = /^ {0,3}(#{1,6})(?:\s+(.*))?$/;
const RE_BLOCKQUOTE = /^ {0,3}>/;
/** HTML 注释块的起行(第二批 P3):0-3 空格缩进后以 `<!--` 开头(CommonMark HTML 块类型 2)。 */
const RE_HTML_COMMENT_OPEN = /^ {0,3}<!--/;
/**
 * 列表项:组1 = 前导缩进(决定嵌套层级)、组2 = 标记后的内容。
 * 允许前导空白是嵌套列表的入口——此前要求顶格,缩进行落到段落分支、
 * 正文里留下字面量 `  - 二级`(内容错乱,非降级)。缩进→depth 的换算见 listDepth。
 *
 * 两组空白的写法**有意不同**,别"统一"掉:
 *  - 缩进组用 `[ \t]*`:只有空格/Tab 才有确定的列宽,全角空格等无法换算 depth;
 *  - 标记后的分隔符保持 `\s+`(与本特性引入前逐字节一致):`\s` 覆盖全角空格 `　` 与 NBSP,
 *    中文输入法下 `-　项目` 很常见,收窄成 `[ \t]` 会让它掉进段落、正文留字面量 `-　项目`。
 */
const RE_UL = /^([ \t]*)[-*+]\s+(.*)$/;
const RE_OL = /^([ \t]*)\d+\.\s+(.*)$/;
/** 打断段落专用的有序列表正则:只认 `1.`(CommonMark 规则,见 isTopLevelListLine)。 */
const RE_OL_INTERRUPT = /^([ \t]*)1\.\s+(.*)$/;

/** Draft 默认样式表只到 `public-DraftStyleDefault-depth4`,更深不再有额外缩进,故截顶。 */
const MAX_LIST_DEPTH = 4;
/**
 * GFM 表格分隔行(表头下方那行):每列 `:?-+:?`,列间 `|`。要求本行**含 `|` 且含 `-`**——
 * 这样纯 `---`/`***` 分割线(不含 `|`)不会被当成表格分隔,与 DIVIDER 不冲突。
 */
const RE_TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const isTableSeparator = (line: string): boolean =>
  line.includes('|') && line.includes('-') && RE_TABLE_SEP.test(line);

/**
 * setext 标题的下划线行:`===`(一级)/ `---`(二级),数量任意 ≥1,其后仅允许空白。
 * **顶格,不允许前导空白**——与 RE_DIVIDER 同样严格,免得列表项下方缩进的 `---` 被误判。
 */
const RE_SETEXT_EQ = /^=+[ \t]*$/;
const RE_SETEXT_DASH = /^-+[ \t]*$/;

/**
 * 围栏行(开栏 / info 规范化共用):缩进 + 3 个以上 ` 或 ~,组1=缩进、组2=围栏标记、组3=info。
 * **单一来源**是有意的:围栏判定散落三处(matchFenceOpen / matchFenceClose / 主循环的 info
 * 规范化),此前各写一份正则,漏改任一处就会吞掉语言标记或让闭栏失效(B3-6 的主要风险)。
 */
// 组1 = 前导缩进(`[ \t]*`,具体上限由 matchFenceOpen 按语境判定:顶层 0-3,列表内放宽,A4)、
// 组2 = 围栏标记、组3 = info。
const RE_FENCE_LINE = /^([ \t]*)(`{3,}|~{3,})(.*)$/;
/** 闭栏行:缩进 + 围栏标记 + 仅空白。缩进上限同开栏(Fence.maxIndent)。 */
const RE_FENCE_CLOSE = /^([ \t]*)(`{3,}|~{3,})\s*$/;
/** 顶层(不在列表语境)围栏的最大缩进:CommonMark 0-3 空格,≥4 属缩进代码领域。 */
const TOP_FENCE_MAX_INDENT = 3;

/**
 * 围栏的缩进上限(A4),按**围栏自身缩进**判定所属容器:**列表语境**(上一产出块是列表项,中间只隔
 * 空行)且围栏缩进 ≥ 列表内容列 ⇒ 属列表项内,放宽到「列表内容列 + 3」——`1. 安装\n\n    \`\`\`bash`
 * 这种列表项下的 4 空格围栏极常见,此前按段落处理,代码整段散成正文;否则(非列表语境,或围栏缩进
 * 不足内容列 ⇒ 已跳出列表)维持顶层 0-3。开/闭栏同口径(闭栏沿用开栏算出的 Fence.maxIndent),
 * 免得列表后的顶格围栏被缩进 4 的 ``` 误闭合。parseLines 主循环与续行吸收共用;
 * forEachContentLine 直接复用 parseLines 的围栏结果,三处同口径。
 */
function fenceMaxIndent(indent: number, listContentCol: number | null): number {
  return listContentCol !== null && indent >= listContentCol
    ? listContentCol + TOP_FENCE_MAX_INDENT
    : TOP_FENCE_MAX_INDENT;
}

/** ASCII 标点集合:反斜杠转义仅在其后紧跟 ASCII 标点时生效(字母/CJK 前的反斜杠保留原样)。 */
const RE_PUNCT = /[!-/:-@[-`{-~]/;

/**
 * 块级数学公式 `$$` 的**起行**判定(GitHub/CommonMark math),返回起行形态或 null。
 * 真机 dump 确认 X 有原生 LATEX atomic 块,公式本体写进块 text(见 protocol AtomicBlock)。
 *
 * **顶格 `$$` 开头**(与 RE_DIVIDER 同样严格,不容前导空白),再按其后内容分形态:
 *  - `'multi'`:`$$` 之后仅空白 → 多行公式起行,向下找裸 `$$` 闭合行(见主循环)。
 *  - `'single'`:`$$ 公式 $$` 同行闭合且中间非空 → 单行公式块。
 *  - `null`:其余(含 `$$100 涨到` 这类**行内双美元**——其后非空且不以 `$$` 收尾)。
 *    这条严格规则是**假阳性的主防线**:口语化的 `$$100` 既不进块判定、也不当段落边界,
 *    与本项目一贯「`$$` 须行首、`includes` 会误报」的口径一致(见 capability 注释)。
 */
function matchMathOpen(line: string): 'single' | 'multi' | null {
  if (!line.startsWith('$$')) return null;
  const rest = line.slice(2).trim();
  if (rest === '') return 'multi';
  // 同行闭合:去掉收尾 `$$` 后中间非空才算(排除 `$$$$` / `$$ $$` 空公式);中间再含 `$$`
  // (`$$a^2$$ 与 $$b^2$$`,同行两段行内公式,A14)不是单行公式块,回落普通文本。
  if (rest.endsWith('$$')) {
    const body = rest.slice(0, -2);
    if (body.trim() !== '' && !body.includes('$$')) return 'single';
  }
  return null;
}

/**
 * 「带内容的起行」(P1-B):`$$ a+b`——顶格 `$$` 之后非空、不以 `$$` 收尾、不再含 `$$`。
 * 只在主循环块首、且段落续行内找到**裸** `$$` 闭合行时才成公式(见 findMathClose 的 'content' 口径);
 * 不进 isBlockBoundary——段落中间的 `$$ a+b` 照旧被段落吸收,`$$100 涨到` 这类口语双美元也不打断段落。
 * 返回起行里的公式片段;不符返回 null。
 */
function matchMathContentOpen(line: string): string | null {
  if (!line.startsWith('$$')) return null;
  const rest = line.slice(2);
  if (rest.trim() === '' || rest.includes('$$')) return null;
  return rest;
}

/**
 * 多行公式的闭合行搜索(P1):从 `from` 起向下找,**遇空行即止**(返回 null = 未闭合)——LaTeX 数学
 * 模式里空行即 `\par`、是错误,合法公式不含空行;此前无界搜索会跨空行、跨段落与下一段公式的起行
 * 配对,把中间正文整段吞进 LATEX。按起行形态分两种口径:
 *  - `'bare'`(裸 `$$` 起行):中间行不设限(公式里出现 `- b + c`、`a --- b` 这类行是正常的);
 *    闭合行可裸(`$$`)也可带内容(`E=mc^2 $$`:去尾随空白后以 `$$` 结尾、本身不以 `$$` 开头、
 *    末尾 `$$` 之前不再含 `$$`)→ `{ at, tail }`,tail 为闭合行去掉末尾 `$$` 的部分。
 *  - `'content'`(带内容起行 `$$ a+b`,与口语 `$$100 涨` 同形):只认裸闭合,且中间行必须是
 *    **段落续行**——遇任何块级起始行(列表 / 引用 / 标题 / 围栏 / 分割线 …)或 setext 下划线即止,
 *    不把它们吞进公式(check 审查 A);也不放行带内容的闭合行(`$$100 涨\n下行 200$$` 正是口语形状)。
 */
function findMathClose(lines: string[], from: number, open: 'bare' | 'content'): { at: number; tail: string } | null {
  for (let j = from; j < lines.length; j += 1) {
    const l = lines[j] ?? '';
    if (l.trim() === '') return null;
    if (l.startsWith('$$') && l.slice(2).trim() === '') return { at: j, tail: '' };
    if (open === 'content') {
      if (isBlockBoundary(l, true) || setextUnderlineLevel(l) !== null) return null;
      continue;
    }
    if (l.startsWith('$$')) continue; // `$$ b` 这类不是闭合行,继续找
    const t = l.trimEnd();
    if (t.endsWith('$$') && !t.slice(0, -2).includes('$$')) return { at: j, tail: t.slice(0, -2) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * setext 标题下划线的级别:`===` → 1、`---` → 2;不是下划线返回 null。
 * 仅解析主循环内部使用:标题抽取(frontmatter.pickTitleHeading)不再自行判定 setext,而是取
 * parseLines 经 onHeading 上报的标题(P3,单一来源),杜绝「parser 认成标题、
 * extractTitle 抽不到」或反之的分裂(本项目已栽过多次「第二套实现漂移」,见 HANDOFF §8)。
 */
function setextUnderlineLevel(line: string): 1 | 2 | null {
  if (RE_SETEXT_EQ.test(line)) return 1;
  if (RE_SETEXT_DASH.test(line)) return 2;
  return null;
}

/**
 * 文首 YAML frontmatter 之后第一行的下标;无 frontmatter 返回 0(即从头解析)。
 *
 * 判定:仅当**第一行即为顶格 `---`** 且后续存在顶格闭合 `---` 时触发。用「顶格 `^---`」
 * 而非 trim,与 frontmatter.ts 的抽取正则一致——否则缩进的 `  ---` 会出现「parser 剥离了
 * 但 extractTitle 抽不到 → 标题静默丢失」的不一致。闭合 `---` 必须出现在**首个空行之前**
 * (frontmatter 体不含空行),否则文首装饰性 `---\n\n正文\n\n---` 会把中间正文当 frontmatter
 * 静默吞掉。此判定须与 frontmatter.ts 的 frontmatterBody 完全对齐。
 *
 * **导出是为了消除第二套实现**:capability 的 setext 计数此前直接扫原始 md(只跳围栏、
 * 不跳 frontmatter),把 frontmatter 体末行 + 闭合 `---` 误当成 setext 标题,任何带
 * frontmatter 的文档都凭空多一条「setext 标题未识别」假告警(review 揪出)。
 */
export function frontmatterBodyStart(lines: string[]): number {
  const isFmDelim = (line: string) => /^---[ \t]*$/.test(line);
  if (!isFmDelim(lines[0] ?? '')) return 0;
  for (let j = 1; j < lines.length; j += 1) {
    const l = lines[j] ?? '';
    if (isFmDelim(l)) return j + 1;
    if (l.trim() === '') break; // 首个空行前未闭合 → 非 frontmatter,首行 --- 交后续按分割线处理
  }
  return 0;
}

/**
 * 解析主循环每产出一个标题块即上报(P3):`[start, end)` 为该标题占用的源行**半开区间**——ATX 为
 * 1 行;setext 覆盖正文各行 + 下划线行(单行 setext 即 end − start === 2)。`level` 按源写法
 * (ATX 的 `#` 数;setext `===` → 1、`---` → 2),不是映射后的块类型。`raw` 为标题文本源:ATX 取
 * `#` 之后的内容(**未**剥闭合井号),setext 取剥掉列表缩进后的段落文本(`- a\n\n  b\n===` → `b`)。
 * `blockIndex` 为该标题块在本次解析产出序列中的下标(P4:按块去掉文章标题,不再改 md 文本重解析)。
 */
export type HeadingVisitor = (
  start: number,
  end: number,
  level: number,
  kind: 'atx' | 'setext',
  raw: string,
  blockIndex: number,
) => void;

/** parseMarkdownWithMeta 上报的单个标题(字段语义同 HeadingVisitor)。 */
export interface HeadingInfo {
  start: number;
  end: number;
  level: number;
  kind: 'atx' | 'setext';
  raw: string;
  blockIndex: number;
}

/**
 * forEachContentLine 的选项。解析开关(obsidianImg / wikilink / taskList,P7)与 parseMarkdown 同义:
 * 遍历所依据的围栏 / 标题判定受它们影响(如 obsidianImg 决定 `![[x]]` 是否打断列表续行 → 其后
 * 缩进围栏是否处于列表语境),未传的按默认值,**不继承**上一次 parseMarkdown 残留的模块级开关。
 */
export interface ContentLineOptions extends ParseOptions {
  /** 从 frontmatterBodyStart 起扫,文首 YAML 块整块不交给 visitor(B3-3,默认关闭)。 */
  skipFrontmatter?: boolean;
  /** 标题上报(P3);标题抽取取数的**唯一入口**,见 HeadingVisitor。 */
  onHeading?: HeadingVisitor;
}

/**
 * 严格围栏感知地遍历 md 行:对每个「位于代码围栏之外」的行调用 visitor(line, index)。
 * 围栏识别与 parseMarkdown 主循环**同源**(matchFenceOpen/matchFenceClose:闭栏须裸行、
 * 数量 ≥ 开栏、`~~~` 与 ``` 不互闭);未闭合的围栏开栏行按普通内容处理(同主循环)——
 * 整个围栏块(开栏行 … 闭栏行)被跳过,内部的 `# x` / `![]()` 等不会被 visitor 看到。
 * visitor 返回 true 时提前停止遍历。
 *
 * 抽出此 helper 是为消除「三处 fence 追踪各写一份、语义漂移」(标题抽取 P4 起改用 parseMarkdownWithMeta
 * 一次解析取标题,onHeading 选项仍保留;第三批 O8 删掉了只剩测试在用的 stripFirstImageLine)。
 *
 * `skipFrontmatter`(B3-3 / P1-6):从 frontmatterBodyStart 起扫,文首 YAML 块整块不交给
 * visitor——`# 注释` 是合法 YAML 注释(Obsidian 模板常见),否则会被当成内容行。**默认关闭**:
 * 此开关有意做成显式的,不隐式改本 helper 的既有语义(其余消费方的行为必须逐字节不变)。传给
 * visitor 的 index 始终是**原始行下标**(调用方按它 splice 才不会删错行)。onHeading 不受此开关
 * 影响:parseLines 自身就跳过 frontmatter,不会从 YAML 块上报标题。
 */
export function forEachContentLine(
  lines: string[],
  visitor: (line: string, index: number) => boolean | void,
  opts: ContentLineOptions = {},
): void {
  // P7:整个遍历(parseLines + visitor 循环)都在调用方给定的解析开关下进行,结束后还原。
  withParseOptions(opts, () => {
    // 围栏区间**直接取自解析主循环**(A4):列表内缩进围栏的判定依赖列表语境(内容列),
    // 在这里另写一套追踪必然漂移;让 parseLines 把它认定的每个已闭合围栏报上来,两边按构造同步。
    // 未闭合围栏 parseLines 不上报 → 开栏行照常交给 visitor(与主循环「按普通文本处理」一致)。
    const fenceClose = new Map<number, number>();
    parseLines(lines, { onFence: (open, close) => fenceClose.set(open, close), onHeading: opts.onHeading });
    let i = opts.skipFrontmatter ? frontmatterBodyStart(lines) : 0;
    while (i < lines.length) {
      const close = fenceClose.get(i);
      if (close !== undefined) {
        i = close + 1; // 跳过整个围栏块(含开/闭栏行)
        continue;
      }
      if (visitor(lines[i] ?? '', i)) return;
      i += 1;
    }
  });
}

/**
 * 解析开关(默认与 defaultOptions 一致):
 *  - obsidianImg:识别 `![[x]]` 内嵌图片(默认 true;关时当普通文本处理);
 *  - wikilink:行内 `[[x]]` / `[[x|别名]]` 转纯文本(默认 true;关时保持字面 `[[x]]`)。
 */
export interface ParseOptions {
  obsidianImg?: boolean;
  wikilink?: boolean;
  /** `- [ ]` 任务列表项的呈现:symbol=转 ☐/☑ 符号(默认);plain=剥掉标记、按普通列表项处理。 */
  taskList?: 'symbol' | 'plain';
}

// 解析开关:parseMarkdown **同步执行**(内部无 await)、JS 单线程不会重入,故用模块级标志
// 在入口一次性设置,免去给 walkInline / isBlockBoundary 逐层穿参。一律经 withParseOptions 临时写入并还原
// (第三批 O5 起 parseMarkdown 也是);块级/行内解析只读。
let optObsidianImg = true;
let optWikilink = true;
let optTaskList: 'symbol' | 'plain' = 'symbol';

/**
 * 在给定解析开关下同步执行 fn,结束(含抛错)后还原模块级开关(P7)。未传的开关**显式**取默认值,
 * 不继承上一次 parseMarkdown 残留的状态——forEachContentLine
 * 与 inlinePlainText 都经此设置,结果只取决于调用方自己的 opts。
 */
function withParseOptions<T>(opts: ParseOptions, fn: () => T): T {
  const saved = [optObsidianImg, optWikilink, optTaskList] as const;
  optObsidianImg = opts.obsidianImg ?? true;
  optWikilink = opts.wikilink ?? true;
  optTaskList = opts.taskList ?? 'symbol';
  try {
    return fn();
  } finally {
    [optObsidianImg, optWikilink, optTaskList] = saved;
  }
}

/**
 * H4+ 降级块的内部标记(A15):降级产物(unstyled + 整行 BOLD)与「整段加粗段落」同形,能力面板
 * 只看块形态会把后者误报成降级标题。TextBlock 属 protocol(会传给 injector),不往里加字段——
 * 用 WeakSet 旁路记录块对象身份:不可枚举、不随序列化/结构化克隆外泄,块被回收时自动释放。
 */
const demotedHeadings = new WeakSet<ImportBlock>();

/**
 * 第二批 P2:「未闭合围栏 → 到文末的代码块」的旁路标记(同 demotedHeadings,不进协议、不随序列化外泄),
 * 供能力面板如实告警。
 */
const unclosedFences = new WeakSet<ImportBlock>();

/** 该块是否为未闭合围栏按 CommonMark 延伸到文末产出的代码块(仅对原块对象成立)。 */
export function isUnclosedFence(block: ImportBlock): boolean {
  return unclosedFences.has(block);
}

/** 该块是否为 parseMarkdown 产出的「四级及以下标题 → 粗体段落」降级块(仅对原块对象成立)。 */
export function isDemotedHeading(block: ImportBlock): boolean {
  return demotedHeadings.has(block);
}

/**
 * 一次解析同时拿到写入块、全部标题与被丢弃的 HTML 注释块数(P4;第二批 P3 加 htmlComments):标题抽取与
 * 「去掉标题块」都基于**同一次**解析的产出,标题块按 `blockIndex` 精确定位——不再像旧 stripFirstH1 那样
 * 删 md 源行再重解析(删行会让相邻行重新拼接:首行变 `---` 被当 frontmatter、上下两段合并、正文被吸进
 * 列表项)。能力面板取 htmlComments 如实告知「注释不写入」。
 * 走 withParseOptions(P7):结束后还原模块级开关,不残留给后续调用。
 */
export function parseMarkdownWithMeta(
  md: string,
  opts: ParseOptions = {},
): { blocks: ImportBlock[]; headings: HeadingInfo[]; htmlComments: number } {
  const headings: HeadingInfo[] = [];
  let htmlComments = 0;
  const blocks = withParseOptions(opts, () =>
    parseLines(md.split(/\r?\n/), {
      onHeading: (start, end, level, kind, raw, blockIndex) => {
        headings.push({ start, end, level, kind, raw, blockIndex });
      },
      onHtmlComment: () => {
        htmlComments += 1;
      },
    }),
  );
  return { blocks, headings, htmlComments };
}

/** 解析 Markdown 文本为按文档顺序排列的写入块序列。 */
export function parseMarkdown(md: string, opts: ParseOptions = {}): ImportBlock[] {
  // 第三批 O5:经 withParseOptions 设置并还原模块级开关(此前写入后不还原),与 parseMarkdownWithMeta 一致。
  return withParseOptions(opts, () => parseLines(md.split(/\r?\n/)));
}

/** parseLines 的上报钩子,仅 forEachContentLine 使用(不另导出直接调 parseLines 的入口)。 */
interface ParseHooks {
  /** 每产出一个围栏代码块(含按 CommonMark 到文末的未闭合围栏)/ 丢弃一个 HTML 注释块,即上报其起止行下标——
   * 这些区间内的行不是正文,forEachContentLine 整段跳过。 */
  onFence?: (open: number, close: number) => void;
  /** 每产出一个标题块即上报(P3),见 HeadingVisitor。 */
  onHeading?: HeadingVisitor;
  /** 每丢弃一个 HTML 注释块即上报其起止行(第二批 P3;区间同时经 onFence 上报供 forEachContentLine 跳过)。 */
  onHtmlComment?: (start: number, end: number) => void;
}

/**
 * 块级主循环。`hooks.onFence` 让 forEachContentLine 与解析**同一套**围栏判定(含列表语境的缩进
 * 放宽,A4),`hooks.onHeading` 让标题抽取与解析**同一套**标题判定(P3),都不另写追踪。
 * 两者都受解析开关影响(如 obsidianImg 决定 `![[x]]` 是否打断列表续行 → 列表语境 → 缩进围栏 /
 * setext 是否成立),故调用方须先设好开关(forEachContentLine 经 withParseOptions,P7)。
 */
function parseLines(lines: string[], hooks: ParseHooks = {}): ImportBlock[] {
  const blocks: ImportBlock[] = [];
  // 跳过文首 YAML frontmatter(判定见 frontmatterBodyStart)。
  let i = frontmatterBodyStart(lines);
  // 当前列表 run 的缩进栈(每层的缩进宽度),由 listDepth 就地维护、离开列表时清空。
  const listIndents: number[] = [];
  // 最近一个列表项的内容列(标记 + 分隔空白之后的列宽);离开列表时与缩进栈一起清空。
  // 用于列表语境下的缩进围栏(A4)与松散列表下缩进段落的剥离(A3)。
  let listContentCol: number | null = null;
  // 第三批 P6:上一轮(产出了块的那一轮)是否在列表项内部——起行缩进 ≥ 当时的列表内容列(列表内的缩进
  // 围栏、缩进图片行、松散列表的缩进续段等)。这类块不结束列表,其后的子项层级照常累计。
  let prevInList = false;
  let lastRound = { count: 0, cols: 0, ctxCol: null as number | null };

  /**
   * 列表项命中后向下吸收续行(A3):非空、非块边界、非新列表项(含更深的子项)、非围栏、非表格起始
   * 的行都属于当前项——缩进续行与 lazy 续行(不缩进)同样并入,剥前导空白后以 `\n` 连接,
   * 再整体交 walkInline(offset 自然以拼接后的文本计算)。返回拼接内容与下一个待处理行下标。
   * 首行内容为空(`- ` 空项)时不吸收:CommonMark 下空项后的不缩进行不属于该项。
   *
   * setext 下划线(`===` / `--` / `-`)同样作为 lazy 续行并入、不升格标题(P3,CommonMark §4.3
   * Example 93/94:下划线不能是列表项的 lazy 续行);`---` 仍由 isBlockBoundary 的分割线规则拦下。
   * 标题抽取经 onHeading 取数,与此天然同口径。
   */
  const absorbListContinuation = (first: string, contentCol: number): { content: string; next: number } => {
    const parts = [first];
    let k = i + 1;
    if (first.trim() !== '') {
      while (k < lines.length) {
        const next = lines[k] ?? '';
        if (isBlockBoundary(next, true)) break;
        // 新列表项 / 子项交主循环:无序标记与 `1.` 一律断开(任意缩进)。
        if (RE_UL.test(next) || RE_OL_INTERRUPT.test(next)) break;
        // 序号非 1 的有序行(P5):缩进 < 当前项内容列 ⇒ 兄弟项 / 跳出,交主循环;缩进 ≥ 内容列 ⇒ 它不能
        // 打断段落(CommonMark),作为续行吸收——`- 去年\n  2024. 冬天很冷` 不再被切成有序子项。
        // 不看当前项是有序还是无序;未缩进的 `- 去年\n2024. 冬天很冷` 仍断开(与 commonmark.js 一致)。
        const ol = RE_OL.exec(next);
        if (ol && indentWidth(ol[1] ?? '') < contentCol) break;
        if (matchFenceOpen(next, contentCol)) break; // 列表内缩进围栏(A4)
        if (next.includes('|') && isTableSeparator(lines[k + 1] ?? '')) break;
        parts.push(next.replace(/^[ \t]+/, ''));
        k += 1;
      }
    }
    return { content: parts.join('\n'), next: k };
  };

  while (i < lines.length) {
    const line = lines[i] ?? '';

    // 列表缩进栈的生命周期:上一个产出块不是列表项 ⇒ 列表已结束 ⇒ 清栈,下个列表从 depth 0 重新起算。
    // 放在轮首统一判定(而非在十余处 push 点各写一遍),对所有 continue 分支都成立。
    // 空行不产出块,故「项与项之间空一行」的松散列表层级得以保持。
    const prevBlock = blocks[blocks.length - 1];
    if (blocks.length > lastRound.count) {
      prevInList = lastRound.ctxCol !== null && lastRound.cols >= lastRound.ctxCol;
    }
    if (
      !prevInList &&
      (!prevBlock ||
        prevBlock.kind !== 'text' ||
        (prevBlock.type !== 'unordered-list-item' && prevBlock.type !== 'ordered-list-item'))
    ) {
      listIndents.length = 0;
      listContentCol = null;
    }
    // 记本轮起行缩进与(清栈后的)列表内容列,下一轮若发现本轮产出了块,据此判定它是否在列表项内部。
    lastRound = { count: blocks.length, cols: leadingCols(line), ctxCol: listContentCol };

    // 1. 围栏代码块:优先保护,内部所有内容(含 --- / > / 行内标记)一律不解析。
    //    列表语境下允许更深的缩进(A4,见 fenceMaxIndent)。
    const fence = matchFenceOpen(line, listContentCol);
    if (fence) {
      let j = i + 1;
      let closed = false;
      while (j < lines.length) {
        if (matchFenceClose(lines[j] ?? '', fence)) {
          closed = true;
          break;
        }
        j += 1;
      }
      if (closed) {
        // 内容行按开栏缩进量剥前导空白(CommonMark;不足的剥到尽量多,A4)——否则列表项下的
        // 缩进代码块每行都背着列表缩进进 X。
        const body = lines.slice(i + 1, j).map((l) => stripIndentCols(l, fence.indent));
        const markdown = fenceMarkdown(lines[i] ?? '', body, lines[j] ?? '');
        blocks.push({ kind: 'atomic', entityType: 'MARKDOWN', data: { markdown } });
        hooks.onFence?.(i, j);
        i = j + 1;
        continue;
      }
      // 第二批 P2:顶层(不在列表项内容里)的未闭合围栏按 CommonMark **到文末都是代码**——此前回退为普通
      // 文本,代码被当 Markdown 解析:`# 注释` 成标题(还被抽成文章标题)、`*args` 的星号被吃掉、`- x` 成列表项。
      // 宁可多包成代码也不改写内容(与 P5「引用内围栏按容器结束闭合」同一原则);能力面板据 isUnclosedFence 告警。
      // 列表内缩进的未闭合围栏(A4 语境)维持原行为:列表容器何时结束另有规则,不在本次范围。
      const topLevel = listContentCol === null || fence.indent < listContentCol;
      const body = topLevel ? lines.slice(i + 1).map((l) => stripIndentCols(l, fence.indent)) : [];
      while (body.length > 0 && (body[body.length - 1] ?? '').trim() === '') body.pop(); // 文末空行不进代码
      // 开栏后一行内容都没有(文末孤立的 ```):不产空代码块,回落文本(与 P5 引用内同口径)。
      if (topLevel && body.length > 0) {
        const block: ImportBlock = { kind: 'atomic', entityType: 'MARKDOWN', data: { markdown: fenceMarkdown(line, body, null) } };
        unclosedFences.add(block);
        blocks.push(block);
        hooks.onFence?.(i, lines.length - 1);
        i = lines.length;
        continue;
      }
      // 列表内未闭合 / 文末孤立开栏:视为普通文本,继续走后续块级逻辑处理本行(不 continue)
    }

    // 1.5 块级数学公式 `$$…$$` → LATEX atomic(真机 dump 确认 X 原生渲染,公式写进块 text)。
    //      放在围栏之后(围栏内的 `$$` 已被上面吃掉、不解析)、其余 atomic 之前(同级块元素)。
    //      单行 `$$ x $$` 就地成块;多行则在**同一段落内**向下找闭合行(findMathClose,遇空行即止,P1)。
    //      三种组合:裸起行 + 裸闭合、裸起行 + 带内容闭合(`E=mc^2 $$`)、带内容起行(`$$ a+b`)+ 裸闭合;
    //      「带内容 × 带内容」不放行(口语双美元防线)。**找不到闭合 → 回退**当普通文本(不 continue,
    //      与未闭合围栏一致)。
    const mathOpen = matchMathOpen(line);
    if (mathOpen === 'single') {
      // `$$ 公式 $$`:剥首尾 `$$`,中间为公式原文(matchMathOpen 已确保中间非空)。
      // 先 trimEnd 再切:否则收尾 `$$` 后的尾随空白会把 `slice(-2)` 顶偏、切出 `x $$` 脏结果。
      const formula = line.trimEnd().slice(2, -2).trim();
      blocks.push({ kind: 'atomic', entityType: 'LATEX', data: {}, text: formula });
      i += 1;
      continue;
    }
    const contentHead = mathOpen === null ? matchMathContentOpen(line) : null;
    if (mathOpen === 'multi' || contentHead !== null) {
      const close = findMathClose(lines, i + 1, contentHead === null ? 'bare' : 'content');
      if (close) {
        // 公式体 = 起行内容(带内容起行时)+ 中间各行 + 闭合行内容(带内容闭合时),保留内部换行原样交 X 渲染。
        const parts = [
          ...(contentHead !== null ? [contentHead] : []),
          ...lines.slice(i + 1, close.at),
          ...(close.tail !== '' ? [close.tail] : []),
        ];
        const inner = parts.join('\n').trim();
        // 空公式(`$$\n$$`)不产 LATEX 块,回退当普通文本(不 continue)。
        if (inner !== '') {
          blocks.push({ kind: 'atomic', entityType: 'LATEX', data: {}, text: inner });
          i = close.at + 1;
          continue;
        }
      }
      // 未闭合 / 空公式:回退,本行按普通文本继续走后续逻辑(不 continue)。
    }

    // 1.6 HTML 注释块(第二批 P3,CommonMark HTML 块类型 2):块首 `<!--` 起,到含 `-->` 的行止,整段**不写入**
    //      ——注释是作者备注,GitHub / Obsidian / Typora 渲染时都不显示,X 又不支持 HTML,写进去只会把备注原样
    //      暴露在文章里;此前逐行按 Markdown 解析,注释里的 `# TODO` 还会被抽成文章标题。`-->` 之后同一行的正文
    //      照常写入。**未闭合不按 CommonMark 吞到文末**:注释不写入,吞到文末等于整篇后文静默丢失(与 P2 围栏不同,
    //      围栏至少把内容按代码写进去)——回退为普通文本,能力面板告警。
    if (RE_HTML_COMMENT_OPEN.test(line)) {
      const startAt = line.indexOf('<!--');
      let j = i;
      let endAt = -1;
      while (j < lines.length) {
        endAt = (lines[j] ?? '').indexOf('-->', j === i ? startAt + 2 : 0);
        if (endAt >= 0) break;
        j += 1;
      }
      if (endAt >= 0) {
        hooks.onHtmlComment?.(i, j);
        hooks.onFence?.(i, j);
        const rest = (lines[j] ?? '').slice(endAt + 3).trim();
        if (rest !== '') blocks.push(textBlock('unstyled', walkInline(rest)));
        i = j + 1;
        continue;
      }
      // 未闭合:回退,本行按普通文本继续(不 continue)
    }

    // 2. 分割线
    if (RE_DIVIDER.test(line)) {
      blocks.push({ kind: 'atomic', entityType: 'DIVIDER', data: {} });
      i += 1;
      continue;
    }

    // 3. 推文(独占一行的裸 URL);url 规范化为 twitter.com/i/web 形式(xposter 实证)
    //    匹配前 trim(B3-2):编辑器/剪贴板常带行尾空白,未 trim 时整行漏判成死文本。
    const tweet = line.trim().match(RE_TWEET);
    if (tweet) {
      const tweetId = tweet[1] ?? '';
      blocks.push({
        kind: 'atomic',
        entityType: 'TWEET',
        data: { url: `https://twitter.com/i/web/status/${tweetId}`, tweetId },
      });
      i += 1;
      continue;
    }

    // 4. 独占一行的图片 → ImageBlock(字节由 content 准备,injector 走 onFilesAdded 上传)。
    //    行内图片(段落中的 `![]()`)不在此列,仍按普通文本保留(M1 边界)。
    //    先匹配「带链接图片」`[![](img)](link)`(以 `[!` 开头),再匹配裸 `![](img)`(以 `![` 开头)。
    const trimmed = line.trim();
    const linkedImage = matchLinkedImageLine(trimmed);
    if (linkedImage) {
      // 内层图片 URL(已剥 `<>` / title)上传;外层链接不返回、直接丢弃——X 图片不能再套超链
      blocks.push({ kind: 'image', source: linkedImage.src, alt: linkedImage.alt, fallbackText: trimmed });
      i += 1;
      continue;
    }
    const imageLine = matchImageLine(trimmed);
    if (imageLine) {
      blocks.push({ kind: 'image', source: imageLine.src, alt: imageLine.alt, fallbackText: trimmed });
      i += 1;
      continue;
    }
    // Obsidian 内嵌图片 `![[path]]` / `![[path|alt]]` → ImageBlock(本地路径,content 侧 FS Access 读取)。
    // 由 obsidianImg 开关门控:关时不识别,`![[x]]` 落到后续按普通文本段落处理。
    const obsidianImage = optObsidianImg ? trimmed.match(RE_OBSIDIAN_IMAGE_LINE) : null;
    if (obsidianImage) {
      const inner = obsidianImage[1] ?? '';
      const pipe = inner.indexOf('|'); // `path|alt`:| 前为路径,| 后为图注/尺寸
      const source = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim();
      const alt = pipe >= 0 ? inner.slice(pipe + 1).trim() : '';
      blocks.push({ kind: 'image', source, alt, fallbackText: trimmed });
      i += 1;
      continue;
    }

    // 4.5 GFM 表格:表头行(含 `|`)+ 紧跟分隔行(`| --- |`)→ 整段原文塞进 MARKDOWN atomic。
    //     X 的 MARKDOWN entity 渲染器识别表格语法并原生渲染(与代码块同一 entity 通道,实证见
    //     docs 勘察);不拆结构化 cell、连 `\|` 转义都原样交给 X 解析。
    if (line.includes('|') && isTableSeparator(lines[i + 1] ?? '')) {
      const start = i;
      i += 2; // 表头 + 分隔行已确认,收下
      // 继续收连续的数据行(含 `|` 的非空行);遇空行 / 不含 `|` 的行即表格结束。
      while (i < lines.length) {
        const row = lines[i] ?? '';
        if (row.trim() === '' || !row.includes('|')) break;
        i += 1;
      }
      const markdown = lines.slice(start, i).join('\n');
      blocks.push({ kind: 'atomic', entityType: 'MARKDOWN', data: { markdown } });
      continue;
    }

    // 5. 空行:跳过
    if (line.trim() === '') {
      i += 1;
      continue;
    }

    // 5. 标题:# / ## → header-one;### → header-two;#### 及以下 → unstyled + 整行 BOLD
    const heading = line.match(RE_HEADING);
    if (heading) {
      const level = (heading[1] ?? '').length;
      const content = stripAtxClosing(heading[2] ?? ''); // 去掉可选的 ATX 闭合 ###
      // 第三批 P12:空标题(`#`、`# #`、`#### ####`)不产出块——写进 X 只是一个空的标题块;标题抽取本就跳过空标题。
      if (content === '') {
        i += 1;
        continue;
      }
      const inline = walkInline(content);
      let type: TextBlockType;
      let demoted = false;
      if (level <= 2) {
        type = 'header-one';
      } else if (level === 3) {
        type = 'header-two';
      } else {
        type = 'unstyled';
        if (inline.text.length > 0) {
          inline.inlineStyleRanges.push({ offset: 0, length: inline.text.length, style: 'BOLD' });
          demoted = true; // 空内容的 `####` 只剩空段落,不算降级标题
        }
      }
      const hb = textBlock(type, inline);
      if (demoted) demotedHeadings.add(hb);
      blocks.push(hb);
      hooks.onHeading?.(i, i + 1, level, 'atx', heading[2] ?? '', blocks.length - 1);
      i += 1;
      continue;
    }

    // 6. 引用:逐行独立成块(不合并多行)
    if (RE_BLOCKQUOTE.test(line)) {
      const content = stripQuotePrefix(line);
      // P5:引用内的围栏代码 → MARKDOWN atomic,原样保留(此前逐行 walkInline,代码里的 `*`/`_` 被当
      // 强调符吃掉)。只收**连续的引用行**:剥前缀后遇闭栏即闭合;引用先结束则按 CommonMark「容器结束
      // 即闭合」到引用末行为止。X 的 atomic 块不能嵌进 blockquote,代码块会单独成块、不在引用竖线内。
      const qFence = matchFenceOpen(content);
      if (qFence) {
        let j = i + 1;
        let closeAt = -1;
        while (j < lines.length && RE_BLOCKQUOTE.test(lines[j] ?? '')) {
          if (matchFenceClose(stripQuotePrefix(lines[j] ?? ''), qFence)) {
            closeAt = j;
            break;
          }
          j += 1;
        }
        const bodyEnd = closeAt >= 0 ? closeAt : j; // 内容行半开区间 [i+1, bodyEnd)
        // 引用随开栏结束、一行内容都没有:不产空代码块,回落下面的引用文字(与空公式同口径)。
        if (closeAt >= 0 || bodyEnd > i + 1) {
          const body = lines.slice(i + 1, bodyEnd).map((l) => stripIndentCols(stripQuotePrefix(l), qFence.indent));
          const closeLine = closeAt >= 0 ? stripQuotePrefix(lines[closeAt] ?? '') : null;
          blocks.push({ kind: 'atomic', entityType: 'MARKDOWN', data: { markdown: fenceMarkdown(content, body, closeLine) } });
          const last = closeAt >= 0 ? closeAt : bodyEnd - 1;
          hooks.onFence?.(i, last); // forEachContentLine 跳过整个区间(标题抽取 / 扫描不看代码内部)
          i = last + 1;
          continue;
        }
      }
      blocks.push(textBlock('blockquote', walkInline(content)));
      i += 1;
      continue;
    }

    // 7. 无序列表(支持嵌套:前导缩进 → depth;缩进门槛见 canBeListItem)
    const ul = line.match(RE_UL);
    if (ul && canBeListItem(listIndents, ul[1] ?? '')) {
      const depth = listDepth(listIndents, indentWidth(ul[1] ?? ''));
      const col = listItemContentCol(line, ul[2] ?? '');
      const item = absorbListContinuation(ul[2] ?? '', col);
      blocks.push(taskAwareListBlock('unordered-list-item', item.content, depth));
      listContentCol = col;
      i = item.next;
      continue;
    }

    // 8. 有序列表(支持嵌套,与无序共用同一缩进栈——混合嵌套 `- 一级 / 1. 二级` 层级正确)
    const ol = line.match(RE_OL);
    if (ol && canBeListItem(listIndents, ol[1] ?? '')) {
      const depth = listDepth(listIndents, indentWidth(ol[1] ?? ''));
      const col = listItemContentCol(line, ol[2] ?? '');
      const item = absorbListContinuation(ol[2] ?? '', col);
      blocks.push(taskAwareListBlock('ordered-list-item', item.content, depth));
      listContentCol = col;
      i = item.next;
      continue;
    }

    // 9. 段落:收集连续的非边界行(遇空行或任一块级起始行即止),合并为一个 unstyled 块
    const para: string[] = [line];
    let k = i + 1;
    while (k < lines.length) {
      const next = lines[k] ?? '';
      // interrupting=true:这些行是要去打断**已开启的段落**,有序列表按 CommonMark 只认 `1.`(B3-11)。
      if (isBlockBoundary(next, true)) break;
      // setext 下划线终止段落收集,交下面判定升格为标题。`---` 已被 isBlockBoundary 的
      // 分割线规则拦下,这里主要拦 `===`(它不匹配任何块级规则,否则会被吸进段落文本)。
      if (setextUnderlineLevel(next) !== null) break;
      // 表格开始(当前行含 `|` 且下一行是分隔行):停止段落收集,交主循环的表格分支处理,
      // 否则紧跟正文段落后、无空行分隔的表格会被段落吞掉。
      if (next.includes('|') && isTableSeparator(lines[k + 1] ?? '')) break;
      para.push(next);
      k += 1;
    }

    // 前导空白剥离(B3-6)**逐行**做、且在 walkInline **之前**——整体 trim 会漏掉中间各行,
    // 剥完再解析行内,offset 才是相对最终文本算的。
    // 松散列表下的缩进段落(`- a\n\n    para`,A3):首行缩进 ≥ 列表内容列 ⇒ 属于该列表项,
    // 每行先剥掉至多「内容列」宽的缩进,再走常规的 0-3 列剥离;否则 ≥4 空格会被当缩进代码原样保留。
    const listCol = listContentCol;
    const underList = listCol !== null && leadingCols(line) >= listCol;
    const paraText = para
      .map((l) => stripParagraphIndent(underList ? stripIndentCols(l, listCol) : l))
      .join('\n');

    // setext 标题:段落正下方紧跟 `===` / `---` → 整段升格为标题,并吃掉下划线行。
    // 放在段落收集**之后**判定,天然支持多行 setext 正文;也天然让 `---` 在此处
    // 优先当下划线而非分割线(CommonMark 同序:有前置段落时 setext 胜出)。
    // 级别映射与 ATX 一致:一级/二级同归 header-one(X 只有两级标题,见 TextBlockType)。
    const setextLevel = k < lines.length ? setextUnderlineLevel(lines[k] ?? '') : null;
    if (setextLevel !== null) {
      blocks.push(textBlock('header-one', walkInline(paraText)));
      hooks.onHeading?.(i, k + 1, setextLevel, 'setext', paraText, blocks.length - 1);
      i = k + 1;
      continue;
    }

    blocks.push(textBlock('unstyled', walkInline(paraText)));
    i = k;
  }

  return blocks;
}

/** 去掉 ATX 标题可选的闭合井号序列(`# 标题 ##` → `标题`;`# C#` 不动,闭合序列前须有空白)。 */
function stripAtxClosing(content: string): string {
  const t = content.replace(/\s+#+\s*$/, '').trim();
  return /^#+$/.test(t) ? '' : t; // 第三批 P12:整段只有闭合井号(`# #`)即空标题
}

/**
 * 一段标题内容的**纯文本**(A7):先剥 ATX 闭合井号(`atxClosing`,setext 标题传 false),
 * 再经 walkInline 去掉行内标记——`**粗** 标题` → `粗 标题`、`[链接](u) 标题` → `链接 标题`。
 * 与 parser 产出 header-one 块的 text **同一条路径**,frontmatter.pickTitleHeading(→ extractTitle /
 * capability.firstTitle)共用它,文章标题与正文标题不再分裂。
 * 行内开关(wikilink 等)固定按默认值解析并在返回前还原(withParseOptions)——标题**文本**口径
 * 维持既有行为,不继承上一次 parseMarkdown 残留的模块级状态。
 */
export function inlinePlainText(s: string, opts: { atxClosing?: boolean } = {}): string {
  const content = (opts.atxClosing ?? true) ? stripAtxClosing(s) : s.trim();
  return withParseOptions({}, () => walkInline(content).text.trim());
}

// ---------------------------------------------------------------------------
// 块级辅助
// ---------------------------------------------------------------------------

/**
 * 由行内解析结果组装一个 TextBlock。
 * depth 仅在 > 0(嵌套列表项)时写入——顶层块不带该字段,产出形状与本特性引入前完全一致。
 * task 仅任务列表项传入(见 taskAwareListBlock)。
 */
function textBlock(type: TextBlockType, inline: InlineResult, depth = 0, task?: 'todo' | 'done'): ImportBlock {
  const block: TextBlock = {
    kind: 'text',
    type,
    text: inline.text,
    inlineStyleRanges: inline.inlineStyleRanges,
    links: inline.links,
  };
  if (depth > 0) block.depth = depth;
  if (task) block.task = task;
  return block;
}

/**
 * 列表内容开头的任务标记 `[ ]` / `[x]` / `[X]`,其后须紧跟至少一个空白——
 * `[x]abc` 不算任务项(与 GFM 一致),原样交普通列表分支处理。
 * 分隔符用 `\s`(而非 `[ \t]`)与列表标记同理:中文输入法下 `- [x]　完成` 会打出全角空格,
 * 收窄会让它退化成正文里带字面量 `[x]` 的普通列表项。
 */
const RE_TASK_MARK = /^\[([ xX])\]\s+/;

/** 识别并剥离任务标记,返回勾选态与剩余内容;不匹配返回 null。 */
function matchTaskMark(content: string): { checked: boolean; rest: string } | null {
  const m = RE_TASK_MARK.exec(content);
  if (!m) return null;
  return { checked: (m[1] ?? ' ') !== ' ', rest: content.slice(m[0].length) };
}

/**
 * 把 InlineResult 的所有 offset 整体平移 shift(不就地改,返回新对象)。
 * symbol 模式在剩余内容解析结果前拼接 `☐ `/`☑ ` 前缀时,inlineStyleRanges / links 的
 * offset 是相对「剩余内容」算出的,必须同步平移前缀长度,否则如 `- [ ] **粗体**` 会整体错位
 * (加粗区间仍指向拼接前的位置,砸到前缀符号或空格上)。
 */
function shiftInline(inline: InlineResult, prefix: string): InlineResult {
  const shift = prefix.length;
  return {
    text: prefix + inline.text,
    inlineStyleRanges: inline.inlineStyleRanges.map((r) => ({ ...r, offset: r.offset + shift })),
    links: inline.links.map((l) => ({ ...l, offset: l.offset + shift })),
  };
}

/**
 * 组装无序/有序列表项块,统一处理任务列表标记(`- [ ] x` / `1. [x] x`):
 *  - 非任务项:与此前行为完全一致,直接 walkInline(content)。
 *  - 任务项:剥标记 → 按 optTaskList 决定是否加 ☐/☑ 前缀(symbol 平移 offset;plain 不加符号)
 *    → 写入 task 字段。
 */
function taskAwareListBlock(type: TextBlockType, content: string, depth: number): ImportBlock {
  const task = matchTaskMark(content);
  if (!task) return textBlock(type, walkInline(content), depth);
  const inline = walkInline(task.rest);
  const shaped = optTaskList === 'symbol' ? shiftInline(inline, task.checked ? '☑ ' : '☐ ') : inline;
  return textBlock(type, shaped, depth, task.checked ? 'done' : 'todo');
}

/**
 * 缩进的列表标记是否真的算列表项。
 *  - **已在列表 run 中**(缩进栈非空)→ 任意缩进都算,这正是嵌套项的入口;
 *  - **不在列表中** → 仅允许缩进 ≤3 列(CommonMark:列表最多缩进 3 格,≥4 格属缩进代码块领域)。
 *
 * 没有这道门槛时,粘进正文的 4 空格缩进代码/日志里的 `- x`、`1. x` 会被拆成独立列表项、
 * 丢掉原始缩进语境(review 揪出:放开缩进匹配的副作用,`isBlockBoundary` 复用同一正则会
 * 把本应连续的段落硬切开)。2 空格的情形保持「可打断段落」——那与 CommonMark 一致。
 */
function canBeListItem(stack: number[], indent: string): boolean {
  return stack.length > 0 || indentWidth(indent) <= 3;
}

/**
 * 顶层语境下该行是否为列表项起始——段落边界判定用(收集段落时定义上不在列表 run 内)。
 *
 * `interrupting`(B3-11 / P2-13):本行是否要去**打断一个已开启的段落**。CommonMark 只允许
 * 序号为 `1.` 的有序列表打断段落——否则软折行段落里「2024. 冬天的第一场雪…」这样的行会被硬切
 * 成列表项,原编号还被 X 重编成 1(内容失真)。**独立起块**时(interrupting=false)仍认任意
 * 数字,`3. 第三项` 照常起列表。无序列表不受此限(CommonMark 同样允许它打断段落)。
 */
function isTopLevelListLine(line: string, interrupting: boolean): boolean {
  const ul = RE_UL.exec(line);
  if (ul) return indentWidth(ul[1] ?? '') <= 3;
  const ol = (interrupting ? RE_OL_INTERRUPT : RE_OL).exec(line);
  return ol !== null && indentWidth(ol[1] ?? '') <= 3;
}

/**
 * 段落行的前导空白剥离(B3-6 / P2-8):**最多剥 3 列**,≥4 空格的行原样保留。
 * CommonMark 里 0-3 空格缩进对段落无语义,留着只会让正文平白多出空格;而 ≥4 空格是缩进代码
 * 的领域——用户粘贴的缩进日志/代码块必须逐字节保住(这是不做 `join` 后整体 trim 的原因)。
 * 只处理空格不处理 Tab:Tab 的列宽依渲染环境而异,剥掉会改变对齐语义。
 */
function stripParagraphIndent(line: string): string {
  const m = /^ {1,3}(?! )/.exec(line);
  return m ? line.slice(m[0].length) : line;
}

/** 行首空格/Tab 的列宽。 */
function leadingCols(line: string): number {
  return indentWidth(/^[ \t]*/.exec(line)?.[0] ?? '');
}

/**
 * 剥掉至多 `cols` 列的前导空格/Tab;前导空白不足 `cols` 时剥到尽量多(CommonMark 对围栏内容行的规则)。
 * Tab 按 4 列计,跨越边界的 Tab 整个剥掉(不拆半个 Tab)。
 */
function stripIndentCols(line: string, cols: number): string {
  let w = 0;
  let k = 0;
  while (k < line.length && w < cols) {
    const ch = line[k];
    if (ch === ' ') w += 1;
    else if (ch === '\t') w += 4;
    else break;
    k += 1;
  }
  return line.slice(k);
}

/** 列表项的内容列:标记 + 分隔空白之后的列宽(`- a` → 2,`10. a` → 4)。content 为正则捕获的项内容。 */
function listItemContentCol(line: string, content: string): number {
  return indentWidth(line.slice(0, line.length - content.length));
}

/** 缩进宽度(列):Tab 记 4 列,空格记 1 列——与主流编辑器/CommonMark 的 Tab 展开一致。 */
function indentWidth(ws: string): number {
  let w = 0;
  for (const ch of ws) w += ch === '\t' ? 4 : 1;
  return w;
}

/**
 * 由缩进宽度算列表嵌套层级,**栈式**而非「缩进 ÷ 固定单位」:
 * 后者必须假定每级固定 2 或 4 空格,遇到另一种(或混用 Tab)就整体算错;
 * 栈式只看「比上一层更深/更浅」的相对关系,故 2 空格、4 空格、Tab、混合缩进都正确。
 *
 * 就地维护 stack(调用方每轮列表run 复用同一个数组):
 *  - 比栈顶浅 → 逐层出栈,回到匹配层级;
 *  - 比栈顶深 → 入栈,新增一层;
 *  - 与栈顶齐平 → 维持当前层。
 * 返回值截顶到 MAX_LIST_DEPTH。
 */
function listDepth(stack: number[], width: number): number {
  while (stack.length > 0 && width < (stack[stack.length - 1] ?? 0)) stack.pop();
  if (stack.length === 0 || width > (stack[stack.length - 1] ?? 0)) stack.push(width);
  return Math.min(stack.length - 1, MAX_LIST_DEPTH);
}

/**
 * 段落边界:空行,或任一块级元素的起始行——段落收集到这些行前停止。
 * `interrupting`:段落收集与列表续行吸收传 true(该行要去打断一个已开启的段落 / 列表项内容),
 * 影响有序列表判定,见 isTopLevelListLine;默认 false 为「块首语境」口径(与主循环块首的列表分支一致)。
 */
function isBlockBoundary(line: string, interrupting = false): boolean {
  if (line.trim() === '') return true;
  if (matchFenceOpen(line)) return true;
  if (RE_DIVIDER.test(line)) return true;
  if (matchMathOpen(line) !== null) return true;
  if (RE_HTML_COMMENT_OPEN.test(line)) return true; // 第二批 P3:HTML 注释块可打断段落(CommonMark 类型 2)
  if (RE_TWEET.test(line.trim())) return true; // trim 与主循环的推文分支同源(B3-2)
  if (matchImageLine(line.trim()) !== null) return true;
  if (matchLinkedImageLine(line.trim()) !== null) return true;
  if (optObsidianImg && RE_OBSIDIAN_IMAGE_LINE.test(line.trim())) return true;
  if (RE_HEADING.test(line)) return true;
  if (RE_BLOCKQUOTE.test(line)) return true;
  if (isTopLevelListLine(line, interrupting)) return true;
  return false;
}

/**
 * 规范化图片 destination(CommonMark 语义):
 *  - `<...>` 包裹 → 剥尖括号,**尖括号内整体为路径**(保留空格——本地图路径含空格很常见,如
 *    `<images/a b.png>`;URL 含空格时 CommonMark 要求必须用 `<>` 包裹),忽略 `>` 之后的可选 title;
 *  - 未包裹 → 剥掉尾部的**可选 title**(B3-1 / P1-4),其余空白保留。
 * 注:与行内链接的 normalizeUrl 有意不同——图片**不做**「截到第一个空白」,否则会切断含空格的本地路径。
 *
 * title 剥离**保守只认 `"…"` / `'…'` 两种**:`url (标题)` 形态与 `photo (1).png` 这类真实
 * 文件名无法区分,误剥会把好路径切坏,故不碰。剥离统一落在本函数(裸图片行与「带链接图片」
 * 两条分支都经它),避免第二套实现漂移;`<>` 分支提前 return,其 `>` 之后的 title 本就被忽略。
 * frontmatter.extractCover 的 `cover: ![x](a.png "t")` 经 matchImageLine / matchLinkedImageLine 间接复用
 * (A6 / P6),不另写第二套剥离。
 */
export function normalizeImageSrc(raw: string): string {
  const s = raw.trim();
  if (s.startsWith('<')) {
    const end = s.indexOf('>');
    if (end >= 0) return s.slice(1, end); // 尖括号内原样(不 trim:空格是路径的一部分)
  }
  return s.replace(/\s+("[^"]*"|'[^']*')$/, '');
}

/**
 * 解析「独占一行的单张裸图片」`![alt](src)`。src 用括号配对扫描(容忍 URL 内含括号,
 * 如 `![a](http://h/f(1).png)`),并要求闭合 `)` 之后到行尾无其他字符——因此一行多图
 * `![a](x) ![b](y)` **不**匹配(返回 null,交由上层按普通文本保留),杜绝旧版贪婪 `.+`
 * 把整行吞成 source 畸形(`x) ![b](y`)的单张图。入参需为**已 trim** 的行。
 * `<>` 包裹的 destination(CommonMark,含空格路径必需)由尖括号感知 + normalizeImageSrc 处理。
 * 导出供 frontmatter.extractCover 复用(P6):cover 值与正文同一套「整行恰为一张图」判定。
 */
export function matchImageLine(line: string): { alt: string; src: string } | null {
  const head = RE_IMAGE_LINE_HEAD.exec(line);
  if (!head) return null;
  const alt = head[1] ?? '';
  const urlStart = head[0].length; // src 起点:紧跟开括号 `(` 之后
  const urlEnd = scanParenClose(line, urlStart);
  if (urlEnd === null) return null; // 括号未闭合
  if (urlEnd !== line.length - 1) return null; // 闭合 `)` 之后仍有字符 → 一行多图 / 尾随文本,不认作图片行
  const src = normalizeImageSrc(line.slice(urlStart, urlEnd));
  if (src === '') return null; // 空 src 不产出 ImageBlock
  return { alt, src };
}

/**
 * 解析「独占一行的带链接图片」`[![alt](src)](link)`(推文转 md 常见)。与 matchImageLine 同一套
 * 括号配对扫描:内层图片 URL 闭合后必须**紧跟** `](`,外层链接 URL 再做一次配对,且其闭合 `)`
 * 必须是行尾最后一个字符。因此以下形态均返回 null,整行交由段落分支按普通文本保留(A1):
 *  - 一行两张链接图 `[![a](1.jpg)](p1) [![b](2.jpg)](p2)`(旧正则把中间整段吞进 source);
 *  - 链接图后跟裸图 `[![a](i.png)](l) ![b](y.png)`(b 静默丢失);
 *  - 链接图后跟尾随文本 `[![a](i.png)](l)(注:见原文)`(注释丢失)。
 * 内层 src 经 normalizeImageSrc(剥 `<>` / title);外层 link 只做结构校验、不返回(X 图片不能套超链)。
 * 入参需为**已 trim** 的行。导出供 frontmatter.extractCover 复用(P6)。
 */
export function matchLinkedImageLine(line: string): { alt: string; src: string } | null {
  const head = RE_LINKED_IMAGE_LINE_HEAD.exec(line);
  if (!head) return null;
  const alt = head[1] ?? '';
  const srcStart = head[0].length;
  const srcEnd = scanParenClose(line, srcStart);
  if (srcEnd === null) return null; // 内层括号未闭合
  if (line.slice(srcEnd + 1, srcEnd + 3) !== '](') return null; // 内层图片闭合后须紧跟 `](`
  const linkStart = srcEnd + 3;
  const linkEnd = scanParenClose(line, linkStart);
  if (linkEnd === null) return null; // 外层括号未闭合
  if (linkEnd !== line.length - 1) return null; // 外层闭合 `)` 之后仍有字符 → 多图 / 尾随文本
  const src = normalizeImageSrc(line.slice(srcStart, srcEnd));
  if (src === '') return null;
  return { alt, src };
}

/**
 * 括号配对扫描:`start` 为某个已消费的开括号 `(` 之后的位置,返回与之配对的闭括号 `)` 下标;
 * 未闭合返回 null。容忍 URL 内嵌套括号(`http://h/f(1).png`),`\` 转义连同下一字符跳过,
 * `<...>` 包裹段整体跳过(CommonMark:尖括号内可含空格 / `)`,不参与计数)。
 * matchImageLine 与 matchLinkedImageLine 共用,避免两套扫描漂移。
 */
function scanParenClose(line: string, start: number): number | null {
  let depth = 1;
  let i = start;
  while (i < line.length) {
    const ch = line[i];
    if (ch === '\\') {
      i += 2; // 转义:连同下一字符跳过,不参与括号计数
      continue;
    }
    if (ch === '<') {
      const gt = line.indexOf('>', i);
      if (gt >= 0) {
        i = gt + 1;
        continue;
      }
    }
    if (ch === '(') {
      depth += 1;
    } else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i; // 找到与开括号配对的闭括号
    }
    i += 1;
  }
  return null;
}

/**
 * 识别开栏:3+ 个 ` 或 ~;反引号围栏的信息串不得含反引号(否则非合法开栏)。
 * 缩进上限按 fenceMaxIndent(自身缩进, listContentCol):顶层 0-3(B3-6),列表语境且缩进 ≥ 内容列时放宽(A4)。
 * 开栏正则 RE_FENCE_LINE 与主循环 info 规范化共用;闭栏缩进上限随 Fence.maxIndent 走——
 * 漏改任一处就会「语言标记丢失」或「闭栏认不出、整段吞进正文」。
 * 导出供 frontmatter.pickTitleHeading 判定「setext 标题文本是开栏行」(L1),不另写围栏正则。
 */
export function matchFenceOpen(line: string, listContentCol: number | null = null): Fence | null {
  const m = line.match(RE_FENCE_LINE);
  if (!m) return null;
  const indent = indentWidth(m[1] ?? '');
  const maxIndent = fenceMaxIndent(indent, listContentCol);
  if (indent > maxIndent) return null;
  const marker = m[2] ?? '';
  const info = m[3] ?? '';
  const char = marker[0] ?? '`';
  if (char === '`' && info.includes('`')) return null;
  return { char, len: marker.length, indent, maxIndent };
}

/**
 * 拼 MARKDOWN entity 的围栏原文(顶层与引用内共用,P5)。开栏行规范化 info(语言):解码 HTML 实体 +
 * 只取第一词——源 md 里 `plain&#x20;text` / `plain text` 会被 X 当成含空格/实体的语言名,渲染出难看的
 * 标签;开栏与闭栏都不带前导缩进,内容行由调用方剥好缩进后原样传入。
 * `closeLine` 为 null(引用结束即闭合)时用开栏 marker 补齐,保证 X 收到闭合的围栏。
 */
function fenceMarkdown(openLine: string, body: string[], closeLine: string | null): string {
  // 与 matchFenceOpen 同一条正则(B3-6):缩进围栏在此若认不出,marker/lang 双双回退默认值,语言标记被静默吞掉。
  const fm = RE_FENCE_LINE.exec(openLine);
  const marker = fm?.[2] ?? '```';
  const lang = normalizeCodeInfo(fm?.[3] ?? '');
  const close = closeLine === null ? marker : closeLine.replace(/^[ \t]+/, '');
  return [marker + lang, ...body, close].join('\n');
}

/** 剥掉引用前缀(0-3 空格缩进 + `>` + 至多一个空白),与 RE_BLOCKQUOTE 同步(B3-6)。 */
function stripQuotePrefix(line: string): string {
  return line.replace(/^ {0,3}>\s?/, '');
}

/** 识别闭栏:同字符、数量 ≥ 开栏、其后仅允许空白(`\s`:含全角空格 U+3000,CJK 输入法
 * 易在行尾带出——收窄成 `[ \t]` 会让这类闭栏失效、整段代码块散架,review 修复);缩进规则与开栏同(B3-6)。 */
function matchFenceClose(line: string, fence: Fence): boolean {
  const m = line.match(RE_FENCE_CLOSE);
  if (!m) return false;
  if (indentWidth(m[1] ?? '') > fence.maxIndent) return false; // 缩进上限与开栏同口径(A4)
  const marker = m[2] ?? '';
  return (marker[0] ?? '') === fence.char && marker.length >= fence.len;
}

/** 把 HTML 数字实体(&#x20; / &#32; 等)解码回字符;越界/非法码点丢弃。用于代码围栏 info 归一。 */
function decodeNumericEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => {
      const cp = parseInt(h, 16);
      return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
    })
    .replace(/&#(\d+);/g, (_, d) => {
      const cp = parseInt(d, 10);
      return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
    });
}

/**
 * 规范化代码围栏的 info string(语言标识):
 *  - 先解码 HTML 数字实体(源 md 可能来自 HTML 导出,空格被转义成 `&#x20;` 混进了 info);
 *  - 再只取第一个 token 作语言(CommonMark:info 首词为语言,其余是元数据)。
 * 例:`plain&#x20;text` / `plain text` → `plain`;`typescript` → `typescript`;空 info → 空(无语言块保持无语言)。
 * 否则含空格 / 实体的 info 会被 X 当成语言名整体渲染出 `plain&#x20;text` 这种难看标签。
 */
function normalizeCodeInfo(info: string): string {
  return decodeNumericEntities(info).trim().split(/\s+/)[0] ?? '';
}

// ---------------------------------------------------------------------------
// 行内解析:递归下降,产出干净文本 + 精确区间
// ---------------------------------------------------------------------------

/**
 * 行内解析递归深度上限。粗/斜/删/链接的嵌套解析都经 walkInline 递归下降,
 * 病理输入(如 `'['.repeat(5000)+'x'+'](u)'.repeat(5000)`、极深强调嵌套)会撑爆调用栈。
 * 超过此深度即停止递归、当前片段按纯文本原样输出(见 walkInline 内 wrap / 链接分支)。
 * 100 远超任何真实文档的行内嵌套层数,正常文档输出完全不受影响。
 */
const MAX_INLINE_DEPTH = 100;

/**
 * 单次 walkInline 调用内的扫描缓存(P1 / P2),只对同一个 src 有效:
 *  - closeMemo:定界符 → 按起点记忆的 findClosing 结果(CLOSE_UNKNOWN = 未算),见 findClosing;
 *  - runStart / runEnd(p):p 所在同字符连续串的串首 / 串尾(开区间)。首次查询时整串回填,
 *    之后串内任一位置 O(1)——canOpen / canClose 不再对长串逐位重扫。
 *  - link(p):起点 p 的 matchLink 结果(按起点缓存)。walkInline 与 findClosing(第二批 P8 跳过完整链接)
 *    共用——matchLink 自身 O(n)(backlog A21),不缓存时 findClosing 在每个 `[` 重算一遍,`[a` 重复串
 *    的病态输入会比改前慢约 3 倍(check 审查 B)。
 */
interface InlineScan {
  closeMemo: Map<string, Int32Array>;
  link: (p: number) => ReturnType<typeof matchLink>;
  runStart: (p: number) => number;
  runEnd: (p: number) => number;
}

/** 建立 src 的扫描缓存;表惰性分配(多数文本块用不到强调符)。p 须 < src.length。 */
function createInlineScan(src: string): InlineScan {
  let starts: Int32Array | null = null;
  let ends: Int32Array | null = null;
  /** 确保 p 所在串已回填,返回两张表。ends[q] === 0 表示未算(串尾恒 > q ≥ 0)。 */
  const ensure = (p: number): { s: Int32Array; e: Int32Array } => {
    starts ??= new Int32Array(src.length);
    ends ??= new Int32Array(src.length);
    if ((ends[p] ?? 0) === 0) {
      const ch = src[p];
      let b = p;
      while (b > 0 && src[b - 1] === ch) b -= 1;
      let e = p + 1;
      while (e < src.length && src[e] === ch) e += 1;
      for (let q = b; q < e; q += 1) {
        starts[q] = b;
        ends[q] = e;
      }
    }
    return { s: starts, e: ends };
  };
  const linkMemo = new Map<number, ReturnType<typeof matchLink>>();
  return {
    closeMemo: new Map(),
    link: (p) => {
      let r = linkMemo.get(p);
      if (r === undefined) {
        r = matchLink(src, p);
        linkMemo.set(p, r);
      }
      return r;
    },
    runStart: (p) => ensure(p).s[p] ?? p,
    runEnd: (p) => ensure(p).e[p] ?? p + 1,
  };
}

/** 解析一段行内文本;offset/length 均基于剥掉标记后的最终文本。depth 为当前递归深度(防栈溢出)。 */
function walkInline(src: string, depth = 0): InlineResult {
  let out = '';
  const ranges: InlineStyleRange[] = [];
  const links: LinkRange[] = [];

  /** 把子结果嵌入当前 out 位置:平移子区间 + 追加包裹样式 / 链接。 */
  const embed = (sub: InlineResult, styles: Array<InlineStyleRange['style']>, url?: string): void => {
    const base = out.length;
    for (const r of sub.inlineStyleRanges) {
      ranges.push({ offset: r.offset + base, length: r.length, style: r.style });
    }
    for (const l of sub.links) {
      links.push({ offset: l.offset + base, length: l.length, url: l.url });
    }
    if (sub.text.length > 0) {
      for (const style of styles) ranges.push({ offset: base, length: sub.text.length, style });
      if (url !== undefined) links.push({ offset: base, length: sub.text.length, url });
    }
    out += sub.text;
  };

  let i = 0;
  const n = src.length;
  // P1 / P2 性能:本次调用内的扫描缓存(闭符记忆表 + 同字符串首尾,见 InlineScan / findClosing)。
  // 仅针对**强调符定界符**(`* _ ~`)的扫描:`'**a '.repeat(5000)`、「`**x` + 行内代码」重复串、长串 `~` / `*`
  // 等由 O(n²) 降为线性。行内代码长反引号串(matchCodeSpan)、链接(matchLink)、wikilink 的 indexOf
  // 在病理输入下仍为 O(n²),属旧问题,不在本次范围。
  const scan = createInlineScan(src);
  const findClose = (start: number, delim: string): number => findClosing(src, start, delim, scan);
  /** p 处的强调符能否开(A2,见 canOpenRun);串尾取自缓存。 */
  const canOpen = (p: number): boolean => canOpenRun(src, scan.runEnd(p));

  /**
   * 递归包裹一段强调:未超深度上限则解析内层 [innerStart,innerEnd) 并挂样式;
   * 超限则把 [i,advanceTo) 原始子串按纯文本输出(不递归、防栈溢出)。两条路径都把指针推进到 advanceTo。
   */
  const wrap = (
    innerStart: number,
    innerEnd: number,
    advanceTo: number,
    styles: Array<InlineStyleRange['style']>,
  ): void => {
    if (depth < MAX_INLINE_DEPTH) {
      embed(walkInline(src.slice(innerStart, innerEnd), depth + 1), styles);
    } else {
      out += src.slice(i, advanceTo);
    }
    i = advanceTo;
  };

  while (i < n) {
    const ch = src[i] ?? '';

    // 反斜杠转义:仅对其后紧跟的 ASCII 标点生效,输出该标点、跳过反斜杠
    if (ch === '\\' && i + 1 < n && RE_PUNCT.test(src[i + 1] ?? '')) {
      out += src[i + 1] ?? '';
      i += 2;
      continue;
    }

    // 行内代码:X Articles 正文**不支持**行内代码(无对应 inline style,真机实测确认),
    // 写 CODE style 也不渲染。降级:原样保留 markdown 反引号(`code`)为纯文本——读者可辨识
    // 是代码/字面量(尤其 `<占位符>`),不虚报样式。仍走 matchCodeSpan 识别边界(保护内部
    // * / _ 不被当强调解析),但输出连反引号的原始子串、不产出 CODE range。
    if (ch === '`') {
      const code = matchCodeSpan(src, i);
      if (code) {
        out += src.slice(i, code.end); // 连反引号原样保留(含多反引号 ``x`` 的边界)
        i = code.end;
        continue;
      }
      out += ch;
      i += 1;
      continue;
    }

    // 行内 Wikilink `[[目标]]` / `[[目标|别名]]` → 纯文本(别名优先)。由 wikilink 开关门控:
    // 关时不介入 → 落到下面链接 `[` 处理(matchLink 不匹配 → 保持字面 `[[...]]`)。须在链接处理
    // **之前**,否则 `[[` 会被当作嵌套链接起始。紧跟 `!` 的 `![[` 是图片语法(块级已处理),不介入。
    if (optWikilink && src.startsWith('[[', i) && src[i - 1] !== '!') {
      const end = src.indexOf(']]', i + 2);
      if (end >= 0) {
        const inner = src.slice(i + 2, end);
        // 内部不得再含 `[`/`]`(避免吞掉相邻链接 / 畸形)——Obsidian wikilink 内容为纯文本。
        if (inner && !inner.includes('[') && !inner.includes(']')) {
          const pipe = inner.indexOf('|');
          out += (pipe >= 0 ? inner.slice(pipe + 1) : inner).trim(); // 别名优先,否则目标
          i = end + 2;
          continue;
        }
      }
    }

    // 链接 [text](url);紧跟在 ! 之后的 [ 属于图片语法,按普通文本保留(M1 边界)
    if (ch === '[' && src[i - 1] !== '!') {
      const link = scan.link(i);
      if (link) {
        if (depth < MAX_INLINE_DEPTH) {
          // normalizeUrl 返回 null 表示 scheme 不在白名单(如 javascript:)→ 降级为纯文本:
          // 仍解析内层样式、可见文本照旧写入,只是**不挂 LINK entity**(url 传 undefined)。
          const url = normalizeUrl(link.url);
          embed(walkInline(link.textRaw, depth + 1), [], url ?? undefined);
        } else {
          out += src.slice(i, link.end); // 递归深度超限:整段按纯文本原样输出
        }
        i = link.end;
        continue;
      }
    }

    // 强调符的最小 flanking(A2):开符号后一字符不得是空白(canOpen),闭符号前一字符不得是空白
    // (findClosing 内 canClose 跳过不满足的候选)。否则 `2 * 3 * 4` 会把 ` 3 ` 设成斜体、吞掉两个
    // 乘号;`a _ b _ c`、`x ~~ y ~~ z` 同类。不满足的符号落到末尾按普通字符原样输出。
    //
    // P2:canOpen 只看整串之后的字符,串内每个位置结论相同。整串不能开(串后为空白 / 行尾)时,
    // 串内每个位置下面各分支都落空、逐字符原样输出——直接整串输出并跳过,结果逐字节相同,
    // `'a' + '~'.repeat(50000)` 这类长串不再逐位重算 canOpen(旧实现 O(n²))。
    if ((ch === '*' || ch === '_' || ch === '~') && !canOpen(i)) {
      const end = scan.runEnd(i);
      out += src.slice(i, end);
      i = end;
      continue;
    }

    // ***x*** 粗+斜
    if (src.startsWith('***', i) && canOpen(i)) {
      const close = findClose(i + 3, '***');
      if (close > i + 3) {
        wrap(i + 3, close, close + 3, ['BOLD', 'ITALIC']);
        continue;
      }
      // 无 `***` 闭合:拆成 `*` + `**`,**先闭合者在内层**(CommonMark)。`***a** b*` 的 `**` 先闭合
      // → 外层斜体包住「加粗 a + b」;`***a* b**` 的 `*` 先闭合 → 交下方 `**` 分支(外层加粗)。
      const c1 = findClose(i + 1, '*');
      const c2 = findClose(i + 3, '**');
      if (c1 > i + 1 && c2 > i + 3 && c2 < c1) {
        wrap(i + 1, c1, c1 + 1, ['ITALIC']);
        continue;
      }
    }
    // **x** 粗
    if (src.startsWith('**', i) && canOpen(i)) {
      const close = findClose(i + 2, '**');
      if (close > i + 2) {
        wrap(i + 2, close, close + 2, ['BOLD']);
        continue;
      }
    }
    // ~~x~~ 删除线
    if (src.startsWith('~~', i) && canOpen(i)) {
      const close = findClose(i + 2, '~~');
      if (close > i + 2) {
        wrap(i + 2, close, close + 2, ['STRIKETHROUGH']);
        continue;
      }
    }
    // *x* 斜体
    if (ch === '*' && canOpen(i)) {
      const close = findClose(i + 1, '*');
      if (close > i + 1) {
        wrap(i + 1, close, close + 1, ['ITALIC']);
        continue;
      }
    }
    // _x_ 斜体:规避 snake_case 词内下划线(左右侧不得紧贴字母数字)
    if (ch === '_' && !isWordChar(src[i - 1]) && canOpen(i)) {
      const close = findClose(i + 1, '_');
      if (close > i + 1 && !isWordChar(src[close + 1])) {
        wrap(i + 1, close, close + 1, ['ITALIC']);
        continue;
      }
    }

    // 普通字符
    out += ch;
    i += 1;
  }

  return { text: out, inlineStyleRanges: ranges, links };
}

/** 匹配从 i 处开始的行内代码:开闭反引号数量需精确相等。返回内容与结束位置。 */
function matchCodeSpan(src: string, i: number): { content: string; end: number } | null {
  let count = 0;
  while (src[i + count] === '`') count += 1;
  let j = i + count;
  while (j < src.length) {
    if (src[j] === '`') {
      let k = 0;
      while (src[j + k] === '`') k += 1;
      if (k === count) return { content: src.slice(i + count, j), end: j + k };
      j += k;
    } else {
      j += 1;
    }
  }
  return null; // 未闭合 → 交由调用方按普通字符处理
}

/**
 * 匹配从 start('[' 处)开始的链接结构 [text](url)。方括号支持嵌套配对,url 支持括号
 * 配对与转义;扫描时跳过行内代码内部。任何环节不成立返回 null(按普通文本处理)。
 */
function matchLink(src: string, start: number): { textRaw: string; url: string; end: number } | null {
  let depth = 0;
  let i = start;
  let close = -1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '`') {
      const cs = matchCodeSpan(src, i);
      i = cs ? cs.end : i + 1;
      continue;
    }
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '[') {
      depth += 1;
    } else if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
    i += 1;
  }
  if (close < 0 || src[close + 1] !== '(') return null;

  let j = close + 2;
  const urlStart = j;
  let pdepth = 1;
  while (j < src.length) {
    const ch = src[j];
    if (ch === '\\') {
      j += 2;
      continue;
    }
    // 第二批 P9:空白后的 `"…"` / `'…'` 是链接 title,其中的 `)` 不参与括号配对(此前
    // `[a](u "x ) y")` 在 title 内截断,` y")` 漏进正文)。找不到闭合引号按普通字符继续。
    if ((ch === '"' || ch === "'") && /\s/.test(src[j - 1] ?? '')) {
      const q = findQuoteClose(src, j + 1, ch);
      if (q >= 0) {
        j = q + 1;
        continue;
      }
    }
    if (ch === '(') {
      pdepth += 1;
    } else if (ch === ')') {
      pdepth -= 1;
      if (pdepth === 0) break;
    }
    j += 1;
  }
  if (pdepth !== 0) return null;

  return { textRaw: src.slice(start + 1, close), url: src.slice(urlStart, j), end: j + 1 };
}

/** 从 from 起找未被 `\` 转义的 quote 字符下标;找不到 -1(链接 title 扫描用,P9)。 */
function findQuoteClose(src: string, from: number, quote: string): number {
  for (let k = from; k < src.length; k += 1) {
    if (src[k] === '\\') {
      k += 1;
      continue;
    }
    if (src[k] === quote) return k;
  }
  return -1;
}

/** findClosing 记忆表里「该起点尚未计算」的标记(结果本身只会是 ≥ -1 的下标)。 */
const CLOSE_UNKNOWN = -2;

/**
 * 从 start 处向后寻找闭合定界符 delim,返回其起始下标(找不到 -1)。delim 恒由同一字符组成
 * (`*` / `_` / `**` / `***` / `~~`)。扫描时跳过行内代码(代码优先)、完整链接(第二批 P8)与反斜杠转义对(A12);
 * 对单字符定界符(* / _)跳过更长的同字符连续段(避免把 ** 中的星号误判为 * 的闭合)。前一字符是
 * 空白的候选不能闭合(canClose,A2),跳过继续找:`**a ** b**` 的中间 `**` 不闭合,整段 `a ** b`
 * 加粗(CommonMark)。
 *
 * 记忆化(P1 / P2,行为零差异):扫描每一步的去向只取决于当前位置,所以从任一起点出发的扫描路径
 * 确定、结果是起点的纯函数——路径上经过的每个位置与起点结果相同。按定界符各建一张记忆表
 * (scan.closeMemo),扫描遇到已算位置直接取用,结束时把整条路径回填:每个位置每种定界符至多真正
 * 扫一次(仅指本函数的定界符扫描;路径上的 matchCodeSpan 自身对长反引号串仍可能 O(n),属旧问题)。
 * 旧实现只缓存「未跨行内代码」的失败,「`**x` + 行内代码」重复串 这类跨代码的输入退化 O(n²)。
 * 同字符串整段处理(P2):
 *  - 多字符定界符:串内各位置的 canClose 只看串首之前一字符、结论相同;不成立则串内其余位置都只会
 *    逐位走出串,整串回填并跳到串尾;
 *  - 单字符定界符:从串内 p 起剩余长度 ≥ 2 时整段跳到串尾,故 [p+1, 串尾-2] 与 p 同结果,一并回填;
 *    **串末位置剩余长度为 1、本身可能就是闭符,须按自身判定,不回填**。
 */
function findClosing(src: string, start: number, delim: string, scan: InlineScan): number {
  let memo = scan.closeMemo.get(delim);
  if (!memo) {
    memo = new Int32Array(src.length).fill(CLOSE_UNKNOWN);
    scan.closeMemo.set(delim, memo);
  }
  const dch = delim[0] ?? '';
  const path: number[] = [];
  let result = -1;
  let i = start;
  while (i < src.length) {
    const known = memo[i] ?? CLOSE_UNKNOWN;
    if (known !== CLOSE_UNKNOWN) {
      result = known;
      break;
    }
    path.push(i);
    const ch = src[i];
    // 反斜杠转义(A12):与 walkInline / matchLink 同口径,`\` + ASCII 标点整体跳过,被转义的定界符不能闭合。
    if (ch === '\\' && RE_PUNCT.test(src[i + 1] ?? '')) {
      i += 2;
      continue;
    }
    if (ch === '`') {
      const cs = matchCodeSpan(src, i);
      i = cs ? cs.end : i + 1;
      continue;
    }
    // 第二批 P8:完整链接 / 图片(`[…](…)`)整体跳过——CommonMark 中链接与代码 span 的结合优先于强调,
    // 此前 `**a [b](u/x**y) c**` 的闭符被 URL 里的 `**` 截走、链接丢失。跳转只取决于位置,记忆化不变量不变。
    if (ch === '[') {
      const lk = scan.link(i);
      if (lk) {
        i = lk.end;
        continue;
      }
    }
    if (ch !== dch) {
      i += 1;
      continue;
    }
    const end = scan.runEnd(i);
    if (delim.length === 1) {
      if (end - i === 1 && canCloseRun(src, scan.runStart(i))) {
        result = i;
        break;
      }
      for (let q = i + 1; q < end - 1; q += 1) path.push(q);
      i = end;
      continue;
    }
    if (end - i < delim.length) {
      i += 1; // 串内剩余不足一个定界符(即 startsWith 不成立):逐位前进
      continue;
    }
    if (canCloseRun(src, scan.runStart(i))) {
      result = i;
      break;
    }
    for (let q = i + 1; q < end; q += 1) path.push(q);
    i = end;
  }
  for (const q of path) memo[q] = result;
  return result;
}

/**
 * 规范化并**安全校验**链接目标:
 *  - `<...>` 包裹(CommonMark)→ 取尖括号内整体(**可含空格**,仿 normalizeImageSrc),忽略 `>` 之后的可选标题;
 *    修掉旧版「先按 endsWith('>') 判整体、再按空白截断」把 `<url with space>` 截成 `<url` 的 bug;
 *  - 裸 destination → 截到第一个空白前(其后是可选标题);
 *  - scheme 白名单:仅放行 http/https/mailto 与「无 scheme 的相对 URL」(`/`、`#`、`.` 开头或纯相对路径);
 *    其余(`javascript:`、`data:`、`vbscript:`、`file:` 等)返回 **null** → 调用方据此降级为纯文本、不挂 LINK。
 */
function normalizeUrl(raw: string): string | null {
  let u = raw.trim();
  if (u.startsWith('<')) {
    const end = u.indexOf('>');
    u = end >= 0 ? u.slice(1, end) : u.slice(1); // 尖括号内原样(含空格);无闭合 `>` 则仅剥左尖括号
  } else {
    const sp = u.search(/\s/);
    if (sp >= 0) u = u.slice(0, sp); // 裸 URL:截到首个空白(标题分隔)
  }
  u = u.trim();
  return isSafeUrl(u) ? u : null;
}

/**
 * 链接 scheme 安全白名单。无 scheme(相对 URL / 锚点 / 协议相对 `//host`)一律放行;
 * 有 scheme 时仅放行 http / https / mailto。`javascript:` / `data:` / `vbscript:` 等一律拒绝。
 */
function isSafeUrl(u: string): boolean {
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(u);
  if (!m) return true; // 无 scheme → 相对 URL / 锚点 / `//host`,放行
  const scheme = (m[1] ?? '').toLowerCase();
  return scheme === 'http' || scheme === 'https' || scheme === 'mailto';
}

/**
 * 强调开符号(最小 left-flanking,A2):**整段同字符连续串**之后紧跟的字符存在且不是空白。
 * 看整段而非仅 `len` 个字符(CommonMark 按 delimiter run 判定):否则 `a *** b` 的 `***` 判不过后,
 * 落到 `**` 分支时「后一字符」是第三个 `*`,会被误判为可开。`runEnd` 为该串串尾(开区间,取自 InlineScan)。
 */
function canOpenRun(src: string, runEnd: number): boolean {
  const next = src[runEnd];
  return next !== undefined && !/\s/.test(next);
}

/** 强调闭符号(最小 right-flanking,A2):同字符连续串**之前**紧邻的字符存在且不是空白。`runStart` 为串首。 */
function canCloseRun(src: string, runStart: number): boolean {
  const prev = src[runStart - 1];
  return prev !== undefined && !/\s/.test(prev);
}

/**
 * 是否为字母或数字(用于下划线斜体的词内规避)。按 Unicode 判定(A13):`报告_终版_修订` 这类
 * CJK 词内下划线同样不得开/闭斜体,只认 ASCII 会把它吞成 `报告终版修订`。
 */
function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
}
