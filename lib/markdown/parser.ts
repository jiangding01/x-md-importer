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

import type { ImportBlock, InlineStyleRange, LinkRange, TextBlockType } from '../bridge/protocol';

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

const RE_DIVIDER = /^(-{3,}|\*{3,})$/;
const RE_TWEET = /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[^/]+\/status\/(\d+)\/?$/;
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
const RE_HEADING = /^(#{1,6})\s+(.*)$/;
const RE_BLOCKQUOTE = /^>/;
const RE_UL = /^[-*+]\s+(.*)$/;
const RE_OL = /^\d+\.\s+(.*)$/;
/**
 * GFM 表格分隔行(表头下方那行):每列 `:?-+:?`,列间 `|`。要求本行**含 `|` 且含 `-`**——
 * 这样纯 `---`/`***` 分割线(不含 `|`)不会被当成表格分隔,与 DIVIDER 不冲突。
 */
const RE_TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const isTableSeparator = (line: string): boolean =>
  line.includes('|') && line.includes('-') && RE_TABLE_SEP.test(line);

/** ASCII 标点集合:反斜杠转义仅在其后紧跟 ASCII 标点时生效(字母/CJK 前的反斜杠保留原样)。 */
const RE_PUNCT = /[!-/:-@[-`{-~]/;

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/** 是否为独占一行的图片(裸 `![](x)` / 带链接 `[![](x)](y)` / Obsidian `![[x]]`)。 */
export function isImageLine(line: string): boolean {
  const t = line.trim();
  return matchImageLine(t) !== null || RE_LINKED_IMAGE_LINE.test(t) || RE_OBSIDIAN_IMAGE_LINE.test(t);
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
 */
export function forEachContentLine(
  lines: string[],
  visitor: (line: string, index: number) => boolean | void,
): void {
  let i = 0;
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
}

// 解析开关:parseMarkdown **同步执行**(内部无 await)、JS 单线程不会重入,故用模块级标志
// 在入口一次性设置,免去给 walkInline / isBlockBoundary 逐层穿参。仅 parseMarkdown 写、
// 块级/行内解析只读。
let optObsidianImg = true;
let optWikilink = true;

/** 解析 Markdown 文本为按文档顺序排列的写入块序列。 */
export function parseMarkdown(md: string, opts: ParseOptions = {}): ImportBlock[] {
  optObsidianImg = opts.obsidianImg ?? true;
  optWikilink = opts.wikilink ?? true;
  const lines = md.split(/\r?\n/);
  const blocks: ImportBlock[] = [];
  let i = 0;

  // 跳过文首 YAML frontmatter(--- … ---):仅当**第一行即为顶格 ---** 且后续存在顶格闭合 --- 时触发,
  // 从闭合行之后开始正文解析。frontmatter 的 title/cover 由 lib/markdown/frontmatter.ts 单独抽取,
  // 不进正文——否则会被误当「分割线 + 文本 + 分割线」写入(正文中间的 --- 分割线不受影响)。
  // 判定用「顶格 ^---」而非 trim,与 frontmatter.ts 的抽取正则一致——否则缩进的 `  ---`
  // 会出现「parser 剥离了但 extractTitle 抽不到 → 标题静默丢失」的不一致。
  // 闭合 --- 必须出现在**首个空行之前**(frontmatter 体不含空行):否则文首装饰性 `---\n\n正文\n\n---`
  // 会把中间正文当 frontmatter 静默吞掉。此判定须与 frontmatter.ts 的 frontmatterBody 完全对齐。
  const isFmDelim = (line: string) => /^---[ \t]*$/.test(line);
  if (isFmDelim(lines[0] ?? '')) {
    for (let j = 1; j < lines.length; j += 1) {
      const l = lines[j] ?? '';
      if (isFmDelim(l)) {
        i = j + 1;
        break;
      }
      if (l.trim() === '') break; // 首个空行前未闭合 → 非 frontmatter,首行 --- 交后续按分割线处理
    }
  }

  while (i < lines.length) {
    const line = lines[i] ?? '';

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
        const fm = /^(`{3,}|~{3,})(.*)$/.exec(openLine);
        const marker = fm?.[1] ?? '```';
        const lang = normalizeCodeInfo(fm?.[2] ?? '');
        const markdown = [marker + lang, ...lines.slice(i + 1, j + 1)].join('\n');
        blocks.push({ kind: 'atomic', entityType: 'MARKDOWN', data: { markdown } });
        i = j + 1;
        continue;
      }
      // 未闭合:视为普通文本,继续走后续块级逻辑处理本行(不 continue)
    }

    // 2. 分割线
    if (RE_DIVIDER.test(line)) {
      blocks.push({ kind: 'atomic', entityType: 'DIVIDER', data: {} });
      i += 1;
      continue;
    }

    // 3. 推文(独占一行的裸 URL);url 规范化为 twitter.com/i/web 形式(xposter 实证)
    const tweet = line.match(RE_TWEET);
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
      const content = line.replace(/^>\s?/, '');
      blocks.push(textBlock('blockquote', walkInline(content)));
      i += 1;
      continue;
    }

    // 7. 无序列表(单层,行首无缩进;缩进视为嵌套 → 落到段落按普通文本)
    const ul = line.match(RE_UL);
    if (ul) {
      blocks.push(textBlock('unordered-list-item', walkInline(ul[1] ?? '')));
      i += 1;
      continue;
    }

    // 8. 有序列表(单层)
    const ol = line.match(RE_OL);
    if (ol) {
      blocks.push(textBlock('ordered-list-item', walkInline(ol[1] ?? '')));
      i += 1;
      continue;
    }

    // 9. 段落:收集连续的非边界行(遇空行或任一块级起始行即止),合并为一个 unstyled 块
    const para: string[] = [line];
    let k = i + 1;
    while (k < lines.length) {
      const next = lines[k] ?? '';
      if (isBlockBoundary(next)) break;
      // 表格开始(当前行含 `|` 且下一行是分隔行):停止段落收集,交主循环的表格分支处理,
      // 否则紧跟正文段落后、无空行分隔的表格会被段落吞掉。
      if (next.includes('|') && isTableSeparator(lines[k + 1] ?? '')) break;
      para.push(next);
      k += 1;
    }
    blocks.push(textBlock('unstyled', walkInline(para.join('\n'))));
    i = k;
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// 块级辅助
// ---------------------------------------------------------------------------

/** 由行内解析结果组装一个 TextBlock。 */
function textBlock(type: TextBlockType, inline: InlineResult): ImportBlock {
  return {
    kind: 'text',
    type,
    text: inline.text,
    inlineStyleRanges: inline.inlineStyleRanges,
    links: inline.links,
  };
}

/** 段落边界:空行,或任一块级元素的起始行——段落收集到这些行前停止。 */
function isBlockBoundary(line: string): boolean {
  if (line.trim() === '') return true;
  if (matchFenceOpen(line)) return true;
  if (RE_DIVIDER.test(line)) return true;
  if (RE_TWEET.test(line)) return true;
  if (matchImageLine(line.trim()) !== null) return true;
  if (RE_LINKED_IMAGE_LINE.test(line.trim())) return true;
  if (optObsidianImg && RE_OBSIDIAN_IMAGE_LINE.test(line.trim())) return true;
  if (RE_HEADING.test(line)) return true;
  if (RE_BLOCKQUOTE.test(line)) return true;
  if (RE_UL.test(line)) return true;
  if (RE_OL.test(line)) return true;
  return false;
}

/**
 * 规范化图片 destination(CommonMark 语义):
 *  - `<...>` 包裹 → 剥尖括号,**尖括号内整体为路径**(保留空格——本地图路径含空格很常见,如
 *    `<images/a b.png>`;URL 含空格时 CommonMark 要求必须用 `<>` 包裹),忽略 `>` 之后的可选 title;
 *  - 未包裹 → 去首尾空白后原样返回(保持既有行为)。
 * 注:与行内链接的 normalizeUrl 有意不同——图片**不做**「截到第一个空白」,否则会切断含空格的本地路径。
 */
function normalizeImageSrc(raw: string): string {
  const s = raw.trim();
  if (s.startsWith('<')) {
    const end = s.indexOf('>');
    if (end >= 0) return s.slice(1, end); // 尖括号内原样(不 trim:空格是路径的一部分)
  }
  return s;
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

/** 识别开栏:3+ 个 ` 或 ~;反引号围栏的信息串不得含反引号(否则非合法开栏)。 */
function matchFenceOpen(line: string): Fence | null {
  const m = line.match(/^(`{3,}|~{3,})(.*)$/);
  if (!m) return null;
  const marker = m[1] ?? '';
  const info = m[2] ?? '';
  const char = marker[0] ?? '`';
  if (char === '`' && info.includes('`')) return null;
  return { char, len: marker.length };
}

/** 识别闭栏:同字符、数量 ≥ 开栏、其后仅允许空白。 */
function matchFenceClose(line: string, fence: Fence): boolean {
  const m = line.match(/^(`{3,}|~{3,})\s*$/);
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
