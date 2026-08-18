// lib/bridge/imagePermissions.ts 单测(B3-4 / P1-7)。
// 关键口径:权限申请的图片来源必须是 **parseMarkdown 的块级产出**,而非全文正则——
// 后者把 `![](<https://h/a.png>)` 判成 local(不申请 → background 下载被 Chrome 拒),
// 还会把代码块内 / 行内的图片一起算进来(申请了永远用不到的 host 权限)。
import { beforeEach, describe, expect, it } from 'vitest';
import { requestRemoteImagePermissions } from './imagePermissions';
import { parseMarkdown } from '../markdown/parser';

/** 每次调用记录一次 origins 参数;未调用则数组为空。 */
const requested: string[][] = [];

beforeEach(() => {
  requested.length = 0;
  (globalThis as unknown as { browser: unknown }).browser = {
    permissions: {
      request: async (p: { origins: string[] }) => {
        requested.push(p.origins);
        return true;
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

  it('无远程来源时不发起申请', async () => {
    await requestRemoteImagePermissions([], []);
    expect(requested).toHaveLength(0);
  });

  it('非法 URL 被跳过而非抛错', async () => {
    await expect(requestRemoteImagePermissions([], ['https://'])).resolves.toBeUndefined();
    expect(requested).toHaveLength(0);
  });
});
