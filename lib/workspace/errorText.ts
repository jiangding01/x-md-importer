import { BAD_RESULT_ERROR, NOT_ARTICLE_EDITOR_ERROR, type SetTitleResponse } from '@/lib/bridge/protocol';
import type { Dict } from '@/lib/i18n/dict';

/**
 * 把注入引擎的英文错误短语归类为可读中文 / 英文文案。第二批 I3 起从 WorkspaceProvider 抽出(可单测),并补
 * 两类常见引擎错误的专属文案——此前以「写入失败: <英文原文>」展示:
 *  - `import already in progress`:两个窗口同时往同一 X 页写入(injector 并发护栏);
 *  - `draft state node not found` / `sample character: …`:定位不到可写入的 Draft 实例 / 取不到样本字符。
 * 仍未知的错误保留「写入失败: <原文>」,便于诊断。
 */
export function importErrorText(error: string, t: Dict): string {
  if (error === 'disconnected') return t.errDisconnected;
  if (error === 'no-injector') return t.errNoInjector;
  if (error === 'timeout') return t.errTimeout;
  if (error === BAD_RESULT_ERROR) return t.errBadResult; // B9:injector 回传形状不合规
  if (error === NOT_ARTICLE_EDITOR_ERROR) return t.errNotArticleEditor; // B3:injector 拒写非文章编辑页
  if (error === 'import already in progress') return t.errImportBusy;
  if (error === 'draft state node not found' || error.startsWith('sample character:')) return t.errNoEditor;
  // 其他 injector 层错误:统一「写入失败」并附上原始短语,便于诊断。
  return `${t.errWriteFail}: ${error}`;
}

/** 把标题设置结果归类为可读文案。applied:false 属正常(keep 命中已有标题)。 */
export function titleResultText(res: SetTitleResponse, t: Dict): string {
  if (res.ok) return res.applied ? t.titleSet : t.titleKept;
  // 标题框未找到单列一类。
  if (res.error.includes('not found')) return t.titleFieldMissing;
  // 通道层错误(未连接/未就绪/超时)复用与正文一致的本地化,不把英文诊断码泄漏给用户。
  if (res.error === 'disconnected') return `${t.titleFail}: ${t.errDisconnected}`;
  if (res.error === 'no-injector') return `${t.titleFail}: ${t.errNoInjector}`;
  if (res.error === 'timeout') return `${t.titleFail}: ${t.errTimeout}`;
  if (res.error === BAD_RESULT_ERROR) return `${t.titleFail}: ${t.errBadResult}`;
  if (res.error === NOT_ARTICLE_EDITOR_ERROR) return `${t.titleFail}: ${t.errNotArticleEditor}`;
  return `${t.titleFail}: ${res.error}`;
}
