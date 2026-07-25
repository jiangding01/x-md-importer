/**
 * 标题抽取(M2)。纯函数、零依赖、named export。
 *
 * 抽取优先级(对齐 docs/research/xposter-analysis.md §8.1):
 *   frontmatter title > 正文第一个 H1。
 * 仅做「简易」frontmatter 解析——文首 `---\n...\n---` 块内逐行匹配
 * `title:` / `Title:` / `标题:`,不支持嵌套 YAML、不支持多行值。
 */

import { forEachContentLine, isParagraphLine, setextUnderlineLevel } from './parser';

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
  const lines = md.split(/\r?\n/);
  if (!/^---[ \t]*$/.test(lines[0] ?? '')) return null;
  const body: string[] = [];
  for (let j = 1; j < lines.length; j += 1) {
    const l = lines[j] ?? '';
    if (/^---[ \t]*$/.test(l)) return body.join('\n'); // 闭合
    if (l.trim() === '') return null; // 空行前未闭合 → 非 frontmatter
    body.push(l);
  }
  return null; // 未闭合
}

/** 在 frontmatter 里按 key 列表取第一个命中的值(去引号);无 / 空 → null。 */
function frontmatterValue(md: string, keys: readonly string[]): string | null {
  const body = frontmatterBody(md);
  if (body === null) return null;
  const keyRe = new RegExp(`^(${keys.join('|')})[ \\t]*:(.*)$`);
  for (const line of body.split(/\r?\n/)) {
    const kv = keyRe.exec(line);
    if (kv) {
      const value = stripQuotes(kv[2] ?? '');
      return value.length > 0 ? value : null;
    }
  }
  return null;
}

/** 从文首 frontmatter 块解析 title;无块 / 无命中 / 值为空 → null。 */
function fromFrontmatter(md: string): string | null {
  return frontmatterValue(md, ['title', 'Title', '标题']);
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
  if (wiki) return (wiki[1] ?? '').trim();
  // 兼容 Obsidian 无 ! 的内链 [[assets/x.png]]
  const wikiLink = /^\[\[(.+?)\]\]$/.exec(raw);
  if (wikiLink) return (wikiLink[1] ?? '').trim();
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
  forEachContentLine(lines, (line, index) => {
    const h1 = /^#\s+(.+)$/.exec(line);
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
  });
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
