/**
 * 定位目标 X 标签页(唯一一份实现)——探针(useProbe)与写入(importArticle)
 * 此前各自内联了一份几乎逐行相同的选取逻辑,分别独立选 tab,多窗口时可能出现
 * 「探 A 写 B」的错位(code review #8)。收敛为本文件的单一入口,两处均改为调用它。
 *
 * 选取策略(与原逻辑逐字一致):
 *   1. browser.tabs.query({ url: X_TAB_MATCHES }) 拿到所有匹配的 X 标签页;
 *   2. 优先「当前窗口的 active tab」,用 browser.windows.getCurrent() 收敛;
 *   3. 拿不到当前窗口 / 当前窗口无匹配 active tab 时,退回「任意一个匹配的 tab」;
 *   4. 拿不到 tab.id / 无匹配 tab / 过程中异常,一律返回 null。
 */

/** X 文章编辑页的 URL 匹配(探针与写入共用同一份)。 */
export const X_TAB_MATCHES = ['*://x.com/*', '*://twitter.com/*'];

/**
 * 解析出应当作为写入/探针目标的 X 标签页 id。
 *
 * @returns 目标 tab 的 id;拿不到匹配 tab、tab.id 缺失或查询过程异常时返回 null。
 */
export async function resolveTargetXTab(): Promise<number | null> {
  let tabs: Awaited<ReturnType<typeof browser.tabs.query>>;
  try {
    tabs = await browser.tabs.query({ url: X_TAB_MATCHES });
  } catch {
    return null;
  }
  if (tabs.length === 0) {
    return null;
  }

  // 优先当前窗口的 active tab,取不到当前窗口时退回「任意一个匹配的 tab」。
  let target = tabs.find((tb) => tb.active) ?? tabs[0];
  try {
    const win = await browser.windows.getCurrent();
    target = tabs.find((tb) => tb.active && tb.windowId === win.id) ?? target;
  } catch {
    /* 拿不到当前窗口不影响兜底选择,忽略 */
  }

  if (target?.id === undefined) {
    return null;
  }

  return target.id;
}
