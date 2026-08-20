// withTimeout —— B4-7/P2-18 引入的超时包装器单测。sendFolderRequest 本体依赖 `browser`
// (webextension-polyfill 全局)与 resolveTargetXTab,在 node 单测环境下不便低成本 mock
// (与 injector.ts/content.ts 同类,靠真机 QA 回归覆盖,见 vitest.config.ts 顶部注释);
// 但 withTimeout 是纯粹的 Promise 时序逻辑,与 chrome/browser 全局无关,直接单测钉住。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimeoutError, withTimeout } from './importArticle';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('withTimeout', () => {
  it('被包装的 promise 在超时前 resolve → 透传其结果,不触发超时', async () => {
    const p = new Promise<string>((resolve) => setTimeout(() => resolve('done'), 100));
    const wrapped = withTimeout(p, 10_000);
    vi.advanceTimersByTime(100);
    await expect(wrapped).resolves.toBe('done');
  });

  it('被包装的 promise 在超时前 reject → 透传其错误,不触发超时', async () => {
    const err = new Error('inner failure');
    const p = new Promise<string>((_resolve, reject) => setTimeout(() => reject(err), 100));
    const wrapped = withTimeout(p, 10_000);
    vi.advanceTimersByTime(100);
    await expect(wrapped).rejects.toThrow('inner failure');
  });

  it('被包装的 promise 比超时慢 → 到点 reject(TimeoutError),不等原 promise 结算', async () => {
    const p = new Promise<string>((resolve) => setTimeout(() => resolve('too late'), 20_000));
    const wrapped = withTimeout(p, 10_000);
    // 断言前先挂上 catch,避免超时抛错先于 expect 附加导致的 unhandled rejection 警告。
    const assertion = expect(wrapped).rejects.toBeInstanceOf(TimeoutError);
    vi.advanceTimersByTime(10_000);
    await assertion;
  });

  it('超时错误的 name 是 TimeoutError(供调用方 instanceof 判定,而非裸字符串比对)', async () => {
    const p = new Promise<string>(() => {
      /* 永不 settle */
    });
    const wrapped = withTimeout(p, 5_000);
    const assertion = expect(wrapped).rejects.toMatchObject({ name: 'TimeoutError' });
    vi.advanceTimersByTime(5_000);
    await assertion;
  });
});
