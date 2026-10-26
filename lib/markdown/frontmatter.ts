/**
 * 标题抽取(M2)。纯函数、零依赖、named export。
 *
 * 抽取优先级(对齐 docs/research/xposter-analysis.md §8.1):
 *   frontmatter title > 正文第一个 H1。
 * 仅做「简易」frontmatter 解析——文首 `---\n...\n---` 块内逐行匹配
 * `title:` / `Title:` / `标题:`,不支持嵌套 YAML、不支持多行值。
 */

import type { ImportBlock } from '../bridge/protocol';
import {
  frontmatterBodyStart,
  inlinePlainText,
  matchFenceOpen,
  matchImageLine,
  matchLinkedImageLine,
  parseMarkdownWithMeta,
  RE_OBSIDIAN_IMAGE_LINE,
  type HeadingInfo,
  type ParseOptions,
} from './parser';

/** 抽取结果:命中标题及其来源(供上层决定是否从正文移除 H1)。 */
export interface ExtractedTitle {
  title: string;
  source: 'frontmatter' | 'h1';
}

/** YAML 双引号值里的单字符转义(第二批 P7)。 */
const YAML_DQ_ESCAPES: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', n: '\n', t: '\t', r: '\r', '0': '\0' };

/** 解码 YAML 双引号值的转义:单字符表 + `\xXX` / `\uXXXX`;未知转义原样保留(不抛错、不吞字符)。 */
function decodeYamlDoubleQuoted(body: string): string {
  return body.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|.)/g, (m, e: string) => {
    if (e.length > 1) return String.fromCharCode(parseInt(e.slice(1), 16));
    return YAML_DQ_ESCAPES[e] ?? m;
  });
}

/**
 * 去掉值两端空白后,再剥掉成对的单/双引号(仅一层)并按 YAML 规则解码转义(第二批 P7):单引号值里
 * `''` → `'`,双引号值里 `\"` `\\` `\n` `\uXXXX` 等;此前只剥引号,`'It''s fine'` 写进 X 的标题是
 * `It''s fine`。无引号值原样返回(YAML 里无引号值不处理转义)。
 */
function stripQuotes(raw: string): string {
  const v = raw.trim();
  if (v.length >= 2) {
    const first = v[0];
    const last = v[v.length - 1];
    // 解码出的控制字符(`\n`、`\x00` …)换成空格:标题 / 封面路径都是单行值,换行、NUL 写进 X 标题框只会出错。
    if (first === '"' && last === '"') return decodeYamlDoubleQuoted(v.slice(1, -1)).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    if (first === "'" && last === "'") return v.slice(1, -1).replace(/''/g, "'").trim();
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
 * 从解析主循环上报的标题里挑出**可作文章标题**的那个(P3 单一来源;P4 起与「去标题块」共用):
 * 标题判定(围栏 / 公式 / 列表 lazy 续行 / setext / frontmatter 跳过)全部与 parseMarkdown 同源,
 * 不再有自己的段落行 / 下划线 / standalone 启发式——那套第二实现曾造成「`- item\n标题\n===` 正文是
 * 列表、却被抽成标题」、「`$$` 公式里的 `# x` 被抽成标题并删坏公式」等分裂(HANDOFF §8 同类教训)。
 *
 * 取第一个满足条件的标题:ATX 一级(`#`;`##` 虽同样映射为 header-one 但不作文章标题),或**单行**
 * setext `===`(正文 1 行 + 下划线 1 行,end − start === 2)——多行 setext 时标题该取整段,这类写法
 * 极罕见,维持「不认」的既有取舍(标题留在正文,不误伤);且纯文本非空。纯文本按写法区分:ATX 用
 * inlinePlainText(raw)(剥闭合井号),setext 用 `atxClosing: false`(`标题 #\n===` 的标题是「标题 #」)。
 * setext 文本是开栏行(未闭合的 ``` / `~~~`)或 `$$` 时跳过、继续找下一个(L1):正文确实把它渲染成
 * 标题「```」,但那是未闭合起行的副产物,不是作者意图的文章标题。只少抽、不改正文解析。
 */
function pickTitleHeading(headings: HeadingInfo[]): (HeadingInfo & { title: string }) | null {
  for (const h of headings) {
    if (h.level !== 1) continue;
    if (h.kind === 'setext' && h.end - h.start !== 2) continue;
    if (h.kind === 'setext' && (matchFenceOpen(h.raw.trim()) !== null || h.raw.trim() === '$$')) continue; // L1
    const title = h.kind === 'atx' ? inlinePlainText(h.raw) : inlinePlainText(h.raw, { atxClosing: false });
    if (title.length > 0) return { ...h, title };
  }
  return null;
}

/**
 * 正文首个可作文章标题的一级标题(见 pickTitleHeading)。
 * `opts` 为解析开关(P7):标题判定随之与实际解析一致(如 obsidianImg 决定 `![[a.png]]\n标题\n===`
 * 是图片 + 单行 setext 还是多行 setext)。extractTitle 与 parseMarkdownWithoutTitle 共用它,
 * 保证「抽为标题的那个」与「从正文去掉的那个」是同一个块。
 */
function fromH1(md: string, opts: ParseOptions): string | null {
  return pickTitleHeading(parseMarkdownWithMeta(md, opts).headings)?.title ?? null;
}

/**
 * 解析正文并去掉被抽为文章标题的那个 H1 块(`h1Handle=remove` 用,P4)。**按块下标去除**:一次解析,
 * 其余块与 parseMarkdown(md) 逐一相同。旧 stripFirstH1 在 md 文本层删源行再重解析,删行会让相邻行
 * 重新拼接——`# 标题\n---\n作者\n---` 删后首行 `---` 被当 frontmatter、`导语\n# 标题\n正文` 两段
 * 合并、标题后的正文被吸进前面的列表项。是否该去(标题来源是 h1 而非 frontmatter)由调用方判定。
 * `opts` 须与 extractTitle 传同一份,去掉的才是抽出的那个标题。
 */
export function parseMarkdownWithoutTitle(md: string, opts: ParseOptions = {}): ImportBlock[] {
  return parseMarkdownWithoutTitleMeta(md, opts).blocks;
}

/** 同 parseMarkdownWithoutTitle,另带回被丢弃的 HTML 注释块数(能力面板按「实际写入」计数用,第三批 P11)。 */
export function parseMarkdownWithoutTitleMeta(md: string, opts: ParseOptions = {}): { blocks: ImportBlock[]; htmlComments: number } {
  const analysis = analyzeDraft(md, opts);
  return { blocks: blocksWithoutTitle(analysis), htmlComments: analysis.htmlComments };
}

/**
 * 一次解析的全部产出(第三批 C2 / O1):写入流程与侧边栏的标题、正文块、去标题块、能力计数都取自同一份,
 * 不再各自重解析全文(160 KB 文档每遍约 30 ms)。**只读**——多个消费方共享同一对象,不得原地修改 blocks。
 */
export interface DraftAnalysis {
  blocks: ImportBlock[];
  headings: HeadingInfo[];
  htmlComments: number;
  /** 文章标题:frontmatter 优先,其次正文首个可作标题的一级标题(与 extractTitle 同一判定)。 */
  title: ExtractedTitle | null;
  /** 正文里可作标题的那个一级标题块的下标;与 title 来源无关(frontmatter 标题时也照记),去不去由调用方定。 */
  titleHeadingIndex: number | null;
  /** 产出这份结果所用的解析开关(能力面板的任务列表说明随 taskList 变化)。 */
  parseOpts: ParseOptions;
}

export function analyzeDraft(md: string, opts: ParseOptions = {}): DraftAnalysis {
  const { blocks, headings, htmlComments } = parseMarkdownWithMeta(md, opts);
  const h = pickTitleHeading(headings);
  const fm = fromFrontmatter(md);
  const title: ExtractedTitle | null =
    fm !== null ? { title: fm, source: 'frontmatter' } : h ? { title: h.title, source: 'h1' } : null;
  return { blocks, headings, htmlComments, title, titleHeadingIndex: h ? h.blockIndex : null, parseOpts: opts };
}

/** 去掉被抽为文章标题的那个一级标题块(按块下标,P4);是否该去(标题来源为 h1)由调用方判定。 */
export function blocksWithoutTitle(analysis: DraftAnalysis): ImportBlock[] {
  const idx = analysis.titleHeadingIndex;
  return idx === null ? analysis.blocks : analysis.blocks.filter((_, i) => i !== idx);
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
