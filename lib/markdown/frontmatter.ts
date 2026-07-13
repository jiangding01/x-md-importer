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

/** 从文首 frontmatter 块解析 title;无块 / 无命中 / 值为空 → null。 */
function fromFrontmatter(md: string): string | null {
  // 必须以 `---` 独占行开头(允许前导 BOM,不允许前导空行)。
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(md);
  if (!m) return null;
  const body = m[1] ?? '';
  for (const line of body.split(/\r?\n/)) {
    // 简易 key: value —— 仅认 title / Title / 标题,不解析嵌套结构。
    const kv = /^(title|Title|标题)[ \t]*:(.*)$/.exec(line);
    if (kv) {
      const value = stripQuotes(kv[2] ?? '');
      return value.length > 0 ? value : null;
    }
  }
  return null;
}

/** 从正文抽取第一个 H1(仅 `# `,不含 `## `);无则 null。 */
function fromH1(md: string): string | null {
  const m = /^#\s+(.+)$/m.exec(md);
  if (!m) return null;
  const value = (m[1] ?? '').trim();
  return value.length > 0 ? value : null;
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
