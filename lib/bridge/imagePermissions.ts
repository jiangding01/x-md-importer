import { images } from '@/lib/markdown/capability';

/**
 * 远程图片的 host 权限运行时申请。
 *
 * 远程图片由 background 代理下载,需要对应来源 origin 的 host 权限。为最小权限 + 商店审核
 * 友好,不静态声明广域 host,而是在写入时(用户点击手势内)按草稿里出现的远程图 origin
 * 用 chrome.permissions.request 申请。用户拒绝 → 那些图上传失败、降级为原文(不阻断正文)。
 *
 * ⚠️ 必须在用户手势(写入按钮点击链)的同步阶段发起——故调用方应把它放在 startImport 的
 * 最前面、任何 await 之前。
 */
export async function requestRemoteImagePermissions(md: string): Promise<void> {
  const origins = new Set<string>();
  for (const img of images(md)) {
    if (img.kind !== 'remote') continue;
    try {
      origins.add(`${new URL(img.src).origin}/*`);
    } catch {
      /* 非法 URL 跳过 */
    }
  }
  if (origins.size === 0) return;

  // ⚠️ 不能在 request() 之前再 await（如 permissions.contains）——那会消耗用户手势,
  // 导致 request() 脱离手势上下文被 Chrome 拒绝。request() 本身对已授予的权限会立即
  // resolve 且不弹窗,故预检既多余又有害。request() 必须是本函数链上的第一个 await。
  try {
    await browser.permissions.request({ origins: [...origins] });
  } catch {
    /* 环境不支持 / 用户拒绝:静默,由上传失败兜底降级 */
  }
}
