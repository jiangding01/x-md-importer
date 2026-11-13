// 导入收尾保存稳定窗判定(X 偶发用旧快照覆盖正文,收尾须等保存稳定后再逐图核对)。
import { describe, expect, it } from 'vitest';
import {
  createSaveTracker,
  isContentSaveUrl,
  MIN_SINCE_WRITE_MS,
  QUIESCE_FALLBACK_MS,
  QUIET_AFTER_SAVE_MS,
} from './saveQuiesce';

describe('isContentSaveUrl', () => {
  it('只认正文保存操作名', () => {
    expect(isContentSaveUrl('https://x.com/i/api/graphql/AbC123/ArticleEntityUpdateContent')).toBe(true);
    expect(isContentSaveUrl('https://x.com/i/api/graphql/AbC123/ArticleEntityUpdateTitle')).toBe(false);
    expect(isContentSaveUrl('https://x.com/i/api/graphql/AbC123/ArticleEntityUpdateCoverMedia')).toBe(false);
    expect(isContentSaveUrl(undefined)).toBe(false);
  });
});

describe('createSaveTracker', () => {
  it('初始无记录:计数 0、完成时刻 null、诊断距离 null', () => {
    const t = createSaveTracker();
    expect(t.observedCount).toBe(0);
    expect(t.lastCompletionAt).toBeNull();
    expect(t.lastStartAt).toBeNull();
    expect(t.msSinceLastSave(1000)).toBeNull();
  });

  it('record 取最大值(条目完成顺序可乱)', () => {
    const t = createSaveTracker();
    t.record({ startTime: 500, responseEnd: 900 });
    t.record({ startTime: 300, responseEnd: 600 });
    expect(t.observedCount).toBe(2);
    expect(t.lastStartAt).toBe(500);
    expect(t.lastCompletionAt).toBe(900);
    expect(t.msSinceLastSave(1400)).toBe(500);
  });

  it('responseEnd 为 0(跨源受限)或早于 startTime 时按 startTime 计;非有限 startTime 丢弃', () => {
    const t = createSaveTracker();
    t.record({ startTime: 700, responseEnd: 0 });
    expect(t.lastCompletionAt).toBe(700);
    t.record({ startTime: Number.NaN, responseEnd: 5000 });
    expect(t.observedCount).toBe(1);
    expect(t.lastCompletionAt).toBe(700);
  });

  it('距最后写入不足 MIN_SINCE_WRITE_MS 一律不稳', () => {
    const t = createSaveTracker();
    t.record({ startTime: 1100, responseEnd: 1200 });
    expect(t.isQuiet({ lastWriteAt: 1000, now: 1000 + MIN_SINCE_WRITE_MS - 1 })).toBe(false);
  });

  it('有一条发起晚于最后写入的保存已完成、且其后静默 ≥ QUIET_AFTER_SAVE_MS → 稳', () => {
    const t = createSaveTracker();
    t.record({ startTime: 1100, responseEnd: 1300 });
    const quietAt = 1300 + QUIET_AFTER_SAVE_MS;
    expect(t.isQuiet({ lastWriteAt: 1000, now: Math.max(quietAt, 1000 + MIN_SINCE_WRITE_MS) })).toBe(true);
  });

  it('保存完成后静默不足 → 不稳', () => {
    const t = createSaveTracker();
    t.record({ startTime: 1100, responseEnd: 2400 });
    expect(t.isQuiet({ lastWriteAt: 1000, now: 2400 + QUIET_AFTER_SAVE_MS - 1 })).toBe(false);
  });

  it('只有写入之前发起的保存(观察到过保存)→ 不退化,不稳', () => {
    const t = createSaveTracker();
    t.record({ startTime: 900, responseEnd: 1100 });
    expect(t.isQuiet({ lastWriteAt: 1000, now: 1000 + QUIESCE_FALLBACK_MS + 5000 })).toBe(false);
  });

  it('发起时刻恰等于最后写入不算「晚于」', () => {
    const t = createSaveTracker();
    t.record({ startTime: 1000, responseEnd: 1100 });
    expect(t.isQuiet({ lastWriteAt: 1000, now: 9000 })).toBe(false);
  });

  it('一条保存都没观察到 → 退化为距最后写入 ≥ QUIESCE_FALLBACK_MS', () => {
    const t = createSaveTracker();
    expect(t.isQuiet({ lastWriteAt: 1000, now: 1000 + QUIESCE_FALLBACK_MS - 1 })).toBe(false);
    expect(t.isQuiet({ lastWriteAt: 1000, now: 1000 + QUIESCE_FALLBACK_MS })).toBe(true);
  });

  it('稳定后又有新写入:须等新写入之后发起的保存', () => {
    const t = createSaveTracker();
    t.record({ startTime: 1100, responseEnd: 1200 });
    expect(t.isQuiet({ lastWriteAt: 1000, now: 3000 })).toBe(true);
    expect(t.isQuiet({ lastWriteAt: 3500, now: 6000 })).toBe(false);
    t.record({ startTime: 3600, responseEnd: 3800 });
    expect(t.isQuiet({ lastWriteAt: 3500, now: 4799 })).toBe(false);
    expect(t.isQuiet({ lastWriteAt: 3500, now: 5000 })).toBe(true);
  });
});
