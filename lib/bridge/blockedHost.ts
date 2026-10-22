/**
 * SSRF 词法黑名单(纯函数,background 远程图代理使用;抽出以便单测——B10)。
 * HANDOFF §8:此防护不可删、只能加强。
 */

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
export function isBlockedHost(host: string): boolean {
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
  // —— B10 加强(只加不删)——
  // 单标签主机(无点的命名主机,如 router / nas / intranet):只可能经本地搜索域 / mDNS / hosts
  // 解析到内网设备,合法公网图床必有点 → 一律拒。数字形式(`0`、`2130706433`)会被 URL 规范化为
  // 点分 IPv4,不受影响;IPv6 字面量另行判断。
  if (!isIPv6Literal && !h.includes('.')) return true;
  // RFC 8375 家庭网络专用域。
  if (h === 'home.arpa' || h.endsWith('.home.arpa')) return true;
  // 以下 IPv4 段只对点分 IPv4 字面量生效(避免误伤 0.example.com 一类域名)。
  const isIPv4Literal = /^\d{1,3}(\.\d{1,3}){3}$/.test(h);
  if (isIPv4Literal) {
    if (/^0\./.test(h)) return true; // 0.0.0.0/8「本网络」
    if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)) return true; // 100.64.0.0/10 CGNAT
    if (/^(22[4-9]|2[3-5]\d)\./.test(h)) return true; // 224.0.0.0/4 组播 + 240.0.0.0/4 保留/广播
  }
  if (isIPv6Literal) {
    // NAT64 前缀 64:ff9b::/96 与本地用途 64:ff9b:1::/48(RFC 6052/8215):内嵌 IPv4 可指向内网
    //(如 [64:ff9b::7f00:1] → 127.0.0.1)→ 一律拒。
    if (h.startsWith('64:ff9b:')) return true;
    // 以 `::` 开头的地址全落在 ::/96 一带(::1 回环、:: 未指定、::ffff:0:0/96 映射、已废弃的
    // IPv4-compatible `::a.b.c.d`——URL 会把 [::127.0.0.1] 规范化成 [::7f00:1])。公网单播地址首段
    // 必非 0,合法图床不会用 → 一律拒,作为 ::ffff: 映射规则的复检兜底。
    if (h.startsWith('::')) return true;
  }
  return false;
}
