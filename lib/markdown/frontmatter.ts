/**
 * 标题抽取(M2)。纯函数、零依赖、named export。
 *
 * 抽取优先级(对齐 docs/research/xposter-analysis.md §8.1):
 *   frontmatter title > 正文第一个 H1。
 * 仅做「简易」frontmatter 解析——文首 `---\n...\n---` 块内逐行匹配
 * `title:` / `Title:` / `标题:`,不支持嵌套 YAML、不支持多行值。
 */

import {
  forEachContentLine,
  frontmatterBodyStart,
  inlinePlainText,
  matchFenceOpen,
  matchImageLine,
  matchLinkedImageLine,
  RE_OBSIDIAN_IMAGE_LINE,
  type ParseOptions,
} from './parser';

/** 抽取结果:命中标题及其来源(供上层决定是否从正文移除 H1)。 */
export interface ExtractedTitle {
  title: string;
  source: 'frontmatter' | 'h1';
}

/** 去掉值两端空白后,再剥掉成对的单/双引号(仅一层)。 */
function stripQuotes(raw: string): string {
  const v = raw.trim();
  if (v.length >= 2) {
    const first = v[0];
    const last = v[v.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return v.slice(1, -1).trim();
    }
  }
  return v;
}

/**
 * 取文首 frontmatter 块的原文(独占行 `---` 包裹);无则 null。
 * 闭合 `---` 必须出现在**首个空行之前**(frontmatter 体不含空行)——须与 parser.ts 的
 * parseMarkdown 文首跳过判定完全对齐,否则文首装饰性 `---\n\n正文\n\n---` 会被这里当成
 * frontmatter(把「正文」误抽为 title/cover),而 parser 却按分割线+正文处理,两边漂移。
 */
function frontmatterBody(md: string): string | null {
  // 判定完全委托 parser.frontmatterBodyStart(review 修复:此前这里是靠注释纪律手工对齐的
  // 第二套实现——B3-7 刚消灭了 Preview 里的第三套,这里没道理再留一套)。
  // 返回值约定:0=无 frontmatter;否则为闭合 `---` 的下一行 → 体 = 行 1 ~ start-2。
  const lines = md.split(/\r?\n/);
  const start = frontmatterBodyStart(lines);
  if (start === 0) return null;
  return lines.slice(1, start - 1).join('\n');
}

/**
 * YAML 行内注释剥离(B3-9 / P2-11)。**只给 title 用**——cover 共用 stripQuotes,
 * 若在那里也剥,`cover: assets/图 #1.png` 这类合法路径会被截断。
 *
 * 按 YAML 规则:`#` 只有在**前面有空白**时才开启注释,且**加引号的值内不认注释**。
 * 传入的是**未 trim 的原始值**(`key:` 之后的整串),前导空白是判定 `title: # 注释`
 * (值为空)所必需的。
 */
function stripInlineComment(raw: string): string {
  const trimmed = raw.trim();
  const quote = trimmed[0];
  if (quote === '"' || quote === "'") {
    // 找**真正的**闭引号(review 修复):双引号内 `\"` 是转义、单引号内 `''` 是转义——
    // naive indexOf 会把首个内嵌引号当闭合,`"He said \"hi\" ok"` 被截成 `He said \`。
    // 引号内的 `#` 是标题的一部分;真闭引号之后的内容(通常是 ` # 注释`)丢弃。
    for (let i = 1; i < trimmed.length; i += 1) {
      const ch = trimmed[i];
      if (quote === '"' && ch === '\\') {
        i += 1; // 跳过被转义的下一个字符
        continue;
      }
      if (ch === quote) {
        if (quote === "'" && trimmed[i + 1] === "'") {
          i += 1; // `''` = 单引号值内的字面量引号,继续找
          continue;
        }
        return trimmed.slice(0, i + 1);
      }
    }
    return trimmed; // 未闭合:原样返回,交 stripQuotes 按既有规则兜底
  }
  const m = /\s#/.exec(raw);
  return m ? raw.slice(0, m.index).trim() : trimmed;
}

/**
 * YAML block scalar 的起始标记(`>` / `|`,可带缩进指示与 chomping 修饰):值在**下面几行**,
 * 本行取到的只是标记本身。此前直接当标题用,产出 `">"` 这种垃圾标题;现视为未命中(回落 H1)——
 * 多行标题不在本模块的「简易 frontmatter」支持范围内,宁可回落也不写错。
 */
const RE_BLOCK_SCALAR = /^[>|][0-9]*[-+]?$/;

/**
 * 在 frontmatter 里按 key 列表取第一个命中的值(去引号);无 / 空 → null。
 * `titleSemantics`(B3-9):仅 title 分支启用的 YAML 语义——剥行内注释 + 拒绝 block scalar 标记。
 */
function frontmatterValue(
  md: string,
  keys: readonly string[],
  opts: { titleSemantics?: boolean } = {},
): string | null {
  const body = frontmatterBody(md);
  if (body === null) return null;
  const keyRe = new RegExp(`^(${keys.join('|')})[ \\t]*:(.*)$`);
  for (const line of body.split(/\r?\n/)) {
    const kv = keyRe.exec(line);
    if (kv) {
      const raw = kv[2] ?? '';
      const shaped = opts.titleSemantics ? stripInlineComment(raw) : raw;
      // block scalar 判定在**剥引号之前**:加了引号的 `title: ">"` 按 YAML 是字面量 `>`,不是标记。
      if (opts.titleSemantics && RE_BLOCK_SCALAR.test(shaped)) return null;
      const value = stripQuotes(shaped);
      return value.length > 0 ? value : null;
    }
  }
  return null;
}

/** 从文首 frontmatter 块解析 title;无块 / 无命中 / 值为空 / block scalar → null。 */
function fromFrontmatter(md: string): string | null {
  return frontmatterValue(md, ['title', 'Title', '标题'], { titleSemantics: true });
}

/**
 * wiki 语法 `[[path|alt]]` 剥壳后取**路径部分**(B3-10 / P2-12):`|` 之后是图注/尺寸,
 * 不切分则封面按 `path|alt` 去查找必然失败,且与 parser 对同一语法的处理(块级 `![[x|alt]]`)分裂。
 */
function wikiTarget(inner: string): string {
  return (inner.split('|')[0] ?? '').trim();
}

/**
 * 从文首 frontmatter 解析封面 `cover`;支持 Obsidian 的 `![[x]]`(嵌入)、`[[x]]`(内链,无 `!`)、
 * `![](x)` / `[![](x)](y)` 包裹写法(剥壳)。无 → null。仅解析 frontmatter,正文首图由上层用块级图兜底。
 *
 * 判定按**整值**进行(P6),与正文「整行恰为一张图」同口径,复用 parser 的整行匹配(不再用贪婪正则——
 * 旧版 `![a](x.png) ![b](y.png)` 会被吞成 `x.png) ![b](y.png`、两个 wiki 链接被吞成一个畸形路径):
 *  1. **wiki 优先**:以 `![[` / `[[` 开头 → 整值恰为一个 wiki 链接则取路径(`|` 之后的图注/尺寸
 *     由 wikiTarget 切掉),否则 null;
 *  2. 以 `![` / `[![` 开头 → 整值恰为一张图(裸 / 带链接)则取地址(已经 normalizeImageSrc 剥 `<>`
 *     与可选 title,A6),否则(两张图、畸形)null;
 *  3. 其余 → 按原样作为路径(`assets/图 #1.png` 等合法路径不受影响)。
 */
export function extractCover(md: string): string | null {
  const raw = frontmatterValue(md, ['cover', 'Cover', '封面']);
  if (raw === null) return null;
  if (raw.startsWith('![[') || raw.startsWith('[[')) {
    // 复用正文的 `![[x]]` 整行判定;无 `!` 的内链补上 `!` 后同口径(等价于 /^!?\[\[([^\]]+)\]\]$/)。
    const wiki = RE_OBSIDIAN_IMAGE_LINE.exec(raw.startsWith('!') ? raw : `!${raw}`);
    return wiki ? wikiTarget(wiki[1] ?? '') : null;
  }
  if (raw.startsWith('![') || raw.startsWith('[![')) {
    return (matchImageLine(raw) ?? matchLinkedImageLine(raw))?.src ?? null;
  }
  return raw;
}

/**
 * 正文首个可作文章标题的一级标题:取解析主循环经 forEachContentLine.onHeading 上报的标题(P3),
 * 返回其源行半开区间 `[start, end)` 与纯文本标题。**单一来源**:标题判定(围栏 / 公式 / 列表 lazy
 * 续行 / setext / frontmatter 跳过)全部与 parseMarkdown 同源,不再有自己的段落行 / 下划线 /
 * standalone 启发式——那套第二实现曾造成「`- item\n标题\n===` 正文是列表、却被抽成标题」、
 * 「`$$` 公式里的 `# x` 被抽成标题并被 stripFirstH1 删坏公式」等分裂(HANDOFF §8 同类教训)。
 *
 * 取第一个满足条件的标题:ATX 一级(`#`;`##` 虽同样映射为 header-one 但不作文章标题),或**单行**
 * setext `===`(正文 1 行 + 下划线 1 行,end − start === 2)——多行 setext 正文时标题该取整段,
 * stripFirstH1 按区间删虽可行但这类写法极罕见,维持「不认」的既有取舍(标题留在正文,不误伤);
 * 且纯文本非空。纯文本按写法区分:ATX 用 inlinePlainText(raw)(剥闭合井号),setext 用
 * `atxClosing: false`(`标题 #\n===` 的标题是「标题 #」)。
 * setext 文本是开栏行(未闭合的 ``` / `~~~`)或 `$$` 时跳过、继续找下一个(L1):正文确实把它渲染成
 * 标题「```」,但那是未闭合起行的副产物,不是作者意图的文章标题。只少抽、不改正文解析,故抽到的
 * 标题仍对应正文中同一源行的 header-one(P3 不变量不受影响)。
 *
 * `opts` 为解析开关(P7):标题判定随之与实际解析一致(如 obsidianImg 决定 `![[a.png]]\n标题\n===`
 * 是图片 + 单行 setext 还是多行 setext),不继承上一次 parseMarkdown 残留的模块级开关。
 * extractTitle 与 stripFirstH1 共用它,保证「抽为标题的那几行」与「从正文移除的那几行」一致。
 */
function findFirstH1(lines: string[], opts: ParseOptions = {}): { start: number; end: number; title: string } | null {
  const headings: Array<{ start: number; end: number; kind: 'atx' | 'setext'; raw: string }> = [];
  // visitor 立即返回 true:这里只要 onHeading(解析主循环在遍历行之前已跑完整篇)。
  // 文首 frontmatter 由 parseLines 自身跳过(与 parseMarkdown 同源),YAML 注释 `# x` 不会被上报。
  forEachContentLine(lines, () => true, {
    obsidianImg: opts.obsidianImg,
    wikilink: opts.wikilink,
    taskList: opts.taskList,
    onHeading: (start, end, level, kind, raw) => {
      if (level !== 1) return;
      if (kind === 'setext' && end - start !== 2) return;
      if (kind === 'setext' && (matchFenceOpen(raw.trim()) !== null || raw.trim() === '$$')) return; // L1
      headings.push({ start, end, kind, raw });
    },
  });
  for (const h of headings) {
    const title = h.kind === 'atx' ? inlinePlainText(h.raw) : inlinePlainText(h.raw, { atxClosing: false });
    if (title.length > 0) return { start: h.start, end: h.end, title };
  }
  return null;
}

/** 从正文抽取第一个 H1(跳过代码块);无则 null。 */
function fromH1(md: string, opts: ParseOptions): string | null {
  return findFirstH1(md.split(/\r?\n/), opts)?.title ?? null;
}

/**
 * 删除正文中「被抽为标题的那一行 H1」(跳过代码块,与 extractTitle 同源)。
 * 在 md 文本层按行删除——而非 blocks 层,因为 parser 把 H1/H2 都映射成 header-one,
 * blocks 层无法区分,按 type 删首个 header-one 会在「H2 在 H1 之前」时删错块。
 * `opts` 为解析开关(P7),须与 extractTitle 传同一份,删的才是抽出的那个标题。
 */
export function stripFirstH1(md: string, opts: ParseOptions = {}): string {
  const lines = md.split(/\r?\n/);
  const found = findFirstH1(lines, opts);
  if (!found) return md;
  // 删标题占用的整个源行区间:ATX 是 1 行,setext 是「正文行 + `===` 下划线」共 2 行
  // (只删 1 行会把下划线孤零零留在正文,再被解析成分割线/段落)。
  lines.splice(found.start, found.end - found.start);
  return lines.join('\n');
}

/**
 * 抽取文章标题。frontmatter 优先,其次正文首个 H1,都没有则返回 null。
 * @param md 原始 Markdown 文本。
 * @param opts 解析开关(P7),与实际写入时 parseMarkdown 用的同一份;不传按默认值。
 */
export function extractTitle(md: string, opts: ParseOptions = {}): ExtractedTitle | null {
  const fm = fromFrontmatter(md);
  if (fm !== null) return { title: fm, source: 'frontmatter' };

  const h1 = fromH1(md, opts);
  if (h1 !== null) return { title: h1, source: 'h1' };

  return null;
}
