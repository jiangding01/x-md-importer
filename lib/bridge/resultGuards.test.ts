// resultGuards —— content 侧 injector 回传结果形状守卫单测(B9)。
import { describe, expect, it } from 'vitest';
import {
  MAX_DETAIL_LEN,
  MAX_ERROR_LEN,
  MAX_IMAGE_FAILURES,
  MAX_SOURCE_LEN,
  normalizeImportResult,
  normalizeProbeResult,
  normalizeSetTitleResult,
} from './resultGuards';

const BAD = { ok: false, error: 'bad-result' };
const okImport = { ok: true, blockCount: 3, effectiveMode: 'replace', imageOk: 1, imageFail: 1 };
const failure = { index: 0, source: 'a.png', stage: 'prepare', reason: 'local-not-found' };

describe('normalizeImportResult', () => {
  it('合法成功结果原样通过,丢弃未知字段', () => {
    const r = normalizeImportResult({ ...okImport, coverSet: true, imageFailures: [failure], settleTimeouts: ['x'], evil: 1 });
    expect(r).toEqual({ ...okImport, coverSet: true, imageFailures: [failure] });
  });

  it('合法失败结果通过,error 截断', () => {
    const r = normalizeImportResult({ ok: false, error: 'e'.repeat(5000), committed: true });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.length).toBe(MAX_ERROR_LEN);
      expect(r.committed).toBe(true);
    }
  });

  it.each([
    ['非对象', null],
    ['字符串', 'ok'],
    ['ok 非布尔', { ...okImport, ok: 'true' }],
    ['失败分支 error 非字符串', { ok: false, error: 42 }],
    ['失败分支 committed 非布尔', { ok: false, error: 'x', committed: 'yes' }],
  ])('不合规(%s)→ bad-result', (_name, raw) => {
    expect(normalizeImportResult(raw)).toEqual(BAD);
  });

  it.each([
    ['imageFailures 非数组', { ...okImport, imageFailures: 'boom' }],
    ['imageFailures 对象', { ...okImport, imageFailures: { length: 1 } }],
    ['计数为负', { ...okImport, imageOk: -1 }],
    ['计数非整数', { ...okImport, blockCount: 1.5 }],
    ['计数为字符串', { ...okImport, imageFail: '1' }],
    ['effectiveMode 非枚举', { ...okImport, effectiveMode: 'nuke' }],
    ['coverSet 非布尔', { ...okImport, coverSet: 1 }],
    ['明细 stage 非枚举', { ...okImport, imageFailures: [{ ...failure, stage: 'x' }] }],
    ['明细 index < -1', { ...okImport, imageFailures: [{ ...failure, index: -2 }] }],
    ['明细 source 非字符串', { ...okImport, imageFailures: [{ ...failure, source: 1 }] }],
    ['明细 detail 非字符串', { ...okImport, imageFailures: [{ ...failure, detail: {} }] }],
  ])('ok:true 但形状不合规(%s)→ bad-result + committed', (_name, raw) => {
    expect(normalizeImportResult(raw)).toEqual({ ...BAD, committed: true });
  });

  it('明细字符串截断 + 条数上限', () => {
    const big = { ...failure, source: 's'.repeat(10_000), detail: 'd'.repeat(10_000) };
    const r = normalizeImportResult({ ...okImport, imageFailures: Array.from({ length: 1000 }, () => big) });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.imageFailures).toHaveLength(MAX_IMAGE_FAILURES);
      expect(r.imageFailures![0]!.source.length).toBe(MAX_SOURCE_LEN);
      expect(r.imageFailures![0]!.detail!.length).toBe(MAX_DETAIL_LEN);
    }
  });
});

describe('normalizeSetTitleResult', () => {
  it('合法结果通过', () => {
    expect(normalizeSetTitleResult({ ok: true, applied: false })).toEqual({ ok: true, applied: false });
    expect(normalizeSetTitleResult({ ok: false, error: 'title field not found' })).toEqual({
      ok: false,
      error: 'title field not found',
    });
  });

  it.each([[null], [{ ok: true }], [{ ok: true, applied: 'yes' }], [{ ok: false }], [{ ok: 1, applied: true }]])(
    '不合规 %j → bad-result',
    (raw) => {
      expect(normalizeSetTitleResult(raw)).toEqual(BAD);
    },
  );

  it('error 截断', () => {
    const r = normalizeSetTitleResult({ ok: false, error: 'x'.repeat(2000) });
    expect(!r.ok && r.error.length).toBe(MAX_ERROR_LEN);
  });
});

describe('normalizeProbeResult', () => {
  const good = {
    hasEditor: true,
    hasDraftNode: true,
    hasOnFilesAdded: true,
    articleId: '123',
    hasContent: false,
    isArticleEditor: true,
  };

  it('合法结果通过,丢弃未知字段', () => {
    expect(normalizeProbeResult({ ...good, evil: 1 })).toEqual(good);
  });

  it('旧 injector 缺 isArticleEditor 时保持缺失(供 classifyProbeResult 判 needs-refresh)', () => {
    const { isArticleEditor: _omit, ...old } = good;
    expect('isArticleEditor' in normalizeProbeResult(old)).toBe(false);
  });

  it.each([
    ['非对象', 'x'],
    ['灯非布尔', { ...good, hasEditor: 'true' }],
    ['articleId 非字符串', { ...good, articleId: 1 }],
    ['articleId 超长', { ...good, articleId: '1'.repeat(1000) }],
    ['isArticleEditor 非布尔', { ...good, isArticleEditor: 1 }],
  ])('不合规(%s)→ 四灯全灭 + bad-result', (_name, raw) => {
    const r = normalizeProbeResult(raw);
    expect(r).toMatchObject({ hasEditor: false, hasDraftNode: false, hasOnFilesAdded: false, isArticleEditor: false, error: 'bad-result' });
  });
});
