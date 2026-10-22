/**
 * 能力映射分析。计数**基于 parseMarkdown(md) 的实际产出块**(而非独立正则),
 * 与真正写入 X 的内容严格一致——消除旧版第二套正则的系统性误差:
 *   - `^\s*\|?[\s:|-]+\|?\s*$` 把纯 `---` 分割线 / frontmatter 的 `---` 误计为表格;
 *   - `c(/^###/) - c(/^####/)` 减法在 H4 多于 H3 时算出负数,让 H3 项凭空消失;
 *   - `~~~` 围栏内容被计成删除线、`~~~` 围栏不计代码块;推文正则漏 `www.`。
 * 现在这些由 parser 的块级判定统一裁决,能力面板所见即写入所得。
 * 导出签名与 CapItem 结构保持不变(消费方 CapabilityPanel / ReportCard / AssetsCard 不改)。
 */

import { extractTitle } from './frontmatter';
import { isDemotedHeading, parseMarkdown, type ParseOptions } from './parser';

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
  let boldParas = 0; // 源 H4+ 降级成的粗体段落(仅认 parser 的降级标记,不含源文本就整段加粗的段落)
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
  let mathBlocks = 0; // 原生 LATEX atomic 块(块级公式 $$…$$,parser 已识别)
  let mathResidue = 0; // 文本块内残留的 $$ 起行(未闭合公式的开头,已降级为普通文本)

  const RE_INLINE_CODE = /`[^`]+`/g;
  const RE_INLINE_IMAGE = /!\[[^\]]*\]\([^)]*\)/g;
  const RE_FOOTNOTE = /\[\^[^\]]+\]/g;
  const RE_HTML_BLOCK_START = /^<[A-Za-z]/;
  // 残留 $$:仅认**裸 `$$` 行**(顶格、其后仅空白)——这是未闭合多行公式的开头签名,
  // 与 parser 的 matchMathOpen('multi') 同源。收窄到裸行天然排除 `$$100` 这类行内双美元
  // 假阳性(其后非空),不再需要旧 `/^\$\$/m` 那种"行首即算"的宽松匹配。
  const RE_MATH_RESIDUE = /^\$\$[ \t]*$/m;

  for (const b of blocks) {
    if (b.kind === 'image') {
      imageCount += 1;
      continue;
    }
    if (b.kind === 'atomic') {
      if (b.entityType === 'DIVIDER') dividers += 1;
      else if (b.entityType === 'TWEET') tweets += 1;
      else if (b.entityType === 'LATEX') mathBlocks += 1;
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
    else if (isDemotedHeading(b)) {
      // H4+ → parser 产出 unstyled + 覆盖全文的 BOLD;`**整段加粗**` 的段落同形但不是降级(A15),
      // 故不按形态判,只认 parser 打的降级标记。
      boldParas += 1;
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
    // 真公式已被 parser 识别成 LATEX atomic(上面单独计 mathBlocks);落到文本块的只剩
    // **未闭合多行公式的开头**(裸 `$$` 行)——如实标降级。`$$100` 这类行内双美元其后非空、
    // 不匹配裸行正则,天然不误计(旧 `/^\$\$/m` 会误报,已随本批收窄)。
    if (RE_MATH_RESIDUE.test(b.text)) mathResidue += 1;
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
  // **真机已确认**(2026-07-25):X 忽略 Draft 的 `ContentBlock.depth`,嵌套项渲染成扁平列表
  // (有序列表还会被连续重编号)。层级信息确实丢失 → badge 从暂定的 'special' 落为 'warn',
  // 文案也从「以实际为准」改成确定的结论。depth 仍照写(语义正确、零成本,X 日后支持即生效)。
  // 注:即便扁平,也远好于本特性引入前——那时缩进项根本不是列表项,而是带字面量 `- x` 的段落。
  add(
    en ? 'Nested lists' : '多级列表',
    multiLevelList,
    'warn',
    en
      ? 'X ignores list nesting · flattened (content preserved)'
      : 'X 不支持列表层级 · 已扁平化(内容不丢)',
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
    'native',
    en ? 'Native LaTeX block' : '原生 LaTeX 块',
  );
  add(
    en ? 'Unclosed math' : '未闭合公式',
    mathResidue,
    'warn',
    en ? 'Unclosed $$ · kept as text' : '未闭合 $$ · 按文本保留',
  );

  return items;
}

// B3-4(P1-7):`images()` 已删除。它用全文正则 `\(([^)]+)\)` 抓 src,把 `![](<https://h/a.png>)`
// 判成 local(权限不申请 → 下载必被拒)、把 `f(1).png` 截断,还会算上代码块内与行内的图片。
// 所有图片来源一律取 parseMarkdown 的块级产出:消费方为 AssetsCard(渲染/计数)与
// requestRemoteImagePermissions(权限申请),两者都已改为块级源。

/**
 * 历史条目/草稿的显示标题。
 *
 * B3-12(P2-14):直接复用 `extractTitle`——它才是**真正写进 X 的标题**的唯一来源。
 * 此前这里自带一套「只认 ATX `# `」的扫描,frontmatter-only 与 setext 标题的文档在记录页
 * 显示「未命名草稿」,而实际导入的标题是对的:同一份文档两个标题,又一次「UI 撒谎」。
 * 抽不到才回落默认文案(此处唯一的额外职责,extractTitle 返回 null)。
 */
export function firstTitle(md: string, en: boolean): string {
  return extractTitle(md)?.title ?? (en ? 'Untitled draft' : '未命名草稿');
}
