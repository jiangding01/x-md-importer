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
