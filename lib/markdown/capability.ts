/**
 * 能力映射分析 · 逐条移植自设计稿 capability() / images() / firstTitle()。
 * 正则计数规则与《技术方案设计.md》§4.2 映射矩阵一致。
 */

export type CapBadge = 'native' | 'special' | 'image' | 'warn';

export interface CapItem {
  label: string;
  count: number;
  badge: CapBadge;
  note: string;
}

export function capability(md: string, en: boolean): CapItem[] {
  const c = (re: RegExp) => (md.match(re) || []).length;
  const items: CapItem[] = [];
  const add = (label: string, count: number, badge: CapBadge, note: string) => {
    if (count > 0) items.push({ label, count, badge, note });
  };

  add(en ? 'H2 → Heading' : '二级标题 → Heading', c(/^##\s/gm), 'native', en ? 'header-one native' : '原生 header-one');
  add(
    en ? 'H3 → Subheading' : '三级标题 → Subheading',
    c(/^###\s/gm) - c(/^####\s/gm),
    'native',
    en ? 'header-two native' : '原生 header-two',
  );
  add(
    en ? 'Bold / italic / strike' : '粗体 / 斜体 / 删除线',
    c(/\*\*[^*]+\*\*/g) + c(/~~[^~]+~~/g),
    'native',
    en ? 'inline styles' : '原生 inline style',
  );
  add(
    en ? 'Links' : '链接',
    c(/\[[^\]]+\]\([^)]+\)/g) - c(/!\[[^\]]*\]\([^)]+\)/g),
    'native',
    en ? 'LINK entity' : 'LINK entity 原生',
  );
  add(en ? 'Lists' : '列表', c(/^(\s*)([-*]|\d+\.)\s/gm), 'native', en ? 'list items' : '原生 list-item');
  add(en ? 'Blockquotes' : '引用', c(/^>\s?/gm), 'native', en ? 'blockquote' : '原生 blockquote');
  add(
    en ? 'Tables → native' : '表格 → 原生表格',
    c(/^\s*\|?[\s:|-]+\|?\s*$/gm),
    'special',
    en ? 'atomic entity · native table' : 'atomic entity·原生渲染',
  );
  add(
    en ? 'Code blocks → native' : '代码块 → 原生代码块',
    Math.floor(c(/^```/gm) / 2),
    'special',
    en ? 'MARKDOWN entity + language' : 'MARKDOWN entity·带语言',
  );
  add(
    en ? 'Dividers' : '分割线 → DIVIDER',
    c(/^(-{3,}|\*{3,})$/gm),
    'special',
    en ? 'DIVIDER entity' : 'DIVIDER entity',
  );
  add(
    en ? 'Tweet embeds' : '推文 URL → 嵌入卡片',
    c(/^https?:\/\/(x|twitter)\.com\/\w+\/status\/\d+\s*$/gm),
    'special',
    en ? 'TWEET entity' : 'TWEET entity',
  );
  add(
    en ? 'Images → upload' : '图片 → 上传 + 图注',
    c(/!\[[^\]]*\]\([^)]+\)/g),
    'image',
    en ? 'chunked upload · alt→caption' : '分块上传·alt 写入图注',
  );
  add(
    en ? 'H4+ → bold para' : '四级以下标题 → 粗体段落',
    c(/^#{4,}\s/gm),
    'warn',
    en ? 'X has two heading levels' : 'X 仅两级标题,自动降级',
  );
  add(
    en ? 'Inline code' : '行内代码',
    c(/`[^`]+`/g) - Math.floor(c(/^```/gm) / 2) * 2,
    'warn',
    en ? 'CODE style, pending M0' : 'CODE 样式·渲染待验证',
  );

  return items.filter((it) => it.count > 0);
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
  const m = md.match(/^#\s+(.+)$/m);
  return m ? (m[1] ?? '').trim() : en ? 'Untitled draft' : '未命名草稿';
}
