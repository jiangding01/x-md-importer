import {
  CLEAR_FOLDER_TYPE,
  CONNECT_FOLDER_TYPE,
  FOLDER_STATUS_TYPE,
  IMPORT_REQUEST_TYPE,
  SET_TITLE_REQUEST_TYPE,
  type FolderResponse,
  type ImportBlock,
  type ImportMode,
  type ImportResponse,
  type RuntimeRequest,
  type SetTitleResponse,
  type TitleConflict,
  type VaultScope,
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
  coverSource: string | null = null,
  scrollTop = false,
  compress: { maxEdge: string; quality: number } | null = null,
): Promise<ImportResponse> {
  const request: RuntimeRequest = { type: IMPORT_REQUEST_TYPE, blocks, mode, coverSource, scrollTop, compress };

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

/**
 * 向目标 X 标签页发起本地文件夹请求(连接 / 清除 / 状态查询三类共用)。
 * 定位不到 X tab 或 sendMessage 抛错/无应答 → 统一归为 `{ ok: false, error: 'disconnected' }`,
 * 与 importToXTab / setTitleOnXTab 的通道层错误处理保持一致。
 */
async function sendFolderRequest(request: RuntimeRequest): Promise<FolderResponse> {
  const tabId = await resolveTargetXTab();
  if (tabId === null) {
    return { ok: false, error: 'disconnected' };
  }

  try {
    const response = (await browser.tabs.sendMessage(tabId, request)) as FolderResponse | undefined;
    if (!response) return { ok: false, error: 'disconnected' };
    return response;
  } catch {
    return { ok: false, error: 'disconnected' };
  }
}

/**
 * 触发本地图片文件夹连接:content 在 X 页面弹出一次性浮层,由用户手势触发
 * `showDirectoryPicker` 完成授权。
 *
 * @param scope 'active'=素材板「当前文章」文件夹(优先级高);'persistent'=设置默认文件夹(兜底)。
 * @param forcePick true=「更换」强制重新选择文件夹;缺省/false=「连接 / 恢复」,存量 handle 仅
 *                  权限回落(浏览器重启)时一键 requestPermission 复用,免重选。
 * @returns 连接成功回 `{ok:true, connected:true, folderName}`;用户取消回
 *          `{ok:false, error:'cancelled'}`;定位不到 X tab 时回 `{ok:false, error:'disconnected'}`。
 */
export async function connectFolder(scope: VaultScope, forcePick = false): Promise<FolderResponse> {
  return sendFolderRequest({ type: CONNECT_FOLDER_TYPE, scope, forcePick });
}

/** 清除指定作用域已连接的本地图片文件夹。 */
export async function clearFolder(scope: VaultScope): Promise<FolderResponse> {
  return sendFolderRequest({ type: CLEAR_FOLDER_TYPE, scope });
}

/** 查询指定作用域本地图片文件夹的连接状态。 */
export async function getFolderStatus(scope: VaultScope): Promise<FolderResponse> {
  return sendFolderRequest({ type: FOLDER_STATUS_TYPE, scope });
}
