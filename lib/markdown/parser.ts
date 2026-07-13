/**
 * Markdown → ImportBlock 解析器(M1)。纯函数、零依赖、named export。
 *
 * 产出精确符合 lib/bridge/protocol.ts 的契约:文本块(TextBlock)带干净文本 +
 * inlineStyleRanges / links 区间;特殊块(AtomicBlock)覆盖 MARKDOWN(围栏代码)、
 * DIVIDER(分割线)、TWEET(独占行推文)。块级/行内规则与《技术方案设计.md》§4.2
 * 映射矩阵、以及 docs/research/xposter-analysis.md §8.1 手写解析器边界对齐。
 *
 * 扫描顺序(块级):先围栏代码块保护内容 → 再分割线 / 推文 → 剩余交给标题 / 引用 /
 * 列表 / 段落。行内规则对每个文本块的原文再解析,offset/length 基于「剥掉标记后的
 * 最终文本」——这是本模块的核心难点。
 */

import type { ImportBlock, InlineStyleRange, LinkRange, TextBlockType } from '../bridge/protocol';

/** 行内解析的中间产物:干净文本 + 样式区间 + 链接区间(offset 相对自身 text)。 */
interface InlineResult {
  text: string;
  inlineStyleRanges: InlineStyleRange[];
  links: LinkRange[];
}

/** 围栏描述:围栏字符(` 或 ~)与数量,用于闭合匹配(闭合需同字符且数量 ≥ 开栏)。 */
interface Fence {
  char: string;
  len: number;
}

// ---------------------------------------------------------------------------
// 块级正则(集中定义,块级判定与「段落边界探测」共用同一套,避免规则漂移)
// ---------------------------------------------------------------------------

const RE_DIVIDER = /^(-{3,}|\*{3,})$/;
const RE_TWEET = /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[^/]+\/status\/(\d+)\/?$/;
const RE_HEADING = /^(#{1,6})\s+(.*)$/;
const RE_BLOCKQUOTE = /^>/;
const RE_UL = /^[-*+]\s+(.*)$/;
const RE_OL = /^\d+\.\s+(.*)$/;

/** ASCII 标点集合:反斜杠转义仅在其后紧跟 ASCII 标点时生效(字母/CJK 前的反斜杠保留原样)。 */
const RE_PUNCT = /[!-/:-@[-`{-~]/;

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/** 解析 Markdown 文本为按文档顺序排列的写入块序列。 */
export function parseMarkdown(md: string): ImportBlock[] {
  const lines = md.split(/\r?\n/);
  const blocks: ImportBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';

    // 1. 围栏代码块:优先保护,内部所有内容(含 --- / > / 行内标记)一律不解析
    const fence = matchFenceOpen(line);
    if (fence) {
      let j = i + 1;
      let closed = false;
      while (j < lines.length) {
        if (matchFenceClose(lines[j] ?? '', fence)) {
          closed = true;
          break;
        }
        j += 1;
      }
      if (closed) {
        // 原文含 ```lang 首行与闭合行,整体塞进 MARKDOWN entity
        const markdown = lines.slice(i, j + 1).join('\n');
        blocks.push({ kind: 'atomic', entityType: 'MARKDOWN', data: { markdown } });
        i = j + 1;
        continue;
      }
      // 未闭合:视为普通文本,继续走后续块级逻辑处理本行(不 continue)
    }

    // 2. 分割线
    if (RE_DIVIDER.test(line)) {
      blocks.push({ kind: 'atomic', entityType: 'DIVIDER', data: {} });
      i += 1;
      continue;
    }

    // 3. 推文(独占一行的裸 URL);url 规范化为 twitter.com/i/web 形式(xposter 实证)
    const tweet = line.match(RE_TWEET);
    if (tweet) {
      const tweetId = tweet[1] ?? '';
      blocks.push({
        kind: 'atomic',
        entityType: 'TWEET',
        data: { url: `https://twitter.com/i/web/status/${tweetId}`, tweetId },
      });
      i += 1;
      continue;
    }

    // 4. 空行:跳过
    if (line.trim() === '') {
      i += 1;
      continue;
    }

    // 5. 标题:# / ## → header-one;### → header-two;#### 及以下 → unstyled + 整行 BOLD
    const heading = line.match(RE_HEADING);
    if (heading) {
      const level = (heading[1] ?? '').length;
      const content = (heading[2] ?? '').replace(/\s+#+\s*$/, '').trim(); // 去掉可选的 ATX 闭合 ###
      const inline = walkInline(content);
      let type: TextBlockType;
      if (level <= 2) {
        type = 'header-one';
      } else if (level === 3) {
        type = 'header-two';
      } else {
        type = 'unstyled';
        if (inline.text.length > 0) {
          inline.inlineStyleRanges.push({ offset: 0, length: inline.text.length, style: 'BOLD' });
        }
      }
      blocks.push(textBlock(type, inline));
      i += 1;
      continue;
    }

    // 6. 引用:逐行独立成块(不合并多行)
    if (RE_BLOCKQUOTE.test(line)) {
      const content = line.replace(/^>\s?/, '');
      blocks.push(textBlock('blockquote', walkInline(content)));
      i += 1;
      continue;
    }

    // 7. 无序列表(单层,行首无缩进;缩进视为嵌套 → 落到段落按普通文本)
    const ul = line.match(RE_UL);
    if (ul) {
      blocks.push(textBlock('unordered-list-item', walkInline(ul[1] ?? '')));
      i += 1;
      continue;
    }

    // 8. 有序列表(单层)
    const ol = line.match(RE_OL);
    if (ol) {
      blocks.push(textBlock('ordered-list-item', walkInline(ol[1] ?? '')));
      i += 1;
      continue;
    }

    // 9. 段落:收集连续的非边界行(遇空行或任一块级起始行即止),合并为一个 unstyled 块
    const para: string[] = [line];
    let k = i + 1;
    while (k < lines.length) {
      const next = lines[k] ?? '';
      if (isBlockBoundary(next)) break;
      para.push(next);
      k += 1;
    }
    blocks.push(textBlock('unstyled', walkInline(para.join('\n'))));
    i = k;
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// 块级辅助
// ---------------------------------------------------------------------------

/** 由行内解析结果组装一个 TextBlock。 */
function textBlock(type: TextBlockType, inline: InlineResult): ImportBlock {
  return {
    kind: 'text',
    type,
    text: inline.text,
    inlineStyleRanges: inline.inlineStyleRanges,
    links: inline.links,
  };
}

/** 段落边界:空行,或任一块级元素的起始行——段落收集到这些行前停止。 */
function isBlockBoundary(line: string): boolean {
  if (line.trim() === '') return true;
  if (matchFenceOpen(line)) return true;
  if (RE_DIVIDER.test(line)) return true;
  if (RE_TWEET.test(line)) return true;
  if (RE_HEADING.test(line)) return true;
  if (RE_BLOCKQUOTE.test(line)) return true;
  if (RE_UL.test(line)) return true;
  if (RE_OL.test(line)) return true;
  return false;
}

/** 识别开栏:3+ 个 ` 或 ~;反引号围栏的信息串不得含反引号(否则非合法开栏)。 */
function matchFenceOpen(line: string): Fence | null {
  const m = line.match(/^(`{3,}|~{3,})(.*)$/);
  if (!m) return null;
  const marker = m[1] ?? '';
  const info = m[2] ?? '';
  const char = marker[0] ?? '`';
  if (char === '`' && info.includes('`')) return null;
  return { char, len: marker.length };
}

/** 识别闭栏:同字符、数量 ≥ 开栏、其后仅允许空白。 */
function matchFenceClose(line: string, fence: Fence): boolean {
  const m = line.match(/^(`{3,}|~{3,})\s*$/);
  if (!m) return false;
  const marker = m[1] ?? '';
  return (marker[0] ?? '') === fence.char && marker.length >= fence.len;
}

// ---------------------------------------------------------------------------
// 行内解析:递归下降,产出干净文本 + 精确区间
// ---------------------------------------------------------------------------

/** 解析一段行内文本;offset/length 均基于剥掉标记后的最终文本。 */
function walkInline(src: string): InlineResult {
  let out = '';
  const ranges: InlineStyleRange[] = [];
  const links: LinkRange[] = [];

  /** 把子结果嵌入当前 out 位置:平移子区间 + 追加包裹样式 / 链接。 */
  const embed = (sub: InlineResult, styles: Array<InlineStyleRange['style']>, url?: string): void => {
    const base = out.length;
    for (const r of sub.inlineStyleRanges) {
      ranges.push({ offset: r.offset + base, length: r.length, style: r.style });
    }
    for (const l of sub.links) {
      links.push({ offset: l.offset + base, length: l.length, url: l.url });
    }
    if (sub.text.length > 0) {
      for (const style of styles) ranges.push({ offset: base, length: sub.text.length, style });
      if (url !== undefined) links.push({ offset: base, length: sub.text.length, url });
    }
    out += sub.text;
  };

  let i = 0;
  const n = src.length;

  while (i < n) {
    const ch = src[i] ?? '';

    // 反斜杠转义:仅对其后紧跟的 ASCII 标点生效,输出该标点、跳过反斜杠
    if (ch === '\\' && i + 1 < n && RE_PUNCT.test(src[i + 1] ?? '')) {
      out += src[i + 1] ?? '';
      i += 2;
      continue;
    }

    // 行内代码最高优先:内部 * / _ 等一律不解析
    if (ch === '`') {
      const code = matchCodeSpan(src, i);
      if (code) {
        const base = out.length;
        out += code.content;
        if (code.content.length > 0) {
          ranges.push({ offset: base, length: code.content.length, style: 'CODE' });
        }
        i = code.end;
        continue;
      }
      out += ch;
      i += 1;
      continue;
    }

    // 链接 [text](url);紧跟在 ! 之后的 [ 属于图片语法,按普通文本保留(M1 边界)
    if (ch === '[' && src[i - 1] !== '!') {
      const link = matchLink(src, i);
      if (link) {
        embed(walkInline(link.textRaw), [], normalizeUrl(link.url));
        i = link.end;
        continue;
      }
    }

    // ***x*** 粗+斜
    if (src.startsWith('***', i)) {
      const close = findClosing(src, i + 3, '***');
      if (close > i + 3) {
        embed(walkInline(src.slice(i + 3, close)), ['BOLD', 'ITALIC']);
        i = close + 3;
        continue;
      }
    }
    // **x** 粗
    if (src.startsWith('**', i)) {
      const close = findClosing(src, i + 2, '**');
      if (close > i + 2) {
        embed(walkInline(src.slice(i + 2, close)), ['BOLD']);
        i = close + 2;
        continue;
      }
    }
    // ~~x~~ 删除线
    if (src.startsWith('~~', i)) {
      const close = findClosing(src, i + 2, '~~');
      if (close > i + 2) {
        embed(walkInline(src.slice(i + 2, close)), ['STRIKETHROUGH']);
        i = close + 2;
        continue;
      }
    }
    // *x* 斜体
    if (ch === '*') {
      const close = findClosing(src, i + 1, '*');
      if (close > i + 1) {
        embed(walkInline(src.slice(i + 1, close)), ['ITALIC']);
        i = close + 1;
        continue;
      }
    }
    // _x_ 斜体:规避 snake_case 词内下划线(左右侧不得紧贴字母数字)
    if (ch === '_' && !isWordChar(src[i - 1])) {
      const close = findClosing(src, i + 1, '_');
      if (close > i + 1 && !isWordChar(src[close + 1])) {
        embed(walkInline(src.slice(i + 1, close)), ['ITALIC']);
        i = close + 1;
        continue;
      }
    }

    // 普通字符
    out += ch;
    i += 1;
  }

  return { text: out, inlineStyleRanges: ranges, links };
}

/** 匹配从 i 处开始的行内代码:开闭反引号数量需精确相等。返回内容与结束位置。 */
function matchCodeSpan(src: string, i: number): { content: string; end: number } | null {
  let count = 0;
  while (src[i + count] === '`') count += 1;
  let j = i + count;
  while (j < src.length) {
    if (src[j] === '`') {
      let k = 0;
      while (src[j + k] === '`') k += 1;
      if (k === count) return { content: src.slice(i + count, j), end: j + k };
      j += k;
    } else {
      j += 1;
    }
  }
  return null; // 未闭合 → 交由调用方按普通字符处理
}

/**
 * 匹配从 start('[' 处)开始的链接结构 [text](url)。方括号支持嵌套配对,url 支持括号
 * 配对与转义;扫描时跳过行内代码内部。任何环节不成立返回 null(按普通文本处理)。
 */
function matchLink(src: string, start: number): { textRaw: string; url: string; end: number } | null {
  let depth = 0;
  let i = start;
  let close = -1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '`') {
      const cs = matchCodeSpan(src, i);
      i = cs ? cs.end : i + 1;
      continue;
    }
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '[') {
      depth += 1;
    } else if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
    i += 1;
  }
  if (close < 0 || src[close + 1] !== '(') return null;

  let j = close + 2;
  const urlStart = j;
  let pdepth = 1;
  while (j < src.length) {
    const ch = src[j];
    if (ch === '\\') {
      j += 2;
      continue;
    }
    if (ch === '(') {
      pdepth += 1;
    } else if (ch === ')') {
      pdepth -= 1;
      if (pdepth === 0) break;
    }
    j += 1;
  }
  if (pdepth !== 0) return null;

  return { textRaw: src.slice(start + 1, close), url: src.slice(urlStart, j), end: j + 1 };
}

/**
 * 从 start 处向后寻找闭合定界符 delim,返回其起始下标(找不到 -1)。
 * 扫描时跳过行内代码(代码优先);对单字符定界符(* / _)跳过更长的同字符连续段
 * (避免把 ** 中的星号误判为 * 的闭合)。
 */
function findClosing(src: string, start: number, delim: string): number {
  const single = delim.length === 1;
  const dch = delim[0] ?? '';
  let i = start;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '`') {
      const cs = matchCodeSpan(src, i);
      i = cs ? cs.end : i + 1;
      continue;
    }
    if (single) {
      if (ch === dch) {
        let run = 1;
        while (src[i + run] === dch) run += 1;
        if (run === 1) return i;
        i += run;
        continue;
      }
      i += 1;
      continue;
    }
    if (src.startsWith(delim, i)) return i;
    i += 1;
  }
  return -1;
}

/** 规范化链接目标:去首尾空白、剥 <>、丢弃可选标题(取第一个空白前的部分)。 */
function normalizeUrl(raw: string): string {
  let u = raw.trim();
  if (u.startsWith('<') && u.endsWith('>')) u = u.slice(1, -1);
  const sp = u.search(/\s/);
  if (sp >= 0) u = u.slice(0, sp);
  return u;
}

/** 是否为 ASCII 字母或数字(用于下划线斜体的词内规避)。 */
function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9]/.test(ch);
}
