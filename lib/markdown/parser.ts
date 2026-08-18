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
 * 独占一行的「带链接图片」`[![alt](imgUrl)](linkUrl)`(推文转 md 常见:图片外套一层
 * 指向媒体页的链接)。取内层图片 URL 上传,外层链接丢弃(X 图片不能再套超链)。
 * 组1=alt、组2=图片URL、组3=链接URL(仅用于剥离)。
 */
const RE_LINKED_IMAGE_LINE = /^\[!\[([^\]]*)\]\((.+)\)\]\((.+)\)$/;
/**
 * 独占一行的 Obsidian 内嵌图片 `![[path]]` 或 `![[path|alt]]`(wiki 风格)。
 * path 是相对文件夹的本地路径,由 content 侧 File System Access 读取(见 lib/bridge/localVault)。
 * 组1 = `path` 或 `path|alt`——由 matchObsidianImageLine 再切分 `|`。
 */
const RE_OBSIDIAN_IMAGE_LINE = /^!\[\[([^\]]+)\]\]$/;
/**
 * ATX 标题 / 引用:允许 CommonMark 的 **0-3 空格缩进**(B3-6 / P2-8)。此前要求顶格,
 * 缩进一格的标题、引用整块降级成段落,前导空格还以字面量进正文。≥4 空格仍不认——那是
 * 缩进代码块的领域(用户粘贴的缩进日志/代码不该被拆成标题)。
 * **注意**:divider / setext / 块级公式**不**随之放宽,它们的顶格约束是有意的(见各自注释)。
 */
const RE_HEADING = /^ {0,3}(#{1,6})\s+(.*)$/;
const RE_BLOCKQUOTE = /^ {0,3}>/;
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
 * 围栏行(开栏 / info 规范化共用):0-3 空格缩进 + 3 个以上 ` 或 ~,组1=围栏标记、组2=info。
 * **单一来源**是有意的:围栏判定散落三处(matchFenceOpen / matchFenceClose / 主循环的 info
 * 规范化),此前各写一份正则,漏改任一处就会吞掉语言标记或让闭栏失效(B3-6 的主要风险)。
 */
const RE_FENCE_LINE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

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
  // 同行闭合:去掉收尾 `$$` 后中间非空才算(排除 `$$$$` / `$$ $$` 空公式)。
  if (rest.endsWith('$$') && rest.slice(0, -2).trim() !== '') return 'single';
  return null;
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/** 是否为独占一行的图片(裸 `![](x)` / 带链接 `[![](x)](y)` / Obsidian `![[x]]`)。 */
export function isImageLine(line: string): boolean {
  const t = line.trim();
  return matchImageLine(t) !== null || RE_LINKED_IMAGE_LINE.test(t) || RE_OBSIDIAN_IMAGE_LINE.test(t);
}

/**
 * setext 标题下划线的级别:`===` → 1、`---` → 2;不是下划线返回 null。
 * 导出供 frontmatter.ts 的 H1 抽取复用——标题抽取与正文解析必须用**同一套**判定,
 * 否则会出现「parser 认成标题、extractTitle 抽不到」的分裂(本项目在 frontmatter/围栏
 * 判定上已栽过两次「第二套实现漂移」,见 HANDOFF §8)。
 */
export function setextUnderlineLevel(line: string): 1 | 2 | null {
  if (RE_SETEXT_EQ.test(line)) return 1;
  if (RE_SETEXT_DASH.test(line)) return 2;
  return null;
}

/**
 * 该行是否为「普通段落文本行」——即不是任何块级语法的起始、也不是空行。
 * setext 标题的正文行必须满足它(`# x` / `- x` / `> x` 等下方跟 `===` 不构成 setext)。
 * 导出同样是为了让 frontmatter.ts 复用同一判定。
 */
export function isParagraphLine(line: string): boolean {
  return !isBlockBoundary(line);
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
 * 严格围栏感知地遍历 md 行:对每个「位于代码围栏之外」的行调用 visitor(line, index)。
 * 围栏识别与 parseMarkdown 主循环**同源**(matchFenceOpen/matchFenceClose:闭栏须裸行、
 * 数量 ≥ 开栏、`~~~` 与 ``` 不互闭);未闭合的围栏开栏行按普通内容处理(同主循环)——
 * 整个围栏块(开栏行 … 闭栏行)被跳过,内部的 `# x` / `![]()` 等不会被 visitor 看到。
 * visitor 返回 true 时提前停止遍历。
 *
 * 抽出此 helper 是为消除「三处 fence 追踪各写一份、语义漂移」:frontmatter.findFirstH1、
 * stripFirstImageLine 均改用它,与解析主循环保持同一套严格围栏判定。
 *
 * `skipFrontmatter`(B3-3 / P1-6):从 frontmatterBodyStart 起扫,文首 YAML 块整块不交给
 * visitor——`# 注释` 是合法 YAML 注释(Obsidian 模板常见),否则会被标题抽取当成文章标题、
 * 甚至被 stripFirstH1 从 frontmatter **内部**删掉一行。**默认关闭**:此开关有意做成显式的,
 * 不隐式改本 helper 的既有语义(其余消费方的行为必须逐字节不变)。传给 visitor 的 index 始终
 * 是**原始行下标**(调用方按它 splice 才不会删错行)。
 */
export function forEachContentLine(
  lines: string[],
  visitor: (line: string, index: number) => boolean | void,
  opts: { skipFrontmatter?: boolean } = {},
): void {
  let i = opts.skipFrontmatter ? frontmatterBodyStart(lines) : 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const fence = matchFenceOpen(line);
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
        i = j + 1; // 跳过整个围栏块(含开/闭栏行)
        continue;
      }
      // 未闭合:开栏行按普通内容处理(与主循环一致),落到下面 visitor
    }
    if (visitor(line, i)) return;
    i += 1;
  }
}

/**
 * 删除正文中「第一张独占行图片」(裸 / 带链接皆可)——供封面取自正文首图且设为
 * 「从正文移除」时使用,避免封面图在正文重复。跳过围栏代码块(与解析一致)。
 */
export function stripFirstImageLine(md: string): string {
  const lines = md.split(/\r?\n/);
  let target = -1;
  forEachContentLine(lines, (line, index) => {
    if (isImageLine(line)) {
      target = index;
      return true;
    }
  });
  if (target < 0) return md;
  lines.splice(target, 1);
  return lines.join('\n');
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
// 在入口一次性设置,免去给 walkInline / isBlockBoundary 逐层穿参。仅 parseMarkdown 写、
// 块级/行内解析只读。
let optObsidianImg = true;
let optWikilink = true;
let optTaskList: 'symbol' | 'plain' = 'symbol';

/** 解析 Markdown 文本为按文档顺序排列的写入块序列。 */
export function parseMarkdown(md: string, opts: ParseOptions = {}): ImportBlock[] {
  optObsidianImg = opts.obsidianImg ?? true;
  optWikilink = opts.wikilink ?? true;
  optTaskList = opts.taskList ?? 'symbol';
  const lines = md.split(/\r?\n/);
  const blocks: ImportBlock[] = [];
  // 跳过文首 YAML frontmatter(判定见 frontmatterBodyStart)。
  let i = frontmatterBodyStart(lines);
  // 当前列表 run 的缩进栈(每层的缩进宽度),由 listDepth 就地维护、离开列表时清空。
  const listIndents: number[] = [];

  while (i < lines.length) {
    const line = lines[i] ?? '';

    // 列表缩进栈的生命周期:上一个产出块不是列表项 ⇒ 列表已结束 ⇒ 清栈,下个列表从 depth 0 重新起算。
    // 放在轮首统一判定(而非在十余处 push 点各写一遍),对所有 continue 分支都成立。
    // 空行不产出块,故「项与项之间空一行」的松散列表层级得以保持。
    const prevBlock = blocks[blocks.length - 1];
    if (
      !prevBlock ||
      prevBlock.kind !== 'text' ||
      (prevBlock.type !== 'unordered-list-item' && prevBlock.type !== 'ordered-list-item')
    ) {
      listIndents.length = 0;
    }

    // 1. 围栏代码块:优先保护,内部所有内容(含 --- / > / 行内标记)一律不解析
    const fence = matchFenceOpen(line);
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
        // 规范化开栏首行的 info(语言):解码 HTML 实体 + 只取第一词——源 md 里 `plain&#x20;text` /
        // `plain text` 会被 X 当成含空格/实体的语言名,渲染出难看的 `plain&#x20;text` 标签。
        // 代码内容(i+1..j)与闭合围栏行原样保留,只重写开栏首行的语言部分。
        const openLine = lines[i] ?? '';
        // 与 matchFenceOpen 同一条正则(B3-6):缩进围栏在此若认不出,marker/lang 双双回退默认值,
        // 语言标记被静默吞掉。规范化后的开栏行不带前导缩进(块内容原样保留)。
        const fm = RE_FENCE_LINE.exec(openLine);
        const marker = fm?.[1] ?? '```';
        const lang = normalizeCodeInfo(fm?.[2] ?? '');
        const markdown = [marker + lang, ...lines.slice(i + 1, j + 1)].join('\n');
        blocks.push({ kind: 'atomic', entityType: 'MARKDOWN', data: { markdown } });
        i = j + 1;
        continue;
      }
      // 未闭合:视为普通文本,继续走后续块级逻辑处理本行(不 continue)
    }

    // 1.5 块级数学公式 `$$…$$` → LATEX atomic(真机 dump 确认 X 原生渲染,公式写进块 text)。
    //      放在围栏之后(围栏内的 `$$` 已被上面吃掉、不解析)、其余 atomic 之前(同级块元素)。
    //      单行 `$$ x $$` 就地成块;多行则向下找裸 `$$` 闭合行(闭合行须顶格、去空白后恰为 `$$`)。
    //      **找不到闭合 → 回退**当普通文本(不 continue,与未闭合围栏一致);`$$100 涨到` 这类
    //      行内双美元被 matchMathOpen 判 null,天然不进这里。
    const mathOpen = matchMathOpen(line);
    if (mathOpen === 'single') {
      // `$$ 公式 $$`:剥首尾 `$$`,中间为公式原文(matchMathOpen 已确保中间非空)。
      // 先 trimEnd 再切:否则收尾 `$$` 后的尾随空白会把 `slice(-2)` 顶偏、切出 `x $$` 脏结果。
      const formula = line.trimEnd().slice(2, -2).trim();
      blocks.push({ kind: 'atomic', entityType: 'LATEX', data: {}, text: formula });
      i += 1;
      continue;
    }
    if (mathOpen === 'multi') {
      let j = i + 1;
      let closed = false;
      while (j < lines.length) {
        // 闭合行:顶格 `$$`、去尾随空白后恰为 `$$`(不含额外内容)。
        if ((lines[j] ?? '').startsWith('$$') && (lines[j] ?? '').slice(2).trim() === '') {
          closed = true;
          break;
        }
        j += 1;
      }
      if (closed) {
        // 公式体 = 起行 `$$` 之后到闭合行之前的所有行(保留内部换行,原样交 X 渲染)。
        // multi 形态的起行仅含 `$$`(matchMathOpen 保证其后仅空白),故公式体就是中间各行。
        const inner = lines.slice(i + 1, j).join('\n').trim();
        // 空公式(`$$\n$$`)不产 LATEX 块,回退当普通文本(不 continue)。
        if (inner !== '') {
          blocks.push({ kind: 'atomic', entityType: 'LATEX', data: {}, text: inner });
          i = j + 1;
          continue;
        }
      }
      // 未闭合 / 空公式:回退,本行按普通文本继续走后续逻辑(不 continue)。
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
    const linkedImage = trimmed.match(RE_LINKED_IMAGE_LINE);
    if (linkedImage) {
      const alt = linkedImage[1] ?? '';
      const src = normalizeImageSrc(linkedImage[2] ?? ''); // 内层图片 URL(剥 `<>`);外层链接(组3)丢弃
      blocks.push({ kind: 'image', source: src, alt, fallbackText: trimmed });
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
      const content = (heading[2] ?? '').replace(/\s+#+\s*$/, '').trim(); // 去掉可选的 ATX 闭合 ###
      const inline = walkInline(content);
      let type: TextBlockType;
      if (level <= 2) {
        type = 'header-one';
      } else if (level === 3) {
        type = 'header-two';
      } else {
        type = 'unstyled';
        if (inline.text.length > 0) {
          inline.inlineStyleRanges.push({ offset: 0, length: inline.text.length, style: 'BOLD' });
        }
      }
      blocks.push(textBlock(type, inline));
      i += 1;
      continue;
    }

    // 6. 引用:逐行独立成块(不合并多行)
    if (RE_BLOCKQUOTE.test(line)) {
      const content = line.replace(/^ {0,3}>\s?/, ''); // 前导缩进与 RE_BLOCKQUOTE 同步剥掉(B3-6)
      blocks.push(textBlock('blockquote', walkInline(content)));
      i += 1;
      continue;
    }

    // 7. 无序列表(支持嵌套:前导缩进 → depth;缩进门槛见 canBeListItem)
    const ul = line.match(RE_UL);
    if (ul && canBeListItem(listIndents, ul[1] ?? '')) {
      const depth = listDepth(listIndents, indentWidth(ul[1] ?? ''));
      blocks.push(taskAwareListBlock('unordered-list-item', ul[2] ?? '', depth));
      i += 1;
      continue;
    }

    // 8. 有序列表(支持嵌套,与无序共用同一缩进栈——混合嵌套 `- 一级 / 1. 二级` 层级正确)
    const ol = line.match(RE_OL);
    if (ol && canBeListItem(listIndents, ol[1] ?? '')) {
      const depth = listDepth(listIndents, indentWidth(ol[1] ?? ''));
      blocks.push(taskAwareListBlock('ordered-list-item', ol[2] ?? '', depth));
      i += 1;
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
    const paraText = para.map(stripParagraphIndent).join('\n');

    // setext 标题:段落正下方紧跟 `===` / `---` → 整段升格为标题,并吃掉下划线行。
    // 放在段落收集**之后**判定,天然支持多行 setext 正文;也天然让 `---` 在此处
    // 优先当下划线而非分割线(CommonMark 同序:有前置段落时 setext 胜出)。
    // 级别映射与 ATX 一致:一级/二级同归 header-one(X 只有两级标题,见 TextBlockType)。
    if (k < lines.length && setextUnderlineLevel(lines[k] ?? '') !== null) {
      blocks.push(textBlock('header-one', walkInline(paraText)));
      i = k + 1;
      continue;
    }

    blocks.push(textBlock('unstyled', walkInline(paraText)));
    i = k;
  }

  return blocks;
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
 * `interrupting`:仅段落收集循环传 true(该行要去打断一个已开启的段落),影响有序列表判定,
 * 见 isTopLevelListLine。`isParagraphLine` 等「块首语境」的消费方保持默认 false,
 * 口径与主循环块首的列表分支一致(不制造「parser 认列表、extractTitle 认标题」的分裂)。
 */
function isBlockBoundary(line: string, interrupting = false): boolean {
  if (line.trim() === '') return true;
  if (matchFenceOpen(line)) return true;
  if (RE_DIVIDER.test(line)) return true;
  if (matchMathOpen(line) !== null) return true;
  if (RE_TWEET.test(line.trim())) return true; // trim 与主循环的推文分支同源(B3-2)
  if (matchImageLine(line.trim()) !== null) return true;
  if (RE_LINKED_IMAGE_LINE.test(line.trim())) return true;
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
 */
function normalizeImageSrc(raw: string): string {
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
 */
function matchImageLine(line: string): { alt: string; src: string } | null {
  const head = RE_IMAGE_LINE_HEAD.exec(line);
  if (!head) return null;
  const alt = head[1] ?? '';
  const urlStart = head[0].length; // src 起点:紧跟开括号 `(` 之后
  let depth = 1;
  let i = urlStart;
  while (i < line.length) {
    const ch = line[i];
    if (ch === '\\') {
      i += 2; // 转义:连同下一字符跳过,不参与括号计数
      continue;
    }
    // CommonMark:destination 用 `<...>` 包裹时,尖括号内整体是 URL(可含空格 / `)`),内部字符
    // 不参与括号配对——直接跳到匹配的 `>`,避免路径里的 `)` 被误判为 destination 闭合。
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
      if (depth === 0) break; // 找到与开括号配对的闭括号
    }
    i += 1;
  }
  if (depth !== 0) return null; // 括号未闭合
  if (i !== line.length - 1) return null; // 闭合 `)` 之后仍有字符 → 一行多图 / 尾随文本,不认作图片行
  const src = normalizeImageSrc(line.slice(urlStart, i));
  if (src === '') return null; // 空 src 不产出 ImageBlock
  return { alt, src };
}

/**
 * 识别开栏:3+ 个 ` 或 ~;反引号围栏的信息串不得含反引号(否则非合法开栏)。
 * 允许 0-3 空格缩进(B3-6):**必须与 matchFenceClose、以及主循环里 info 规范化的正则
 * 三处同改**——漏任一处就会「语言标记丢失」或「闭栏认不出、整段吞进正文」。
 */
function matchFenceOpen(line: string): Fence | null {
  const m = line.match(RE_FENCE_LINE);
  if (!m) return null;
  const marker = m[1] ?? '';
  const info = m[2] ?? '';
  const char = marker[0] ?? '`';
  if (char === '`' && info.includes('`')) return null;
  return { char, len: marker.length };
}

/** 识别闭栏:同字符、数量 ≥ 开栏、其后仅允许空白(`\s`:含全角空格 U+3000,CJK 输入法
 * 易在行尾带出——收窄成 `[ \t]` 会让这类闭栏失效、整段代码块散架,review 修复);缩进规则与开栏同(B3-6)。 */
function matchFenceClose(line: string, fence: Fence): boolean {
  const m = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
  if (!m) return false;
  const marker = m[1] ?? '';
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
      const link = matchLink(src, i);
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

    // ***x*** 粗+斜
    if (src.startsWith('***', i)) {
      const close = findClosing(src, i + 3, '***');
      if (close > i + 3) {
        wrap(i + 3, close, close + 3, ['BOLD', 'ITALIC']);
        continue;
      }
    }
    // **x** 粗
    if (src.startsWith('**', i)) {
      const close = findClosing(src, i + 2, '**');
      if (close > i + 2) {
        wrap(i + 2, close, close + 2, ['BOLD']);
        continue;
      }
    }
    // ~~x~~ 删除线
    if (src.startsWith('~~', i)) {
      const close = findClosing(src, i + 2, '~~');
      if (close > i + 2) {
        wrap(i + 2, close, close + 2, ['STRIKETHROUGH']);
        continue;
      }
    }
    // *x* 斜体
    if (ch === '*') {
      const close = findClosing(src, i + 1, '*');
      if (close > i + 1) {
        wrap(i + 1, close, close + 1, ['ITALIC']);
        continue;
      }
    }
    // _x_ 斜体:规避 snake_case 词内下划线(左右侧不得紧贴字母数字)
    if (ch === '_' && !isWordChar(src[i - 1])) {
      const close = findClosing(src, i + 1, '_');
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

/**
 * 从 start 处向后寻找闭合定界符 delim,返回其起始下标(找不到 -1)。
 * 扫描时跳过行内代码(代码优先);对单字符定界符(* / _)跳过更长的同字符连续段
 * (避免把 ** 中的星号误判为 * 的闭合)。
 */
function findClosing(src: string, start: number, delim: string): number {
  const single = delim.length === 1;
  const dch = delim[0] ?? '';
  let i = start;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '`') {
      const cs = matchCodeSpan(src, i);
      i = cs ? cs.end : i + 1;
      continue;
    }
    if (single) {
      if (ch === dch) {
        let run = 1;
        while (src[i + run] === dch) run += 1;
        if (run === 1) return i;
        i += run;
        continue;
      }
      i += 1;
      continue;
    }
    if (src.startsWith(delim, i)) return i;
    i += 1;
  }
  return -1;
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

/** 是否为 ASCII 字母或数字(用于下划线斜体的词内规避)。 */
function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9]/.test(ch);
}
