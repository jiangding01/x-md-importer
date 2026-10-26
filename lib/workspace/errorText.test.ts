// 第二批 W11 / I3:引擎错误码映射为本地化文案;未知错误保留原文便于诊断。
import { describe, expect, it } from 'vitest';
import { dictionaries } from '../i18n/dict';
import { SAMPLE_RESIDUE_SUFFIX } from '../bridge/sampleResidue';
import { importErrorText, titleResultText } from './errorText';

const zh = dictionaries.zh;

describe('importErrorText', () => {
  it('既有映射不变', () => {
    expect(importErrorText('disconnected', zh)).toBe(zh.errDisconnected);
    expect(importErrorText('not-article-editor', zh)).toBe(zh.errNotArticleEditor);
  });
  it('并发写入 / 找不到编辑器 → 专属文案(不再外露英文原文)', () => {
    expect(importErrorText('import already in progress', zh)).toBe(zh.errImportBusy);
    expect(importErrorText('draft state node not found', zh)).toBe(zh.errNoEditor);
    expect(importErrorText('sample character: unable to acquire via execCommand', zh)).toBe(zh.errNoEditor);
  });
  it('第三批 I2:取样失败且撤回不了插入的 x → 找不到编辑器 + 提示手动删除', () => {
    expect(importErrorText(`sample character: unable to acquire via execCommand${SAMPLE_RESIDUE_SUFFIX}`, zh)).toBe(
      `${zh.errNoEditor} · ${zh.errSampleResidue}`,
    );
  });
  it('未知错误:「写入失败: 原文」', () => {
    expect(importErrorText('commit: boom', zh)).toBe(`${zh.errWriteFail}: commit: boom`);
  });
});

describe('titleResultText', () => {
  it('applied / kept / 未找到 / 通道错误', () => {
    expect(titleResultText({ ok: true, applied: true }, zh)).toBe(zh.titleSet);
    expect(titleResultText({ ok: true, applied: false }, zh)).toBe(zh.titleKept);
    expect(titleResultText({ ok: false, error: 'title field not found' }, zh)).toBe(zh.titleFieldMissing);
    expect(titleResultText({ ok: false, error: 'timeout' }, zh)).toBe(`${zh.titleFail}: ${zh.errTimeout}`);
  });
});
