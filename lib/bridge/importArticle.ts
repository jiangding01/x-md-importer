import {
  IMPORT_REQUEST_TYPE,
  type ImportBlock,
  type ImportMode,
  type ImportResponse,
  type RuntimeRequest,
} from './protocol';

/**
 * 写入桥接:sidepanel → content → injector 的真实写入入口。
 *
 * 复用 useProbe 的目标 tab 定位策略(优先当前窗口的 active X tab,其次任意匹配 tab),
 * 经 browser.tabs.sendMessage 向该 tab 的 content script 发起 markflow:import 请求,
 * content 再转 injector 直写 Draft,层层把结果透传回来。
 *
 * 与探针(ProbeResponse)共用同一套错误短语约定:通道层错误(未连接/无 content script)
 * 归为 'disconnected';引擎层错误('no-injector'/'timeout'/其他)由 content 原样透传,
 * UI 层负责本地化归类。
 */

/** X 文章编辑页的 URL 匹配(与 useProbe 保持一致)。 */
const X_TAB_MATCHES = ['*://x.com/*', '*://twitter.com/*'];

/**
 * 把 Markdown 解析出的写入块发送到目标 X 标签页并等待写入结果。
 *
 * @param blocks 解析器(parseMarkdown)产出的写入块序列。
 * @param mode   写入模式:'replace' 整体替换 / 'append' 追加。
 * @returns 注入引擎的 ImportResponse;定位不到 X tab 或 sendMessage 抛错时返回
 *          `{ ok: false, error: 'disconnected' }`。
 */
export async function importToXTab(
  blocks: ImportBlock[],
  mode: ImportMode,
): Promise<ImportResponse> {
  const request: RuntimeRequest = { type: IMPORT_REQUEST_TYPE, blocks, mode };

  // ── 1. 定位所有 X 文章编辑页标签(拿不到直接判「未连接」)──
  let tabs: Awaited<ReturnType<typeof browser.tabs.query>>;
  try {
    tabs = await browser.tabs.query({ url: X_TAB_MATCHES });
  } catch {
    return { ok: false, error: 'disconnected' };
  }
  if (tabs.length === 0) {
    return { ok: false, error: 'disconnected' };
  }

  // ── 2. 优先当前窗口的 active tab,取不到当前窗口时退回「任意一个匹配的 tab」──
  let target = tabs.find((tb) => tb.active) ?? tabs[0];
  try {
    const win = await browser.windows.getCurrent();
    target = tabs.find((tb) => tb.active && tb.windowId === win.id) ?? target;
  } catch {
    /* 拿不到当前窗口不影响兜底选择,忽略 */
  }
  if (target?.id === undefined) {
    return { ok: false, error: 'disconnected' };
  }

  // ── 3. 发送写入请求,透传 content 的 ImportResponse ──
  try {
    const response = (await browser.tabs.sendMessage(target.id, request)) as
      | ImportResponse
      | undefined;
    // content script 未注入 / 无应答 → 目标页不是可写入的 X 文章编辑页
    if (!response) return { ok: false, error: 'disconnected' };
    return response;
  } catch {
    // 目标 tab 没有 content script(非 X 文章编辑页 / 页面未刷新)→ 归为「未连接」
    return { ok: false, error: 'disconnected' };
  }
}
