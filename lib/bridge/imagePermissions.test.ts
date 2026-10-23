// lib/bridge/imagePermissions.ts 单测(B3-4 / P1-7)。
// 关键口径:权限申请的图片来源必须是 **parseMarkdown 的块级产出**,而非全文正则——
// 后者把 `![](<https://h/a.png>)` 判成 local(不申请 → background 下载被 Chrome 拒),
// 还会把代码块内 / 行内的图片一起算进来(申请了永远用不到的 host 权限)。
import { beforeEach, describe, expect, it } from 'vitest';
import {
  countDeniedRemote,
  originPatternOf,
  queryRemoteImagePermissions,
  relabelPermissionFailures,
  requestRemoteImagePermissions,
} from './imagePermissions';
import { parseMarkdown } from '../markdown/parser';
import type { ImageFailure, ImportBlock } from './protocol';

/** 每次调用记录一次 origins 参数;未调用则数组为空。 */
const requested: string[][] = [];
/** request() 的行为:true/false = 用户授权/拒绝;'throw' = 环境不支持或脱离手势被拒。 */
let answer: boolean | 'throw' = true;
/** contains() 的调用记录(每次一个 origin 列表)。 */
const containsCalls: string[][] = [];
/** request / contains 按发生顺序记录(断言 request 是第一个权限 API 调用)。 */
const callOrder: string[] = [];
/** contains() 的行为:已授权的 origin 集合;'throw' = contains 本身抛错。 */
let grantedSet: Set<string> | 'throw' = new Set();

beforeEach(() => {
  requested.length = 0;
  answer = true;
  containsCalls.length = 0;
  callOrder.length = 0;
  grantedSet = new Set();
  (globalThis as unknown as { browser: unknown }).browser = {
    permissions: {
      request: async (p: { origins: string[] }) => {
        requested.push(p.origins);
        callOrder.push('request');
        if (answer === 'throw') throw new Error('This function must be called during a user gesture');
        return answer;
      },
      contains: async (p: { origins: string[] }) => {
        containsCalls.push(p.origins);
        callOrder.push('contains');
        if (grantedSet === 'throw') throw new Error('contains unavailable');
        const set = grantedSet;
        return p.origins.every((o) => set.has(o));
      },
    },
  };
});

/** 便捷:解析 md 后申请权限,返回本次申请的 origins(未申请 → null)。 */
async function originsFor(md: string, extraUrls: string[] = []): Promise<string[] | null> {
  await requestRemoteImagePermissions(parseMarkdown(md), extraUrls);
  return requested[0] ?? null;
}

describe('requestRemoteImagePermissions', () => {
  it('`<>` 包裹的远程图仍申请其 origin(P1-7 主用例)', async () => {
    expect(await originsFor('![](<https://h.example.com/a b.png>)')).toEqual(['https://h.example.com/*']);
  });

  it('URL 内含括号不被截断', async () => {
    expect(await originsFor('![a](https://h.example.com/f(1).png)')).toEqual(['https://h.example.com/*']);
  });

  it('代码围栏内的图片不申请权限(块级产出天然跳过)', async () => {
    expect(await originsFor('```\n![](https://code.example.com/a.png)\n```')).toBeNull();
  });

  it('行内图片不申请权限(不会上传,申请了也用不到)', async () => {
    expect(await originsFor('正文里有 ![x](https://inline.example.com/a.png) 一张图。')).toBeNull();
  });

  it('本地路径 / dataURI 不申请权限', async () => {
    expect(await originsFor('![](assets/a.png)\n\n![](data:image/png;base64,AAAA)')).toBeNull();
  });

  it('多张远程图去重成 origin 集合', async () => {
    const origins = await originsFor(
      '![](https://a.example.com/1.png)\n\n![](https://a.example.com/2.png)\n\n![](https://b.example.com/3.png)',
    );
    expect(origins?.slice().sort()).toEqual(['https://a.example.com/*', 'https://b.example.com/*']);
  });

  it('extraUrls(frontmatter 封面)同样纳入申请', async () => {
    expect(await originsFor('正文无图', ['https://cover.example.com/c.png'])).toEqual([
      'https://cover.example.com/*',
    ]);
  });

  it('无远程来源时不发起申请,按「已授权、无 origin」返回', async () => {
    expect(await requestRemoteImagePermissions([], [])).toEqual({ granted: true, origins: [], deniedOrigins: [] });
    expect(requested).toHaveLength(0);
  });

  it('非法 URL 被跳过而非抛错', async () => {
    await expect(requestRemoteImagePermissions([], ['https://'])).resolves.toEqual({
      granted: true,
      origins: [],
      deniedOrigins: [],
    });
    expect(requested).toHaveLength(0);
  });

  // C25:结果如实回传,调用方据此提示「N 张远程图未获授权」
  it('用户授权 → granted=true 并带回申请的 origins', async () => {
    const res = await requestRemoteImagePermissions(parseMarkdown('![](https://h.example.com/a.png)'));
    expect(res).toEqual({ granted: true, origins: ['https://h.example.com/*'], deniedOrigins: [] });
  });

  it('用户拒绝 → granted=false(不抛错)', async () => {
    answer = false;
    const res = await requestRemoteImagePermissions(parseMarkdown('![](https://h.example.com/a.png)'));
    expect(res).toEqual({
      granted: false,
      origins: ['https://h.example.com/*'],
      deniedOrigins: ['https://h.example.com/*'],
    });
  });

  it('request() 抛错(脱离手势 / 环境不支持)→ 按未授权处理', async () => {
    answer = 'throw';
    const res = await requestRemoteImagePermissions([], ['https://cover.example.com/c.png']);
    expect(res).toEqual({
      granted: false,
      origins: ['https://cover.example.com/*'],
      deniedOrigins: ['https://cover.example.com/*'],
    });
  });

  // B4:deniedOrigins 只含真正未授权的 origin(permissions.request 全有或全无,已授权的不受拒绝影响)
  it('request=true → 不调 contains,deniedOrigins=[]', async () => {
    const res = await requestRemoteImagePermissions(
      parseMarkdown('![](https://a.example.com/1.png)\n\n![](https://b.example.com/2.png)'),
    );
    expect(res.deniedOrigins).toEqual([]);
    expect(containsCalls).toHaveLength(0);
  });

  it('request=false + contains 部分已授权 → deniedOrigins 只含未授权的', async () => {
    answer = false;
    grantedSet = new Set(['https://a.example.com/*']);
    const res = await requestRemoteImagePermissions(
      parseMarkdown('![](https://a.example.com/1.png)\n\n![](https://b.example.com/2.png)'),
    );
    expect(res.granted).toBe(false);
    expect(res.deniedOrigins).toEqual(['https://b.example.com/*']);
    // request 仍是第一个 await:contains 只在 request 之后发生
    expect(callOrder).toEqual(['request', 'contains', 'contains']);
  });

  it('request 抛错 + contains 抛错 → deniedOrigins = 全部 origins', async () => {
    answer = 'throw';
    grantedSet = 'throw';
    const res = await requestRemoteImagePermissions(
      parseMarkdown('![](https://a.example.com/1.png)\n\n![](https://b.example.com/2.png)'),
    );
    expect(res.deniedOrigins.slice().sort()).toEqual(['https://a.example.com/*', 'https://b.example.com/*']);
  });

  // B5:被拦主机(内网 / localhost / 单标签)background 必拒,不进申请
  it('被拦主机不进 origins(不申请、不计入)', async () => {
    const res = await requestRemoteImagePermissions(
      parseMarkdown(
        '![](http://192.168.1.1/a.png)\n\n![](http://localhost:1313/a.png)\n\n![](http://nas/a.png)\n\n![](https://ok.example.com/a.png)',
      ),
    );
    expect(res.origins).toEqual(['https://ok.example.com/*']);
    expect(requested).toEqual([['https://ok.example.com/*']]);
  });

  it('全部来源都是被拦主机 → 不发起申请', async () => {
    const res = await requestRemoteImagePermissions([], ['http://192.168.1.1/c.png']);
    expect(res).toEqual({ granted: true, origins: [], deniedOrigins: [] });
    expect(requested).toHaveLength(0);
  });
});

describe('originPatternOf(B4/B5 单一 origin 计算)', () => {
  it('http(s) 远程地址 → `${origin}/*`', () => {
    expect(originPatternOf('https://h.example.com/a/b.png?x=1')).toBe('https://h.example.com/*');
    expect(originPatternOf('http://h.example.com:8080/a.png')).toBe('http://h.example.com:8080/*');
  });

  it('非 http(s) / 解析失败 → null', () => {
    expect(originPatternOf('assets/a.png')).toBeNull();
    expect(originPatternOf('data:image/png;base64,AAAA')).toBeNull();
    expect(originPatternOf('https://')).toBeNull();
  });

  it('被拦主机 → null', () => {
    expect(originPatternOf('http://192.168.1.1/a.png')).toBeNull();
    expect(originPatternOf('http://localhost:1313/a.png')).toBeNull();
    expect(originPatternOf('http://nas/a.png')).toBeNull();
  });
});

describe('queryRemoteImagePermissions(B6 确认路径:只查不申请)', () => {
  it('不调 request,按 contains 重算 deniedOrigins', async () => {
    grantedSet = new Set(['https://a.example.com/*']);
    const res = await queryRemoteImagePermissions(
      parseMarkdown('![](https://a.example.com/1.png)\n\n![](https://b.example.com/2.png)'),
    );
    expect(requested).toHaveLength(0);
    expect(res.origins.slice().sort()).toEqual(['https://a.example.com/*', 'https://b.example.com/*']);
    expect(res.deniedOrigins).toEqual(['https://b.example.com/*']);
    expect(res.granted).toBe(false);
  });

  it('全部已授权 → granted=true、deniedOrigins=[]', async () => {
    grantedSet = new Set(['https://a.example.com/*']);
    const res = await queryRemoteImagePermissions([], ['https://a.example.com/c.png']);
    expect(res).toEqual({ granted: true, origins: ['https://a.example.com/*'], deniedOrigins: [] });
  });

  it('contains 抛错 → 全部视为未授权', async () => {
    grantedSet = 'throw';
    const res = await queryRemoteImagePermissions([], ['https://a.example.com/c.png']);
    expect(res.deniedOrigins).toEqual(['https://a.example.com/*']);
  });

  it('无远程来源 → 不调 contains', async () => {
    expect(await queryRemoteImagePermissions([], [])).toEqual({ granted: true, origins: [], deniedOrigins: [] });
    expect(containsCalls).toHaveLength(0);
  });
});

describe('countDeniedRemote(B4 toast 计数)', () => {
  const blocks = parseMarkdown(
    '![](https://a.example.com/1.png)\n\n![](https://b.example.com/2.png)\n\n![](https://b.example.com/3.png)\n\n![](local/x.png)',
  ) as ImportBlock[];
  const denied = ['https://b.example.com/*'];

  it('只计被拒 origin 的图块(已授权 origin 不计)', () => {
    expect(countDeniedRemote(blocks, null, denied)).toBe(2);
  });

  it('无被拒 origin → 0', () => {
    expect(countDeniedRemote(blocks, null, [])).toBe(0);
  });

  it('远程封面属被拒 origin 时计入;已授权 / 本地封面不计', () => {
    expect(countDeniedRemote(blocks, 'https://b.example.com/c.png', denied)).toBe(3);
    expect(countDeniedRemote(blocks, 'https://a.example.com/c.png', denied)).toBe(2);
    expect(countDeniedRemote(blocks, 'cover.png', denied)).toBe(2);
  });

  it('封面为被拦主机不计入(即便其 origin 出现在 denied 里)', () => {
    expect(countDeniedRemote(blocks, 'http://192.168.1.1/c.png', [...denied, 'http://192.168.1.1/*'])).toBe(2);
  });
});

describe('relabelPermissionFailures(B4 只改被拒 origin 的网络类失败)', () => {
  const fail = (source: string, reason: string, detail?: string, index = 0): ImageFailure => ({
    index,
    source,
    stage: 'prepare',
    reason,
    detail,
  });
  const denied = ['https://b.example.com/*'];

  it('被拒 origin 的 Failed to fetch → remote-permission-denied', () => {
    const out = relabelPermissionFailures(
      [fail('https://b.example.com/2.png', 'remote-fetch-failed', 'TypeError: Failed to fetch')],
      denied,
    );
    expect(out[0]!.reason).toBe('remote-permission-denied');
  });

  it('已授权 origin 的同类失败不改标(不误伤)', () => {
    const out = relabelPermissionFailures(
      [fail('https://a.example.com/1.png', 'remote-fetch-failed', 'TypeError: Failed to fetch')],
      denied,
    );
    expect(out[0]!.reason).toBe('remote-fetch-failed');
  });

  it('被拒 origin 的非网络类失败(http 404 / 其它原因码)不改标', () => {
    const out = relabelPermissionFailures(
      [
        fail('https://b.example.com/2.png', 'remote-fetch-failed', 'http 404'),
        fail('https://b.example.com/3.png', 'upload-timeout'),
      ],
      denied,
    );
    expect(out.map((f) => f.reason)).toEqual(['remote-fetch-failed', 'upload-timeout']);
  });

  it('source 被截到 80 字符(带 …)仍能取 origin;host 被截断 / 无法解析则不改标', () => {
    const longPath = `https://b.example.com/${'x'.repeat(100)}.png`.slice(0, 79) + '…';
    const out = relabelPermissionFailures(
      [
        fail(longPath, 'remote-fetch-failed', 'TypeError: Failed to fetch'),
        fail('https://b.exam…', 'remote-fetch-failed', 'TypeError: Failed to fetch'),
        fail('not a url', 'remote-fetch-failed', 'TypeError: Failed to fetch'),
      ],
      denied,
    );
    expect(out.map((f) => f.reason)).toEqual(['remote-permission-denied', 'remote-fetch-failed', 'remote-fetch-failed']);
  });

  it('封面失败(index=-1)同样按 origin 判定', () => {
    const out = relabelPermissionFailures(
      [fail('https://b.example.com/c.png', 'remote-fetch-failed', 'TypeError: Failed to fetch', -1)],
      denied,
    );
    expect(out[0]).toMatchObject({ index: -1, reason: 'remote-permission-denied' });
  });

  it('deniedOrigins 为空 → 原样返回', () => {
    const list = [fail('https://b.example.com/2.png', 'remote-fetch-failed', 'TypeError: Failed to fetch')];
    expect(relabelPermissionFailures(list, [])).toEqual(list);
  });
});
