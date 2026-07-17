/**
 * 能力映射分析。计数**基于 parseMarkdown(md) 的实际产出块**(而非独立正则),
 * 与真正写入 X 的内容严格一致——消除旧版第二套正则的系统性误差:
 *   - `^\s*\|?[\s:|-]+\|?\s*$` 把纯 `---` 分割线 / frontmatter 的 `---` 误计为表格;
 *   - `c(/^###/) - c(/^####/)` 减法在 H4 多于 H3 时算出负数,让 H3 项凭空消失;
 *   - `~~~` 围栏内容被计成删除线、`~~~` 围栏不计代码块;推文正则漏 `www.`。
 * 现在这些由 parser 的块级判定统一裁决,能力面板所见即写入所得。
 * 导出签名与 CapItem 结构保持不变(消费方 CapabilityPanel / ReportCard / AssetsCard 不改)。
 */

import { forEachContentLine, parseMarkdown } from './parser';

export type CapBadge = 'native' | 'special' | 'image' | 'warn';

export interface CapItem {
  label: string;
  count: number;
  badge: CapBadge;
  note: string;
}

export function capability(md: string, en: boolean): CapItem[] {
  const blocks = parseMarkdown(md);

  let headers = 0; // header-one(源 H1/H2)
  let subheaders = 0; // header-two(源 H3)
  let boldParas = 0; // unstyled + 整段 BOLD(源 H4+ 降级 / 整段加粗)
  let listItems = 0;
  let blockquotes = 0;
  let links = 0;
  let inlineStyles = 0; // BOLD / ITALIC / STRIKETHROUGH range 数
  let tables = 0;
  let codeBlocks = 0;
  let dividers = 0;
  let tweets = 0;
  let imageCount = 0;
  let inlineCode = 0; // 保留反引号的行内代码(扫文本块内 `...`,代码块已单独成块不误计)

  const RE_INLINE_CODE = /`[^`]+`/g;

  for (const b of blocks) {
    if (b.kind === 'image') {
      imageCount += 1;
      continue;
    }
    if (b.kind === 'atomic') {
      if (b.entityType === 'DIVIDER') dividers += 1;
      else if (b.entityType === 'TWEET') tweets += 1;
      else if (b.entityType === 'MARKDOWN') {
        // MARKDOWN atomic 承载「代码块」与「表格」两类:以围栏开头者为代码块,否则表格。
        if (/^(`{3,}|~{3,})/.test(b.data.markdown)) codeBlocks += 1;
        else tables += 1;
      }
      continue;
    }
    // 文本块
    if (b.type === 'header-one') headers += 1;
    else if (b.type === 'header-two') subheaders += 1;
    else if (b.type === 'unordered-list-item' || b.type === 'ordered-list-item') listItems += 1;
    else if (b.type === 'blockquote') blockquotes += 1;
    else if (b.type === 'unstyled') {
      // H4+ → parser 产出 unstyled + 覆盖全文的单个 BOLD range;整段纯加粗段落同形,一并计入。
      const fullBold = b.text.length > 0 && b.inlineStyleRanges.some(
        (r) => r.offset === 0 && r.length === b.text.length && r.style === 'BOLD',
      );
      if (fullBold) boldParas += 1;
    }
    for (const r of b.inlineStyleRanges) {
      if (r.style === 'BOLD' || r.style === 'ITALIC' || r.style === 'STRIKETHROUGH') inlineStyles += 1;
    }
    links += b.links.length;
    inlineCode += (b.text.match(RE_INLINE_CODE) || []).length;
  }

  const items: CapItem[] = [];
  const add = (label: string, count: number, badge: CapBadge, note: string) => {
    if (count > 0) items.push({ label, count, badge, note });
  };

  add(en ? 'H2 → Heading' : '二级标题 → Heading', headers, 'native', en ? 'header-one native' : '原生 header-one');
  add(
    en ? 'H3 → Subheading' : '三级标题 → Subheading',
    subheaders,
    'native',
    en ? 'header-two native' : '原生 header-two',
  );
  add(
    en ? 'Bold / italic / strike' : '粗体 / 斜体 / 删除线',
    inlineStyles,
    'native',
    en ? 'inline styles' : '原生 inline style',
  );
  add(en ? 'Links' : '链接', links, 'native', en ? 'LINK entity' : 'LINK entity 原生');
  add(en ? 'Lists' : '列表', listItems, 'native', en ? 'list items' : '原生 list-item');
  add(en ? 'Blockquotes' : '引用', blockquotes, 'native', en ? 'blockquote' : '原生 blockquote');
  add(
    en ? 'Tables → native' : '表格 → 原生表格',
    tables,
    'special',
    en ? 'MARKDOWN entity · native table' : '原生表格·MARKDOWN entity',
  );
  add(
    en ? 'Code blocks → native' : '代码块 → 原生代码块',
    codeBlocks,
    'special',
    en ? 'MARKDOWN entity + language' : 'MARKDOWN entity·带语言',
  );
  add(en ? 'Dividers' : '分割线 → DIVIDER', dividers, 'special', en ? 'DIVIDER entity' : 'DIVIDER entity');
  add(
    en ? 'Tweet embeds' : '推文 URL → 嵌入卡片',
    tweets,
    'special',
    en ? 'TWEET entity' : 'TWEET entity',
  );
  add(
    en ? 'Images → upload' : '图片 → 上传',
    imageCount,
    'image',
    en ? 'chunked upload' : '分块上传',
  );
  add(
    en ? 'H4+ → bold para' : '四级以下标题 → 粗体段落',
    boldParas,
    'warn',
    en ? 'X has two heading levels' : 'X 仅两级标题,自动降级',
  );
  add(
    en ? 'Inline code' : '行内代码',
    inlineCode,
    'warn',
    en ? 'X unsupported → keep `backticks`' : 'X 不支持·保留反引号 `code`',
  );

  return items;
}

export type ImageKind = 'local' | 'remote' | 'data';

export interface ImageRef {
  src: string;
  kind: ImageKind;
}

export function images(md: string): ImageRef[] {
  const out: ImageRef[] = [];
  const re = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) {
    const src = m[2] ?? '';
    const kind: ImageKind = src.startsWith('data:') ? 'data' : /^https?:\/\//.test(src) ? 'remote' : 'local';
    out.push({ src, kind });
  }
  return out;
}

export function firstTitle(md: string, en: boolean): string {
  // 用 forEachContentLine 跳过围栏代码块——否则代码块内的 `# 注释` 会被当历史条目标题,
  // 与 extractTitle/stripFirstH1 的判定分裂(它们经同一 helper,历史修复点;单测钉出)。
  let title: string | null = null;
  forEachContentLine(md.split(/\r?\n/), (line) => {
    const m = /^#\s+(.+)$/.exec(line);
    if (m) {
      const t = (m[1] ?? '').trim();
      if (t.length > 0) {
        title = t;
        return true;
      }
    }
  });
  return title ?? (en ? 'Untitled draft' : '未命名草稿');
}
