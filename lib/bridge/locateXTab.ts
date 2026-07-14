/**
 * 定位目标 X 标签页(唯一一份实现)——探针(useProbe)与写入(importArticle)共用,
 * 保证「探针显示的连接状态」与「写入的目标」始终一致(不会探 A 写 B)。
 *
 * 选取策略:**只认「当前窗口的活动标签」**——它是 X 页才作为目标,否则返回 null(未连接)。
 * 即侧边栏跟随当前标签:切到非 X 标签立即变未连接、写入禁用(用户选择的行为,而非
 * 「后台任意 X 标签都算已连接」)。拿不到当前窗口时退回全局活动标签兜底。
 */

/** X 文章编辑页的 URL 匹配(探针与写入共用同一份)。 */
export const X_TAB_MATCHES = ['*://x.com/*', '*://twitter.com/*'];

/** 判断某 URL 是否属于 X(x.com / twitter.com)。 */
const isXUrl = (url: string | undefined): boolean =>
  /^https?:\/\/(?:[^/]+\.)?(?:x|twitter)\.com\//.test(url ?? '');

/**
 * 解析目标 X 标签页 id——**仅当当前活动标签本身是 X 页**时返回其 id,否则 null。
 *
 * @returns 当前活动 X 标签的 id;当前标签非 X、拿不到 tab.id 或查询异常时返回 null。
 */
export async function resolveTargetXTab(): Promise<number | null> {
  try {
    // 优先「当前窗口的活动标签」;个别环境(如从 devtools 上下文)拿不到当前窗口时,
    // 退回全局活动标签兜底。
    let active = (await browser.tabs.query({ active: true, currentWindow: true }))[0];
    if (!active) active = (await browser.tabs.query({ active: true, lastFocusedWindow: true }))[0];
    if (!active || active.id === undefined) return null;
    return isXUrl(active.url) ? active.id : null;
  } catch {
    return null;
  }
}
