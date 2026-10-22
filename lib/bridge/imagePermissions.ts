import type { ImportBlock } from '@/lib/bridge/protocol';

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
}

export async function requestRemoteImagePermissions(
  blocks: ImportBlock[],
  extraUrls: string[] = [],
): Promise<RemotePermissionResult> {
  const origins = new Set<string>();
  const addRemote = (src: string) => {
    if (!/^https?:\/\//i.test(src)) return; // 仅远程需要 host 权限
    try {
      origins.add(`${new URL(src).origin}/*`);
    } catch {
      /* 非法 URL 跳过 */
    }
  };
  for (const b of blocks) if (b.kind === 'image') addRemote(b.source);
  // 额外来源(如 frontmatter cover 不在正文图片块里)
  for (const url of extraUrls) addRemote(url);
  const list = [...origins];
  if (list.length === 0) return { granted: true, origins: list };

  // ⚠️ 不能在 request() 之前再 await（如 permissions.contains）——那会消耗用户手势,
  // 导致 request() 脱离手势上下文被 Chrome 拒绝。request() 本身对已授予的权限会立即
  // resolve 且不弹窗,故预检既多余又有害。request() 必须是本函数链上的第一个 await。
  // C25:结果如实回传(此前静默吞掉),由调用方在被拒时提示用户「远程图将降级」。
  try {
    const granted = await browser.permissions.request({ origins: list });
    return { granted: granted === true, origins: list };
  } catch {
    // 环境不支持 / 脱离手势被拒:同样按未授权处理,由上传失败兜底降级。
    return { granted: false, origins: list };
  }
}
