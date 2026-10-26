import type { Dict } from '@/lib/i18n/dict';
import type { ProbeResult } from './protocol';

/**
 * 探针结果对应的页面状态(第二批 W3)。按**路由**(`isArticleEditor`)判定是否在文章编辑页——新建文章页
 * 的 URL 还没有 `/edit/数字`,articleId 为 null,但 Draft 已可写、`useConnection` 也判已连接;此前状态条 /
 * 预检卡用 `articleId !== null` 判定,把新建页显示成「未在文章编辑页」,与可用的写入按钮自相矛盾。
 * 旧 injector(页面未刷新)不回 isArticleEditor → 按非文章页(fail-closed,与 useConnection 一致)。
 */
export function pageState(result: ProbeResult): 'article' | 'new-article' | 'not-article' {
  if (result.isArticleEditor !== true) return 'not-article';
  return result.articleId ? 'article' : 'new-article';
}

/** 预检卡「目标页面」一行的说明文案。 */
export function pageNote(t: Dict, result: ProbeResult): string {
  const s = pageState(result);
  if (s === 'article') return `${t.ckPageOk} #${result.articleId}`;
  return s === 'new-article' ? t.probeNewArticle : t.probeNoArticle;
}

/** 状态条右侧(ready 态)的文案。 */
export function statusNote(t: Dict, result: ProbeResult): string {
  const s = pageState(result);
  if (s === 'article') return `${t.probeArticle} #${result.articleId}`;
  return s === 'new-article' ? t.probeNewArticle : t.probeNoArticle;
}
