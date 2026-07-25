/**
 * 能力映射分析。计数**基于 parseMarkdown(md) 的实际产出块**(而非独立正则),
 * 与真正写入 X 的内容严格一致——消除旧版第二套正则的系统性误差:
 *   - `^\s*\|?[\s:|-]+\|?\s*$` 把纯 `---` 分割线 / frontmatter 的 `---` 误计为表格;
 *   - `c(/^###/) - c(/^####/)` 减法在 H4 多于 H3 时算出负数,让 H3 项凭空消失;
 *   - `~~~` 围栏内容被计成删除线、`~~~` 围栏不计代码块;推文正则漏 `www.`。
 * 现在这些由 parser 的块级判定统一裁决,能力面板所见即写入所得。
 * 导出签名与 CapItem 结构保持不变(消费方 CapabilityPanel / ReportCard / AssetsCard 不改)。
 */

import { forEachContentLine, parseMarkdown, type ParseOptions } from './parser';

export type CapBadge = 'native' | 'special' | 'image' | 'warn';

export interface CapItem {
  label: string;
  count: number;
  badge: CapBadge;
  note: string;
}

/**
 * parseOpts 透传给 parseMarkdown——面板必须与「实际会写入的内容」同一份解析开关下产出,
 * 否则用户关掉 obsidianImg/wikilink/taskList 后,面板仍按默认开的口径统计,又是一次
 * 「UI 撒谎」(计数与真实写入不一致)。调用方拿不到 opts 时不传,退回 parseMarkdown 的默认值。
 */
export function capability(md: string, en: boolean, parseOpts?: ParseOptions): CapItem[] {
  const blocks = parseMarkdown(md, parseOpts);

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
  let multiLevelList = 0; // 嵌套列表项(depth > 0)
  let taskListItems = 0; // 任务列表项(task 字段非空)
  let inlineImages = 0; // 文本块残留的行内图片(独占一行的已被解析成 ImageBlock,不在此列)
  let footnotes = 0; // 文本块内的脚注标记 [^xxx]
  let htmlBlocks = 0; // 以 `<字母` 开头、被当普通段落写入的 HTML 块
  let mathBlocks = 0; // 含 $$ 的文本块(LaTeX 块级公式)

  const RE_INLINE_CODE = /`[^`]+`/g;
  const RE_INLINE_IMAGE = /!\[[^\]]*\]\([^)]*\)/g;
  const RE_FOOTNOTE = /\[\^[^\]]+\]/g;
  const RE_HTML_BLOCK_START = /^<[A-Za-z]/;

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
    if (b.depth !== undefined && b.depth > 0) multiLevelList += 1;
    if (b.task) taskListItems += 1;
    inlineImages += (b.text.match(RE_INLINE_IMAGE) || []).length;
    footnotes += (b.text.match(RE_FOOTNOTE) || []).length;
    if (RE_HTML_BLOCK_START.test(b.text.trim())) htmlBlocks += 1;
    if (b.text.includes('$$')) mathBlocks += 1;
  }

  const setextHeadings = countSetextHeadings(md);

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
  // badge 用 'special'(经特殊原生机制写入,同表格/代码块/DIVIDER)而**非** 'warn':
  // 嵌套走的是 Draft 原生 `ContentBlock.depth` 字段,不是降级路径;而 X 究竟渲不渲染这层缩进
  // **尚未真机验证**——标 'warn' 等于断言「已降级」,是我们此刻并不知道的事,且会让报告的
  // 「降级 N 处」凭空膨胀(warn 项求和)。真机确认后再定:渲染 → 可升 'native';忽略 → 降 'warn'。
  add(
    en ? 'Nested lists' : '多级列表',
    multiLevelList,
    'special',
    en
      ? 'Written via native Draft depth · X rendering to be confirmed'
      : 'Draft 原生 depth 写入 · X 是否渲染层级以实际为准',
  );
  add(
    en ? 'Task lists' : '任务列表',
    taskListItems,
    'warn',
    (parseOpts?.taskList ?? 'symbol') === 'symbol'
      ? (en ? 'X has no task lists · rendered as ☑/☐ symbols' : 'X 无任务列表 · 转 ☑/☐ 符号')
      : (en ? 'X has no task lists · rendered as plain list items' : 'X 无任务列表 · 转普通列表项'),
  );
  add(
    en ? 'Inline images' : '行内图片',
    inlineImages,
    'warn',
    en
      ? 'Inline images kept as raw text · only images on their own line upload'
      : '行内图片保留原文 · 仅独占一行的图片可上传',
  );
  add(
    en ? 'Footnotes' : '脚注',
    footnotes,
    'warn',
    en ? 'X has no footnotes · marker kept as-is' : 'X 无脚注 · 保留原文标记',
  );
  add(
    en ? 'HTML blocks' : 'HTML 块',
    htmlBlocks,
    'warn',
    en ? "X doesn't support HTML · kept as-is" : 'X 不支持 HTML · 保留原文',
  );
  add(
    en ? 'Math blocks' : '数学公式',
    mathBlocks,
    'warn',
    en ? 'X has no LaTeX support · kept as-is' : 'X LaTeX 块未接 · 保留原文',
  );
  add(
    en ? 'Setext headings' : 'setext 标题',
    setextHeadings,
    'warn',
    en ? 'Not recognized · kept as-is (use # headings instead)' : '未识别 · 保留原文(请改用 # 标题)',
  );

  return items;
}

// ---------------------------------------------------------------------------
// setext 标题计数:唯一必须扫原始 md 的一项——parser 把 setext 标题解析成普通段落
// (下划线是 `---` 时甚至变成「段落 + DIVIDER」),标题语义在产出块里已经丢失,无法从块反推,
// 只能退回扫原文。用 forEachContentLine 保持与主解析同一套围栏跳过逻辑(围栏内的
// `文字\n===` 不是 setext)。
// ---------------------------------------------------------------------------

/** 块级起始行判定(setext 专用最小集):这些行本身有明确语义,不应被当成 setext 标题正文。 */
const RE_SETEXT_HEADING_LINE = /^#{1,6}\s+/;
const RE_SETEXT_BLOCKQUOTE_LINE = /^>/;
const RE_SETEXT_UL_LINE = /^[ \t]*[-*+]\s+/;
const RE_SETEXT_OL_LINE = /^[ \t]*\d+\.\s+/;
const RE_SETEXT_DIVIDER_LINE = /^(-{3,}|\*{3,})$/;
const RE_SETEXT_EQ_UNDERLINE = /^=+\s*$/;
const RE_SETEXT_DASH_UNDERLINE = /^-+\s*$/;

function isOtherBlockLine(line: string): boolean {
  return (
    RE_SETEXT_HEADING_LINE.test(line) ||
    RE_SETEXT_BLOCKQUOTE_LINE.test(line) ||
    RE_SETEXT_UL_LINE.test(line) ||
    RE_SETEXT_OL_LINE.test(line) ||
    RE_SETEXT_DIVIDER_LINE.test(line)
  );
}

function countSetextHeadings(md: string): number {
  const lines = md.split(/\r?\n/);
  let count = 0;
  forEachContentLine(lines, (line, index) => {
    if (line.trim() === '' || isOtherBlockLine(line)) return;
    const next = lines[index + 1];
    if (next === undefined) return;
    if (RE_SETEXT_EQ_UNDERLINE.test(next) || RE_SETEXT_DASH_UNDERLINE.test(next)) count += 1;
  });
  return count;
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
