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
  ])('放行公网 %s', (u) => {
    expect(isBlockedHost(host(u))).toBe(false);
  });
});
