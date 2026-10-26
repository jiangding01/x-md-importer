/**
 * X 文章正文编辑器的定位(injector 与 content 共用,第三批 I4)。
 *
 * 多级 fallback 选择器(B2-6 改造):**有序数组逐级尝试**——逗号并集下 querySelectorAll 按文档顺序返回、
 * 书写顺序毫无优先级。层级从「真机实测指纹」到「裸 contenteditable」逐级放宽(data-testid="composer" 与
 * .public-DraftEditor-content 见 docs/技术方案设计.md §2.1)。标题字段是 textarea(非 contenteditable),
 * 天然不会被任何一级命中。此前 content 的「完成后滚动到顶部」另取文档里第一个 `[contenteditable="true"]`,
 * 可能是正文以外的可编辑区,滚错容器(I4);现两处同口径。
 */
export const EDITOR_SELECTOR_TIERS = [
  "[contenteditable='true'][data-testid='composer']",
  "[contenteditable='true'].public-DraftEditor-content",
  "[contenteditable='true'][role='textbox']",
  "[contenteditable='true']",
] as const;

/**
 * 按层级依次查询,级内用几何尺寸(宽 > 200 且高 > 80)过滤掉小型 contenteditable,取**面积最大者**
 * (而非文档顺序第一个)——同级多命中时正文必然最大。`root` / `rectOf` 可注入,便于离线单测。
 */
export function findEditorElement(
  root: ParentNode = document,
  rectOf: (el: HTMLElement) => { width: number; height: number } = (el) => el.getBoundingClientRect(),
): HTMLElement | null {
  for (const selector of EDITOR_SELECTOR_TIERS) {
    let best: HTMLElement | null = null;
    let bestArea = 0;
    for (const el of root.querySelectorAll<HTMLElement>(selector)) {
      const rect = rectOf(el);
      if (rect.width <= 200 || rect.height <= 80) continue;
      const area = rect.width * rect.height;
      if (area > bestArea) {
        best = el;
        bestArea = area;
      }
    }
    if (best) return best;
  }
  return null;
}
