/**
 * store.ts 错误传播测试(P0-1 回归钉)。
 *
 * 关键姿势:`hasChromeStorage` 是**模块加载期**求值的常量——先 import 再 stub
 * `globalThis.chrome` 无效,测试会永远走 localStorage 分支(假绿)。必须
 * `vi.resetModules()` + 先装 stub 再动态 `import('./store')`。
 * 测试环境是 node(无 DOM),localStorage 同样以 stub 注入。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

type StoreModule = typeof import('./store');

const g = globalThis as Record<string, unknown>;

async function importStore(stubs: { chrome?: unknown; localStorage?: unknown }): Promise<StoreModule> {
  vi.resetModules();
  if (stubs.chrome !== undefined) g.chrome = stubs.chrome;
  else delete g.chrome;
  if (stubs.localStorage !== undefined) g.localStorage = stubs.localStorage;
  return import('./store');
}

/** 最小 localStorage stub(node 环境无 DOM)。 */
function makeLocalStorage(overrides: Partial<Record<'setItem' | 'getItem' | 'removeItem', unknown>> = {}) {
  const map = new Map<string, string>();
  return {
    setItem: (k: string, v: string) => void map.set(k, v),
    getItem: (k: string) => map.get(k) ?? null,
    removeItem: (k: string) => void map.delete(k),
    ...overrides,
  };
}

afterEach(() => {
  delete g.chrome;
  delete g.localStorage;
  vi.resetModules();
});

describe('setItem 错误传播(chrome 路径)', () => {
  it('chrome.storage.local.set reject(配额满等)时向上抛,不静默吞', async () => {
    const { setItem } = await importStore({
      chrome: {
        storage: {
          local: {
            set: vi.fn().mockRejectedValue(new Error('QUOTA_BYTES quota exceeded')),
            get: vi.fn().mockResolvedValue({}),
            remove: vi.fn().mockResolvedValue(undefined),
          },
        },
      },
    });
    await expect(setItem('markflow:draft', 'x')).rejects.toThrow('quota');
  });

  it('chrome.storage.local.set 成功时正常 resolve', async () => {
    const set = vi.fn().mockResolvedValue(undefined);
    const { setItem } = await importStore({
      chrome: { storage: { local: { set, get: vi.fn().mockResolvedValue({}), remove: vi.fn() } } },
    });
    await expect(setItem('markflow:draft', 'x')).resolves.toBeUndefined();
    expect(set).toHaveBeenCalledWith({ 'markflow:draft': 'x' });
  });
});

describe('setItem 错误传播(localStorage 回退路径)', () => {
  it('localStorage.setItem 抛错(配额/隐私模式)时向上抛,不静默吞', async () => {
    const { setItem } = await importStore({
      localStorage: makeLocalStorage({
        setItem: () => {
          throw new Error('QuotaExceededError');
        },
      }),
    });
    await expect(setItem('markflow:draft', 'x')).rejects.toThrow('Quota');
  });

  it('正常写入可读回', async () => {
    const { setItem, getItem } = await importStore({ localStorage: makeLocalStorage() });
    await setItem('markflow:test', { a: 1 });
    expect(await getItem('markflow:test', null)).toEqual({ a: 1 });
  });
});
