import { browser } from 'wxt/browser';
import {
  isFetchImageRequest,
  type FetchImageResponse,
} from '@/lib/bridge/protocol';

/** onMessage 监听回调的 sender 类型:从运行时 API 推导,避免依赖具体 polyfill 包路径。 */
type MessageSender = Parameters<
  Parameters<typeof browser.runtime.onMessage.addListener>[0]
>[1];

/** 单图字节上限(16MB):超限拒绝,避免拖垮上传 / 内存。 */
const MAX_BYTES = 16 * 1024 * 1024;
/** 远程抓取超时(20s)。 */
const FETCH_TIMEOUT_MS = 20_000;

/**
 * 以 magic bytes 判定真实图片类型(响应头 content-type / URL 扩展名都可伪造,不可信)。
 * 只认 X 支持的四类;不匹配返回 null → 拒绝上传非图片字节。
 */
function sniffImageMime(b: Uint8Array): string | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // "RIFF"
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // "WEBP"
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * 流式读取响应体,累计超过 max 立即中止并返回 null——避免恶意服务器在超时窗口内推送
 * 超大数据把内存撑爆(arrayBuffer() 会先全量落盘才判)。无 body 流时退回一次性读 + 事后判。
 */
async function readCapped(resp: Response, max: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const reader = resp.body?.getReader();
  if (!reader) {
    const buf = await resp.arrayBuffer();
    return buf.byteLength > max ? null : new Uint8Array(buf);
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/**
 * SSRF 防护:拒绝指向内网 / 回环 / 链路本地的主机,防止被 Markdown 里的恶意图片 URL
 * 当作探测内网的跳板。仅做主机名层面的最佳努力拦截(扩展上下文无法在 fetch 前解析 DNS,
 * DNS rebinding 无法完全防住;叠加「按来源 origin 运行时申请权限」已收敛面)。
 *
 * 残留风险(诚实标注,扩展层无法根治):这是纯词法(lexical)黑名单,只看主机名字符串。
 * 对于「公网 DNS 名解析到内网 IP」的攻击(A/AAAA 记录指向 169.254.169.254 或私网段,
 * 含 DNS rebinding),扩展在 fetch 前拿不到 resolved IP,词法层面无从判断,故无法根治。
 * 现有纵深缓解为多层叠加:词法黑名单 + credentials:'omit'(不带凭据)+ magic-byte 内容
 * 嗅探(只上传真图片字节、不外泄内网响应文本)+ 按来源 origin 精确申请 host 权限 +
 * 重定向最终落点复查。下方对常见「泛解析到内网」的 wildcard-DNS 服务后缀做了词法拦截,
 * 属尽力而为,并不能覆盖任意自建的内网解析域名。
 */
function isBlockedHost(host: string): boolean {
  const raw = host.toLowerCase();
  const unbracketed = raw.replace(/^\[|\]$/g, ''); // 去掉 IPv6 字面量方括号
  // 是否为 IPv6 字面量:被方括号包裹,或去括号后仍含冒号。fc/fd 前缀规则仅对它生效。
  const isIPv6Literal = raw.startsWith('[') || unbracketed.includes(':');
  // 归一剥「尾点」(FQDN 根标签):`new URL('http://localhost./').hostname` === 'localhost.',
  // 尾点被保留会让 'localhost.'/'foo.local.'/'x.nip.io.' 绕过下方精确/后缀匹配 → 放行到回环/内网。
  // 尾点只对命名主机 / IPv4 有意义;IPv6 字面量(`[::1]` 等)不带尾点,剥了反而可能误伤,故跳过。
  const h = isIPv6Literal ? unbracketed : unbracketed.replace(/\.$/, '');
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.localhost')) return true;
  if (h === '0.0.0.0' || h === '::1' || h === '::') return true;
  // 常见「泛解析到内网 / 回环」的 wildcard-DNS 服务:形如 10-0-0-1.nip.io、
  // 127.0.0.1.sslip.io、xxx.localtest.me 会被公网 DNS 解析到内网/回环地址。
  // 尽力而为地按后缀拦截(无法穷举所有自建域名,见函数头注释)。
  const wildcardDnsSuffixes = ['.nip.io', '.sslip.io', '.xip.io', '.localtest.me', '.lvh.me', '.vcap.me'];
  if (h === 'localtest.me' || h === 'lvh.me' || h === 'vcap.me') return true;
  if (wildcardDnsSuffixes.some((s) => h.endsWith(s))) return true;
  // IPv4-mapped IPv6(::ffff:127.0.0.1 / ::ffff:7f00:1)会被 URL 规范化成 ::ffff:… 而绕过
  // 下面的 IPv4 私网规则,实际却路由到内网 → 一律拒绝。合法图床没有用它的理由。
  if (h.includes('::ffff:') || h.includes('::ffff.')) return true;
  // IPv4 回环 / 私有 / 链路本地
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  // IPv6 回环 / 链路本地(fe80::/10) / 唯一本地(fc00::/7)。
  // fc/fd 前缀是 IPv6 唯一本地地址(fc00::/7)的判据,只能对 IPv6 字面量生效——
  // 否则会误伤 fc2.com、fdmedia.io 等以 fc/fd 开头的合法域名(P0#3)。
  if (isIPv6Literal && (h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd'))) return true;
  return false;
}

/** 从 URL / MIME 推导文件名(带扩展名),供 new File(...) 使用。 */
function deriveFileName(url: string, mime: string): string {
  const extByMime: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
  };
  const ext = extByMime[mime] ?? 'img';
  let base = 'image';
  try {
    const path = new URL(url).pathname;
    const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
    if (name) base = decodeURIComponent(name).replace(/[^\w.-]+/g, '_').slice(0, 60) || 'image';
  } catch {
    /* URL 解析失败用默认名 */
  }
  return `${base}.${ext}`;
}

/** ArrayBuffer → base64(分块避免 String.fromCharCode 参数过多爆栈)。 */
function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** 代理下载一张远程图片,校验后以 base64 回传;任一环节不过关返回诊断短语。 */
async function fetchImage(rawUrl: string): Promise<FetchImageResponse> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, error: 'invalid url' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'unsupported protocol' };
  }
  if (isBlockedHost(url.hostname)) {
    return { ok: false, error: 'blocked host' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // credentials:'omit' —— 不携带第三方 cookie,避免被当作已登录会话取私有资源。
    const resp = await fetch(url.href, { credentials: 'omit', redirect: 'follow', signal: controller.signal });
    if (!resp.ok) return { ok: false, error: `http ${resp.status}` };

    // 跟随重定向后复检最终落点(resp.url):挡「公网图床 302 跳内网 / 云元数据」的 SSRF。
    // 跨源重定向的 manual 响应是 opaqueredirect、读不到 Location,故不逐跳而查最终 URL——
    // 能防数据外泄(不把内网响应上传给 X),残留仅「内网被访问一次」的探测风险(与 DNS
    // rebinding 同类,扩展层无法根治,已知悉)。
    try {
      if (isBlockedHost(new URL(resp.url || url.href).hostname)) {
        return { ok: false, error: 'blocked host (redirected)' };
      }
    } catch {
      /* resp.url 解析失败:忽略,继续按内容校验 */
    }

    // Content-Length 预筛(能省则省),再流式读取、超限即时中止,避免内存被撑爆。
    const declared = resp.headers.get('content-length');
    if (declared && Number(declared) > MAX_BYTES) return { ok: false, error: 'too large' };
    const bytes = await readCapped(resp, MAX_BYTES);
    if (!bytes) return { ok: false, error: 'too large' };
    if (bytes.byteLength === 0) return { ok: false, error: 'empty body' };

    // 真实类型以 magic bytes 为准(响应头 / URL 扩展名可伪造);非白名单图片一律拒绝。
    const mime = sniffImageMime(bytes);
    if (!mime) return { ok: false, error: 'not a supported image' };

    return { ok: true, base64: bufferToBase64(bytes.buffer), mime, fileName: deriveFileName(url.href, mime) };
  } catch (err) {
    return { ok: false, error: controller.signal.aborted ? 'timeout' : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

export default defineBackground(() => {
  // 点击工具栏图标即打开侧边栏
  chrome.sidePanel
    ?.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err: unknown) => console.error('[MarkFlow] setPanelBehavior failed', err));

  // content → background 远程抓图代理。返回 Promise 即异步应答。
  browser.runtime.onMessage.addListener(
    (message: unknown, sender: MessageSender): Promise<FetchImageResponse> | undefined => {
      // 纵深校验:只处理本扩展自身发来的消息(拒绝其他扩展 / 外部页面伪造)。
      if (sender.id !== browser.runtime.id) return undefined;
      // 来自标签页(content script)的消息:进一步限制发起帧属 x.com / twitter.com。
      // 用 sender.origin / sender.url(content script 发来的消息总带,不依赖 tabs 权限),
      // 不再读 sender.tab.url(B4 去掉 tabs 后不保证可读)。范围与 content_scripts 一致,不含子域。
      // 非标签页来源(扩展自身页面)跳过该项、由上面的 id 校验兜底。
      if (sender.tab) {
        // origin 为 Chrome 80+ 字段,webextension-polyfill 的类型未收录,故窄化断言。
        const from = (sender as MessageSender & { origin?: string }).origin ?? sender.url;
        if (!from) return undefined; // 标签页来源却无 origin/url:保守拒绝
        let host: string;
        try {
          host = new URL(from).hostname.toLowerCase();
        } catch {
          return undefined; // URL 解析失败:保守拒绝
        }
        if (host !== 'x.com' && host !== 'twitter.com') return undefined;
      }
      if (isFetchImageRequest(message)) return fetchImage(message.url);
      return undefined; // 非本扩展关心的消息:交给其他监听器
    },
  );
});
