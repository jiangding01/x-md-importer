import {
  IMPORT_REQUEST_TYPE,
  SET_TITLE_REQUEST_TYPE,
  type ImportBlock,
  type ImportMode,
  type ImportResponse,
  type RuntimeRequest,
  type SetTitleResponse,
  type TitleConflict,
} from './protocol';
import { resolveTargetXTab } from './locateXTab';

/**
 * 写入桥接:sidepanel → content → injector 的真实写入入口。
 *
 * 目标 tab 定位复用 lib/bridge/locateXTab.ts 的 resolveTargetXTab()(与探针共用同一份
 * 选取策略,避免多窗口下「探 A 写 B」),经 browser.tabs.sendMessage 向该 tab 的
 * content script 发起 markflow:import / markflow:set-title 请求,content 再转 injector
 * 直写 Draft,层层把结果透传回来。
 *
 * 与探针(ProbeResponse)共用同一套错误短语约定:通道层错误(未连接/无 content script)
 * 归为 'disconnected';引擎层错误('no-injector'/'timeout'/其他)由 content 原样透传,
 * UI 层负责本地化归类。
 */

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

  // ── 1. 定位目标 X 标签页(拿不到直接判「未连接」)──
  const tabId = await resolveTargetXTab();
  if (tabId === null) {
    return { ok: false, error: 'disconnected' };
  }

  // ── 2. 发送写入请求,透传 content 的 ImportResponse(含 effectiveMode)──
  try {
    const response = (await browser.tabs.sendMessage(tabId, request)) as
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

/**
 * 把标题设置请求发送到目标 X 标签页并等待结果。
 *
 * @param title    要设置的标题文本。
 * @param conflict 标题冲突策略:'overwrite' 强制覆盖 / 'keep' 保留原标题、跳过设置。
 * @returns 注入引擎的 SetTitleResponse;定位不到 X tab 或 sendMessage 抛错/无应答时
 *          返回 `{ ok: false, error: 'disconnected' }`。
 */
export async function setTitleOnXTab(
  title: string,
  conflict: TitleConflict,
): Promise<SetTitleResponse> {
  const request: RuntimeRequest = { type: SET_TITLE_REQUEST_TYPE, title, conflict };

  const tabId = await resolveTargetXTab();
  if (tabId === null) {
    return { ok: false, error: 'disconnected' };
  }

  try {
    const response = (await browser.tabs.sendMessage(tabId, request)) as
      | SetTitleResponse
      | undefined;
    if (!response) return { ok: false, error: 'disconnected' };
    return response;
  } catch {
    return { ok: false, error: 'disconnected' };
  }
}
