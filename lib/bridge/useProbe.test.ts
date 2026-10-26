import { describe, expect, it } from 'vitest';
import type { ProbeResult } from './protocol';
import { classifyProbeResult } from './useProbe';

const base: ProbeResult = {
  hasEditor: true,
  hasDraftNode: true,
  hasOnFilesAdded: true,
  articleId: '123',
  hasContent: false,
  isArticleEditor: true,
};

describe('classifyProbeResult', () => {
  it('新 injector 正常回 isArticleEditor → ready', () => {
    expect(classifyProbeResult(base)).toBe('ready');
    expect(classifyProbeResult({ ...base, isArticleEditor: false })).toBe('ready');
  });

  it('旧 injector 缺 isArticleEditor 且 hasDraftNode → needs-refresh', () => {
    const { isArticleEditor: _omit, ...legacy } = base;
    expect(classifyProbeResult(legacy as ProbeResult)).toBe('needs-refresh');
  });

  it('缺 isArticleEditor 但无 draft 节点 → 仍按 ready(由 connected 闸门判未连接)', () => {
    const { isArticleEditor: _omit, ...legacy } = base;
    expect(classifyProbeResult({ ...(legacy as ProbeResult), hasDraftNode: false })).toBe('ready');
  });
});

// 第二批 W5:重探期间保留上次结论;标签事件只认本窗口。
import { beginProbe, isOwnWindowEvent } from './useProbe';

describe('beginProbe / isOwnWindowEvent(W5)', () => {
  it('首次探测(尚无结论)显示 probing;已有结论时只置 loading、保留 status / result', () => {
    expect(beginProbe({ status: 'probing', result: null, loading: false, settled: false })).toEqual({ status: 'probing', result: null, loading: true, settled: false });
    const ready = { status: 'ready' as const, result: null, loading: false, settled: true };
    expect(beginProbe(ready)).toEqual({ ...ready, loading: true });
  });
  it('窗口过滤:本窗口或未知(取不到窗口 id)→ 处理;其他窗口 → 忽略', () => {
    expect(isOwnWindowEvent(3, 3)).toBe(true);
    expect(isOwnWindowEvent(4, 3)).toBe(false);
    expect(isOwnWindowEvent(4, null)).toBe(true);
    expect(isOwnWindowEvent(undefined, 3)).toBe(true);
  });
});
