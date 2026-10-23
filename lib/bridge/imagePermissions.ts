import { isBlockedHost } from '@/lib/bridge/blockedHost';
import type { ImageFailure, ImportBlock } from '@/lib/bridge/protocol';

/**
 * 远程图片的 host 权限运行时申请。
 *
 * 远程图片由 background 代理下载,需要对应来源 origin 的 host 权限。为最小权限 + 商店审核
 * 友好,不静态声明广域 host,而是在写入时(用户点击手势内)按草稿里出现的远程图 origin
 * 用 chrome.permissions.request 申请。用户拒绝 → 那些图上传失败、降级为原文(不阻断正文)。
 *
 * 图片来源取**调用方已解析好的 blocks**(B3-4 / P1-7),不在本模块再解析一次:
 *  - 旧实现用 capability.images() 的全文正则 `\(([^)]+)\)` 抓 src,`![](<https://h/a.png>)`
 *    抓到带 `<>` 的串被判成 local → 该 origin 不申请 → background 下载必被 Chrome 拒;
 *  - 全文正则还会把代码块内 / 行内的图片算进来(它们根本不会上传),申请多余的 host 权限;
 *  - 传 blocks 而非 md,也避免「同一份文档第三次全量解析」与随之而来的口径漂移
 *    (AssetsCard 已因此立过规矩:必须用 parseMarkdown 的块级结果)。
 *
 * ⚠️ 必须在用户手势(写入按钮点击链)的同步阶段发起——故调用方应把它放在 startImport 的
 * 最前面、任何 await 之前。parseMarkdown 是**同步**函数,把解析提到本调用之前不引入新的
 * await,该约束不受影响。
 */
export interface RemotePermissionResult {
  /** 全部所需 origin 已授权(含「无远程来源、无需申请」);用户拒绝 / 申请抛错为 false。 */
  granted: boolean;
  /** 本次申请的 origin 模式列表(`https://h/*`);无远程来源时为空数组。 */
  origins: string[];
  /**
   * B4:origins 中**确实未授权**的子集。`permissions.request` 全有或全无——拒绝不影响此前已授权
   * 的 origin,故不能把「被拒」等同于「全部未授权」。granted=true 时恒为空。
   */
  deniedOrigins: string[];
}

/**
 * 远程图片地址 → host 权限的 origin 模式(`${origin}/*`)。**本模块唯一的 origin 计算**:
 * 申请、toast 计数、失败改标共用,不再有第二套口径(B4)。
 * 返回 null:非 http(s)(本地 / dataURI 不需要 host 权限)、解析失败,或命中 isBlockedHost
 * (B5:内网 / localhost / 单标签主机 background 必拒,申请了也用不上,不进申请也不进计数)。
 */
export function originPatternOf(src: string): string | null {
  if (!/^https?:\/\//i.test(src)) return null; // 仅远程需要 host 权限
  try {
    const url = new URL(src);
    if (isBlockedHost(url.hostname)) return null;
    return `${url.origin}/*`;
  } catch {
    return null; // 非法 URL 跳过
  }
}

/** 正文图片块 + 额外来源(封面)→ 去重的 origin 列表。 */
function collectOrigins(blocks: ImportBlock[], extraUrls: string[]): string[] {
  const origins = new Set<string>();
  const add = (src: string) => {
    const o = originPatternOf(src);
    if (o) origins.add(o);
  };
  for (const b of blocks) if (b.kind === 'image') add(b.source);
  // 额外来源(如 frontmatter cover 不在正文图片块里)
  for (const url of extraUrls) add(url);
  return [...origins];
}

/**
 * 逐 origin 查询是否已授权,返回未授权子集。contains 无需手势、不弹窗;单个 origin 查询抛错
 * (环境不支持等)按未授权处理——宁可多提示,不把失败归因漏掉。
 */
async function deniedAmong(origins: string[]): Promise<string[]> {
  const denied: string[] = [];
  for (const o of origins) {
    try {
      if (!(await browser.permissions.contains({ origins: [o] }))) denied.push(o);
    } catch {
      denied.push(o);
    }
  }
  return denied;
}

export async function requestRemoteImagePermissions(
  blocks: ImportBlock[],
  extraUrls: string[] = [],
): Promise<RemotePermissionResult> {
  const list = collectOrigins(blocks, extraUrls);
  if (list.length === 0) return { granted: true, origins: list, deniedOrigins: [] };

  // ⚠️ 不能在 request() 之前再 await（如 permissions.contains）——那会消耗用户手势,
  // 导致 request() 脱离手势上下文被 Chrome 拒绝。request() 本身对已授予的权限会立即
  // resolve 且不弹窗,故预检既多余又有害。request() 必须是本函数链上的第一个 await。
  // C25:结果如实回传(此前静默吞掉),由调用方在被拒时提示用户。
  // B4:被拒(或抛错)后**再**逐 origin contains 求未授权子集——此时手势已用过,contains 无需手势。
  let granted: boolean;
  try {
    granted = (await browser.permissions.request({ origins: list })) === true;
  } catch {
    // 环境不支持 / 脱离手势被拒:同样按未授权处理,由上传失败兜底降级。
    granted = false;
  }
  if (granted) return { granted: true, origins: list, deniedOrigins: [] };
  return { granted: false, origins: list, deniedOrigins: await deniedAmong(list) };
}

/**
 * B6:只查不申请——ask 模式确认覆盖路径用。首次点击已申请过(手势已用掉),确认时再 request
 * 会二次弹窗 / 二次 toast;这里仅对**当前** origins 调 contains 重算未授权子集(对话框期间
 * 草稿或权限变化也能反映),供失败改标使用。不弹窗、无需手势。
 */
export async function queryRemoteImagePermissions(
  blocks: ImportBlock[],
  extraUrls: string[] = [],
): Promise<RemotePermissionResult> {
  const list = collectOrigins(blocks, extraUrls);
  if (list.length === 0) return { granted: true, origins: list, deniedOrigins: [] };
  const deniedOrigins = await deniedAmong(list);
  return { granted: deniedOrigins.length === 0, origins: list, deniedOrigins };
}

/**
 * B4:未获授权的远程图张数(toast 用)。按**块**计(同 origin 多张各算一张),含远程封面——
 * 与「图片 x/y」口径一致;已授权 origin、本地 / dataURI、被拦主机都不计。
 */
export function countDeniedRemote(
  blocks: ImportBlock[],
  coverSource: string | null,
  deniedOrigins: string[],
): number {
  if (!deniedOrigins.length) return 0;
  const denied = new Set(deniedOrigins);
  const isDenied = (src: string) => {
    const o = originPatternOf(src);
    return o !== null && denied.has(o);
  };
  let n = 0;
  for (const b of blocks) if (b.kind === 'image' && isDenied(b.source)) n += 1;
  if (coverSource !== null && isDenied(coverSource)) n += 1;
  return n;
}

/**
 * B4(C25 改标收窄):无 host 权限的跨源 fetch 只表现为 `TypeError: Failed to fetch`,content 分辨
 * 不出权限与网络故障;这里把**来源 origin ∈ deniedOrigins** 的网络类失败改标为
 * remote-permission-denied。已授权 origin 的同类失败(真网络故障)、http 4xx / 超时 / 非图片等
 * 明确原因保持原样。`f.source` 已被截到 80 字符:截断通常只落在路径段、origin 仍可解析;
 * 解析失败(或 host 被截断导致 origin 不符)则不改标,宁可保留原因码也不误判。
 */
export function relabelPermissionFailures(failures: ImageFailure[], deniedOrigins: string[]): ImageFailure[] {
  if (!deniedOrigins.length) return failures;
  const denied = new Set(deniedOrigins);
  return failures.map((f) => {
    if (f.reason !== 'remote-fetch-failed' || !/failed to fetch|permission/i.test(f.detail ?? '')) return f;
    const o = originPatternOf(f.source);
    return o !== null && denied.has(o) ? { ...f, reason: 'remote-permission-denied' } : f;
  });
}
