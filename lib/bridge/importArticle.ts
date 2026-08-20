import {
  CLEAR_FOLDER_TYPE,
  CONNECT_FOLDER_TYPE,
  FOLDER_STATUS_TYPE,
  IMPORT_REQUEST_TYPE,
  PROBE_REQUEST_TYPE,
  SET_TITLE_REQUEST_TYPE,
  type FolderResponse,
  type ImportBlock,
  type ImportMode,
  type ImportResponse,
  type ProbeResponse,
  type RuntimeRequest,
  type SetTitleResponse,
  type TitleConflict,
  type VaultScope,
} from './protocol';
import { resolveTargetXTab } from './locateXTab';

/**
 * 超时标记(B4-7/P2-18):用具名 Error 而非裸 reject(原因)或 Symbol,方便调用方 / 测试用
 * `instanceof` 判定,且不会与「被包装的 promise 自身失败」的普通 Error 混淆。
 */
export class TimeoutError extends Error {
  constructor() {
    super('operation timed out');
    this.name = 'TimeoutError';
  }
}

/**
 * 给一个 Promise 包一层超时:到点先 reject(TimeoutError),不影响被包装的 promise 继续在
 * 后台跑完(sendMessage 无取消语义,调用方只是不再等待,底层由 content 侧自己的更长兜底收尾)。
 * 导出供单测直接驱动(不依赖 chrome/browser 全局)。
 */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError()), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

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
  pinnedTabId?: number,
  expectedArticleId: string | null = null,
): Promise<ImportResponse> {
  const request: RuntimeRequest = { type: IMPORT_REQUEST_TYPE, blocks, mode, coverSource, scrollTop, compress, expectedArticleId };

  // ── 1. 定位目标 X 标签页(拿不到直接判「未连接」)──
  // 传入 pinnedTabId(startImport 开头解析一次并全程复用)时**跳过内部重解析**,直接用它——
  // 否则多图/ask 弹窗挂起期间用户切到另一篇 X 草稿,此处重解析会命中那一篇、写错目标(review B1)。
  // 不传时维持原行为(自行解析当前活动标签),保持向后兼容。
  // ⚠️ 此行曾在一次批量文本替换中被误还原成无条件重解析(批次四 code review 抓回)——
  // pinnedTabId 必须优先,否则注释描述的 B1 防线只剩注释。
  const tabId = pinnedTabId ?? (await resolveTargetXTab());
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
  pinnedTabId?: number,
): Promise<SetTitleResponse> {
  const request: RuntimeRequest = { type: SET_TITLE_REQUEST_TYPE, title, conflict };

  // 标题阶段在正文写完后才跑,是 review B1 的核心暴露点:必须复用 startImport 钉死的
  // pinnedTabId,而非在此重解析「当前活动标签」——否则弹窗挂起期间用户切走会静默覆盖别篇标题。
  // ⚠️ 同 importToXTab:此行曾被批量替换误还原,pinnedTabId 必须优先(批次四 code review 抓回)。
  const tabId = pinnedTabId ?? (await resolveTargetXTab());
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
 *
 * 超时按消息类型区分(B4-7/P2-18):此前完全不设超时,坏库状态(如 idbRun 同步抛导致
 * Promise 悬挂——已在 localVault.ts 修)会让「连接/清除文件夹」按钮永久 pending。
 * FOLDER_STATUS/CLEAR_FOLDER 是纯后台读写,给 10s 预算足够正常完成、也能在异常时把按钮
 * 解放出来。**CONNECT_FOLDER 不设超时**——用户要在系统目录选择器里手动选择文件夹,耗时
 * 不可控且常见地超过 10s,一刀切超时会在用户还没选完时就误判失败,直接弄坏「连接文件夹」
 * 这个核心功能;content 侧本身对 connect 已有 180s 兜底(entrypoints/content.ts `finish`
 * 前的 `setTimeout(..., 180_000)`),这里不必重复设限。
 */
async function sendFolderRequest(request: RuntimeRequest): Promise<FolderResponse> {
  const tabId = await resolveTargetXTab();
  if (tabId === null) {
    return { ok: false, error: 'disconnected' };
  }

  const timeoutMs = request.type === CONNECT_FOLDER_TYPE ? undefined : 10_000;

  try {
    const sendPromise = browser.tabs.sendMessage(tabId, request) as Promise<FolderResponse | undefined>;
    const response = await (timeoutMs === undefined ? sendPromise : withTimeout(sendPromise, timeoutMs));
    if (!response) return { ok: false, error: 'disconnected' };
    return response;
  } catch (err) {
    if (err instanceof TimeoutError) return { ok: false, error: 'timeout' };
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

/**
 * 即时探一次目标 X 编辑器的连接与「已有内容」状态,返回**新鲜**值(review #5)。
 *
 * useProbe 的快照只在挂载/tab 事件/手动刷新/导入后更新——用户切到 X tab(彼时编辑器空)
 * 后在编辑器手打内容不会触发重探,导致 onExisting='ask' 误判「编辑器为空」直接 replace、
 * 覆盖手打内容。写入决策(ask/replace)前调用本函数拿到当下真相,而非依赖陈旧快照。
 *
 * connected 语义与 useConnection 对齐:探针 ready(response.ok)且定位到 Draft 实例
 * (hasDraftNode)才算已连接;hasContent 取探针结果(未连接时恒 false)。
 */
export async function probeXTabContent(): Promise<{
  connected: boolean;
  hasContent: boolean;
  /** 实际探测的 tabId(B2-1:供调用方钉死,与 articleId 组成双钥);定位失败为 null。 */
  tabId: number | null;
  /** 探测时目标页的文章 id(B2-1 双钥之二);未连接/非编辑页为 null。 */
  articleId: string | null;
}> {
  const tabId = await resolveTargetXTab();
  if (tabId === null) return { connected: false, hasContent: false, tabId: null, articleId: null };

  try {
    const response = (await browser.tabs.sendMessage(tabId, { type: PROBE_REQUEST_TYPE })) as
      | ProbeResponse
      | undefined;
    if (!response || !response.ok) return { connected: false, hasContent: false, tabId, articleId: null };
    return {
      connected: response.result.hasDraftNode,
      hasContent: response.result.hasContent,
      tabId,
      articleId: response.result.articleId,
    };
  } catch {
    return { connected: false, hasContent: false, tabId, articleId: null };
  }
}
