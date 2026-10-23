// isBlockedHost —— SSRF 词法黑名单单测(B10)。输入走 `new URL(...).hostname`,与 background 调用一致。
import { describe, expect, it } from 'vitest';
import { isBlockedHost } from './blockedHost';

const host = (u: string) => new URL(u).hostname;

describe('isBlockedHost', () => {
  it.each([
    // 既有规则(回归)
    'http://localhost/',
    'http://localhost./',
    'http://127.1/',
    'http://0x7f000001/',
    'http://2130706433/',
    'http://10.0.0.1/',
    'http://192.168.1.1/',
    'http://172.16.0.1/',
    'http://169.254.169.254/',
    'http://foo.local/',
    'http://10-0-0-1.nip.io/',
    'http://[::1]/',
    'http://[::]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[fe80::1]/',
    'http://[fd00::1]/',
    // B10 新增
    'http://router/',
    'http://nas/',
    'http://0/',
    'http://0.1.2.3/',
    'http://100.64.0.1/',
    'http://100.127.255.255/',
    'http://foo.home.arpa/',
    'http://home.arpa./',
    'http://224.0.0.1/',
    'http://255.255.255.255/',
    'http://[64:ff9b::7f00:1]/',
    'http://[64:ff9b:1::a00:1]/',
    'http://[::127.0.0.1]/',
    // F6 加固(只加不减)
    'http://localhost../', // 多个尾点
    'http://foo.local../',
    'http://[fe90::1]/', // fe80::/10 全段(fe80–febf),此前只认 fe80:
    'http://[febf::1]/',
    'http://[fec0::1]/', // fec0::/10(已废弃的站点本地)
    'http://[feff::1]/',
    'http://[ff02::1]/', // ff00::/8 组播
    'http://[ff00::1]/',
    'http://x.localdomain/',
    'http://nas.lan/',
    'http://198.18.0.1/', // 198.18.0.0/15 基准测试网段
    'http://198.19.255.255/',
  ])('拦截 %s', (u) => {
    expect(isBlockedHost(host(u))).toBe(true);
  });

  it.each([
    'https://pbs.twimg.com/x.jpg',
    'https://1.1.1.1/',
    'https://example.com',
    'https://fc2.com/',
    'https://fdmedia.io/',
    'https://100.63.0.1/',
    'https://100.128.0.1/',
    'https://0.example.com/',
    'https://[2606:4700::1111]/',
    // F6:新增 IPv6 段只对 IPv6 字面量生效,且按完整首段判定
    'https://[fe7f::1]/',
    'https://fc.example.com/',
    'https://fe80.example.com/',
    'https://ff.example.com/',
    'https://ffmpeg.org/',
    'https://198.20.0.1/',
    'https://198.17.255.255/',
    'https://lan.example.com/',
  ])('放行公网 %s', (u) => {
    expect(isBlockedHost(host(u))).toBe(false);
  });
});
