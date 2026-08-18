/**
 * 标题抽取(M2)。纯函数、零依赖、named export。
 *
 * 抽取优先级(对齐 docs/research/xposter-analysis.md §8.1):
 *   frontmatter title > 正文第一个 H1。
 * 仅做「简易」frontmatter 解析——文首 `---\n...\n---` 块内逐行匹配
 * `title:` / `Title:` / `标题:`,不支持嵌套 YAML、不支持多行值。
 */

import { forEachContentLine, frontmatterBodyStart, isParagraphLine, setextUnderlineLevel } from './parser';

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
 * `![](x)` 三种包裹写法(剥壳)。无 → null。仅解析 frontmatter,正文首图由上层用块级图兜底。
 */
export function extractCover(md: string): string | null {
  const raw = frontmatterValue(md, ['cover', 'Cover', '封面']);
  if (raw === null) return null;
  // 兼容 ![[assets/x.png]] 包裹(先于 [[x]] 判断,避免被误剥成 !x)
  const wiki = /^!\[\[(.+?)\]\]$/.exec(raw);
  if (wiki) return wikiTarget(wiki[1] ?? '');
  // 兼容 Obsidian 无 ! 的内链 [[assets/x.png]]
  const wikiLink = /^\[\[(.+?)\]\]$/.exec(raw);
  if (wikiLink) return wikiTarget(wikiLink[1] ?? '');
  const md2 = /^!\[[^\]]*\]\((.+)\)$/.exec(raw);
  if (md2) return (md2[1] ?? '').trim();
  return raw;
}

/**
 * 逐行扫描定位「首个位于代码围栏外的一级标题」,返回其行号、**占用行数**与标题。
 * 两种写法都认:ATX `# x`(1 行)与 **setext `x` + `===`**(2 行)。
 * **必须跳过围栏代码块**——否则代码示例里的 `# 注释` 会被误当文章标题(与 parser 一致)。
 * extractTitle 与 stripFirstH1 共用它,保证「抽为标题的那行」与「从正文移除的那行」一致;
 * lineCount 就是为 setext 的两行而加——按 1 行删会把 `===` 下划线孤零零留在正文。
 *
 * setext 只认**一级**(`===`):`---` 是二级,与 ATX 的 `## ` 一样不作文章标题。
 * 判定复用 parser 导出的 `setextUnderlineLevel`/`isParagraphLine`,不另写一套——
 * 否则会出现「parser 认成标题、extractTitle 抽不到」的分裂(HANDOFF §8 记过两次同类教训)。
 */
function findFirstH1(lines: string[]): { index: number; lineCount: number; title: string } | null {
  let found: { index: number; lineCount: number; title: string } | null = null;
  // 复用 parser 的严格围栏遍历(与解析主循环同源):`~~~` 与 ``` 不互闭、闭栏须裸行且数量足够,
  // 代码块内的 `# 注释` 不会被误当文章标题。`/^#\s+/` 只匹配 H1(`## ` 因 `#` 后非空白不命中)。
  // skipFrontmatter(B3-3 / P1-6):文首 YAML 块不参与标题扫描——`# 元数据区` 这类合法 YAML
  // 注释此前会被抽成文章标题,h1Handle=remove 时还从 frontmatter 内部删行。判定与 parser 的
  // frontmatterBodyStart 同源(即与 frontmatterBody 同源),不新开第二套。
  forEachContentLine(lines, (line, index) => {
    // `^ {0,3}` 与 parser 的 RE_HEADING 同步放宽(B3-6):否则缩进一格的 `# 标题` 会出现
    // 「parser 认成标题、extractTitle 抽不到」的分裂。≥4 空格同样不认(缩进代码领域)。
    const h1 = /^ {0,3}#\s+(.+)$/.exec(line);
    if (h1) {
      const title = (h1[1] ?? '').trim();
      if (title.length > 0) {
        found = { index, lineCount: 1, title };
        return true;
      }
    }
    // setext 一级标题:本行是普通段落文本,下一行是 `===`。
    // 额外要求**本行独立成段**(上一行为空/块边界/文首)——多行 setext 正文时,
    // 标题该取整段而非末行,且 stripFirstH1 按固定行数删会删错;这类写法极罕见,
    // 宁可不认(标题留在正文,不误伤),也不做不完整的处理。
    if (isParagraphLine(line) && setextUnderlineLevel(lines[index + 1] ?? '') === 1) {
      const prev = index > 0 ? (lines[index - 1] ?? '') : '';
      const standalone = index === 0 || prev.trim() === '' || !isParagraphLine(prev);
      const title = line.trim();
      if (standalone && title.length > 0) {
        found = { index, lineCount: 2, title };
        return true;
      }
    }
  }, { skipFrontmatter: true });
  return found;
}

/** 从正文抽取第一个 H1(跳过代码块);无则 null。 */
function fromH1(md: string): string | null {
  return findFirstH1(md.split(/\r?\n/))?.title ?? null;
}

/**
 * 删除正文中「被抽为标题的那一行 H1」(跳过代码块,与 extractTitle 同源)。
 * 在 md 文本层按行删除——而非 blocks 层,因为 parser 把 H1/H2 都映射成 header-one,
 * blocks 层无法区分,按 type 删首个 header-one 会在「H2 在 H1 之前」时删错块。
 */
export function stripFirstH1(md: string): string {
  const lines = md.split(/\r?\n/);
  const found = findFirstH1(lines);
  if (!found) return md;
  // 删 found.lineCount 行:ATX 是 1 行,setext 是「正文行 + `===` 下划线」共 2 行
  // (只删 1 行会把下划线孤零零留在正文,再被解析成分割线/段落)。
  lines.splice(found.index, found.lineCount);
  return lines.join('\n');
}

/**
 * 抽取文章标题。frontmatter 优先,其次正文首个 H1,都没有则返回 null。
 * @param md 原始 Markdown 文本。
 */
export function extractTitle(md: string): ExtractedTitle | null {
  const fm = fromFrontmatter(md);
  if (fm !== null) return { title: fm, source: 'frontmatter' };

  const h1 = fromH1(md);
  if (h1 !== null) return { title: h1, source: 'h1' };

  return null;
}
