// 加载路径的校验单测:坏 storage 数据不再靠「抛错 → 恢复 UI → 用户清空全部数据」兜底,
// 而是读出即校验、坏字段回落默认,用户的草稿与历史得以保全。
//
// 覆盖两层不变量:
//  1. **加载器层**:各 loadX() 对任意脏输入都返回结构合法的值,且**永不抛错**;
//  2. **端到端安全属性**:任何损坏形态下,「bootstrap 首帧要用的主题解析」要么正常出值,
//     要么抛错被 bootstrap 的 try/catch 兜住 —— 绝不能出现「不抛错但产出畸形主题」的
//     中间态(那会是「不白屏但界面全坏」,比崩掉更难排查)。
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { validatePrefs, validateOptions, validateHistory, validateDraft } from './schema';
import { defaultPrefs } from './schema';
import { defaultOptions } from '@/lib/settings/options';
import { skinVars, resolveDark } from '@/lib/theme/themes';

/**
 * 真实世界里 storage 可能出现的损坏形态。`getItem` 只在值为 `undefined` 时用 fallback,
 * 故以下每一种都会被原样交给加载器 —— 这正是本批修复要挡住的输入面。
 */
const CORRUPTIONS: Array<[name: string, raw: unknown]> = [
  ['整个值是字符串', 'corrupted'],
  ['值是数字', 42],
  ['值是 null', null],
  ['值是数组', ['a', 'b']],
  ['值是布尔', true],
  ['空对象', {}],
  ['skin 非法字符串', { skin: 'nonexistent' }],
  ['skin 是数字', { skin: 123 }],
  ['skin 是 null', { skin: null }],
  ['theme 非法', { theme: 'bogus' }],
  ['lang 非法', { lang: 'klingon' }],
  ['accent 非字符串', { accent: 999 }],
  ['原型污染尝试', JSON.parse('{"__proto__":{"polluted":true},"skin":"paper"}')],
];

describe('加载校验 · validatePrefs 对任意脏输入都产出合法 Prefs', () => {
  it.each(CORRUPTIONS)('%s', (_name, raw) => {
    const p = validatePrefs(raw);
    // skin 必须是主题表里真实存在的键 —— 这是 bootstrap 不越界抛的前提。
    expect(['minimal', 'console', 'paper', 'glass']).toContain(p.skin);
    expect(['light', 'dark', 'system']).toContain(p.theme);
    expect(['auto', 'zh', 'en']).toContain(p.lang);
    expect(typeof p.accent).toBe('string');
  });

  it('合法值原样保留(校验不误伤正常数据)', () => {
    const good = { skin: 'paper', theme: 'dark', accent: '#FF0000', lang: 'en' } as const;
    expect(validatePrefs(good)).toEqual(good);
  });

  it('部分字段合法时逐字段各自回落(不整体丢弃)', () => {
    const p = validatePrefs({ skin: 'glass', theme: 'bogus' });
    expect(p.skin).toBe('glass'); // 合法字段保留
    expect(p.theme).toBe(defaultPrefs.theme); // 非法字段回落
  });

  it('不被原型污染(__proto__ 不落到结果上)', () => {
    const p = validatePrefs(JSON.parse('{"__proto__":{"polluted":true},"skin":"paper"}'));
    expect((p as unknown as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('加载校验 · 端到端安全属性:坏 prefs 不产生「畸形主题」中间态', () => {
  // 这是本批修复的**核心价值**:改动前 `{skin:'bogus'}` 会让 skinVars 越界抛 →
  // 用户被推到「清空全部本地数据」的恢复 UI、草稿与历史一并丢失。改动后应正常出值。
  it.each(CORRUPTIONS)('%s → 主题解析正常出值,不抛错', (_name, raw) => {
    const p = validatePrefs(raw);
    const dark = resolveDark(p.skin, p.theme);
    const vars = skinVars(p.skin, dark, p.accent);
    expect(typeof dark).toBe('boolean');
    expect(vars).toBeTruthy();
    // 主题变量表应是完整的一组,而不是空对象/半成品。
    expect(Object.keys(vars).length).toBeGreaterThan(10);
  });

  it('回归对照:未经校验的坏 skin 确实会抛(证明这层防护并非空转)', () => {
    // 直接把脏值喂给主题解析(模拟改动前的裸信任路径),必须抛错 ——
    // 若这里不抛,说明本测试文件的前提失效、上面那组断言也就失去意义。
    //
    // 抛点是 **resolveDark**(`skinMeta[skin]` 越界 → 读 `.length` 抛),不是 skinVars ——
    // 后者用 if/else 分支匹配 skin,未知值会落到 minimal 默认分支、并不抛。
    // 本条断言最初写的就是 skinVars 并因此变红,才定位到真实抛点;保留此注释免得再踩。
    expect(() => resolveDark('bogus' as never, 'system')).toThrow();
    expect(() => skinVars('bogus' as never, false, '#1D9BF0')).not.toThrow();
  });
});

describe('加载校验 · validateOptions', () => {
  it.each(CORRUPTIONS)('%s → 产出完整 Options', (_name, raw) => {
    const o = validateOptions(raw);
    expect(Object.keys(o).sort()).toEqual(Object.keys(defaultOptions).sort());
  });

  it('坏 onExisting 回落默认,而非静默变成「总是覆盖」', () => {
    // 这条是真实风险:用户以为写入前会先询问,坏值却让正文被直接替换。
    const o = validateOptions({ onExisting: 'overwrite-everything-always' });
    expect(o.onExisting).toBe(defaultOptions.onExisting);
    expect(['ask', 'append', 'overwrite']).toContain(o.onExisting);
  });

  it('合法设置原样保留', () => {
    const o = validateOptions({ onExisting: 'append', taskList: 'plain', compress: false });
    expect(o.onExisting).toBe('append');
    expect(o.taskList).toBe('plain');
    expect(o.compress).toBe(false);
  });
});

describe('加载校验 · validateHistory 只丢坏项、保住其余历史', () => {
  it.each(CORRUPTIONS)('%s → 产出数组,不抛错', (_name, raw) => {
    expect(Array.isArray(validateHistory(raw))).toBe(true);
  });

  it('混合数组:坏项被丢弃,合法项完整保留', () => {
    const raw = [
      { id: 1, title: '好记录', date: '2026/07/25 10:00', ok: 5, deg: 0, fail: 0, md: '# a' },
      null, // 坏项
      { title: '缺 id' }, // 坏项:id 是主键/React key,缺失无法安全承载
      'garbage', // 坏项
      { id: 2, title: '另一条好记录', date: '', ok: 0, deg: 0, fail: 0, md: '' },
    ];
    const out = validateHistory(raw);
    expect(out).toHaveLength(2);
    expect(out.map((h) => h.id)).toEqual([1, 2]);
    expect(out[0]?.title).toBe('好记录');
  });

  it('缺 title 的项补空串而非丢弃(下游 toLowerCase 不再抛)', () => {
    const out = validateHistory([{ id: 1, md: 'x' }]);
    expect(out).toHaveLength(1);
    expect(out[0]?.title).toBe('');
    expect(() => out[0]?.title.toLowerCase()).not.toThrow();
  });
});

describe('加载校验 · validateDraft', () => {
  it('非字符串一律回落空串(下游 md.trim() 不再抛)', () => {
    for (const bad of [42, null, {}, [], true, undefined]) {
      const d = validateDraft(bad);
      expect(typeof d).toBe('string');
      expect(() => d.trim()).not.toThrow();
    }
  });

  it('字符串原样保留(含空串)', () => {
    expect(validateDraft('# 我的草稿')).toBe('# 我的草稿');
    expect(validateDraft('')).toBe('');
  });
});

describe('加载校验 · loadX() 端到端:脏 storage 不抛错', () => {
  // 直接驱动真实的 loadX():用 localStorage 回退路径(非扩展环境下 store.ts 走这条),
  // 把脏 JSON 塞进去,断言加载器不抛且产出合法 —— 覆盖「校验器接没接上」这层接线,
  // 而不只是校验器本身(接线漏了的话,上面的校验器测试全绿也白搭)。
  beforeEach(() => {
    vi.stubGlobal('localStorage', (() => {
      const m = new Map<string, string>();
      return {
        getItem: (k: string) => m.get(k) ?? null,
        setItem: (k: string, v: string) => void m.set(k, v),
        removeItem: (k: string) => void m.delete(k),
      };
    })());
  });

  it('四个加载器面对脏数据都返回合法结构且不抛', async () => {
    localStorage.setItem('markflow:prefs', JSON.stringify({ skin: 'bogus', theme: 42 }));
    localStorage.setItem('markflow:opts', JSON.stringify('not-an-object'));
    localStorage.setItem('markflow:history', JSON.stringify([{ noId: true }, 'junk']));
    localStorage.setItem('markflow:draft', JSON.stringify(12345));

    const { loadPrefs } = await import('./prefs');
    const { loadOptions } = await import('./optionsStore');
    const { loadHistory } = await import('./historyStore');
    const { loadDraft } = await import('./draftStore');

    const [prefs, opts, history, draft] = await Promise.all([
      loadPrefs(),
      loadOptions(),
      loadHistory(),
      loadDraft(),
    ]);

    expect(['minimal', 'console', 'paper', 'glass']).toContain(prefs.skin);
    expect(Object.keys(opts).sort()).toEqual(Object.keys(defaultOptions).sort());
    expect(history).toEqual([]); // 两项都不合格 → 全丢,但返回空数组而非崩
    expect(draft).toBe(''); // 数字草稿回落空串

    // 首帧主题解析也应正常(bootstrap 的关键路径)
    expect(() => skinVars(prefs.skin, resolveDark(prefs.skin, prefs.theme), prefs.accent)).not.toThrow();
  });
});
