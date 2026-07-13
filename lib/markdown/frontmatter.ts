/**
 * 标题抽取(M2)。纯函数、零依赖、named export。
 *
 * 抽取优先级(对齐 docs/research/xposter-analysis.md §8.1):
 *   frontmatter title > 正文第一个 H1。
 * 仅做「简易」frontmatter 解析——文首 `---\n...\n---` 块内逐行匹配
 * `title:` / `Title:` / `标题:`,不支持嵌套 YAML、不支持多行值。
 */

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

/** 取文首 frontmatter 块的原文(独占行 `---` 包裹);无则 null。 */
function frontmatterBody(md: string): string | null {
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(md);
  return m ? (m[1] ?? '') : null;
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
 * 从文首 frontmatter 解析封面 `cover`;支持 Obsidian 的 `![[x]]` / `![](x)` 包裹写法(剥壳)。
 * 无 → null。仅解析 frontmatter,正文首图由上层用 images() 兜底。
 */
export function extractCover(md: string): string | null {
  const raw = frontmatterValue(md, ['cover', 'Cover', '封面']);
  if (raw === null) return null;
  // 兼容 ![[assets/x.png]] / ![](assets/x.png) 包裹
  const wiki = /^!\[\[(.+?)\]\]$/.exec(raw);
  if (wiki) return (wiki[1] ?? '').trim();
  const md2 = /^!\[[^\]]*\]\((.+)\)$/.exec(raw);
  if (md2) return (md2[1] ?? '').trim();
  return raw;
}

/**
 * 逐行扫描定位「首个位于代码围栏外的 H1」(仅 `# `,不含 `## `),返回其行号与标题。
 * **必须跳过围栏代码块**——否则代码示例里的 `# 注释` 会被误当文章标题(与 parser 一致)。
 * extractTitle 与 stripFirstH1 共用它,保证「抽为标题的 H1」与「从正文移除的 H1」是同一行。
 */
function findFirstH1(lines: string[]): { index: number; title: string } | null {
  let fence: string | null = null; // 当前围栏字符(` 或 ~),null=不在围栏内
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const fenceMatch = /^(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = (fenceMatch[1] ?? '')[0] ?? '`';
      if (fence === null) fence = marker; // 开栏
      else if (marker === fence) fence = null; // 同字符闭栏
      continue;
    }
    if (fence !== null) continue; // 围栏内一律不解析
    const h1 = /^#\s+(.+)$/.exec(line);
    if (h1) {
      const title = (h1[1] ?? '').trim();
      if (title.length > 0) return { index: i, title };
    }
  }
  return null;
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
  lines.splice(found.index, 1);
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
