// 备份校验层单测(v0.2.0 修 P0「坏备份砖化面板」的防线)——钉住恢复边界的逐字段白名单
// 行为:非法 skin/onExisting 等不得再让面板白屏/静默变危险行为;history 缺 title 不得再让
// HistoryTab 崩溃。见 backup.ts 顶部注释与 review B2。
import { describe, expect, it } from 'vitest';
import {
  validatePrefs,
  validateOptions,
  validateHistory,
  validateImageFailures,
} from './backup';
import { defaultPrefs } from './prefs';
import { defaultOptions } from '@/lib/settings/options';
import { truncateForReport } from '@/lib/bridge/protocol';

describe('validatePrefs', () => {
  it('非法 skin/theme/lang 回落默认', () => {
    const p = validatePrefs({ skin: 'evil', theme: 'nope', lang: 'fr' });
    expect(p.skin).toBe(defaultPrefs.skin);
    expect(p.theme).toBe(defaultPrefs.theme);
    expect(p.lang).toBe(defaultPrefs.lang);
  });

  it('合法值保留', () => {
    const p = validatePrefs({ skin: 'console', theme: 'dark', lang: 'zh', accent: '#fff' });
    expect(p).toEqual({ skin: 'console', theme: 'dark', lang: 'zh', accent: '#fff' });
  });

  it('accent 任意字符串保留(不限枚举/格式)', () => {
    const p = validatePrefs({ accent: 'not-a-hex-color 😀' });
    expect(p.accent).toBe('not-a-hex-color 😀');
  });

  it('accent 非字符串回落默认', () => {
    const p = validatePrefs({ accent: 123 });
    expect(p.accent).toBe(defaultPrefs.accent);
  });

  it.each([
    ['null', null],
    ['数组', ['skin', 'minimal']],
    ['字符串', 'not an object'],
    ['数字', 42],
    ['undefined', undefined],
  ])('非对象输入(%s)→整体默认', (_label, raw) => {
    expect(validatePrefs(raw)).toEqual(defaultPrefs);
  });
});

describe('validateOptions', () => {
  it('onExisting 非法值回落默认(不得静默变成 overwrite/append 等危险行为)', () => {
    const o = validateOptions({ onExisting: 'overwrite-everything-now' });
    expect(o.onExisting).toBe(defaultOptions.onExisting);
    expect(o.onExisting).toBe('ask');
  });

  it('titleConflict 非法值回落默认(不得静默变成 overwrite)', () => {
    const o = validateOptions({ titleConflict: 'overwrite; drop table' });
    expect(o.titleConflict).toBe(defaultOptions.titleConflict);
    expect(o.titleConflict).toBe('ask');
  });

  it('titleConflict 合法值 overwrite 保留(合法输入不应被过度保守拦截)', () => {
    const o = validateOptions({ titleConflict: 'overwrite' });
    expect(o.titleConflict).toBe('overwrite');
  });

  it('每个枚举字段非法值回落默认', () => {
    const bad = {
      editorFont: 'xxl',
      onExisting: 'bogus',
      autoReport: 'bogus',
      titleConflict: 'bogus',
      h1Handle: 'bogus',
      coverKeep: 'bogus',
      codeStrategy: 'bogus',
      taskList: 'bogus',
      zhConvert: 'bogus',
      maxEdge: 'bogus',
      quality: 'bogus',
      soundStyle: 'bogus',
      histLimit: 'bogus',
      retries: 'bogus',
    };
    const o = validateOptions(bad);
    expect(o).toEqual(defaultOptions);
  });

  it('布尔字段非布尔回落默认', () => {
    const bad = {
      wrap: 'yes',
      scrollTop: 1,
      setTitle: 'true',
      setCover: null,
      obsidianImg: 0,
      wikilink: 'no',
      punct: {},
      folder: [],
      activeFolder: 'on',
      compress: 'off',
      confetti: 2,
      sound: 'yes',
    };
    const o = validateOptions(bad);
    expect(o.wrap).toBe(defaultOptions.wrap);
    expect(o.scrollTop).toBe(defaultOptions.scrollTop);
    expect(o.setTitle).toBe(defaultOptions.setTitle);
    expect(o.setCover).toBe(defaultOptions.setCover);
    expect(o.obsidianImg).toBe(defaultOptions.obsidianImg);
    expect(o.wikilink).toBe(defaultOptions.wikilink);
    expect(o.punct).toBe(defaultOptions.punct);
    expect(o.folder).toBe(defaultOptions.folder);
    expect(o.activeFolder).toBe(defaultOptions.activeFolder);
    expect(o.compress).toBe(defaultOptions.compress);
    expect(o.confetti).toBe(defaultOptions.confetti);
    expect(o.sound).toBe(defaultOptions.sound);
  });

  it('合法值全量保留(逐字段覆盖一遍取值集)', () => {
    const full = {
      editorFont: 'lg',
      wrap: false,
      onExisting: 'append',
      scrollTop: false,
      autoReport: 'always',
      setTitle: false,
      titleConflict: 'keep',
      h1Handle: 'keep',
      setCover: true,
      coverKeep: 'remove',
      codeStrategy: 'image',
      taskList: 'plain',
      obsidianImg: false,
      wikilink: false,
      punct: true,
      zhConvert: 's2t',
      folder: true,
      folderName: 'my-folder',
      activeFolder: true,
      activeFolderName: 'active-folder',
      compress: false,
      maxEdge: '960',
      quality: '60',
      confetti: false,
      sound: false,
      soundStyle: 'crisp',
      histLimit: '50',
      retries: '5',
    };
    expect(validateOptions(full)).toEqual(full);
  });

  it('folderName/activeFolderName: null 保留、非法类型回落默认、字符串保留', () => {
    expect(validateOptions({ folderName: null }).folderName).toBeNull();
    expect(validateOptions({ folderName: 123 }).folderName).toBe(defaultOptions.folderName);
    expect(validateOptions({ folderName: 'abc' }).folderName).toBe('abc');
  });

  it('未知多余字段不进结果', () => {
    const o = validateOptions({ evilField: 'inject', __proto__: { polluted: true } });
    expect(Object.keys(o).sort()).toEqual(Object.keys(defaultOptions).sort());
    expect((o as unknown as Record<string, unknown>).evilField).toBeUndefined();
  });

  it('非对象输入 → 整体默认', () => {
    expect(validateOptions(null)).toEqual(defaultOptions);
    expect(validateOptions([1, 2, 3])).toEqual(defaultOptions);
    expect(validateOptions('bad')).toEqual(defaultOptions);
  });
});

describe('validateHistory', () => {
  it('非法 id(缺失/NaN/Infinity/null/空串/超长串)丢弃整项', () => {
    const items = [
      { title: 'no id' },
      { id: NaN, title: 'nan id' },
      { id: Infinity, title: 'inf id' },
      { id: null, title: 'null id' },
      { id: '', title: 'empty string id' },
      { id: 'x'.repeat(65), title: 'oversized string id' },
    ];
    expect(validateHistory(items)).toEqual([]);
  });

  it('string id(新版 UUID 形状)与 number id(旧版时间戳)均合法保留', () => {
    const uuid = '5e3f0f9a-1111-4222-8333-444455556666';
    const items = validateHistory([
      { id: uuid, title: 'uuid' },
      { id: 1721300000000, title: 'ts' },
    ]);
    expect(items.map((i) => i.id)).toEqual([uuid, 1721300000000]);
  });

  it('缺 title/md/date 补默认不丢项', () => {
    const items = validateHistory([{ id: 1 }]);
    expect(items).toEqual([{ id: 1, title: '', date: '', ok: 0, deg: 0, fail: 0, md: '' }]);
  });

  it('非数组 → []', () => {
    expect(validateHistory(null)).toEqual([]);
    expect(validateHistory(undefined)).toEqual([]);
    expect(validateHistory({})).toEqual([]);
    expect(validateHistory('not-array')).toEqual([]);
  });

  it('正常项原样保留', () => {
    const item = { id: 1, title: 'foo', date: '2026-07-18', ok: 3, deg: 1, fail: 0, md: '# hi' };
    expect(validateHistory([item])).toEqual([item]);
  });

  it('imageFailures 联动:合法数组保留,非法数组整体丢弃为 undefined,不影响该 history 项存活', () => {
    const good = validateHistory([
      {
        id: 1,
        imageFailures: [{ index: 0, source: 'a.png', stage: 'prepare', reason: 'x' }],
      },
    ]);
    expect(good[0]!.imageFailures).toEqual([
      { index: 0, source: 'a.png', stage: 'prepare', reason: 'x', detail: undefined },
    ]);

    const bad = validateHistory([{ id: 2, imageFailures: [{ index: 'oops' }] }]);
    expect(bad).toHaveLength(1);
    expect(bad[0]!.imageFailures).toBeUndefined();
  });

  it('id 为非整数有限数(如时间戳/浮点)仍被接受(仅要求 number 且有限)', () => {
    const items = validateHistory([{ id: 1.5, title: 'float id' }]);
    expect(items).toHaveLength(1);
    expect(items[0]!.id).toBe(1.5);
  });
});

describe('validateImageFailures', () => {
  it('非数组 → undefined', () => {
    expect(validateImageFailures(null)).toBeUndefined();
    expect(validateImageFailures(undefined)).toBeUndefined();
    expect(validateImageFailures({})).toBeUndefined();
    expect(validateImageFailures('nope')).toBeUndefined();
  });

  it('空数组 → undefined', () => {
    expect(validateImageFailures([])).toBeUndefined();
  });

  it('index 非 ≥-1 整数丢项(当前实际行为:整个数组丢弃,非逐项丢弃——见 backup.ts 注释)', () => {
    expect(
      validateImageFailures([{ index: -2, source: 'a', stage: 'prepare', reason: 'r' }]),
    ).toBeUndefined();
    expect(
      validateImageFailures([{ index: 1.5, source: 'a', stage: 'prepare', reason: 'r' }]),
    ).toBeUndefined();
    expect(
      validateImageFailures([{ index: '0', source: 'a', stage: 'prepare', reason: 'r' }]),
    ).toBeUndefined();
    // -1(封面哨兵)合法
    expect(
      validateImageFailures([{ index: -1, source: 'a', stage: 'prepare', reason: 'r' }]),
    ).toEqual([{ index: -1, source: 'a', stage: 'prepare', reason: 'r', detail: undefined }]);
  });

  it('source/detail 超长被截断(验证 truncateForReport 生效)', () => {
    const longSource = 'x'.repeat(200);
    const longDetail = 'y'.repeat(300);
    const out = validateImageFailures([
      { index: 0, source: longSource, stage: 'upload', reason: 'r', detail: longDetail },
    ]);
    expect(out).toHaveLength(1);
    expect(out![0]!.source).toBe(truncateForReport(longSource, 80));
    expect(out![0]!.source.length).toBe(80);
    expect(out![0]!.detail).toBe(truncateForReport(longDetail, 200));
    expect(out![0]!.detail!.length).toBe(200);
  });

  it('source 截断代理对不切半:高位代理项落在截断边界时被一并去掉', () => {
    // 😀 编码为代理对。max=80 → cut=slice(0, 79)。构造 78 个 'a' + emoji + 'x'
    // (长度 81 > max),使 slice(0, 79) 恰好落在 78 个 'a' 之后的高位代理项处。
    const emoji = '😀';
    const s = 'a'.repeat(78) + emoji + 'x';
    const out = validateImageFailures([
      { index: 0, source: s, stage: 'prepare', reason: 'r' },
    ])![0]!.source;
    expect(out).toBe('a'.repeat(78) + '…');
    expect(/[\uD800-\uDBFF]/.test(out)).toBe(false);
  });

  it('合法项保留', () => {
    const items = [
      { index: 0, source: 'a.png', stage: 'prepare' as const, reason: 'remote-fetch-failed' },
      { index: -1, source: 'cover.png', stage: 'upload' as const, reason: 'upload-timeout', detail: 'timed out' },
    ];
    expect(validateImageFailures(items)).toEqual([
      { index: 0, source: 'a.png', stage: 'prepare', reason: 'remote-fetch-failed', detail: undefined },
      { index: -1, source: 'cover.png', stage: 'upload', reason: 'upload-timeout', detail: 'timed out' },
    ]);
  });

  it('stage 非 prepare/upload 时整个数组丢弃', () => {
    expect(
      validateImageFailures([{ index: 0, source: 'a', stage: 'weird', reason: 'r' }]),
    ).toBeUndefined();
  });

  it('detail 非字符串(且非 undefined)时整个数组丢弃', () => {
    expect(
      validateImageFailures([{ index: 0, source: 'a', stage: 'prepare', reason: 'r', detail: 123 }]),
    ).toBeUndefined();
  });
});

describe('truncateForReport', () => {
  it('短串原样返回', () => {
    expect(truncateForReport('hello', 10)).toBe('hello');
    expect(truncateForReport('exactly10!', 10)).toBe('exactly10!');
  });

  it('超长串加省略号,截断到 max 长度', () => {
    const s = 'a'.repeat(20);
    const out = truncateForReport(s, 10);
    expect(out).toBe('a'.repeat(9) + '…');
    expect(out.length).toBe(10);
  });

  it('不截断时原样返回(即使含代理对)', () => {
    const s = 'a'.repeat(8) + '😀'; // 长度 10,不超过 max=10
    expect(truncateForReport(s, 10)).toBe(s);
  });

  it('末位若为高位代理项(代理对被从中间切开)则一并去掉', () => {
    // 'a'.repeat(8) + 😀(代理对 😀)+ 'x',长度 11 > max=10。
    // slice(0, 9) = 8 个 'a' + \uD83D(高位代理项,代理对被切开),需一并去掉。
    const emoji = '😀';
    const s = 'a'.repeat(8) + emoji + 'x';
    const out = truncateForReport(s, 10);
    expect(out).toBe('a'.repeat(8) + '…');
    expect(/[\uD800-\uDBFF]/.test(out)).toBe(false);
  });
});
