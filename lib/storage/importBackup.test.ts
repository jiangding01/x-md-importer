// importBackup/exportBackup 本体单测(B4-1/P2-15 + B4-2/P2-16)——backup.test.ts 只测
// validate* 逐字段校验层,本文件补的是「校验层之上」importBackup 的来源断言、版本分支、
// 顺序写回与部分失败报告这几条此前零覆盖的行为(见审查报告「测试覆盖缺口」条目 2)。
//
// 姿势:store.ts 的 hasChromeStorage 在没有全局 chrome 时走 localStorage 回退——用可控的
// 假 localStorage(支持「指定 key 写入时抛错」)驱动 importBackup 的顺序执行/部分失败路径,
// 不必像 store.test.ts 那样处理 chrome 分支的模块加载期常量(这里从头到尾都是 localStorage 分支)。
import { afterEach, describe, expect, it } from 'vitest';
import { BackupImportError, exportBackup, importBackup, type BackupData } from './backup';
import { defaultOptions } from '@/lib/settings/options';

function makeFakeLocalStorage(opts: { failOnKey?: string } = {}) {
  const map = new Map<string, string>();
  return {
    setItem: (k: string, v: string) => {
      if (opts.failOnKey && k === opts.failOnKey) {
        throw new Error(`simulated write failure for ${k}`);
      }
      map.set(k, v);
    },
    getItem: (k: string) => map.get(k) ?? null,
    removeItem: (k: string) => void map.delete(k),
    map,
  };
}

const g = globalThis as Record<string, unknown>;

afterEach(() => {
  delete g.localStorage;
  delete g.chrome;
});

const validHistory = [{ id: 'a1b2', title: 'hello', date: '2026/08/18 10:00', ok: 1, deg: 0, fail: 0, md: '# hello' }];
const validPrefs = { skin: 'console', theme: 'dark', accent: '#fff', lang: 'en' };

function makeBackup(overrides: Partial<BackupData> = {}): unknown {
  return {
    app: 'markflow',
    kind: 'backup',
    version: 2,
    exportedAt: new Date().toISOString(),
    prefs: validPrefs,
    options: defaultOptions,
    history: validHistory,
    draft: '# draft content',
    ...overrides,
  };
}

describe('importBackup · 来源断言(B4-1/P2-15)', () => {
  it('非对象输入(null/数组/字符串/数字)拒收,reason=not-object', async () => {
    for (const bad of [null, [], 'nope', 42]) {
      g.localStorage = makeFakeLocalStorage();
      await expect(importBackup(bad)).rejects.toThrow(BackupImportError);
      try {
        await importBackup(bad);
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(BackupImportError);
        expect((err as BackupImportError).reason).toBe('not-object');
      }
    }
  });

  it('诊断快照文件(kind:"diagnostics")被误选 → 拒收,reason=wrong-kind(不当备份「恢复成功」)', async () => {
    g.localStorage = makeFakeLocalStorage();
    const diagnostics = {
      app: 'markflow',
      kind: 'diagnostics',
      at: new Date().toISOString(),
      version: '3.0.0',
      prefs: validPrefs,
      options: defaultOptions,
    };
    try {
      await importBackup(diagnostics);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(BackupImportError);
      expect((err as BackupImportError).reason).toBe('wrong-kind');
    }
  });

  it('app 不是 markflow → 拒收,reason=wrong-kind', async () => {
    g.localStorage = makeFakeLocalStorage();
    try {
      await importBackup(makeBackup({ app: 'other-app' as unknown as 'markflow' }));
      expect.unreachable();
    } catch (err) {
      expect((err as BackupImportError).reason).toBe('wrong-kind');
    }
  });

  it.each([0, 3, 99, 'v2', undefined, null])('version=%s(既非 1 也非 2)→ 拒收,reason=bad-version', async (badVersion) => {
    g.localStorage = makeFakeLocalStorage();
    try {
      await importBackup(makeBackup({ version: badVersion as unknown as number }));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(BackupImportError);
      expect((err as BackupImportError).reason).toBe('bad-version');
    }
  });

  it('无任何可恢复切片(四个字段都缺席但 app/kind/version 合法)→ 拒收,reason=empty', async () => {
    g.localStorage = makeFakeLocalStorage();
    try {
      await importBackup({ app: 'markflow', kind: 'backup', version: 2, exportedAt: '' });
      expect.unreachable();
    } catch (err) {
      expect((err as BackupImportError).reason).toBe('empty');
    }
  });
});

describe('importBackup · 版本分支(全局定案 2)', () => {
  it('version=2(原生)正常写回全部切片', async () => {
    const fake = makeFakeLocalStorage();
    g.localStorage = fake;
    const report = await importBackup(makeBackup({ version: 2 }));
    expect(report.failedAt).toBeUndefined();
    expect(report.restored).toEqual(['prefs', 'options', 'history', 'draft']);
  });

  it('version=1(旧版兼容读入)同样正常写回——旧版 history 数字 id 照单全收', async () => {
    const fake = makeFakeLocalStorage();
    g.localStorage = fake;
    const numericIdHistory = [{ id: 1721300000000, title: 'old', date: '2024/07/18', ok: 1, deg: 0, fail: 0, md: 'x' }];
    const report = await importBackup(makeBackup({ version: 1, history: numericIdHistory }));
    expect(report.failedAt).toBeUndefined();
    expect(report.restored).toEqual(['prefs', 'options', 'history', 'draft']);
    // 写回的历史条目里数字 id 原样保留(validateHistory 本就双形状兼容)。
    const stored = JSON.parse(fake.map.get('markflow:history')!) as Array<{ id: unknown }>;
    expect(stored[0]!.id).toBe(1721300000000);
  });
});

describe('importBackup · 部分切片(B4-2/P2-16)', () => {
  it('只含 draft 字段的部分备份 → 只恢复 draft 这一个切片', async () => {
    g.localStorage = makeFakeLocalStorage();
    const report = await importBackup({
      app: 'markflow',
      kind: 'backup',
      version: 2,
      exportedAt: '',
      draft: '# only draft',
    });
    expect(report.restored).toEqual(['draft']);
    expect(report.failedAt).toBeUndefined();
  });

  it('顺序执行 + 中途失败即停:history 切片写入失败时,之前的 prefs/options 已恢复、' +
    'draft(顺序在 history 之后)未被尝试(不是 Promise.all 的「其余仍已落盘」混合态,' +
    '而是明确停在失败点,后续切片压根没跑)', async () => {
    const fake = makeFakeLocalStorage({ failOnKey: 'markflow:history' });
    g.localStorage = fake;
    const report = await importBackup(makeBackup());
    expect(report.restored).toEqual(['prefs', 'options']);
    expect(report.failedAt?.slice).toBe('history');
    expect(report.failedAt?.error).toMatch(/simulated write failure/);
    // prefs/options 确已落盘(部分恢复是真实发生的,不是空报告)。
    expect(fake.map.has('markflow:prefs')).toBe(true);
    expect(fake.map.has('markflow:opts')).toBe(true);
    // history 写入失败、draft 顺序在其后从未被尝试,两者都不应该出现在 storage 里。
    expect(fake.map.has('markflow:history')).toBe(false);
    expect(fake.map.has('markflow:draft')).toBe(false);
  });

  it('第一个切片(prefs)就失败 → restored 为空数组,failedAt 指向 prefs', async () => {
    const fake = makeFakeLocalStorage({ failOnKey: 'markflow:prefs' });
    g.localStorage = fake;
    const report = await importBackup(makeBackup());
    expect(report.restored).toEqual([]);
    expect(report.failedAt?.slice).toBe('prefs');
  });
});

describe('exportBackup', () => {
  it('导出的备份带 app/kind/version=2 标识(全局定案 2),四个切片齐全', async () => {
    g.localStorage = makeFakeLocalStorage();
    const data = await exportBackup();
    expect(data.app).toBe('markflow');
    expect(data.kind).toBe('backup');
    expect(data.version).toBe(2);
    expect(typeof data.exportedAt).toBe('string');
    expect(Array.isArray(data.history)).toBe(true);
    expect(typeof data.draft).toBe('string');
  });
});
