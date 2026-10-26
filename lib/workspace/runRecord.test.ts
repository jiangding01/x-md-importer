// W1(2026-10-26):导入收尾的纯计算——历史条目 / 报告快照 / 是否异常,只取决于本次运行显式传入的数据。
import { describe, expect, it } from 'vitest';
import { analyzeDraft } from '../markdown/frontmatter';
import { buildRunRecord, type RunInput } from './runRecord';
import type { ImageFailure } from '../bridge/protocol';

// C2:analysis 默认由同一份 md / parseOpts 现算(与 startImport 一致);个别用例显式传入以证明不再重新解析。
const base = (over: Partial<Omit<RunInput, 'analysis'>> & { analysis?: RunInput['analysis'] } = {}): RunInput => {
  const md = over.md ?? '# 标题\n\n正文';
  const parseOpts = over.parseOpts ?? { obsidianImg: true, wikilink: true, taskList: 'symbol' as const };
  return baseRaw({ ...over, md, parseOpts, analysis: over.analysis ?? analyzeDraft(md, parseOpts) });
};
const baseRaw = (over: Partial<RunInput> & Pick<RunInput, 'analysis'>): RunInput => ({
  md: '# 标题\n\n正文',
  parseOpts: { obsidianImg: true, wikilink: true, taskList: 'symbol' },
  adjust: {},
  en: false,
  blockCount: 2,
  imageFail: 0,
  imageFailures: undefined,
  id: 'id-1',
  now: new Date(2026, 9, 26, 9, 5),
  ...over,
});

const fail = (index: number, reason: string): ImageFailure => ({ index, source: 's', stage: 'upload', reason });

describe('buildRunRecord · 解析开关取自本次运行(W1)', () => {
  it('parseOpts 原样进入历史条目与报告快照', () => {
    const parseOpts = { obsidianImg: false, wikilink: false, taskList: 'plain' } as const;
    const { item, snapshot } = buildRunRecord(base({ parseOpts }));
    expect(item.parseOpts).toEqual(parseOpts);
    expect(snapshot.parseOpts).toEqual(parseOpts);
  });

  it('历史标题按传入的开关判定(obsidianImg 决定 `![[a.png]]\\n标题\\n===` 是否成标题)', () => {
    const md = '![[a.png]]\n标题\n===';
    expect(buildRunRecord(base({ md })).item.title).toBe('标题');
    const off = { obsidianImg: false, wikilink: true, taskList: 'symbol' } as const;
    expect(buildRunRecord(base({ md, parseOpts: off })).item.title).toBe('未命名草稿');
  });

  it('md / id / 日期按传入值写入', () => {
    const { item, snapshot } = buildRunRecord(base());
    expect(item).toMatchObject({ id: 'id-1', md: '# 标题\n\n正文', date: '2026/10/26 09:05' });
    expect(snapshot.md).toBe('# 标题\n\n正文');
  });
});

describe('buildRunRecord · 计数口径(搬自 finishImport,行为不变)', () => {
  it('ok = blockCount − imageFail,不为负', () => {
    expect(buildRunRecord(base({ blockCount: 5, imageFail: 2 })).item.ok).toBe(3);
    expect(buildRunRecord(base({ blockCount: 1, imageFail: 3 })).item.ok).toBe(0);
  });

  it('封面失败(index<0)计入 fail,marker-residue 不计', () => {
    const imageFailures = [fail(-1, 'cover-set-failed'), fail(-1, 'marker-residue'), fail(0, 'upload-timeout')];
    const { item, snapshot } = buildRunRecord(base({ imageFail: 1, imageFailures }));
    expect(item.fail).toBe(2);
    expect(snapshot.fail).toBe(2);
    expect(item.imageFailures).toBe(imageFailures);
  });

  it('deg 取能力面板 warn 项之和', () => {
    expect(buildRunRecord(base({ md: '- [ ] 待办' })).item.deg).toBe(1);
    expect(buildRunRecord(base()).item.deg).toBe(0);
  });

  it('hasAnomaly:降级 / 失败 / 任一明细(含不计数的 orphan-media)', () => {
    expect(buildRunRecord(base()).hasAnomaly).toBe(false);
    expect(buildRunRecord(base({ md: '- [ ] 待办' })).hasAnomaly).toBe(true);
    expect(buildRunRecord(base({ imageFail: 1, imageFailures: [fail(0, 'upload-timeout')] })).hasAnomaly).toBe(true);
    expect(buildRunRecord(base({ imageFailures: [fail(1, 'orphan-media')] })).hasAnomaly).toBe(true);
  });
});

// 第二批 W7 / W8
import { pruneHistory, reportTone } from './runRecord';
import type { HistoryItem } from '../storage/schema';

describe('reportTone(W7:报告卡标题栏三态)', () => {
  const snap = (over: object) => ({ md: '', parseOpts: { obsidianImg: true, wikilink: true, taskList: 'symbol' as const }, ok: 1, deg: 0, fail: 0, ...over });
  it('有失败 → fail;仅降级 / 仅明细 → warn;否则 ok', () => {
    expect(reportTone(snap({ fail: 1 }))).toBe('fail');
    expect(reportTone(snap({ deg: 2 }))).toBe('warn');
    expect(reportTone(snap({ imageFailures: [{ index: 0, source: 's', stage: 'upload', reason: 'orphan-media' }] }))).toBe('warn');
    expect(reportTone(snap({}))).toBe('ok');
  });
});

describe('pruneHistory(W8:上限立即生效)', () => {
  const items = Array.from({ length: 5 }, (_, i) => ({ id: String(i) }) as HistoryItem);
  it('超限保留最新(列表头)若干条;未超限 / inf 原样返回同一引用', () => {
    expect(pruneHistory(items, '50')).toBe(items);
    expect(pruneHistory(items, 'inf')).toBe(items);
    const many = Array.from({ length: 60 }, (_, i) => ({ id: String(i) }) as HistoryItem);
    const out = pruneHistory(many, '50');
    expect(out).toHaveLength(50);
    expect(out[0]?.id).toBe('0');
  });
});

// 第三批 P11:降级计数(deg)与报告快照按实际写入口径——h1Handle=remove 去掉的标题块、coverKeep=remove
// 去掉的封面首图不再计入。
describe('buildRunRecord · adjust(第三批 P11)', () => {
  const md = '# 标题\n\n![a](a.png)\n\n| a |\n|---|\n| 1 |';
  it('adjust 原样进入报告快照', () => {
    const adjust = { removeTitle: true, removeCoverImage: true };
    expect(buildRunRecord(base({ md, adjust })).snapshot.adjust).toEqual(adjust);
  });
  it('被移除标题里的降级项(脚注)不再计入 deg', () => {
    const md2 = '# 标题[^1]\n\n正文';
    expect(buildRunRecord(base({ md: md2 })).snapshot.deg).toBe(1);
    expect(buildRunRecord(base({ md: md2, adjust: { removeTitle: true } })).snapshot.deg).toBe(0);
  });
});

// C2:收尾只用 startImport 传入的那一次解析结果,不再自行解析 md。
describe('buildRunRecord · 使用传入的 analysis(C2)', () => {
  it('标题与降级计数取自 analysis', () => {
    const analysis = analyzeDraft('# 另一个标题\n\n正文[^1]');
    const { item, snapshot } = buildRunRecord(base({ md: '# 标题\n\n正文', analysis }));
    expect(item.title).toBe('另一个标题');
    expect(snapshot.deg).toBe(1);
  });
});
