// W1(2026-10-26):导入收尾的纯计算——历史条目 / 报告快照 / 是否异常,只取决于本次运行显式传入的数据。
import { describe, expect, it } from 'vitest';
import { buildRunRecord, type RunInput } from './runRecord';
import type { ImageFailure } from '../bridge/protocol';

const base = (over: Partial<RunInput> = {}): RunInput => ({
  md: '# 标题\n\n正文',
  parseOpts: { obsidianImg: true, wikilink: true, taskList: 'symbol' },
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
