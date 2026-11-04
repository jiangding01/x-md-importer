// 第二批 W11 / I3:引擎错误码映射为本地化文案;未知错误保留原文便于诊断。
import { describe, expect, it } from 'vitest';
import { dictionaries } from '../i18n/dict';
import { SAMPLE_RESIDUE_SUFFIX } from '../bridge/sampleResidue';
import { importErrorText, importFailureText, titleResultText } from './errorText';

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

describe('importFailureText(A11 S2 写入失败 toast 优先级)', () => {
  it('提交后切文章 → 专属文案(中英),不再落到通用「正文可能已写入」', () => {
    expect(importFailureText('article-switched', true, zh)).toBe(zh.errSwitchedAfterCommit);
    expect(importFailureText('article-switched', true, dictionaries.en)).toBe(dictionaries.en.errSwitchedAfterCommit);
    expect(zh.errSwitchedAfterCommit).not.toContain('检查 X 编辑器'); // 切走后编辑器仍显示旧内容,不引导去看编辑器
  });
  it('提交前切文章 → 未写入文案', () => {
    expect(importFailureText('article-switched', false, zh)).toBe(zh.errArticleSwitched);
    expect(importFailureText('article-switched', undefined, zh)).toBe(zh.errArticleSwitched);
  });
  it('提交后其他失败 / 通道超时 → 正文可能已写入(B2-2 不变)', () => {
    expect(importFailureText('verify: only 1/3 blocks landed', true, zh)).toBe(zh.errFailedButCommitted);
    expect(importFailureText('timeout', undefined, zh)).toBe(zh.errFailedButCommitted);
  });
  it('其余按 importErrorText 归类', () => {
    expect(importFailureText('disconnected', undefined, zh)).toBe(zh.errDisconnected);
    expect(importFailureText('commit: boom', false, zh)).toBe(`${zh.errWriteFail}: commit: boom`);
  });
});

describe('titleResultText', () => {
  it('applied / kept / 未找到 / 通道错误', () => {
    expect(titleResultText({ ok: true, applied: true }, zh)).toBe(zh.titleSet);
    expect(titleResultText({ ok: true, applied: false }, zh)).toBe(zh.titleKept);
    expect(titleResultText({ ok: false, error: 'title field not found' }, zh)).toBe(zh.titleFieldMissing);
    expect(titleResultText({ ok: false, error: 'timeout' }, zh)).toBe(`${zh.titleFail}: ${zh.errTimeout}`);
  });
  it('A11:标题阶段已切文章 → 专属文案(不外露英文错误码,也不诱导重新写入)', () => {
    expect(titleResultText({ ok: false, error: 'article-switched' }, zh)).toBe(zh.titleArticleSwitched);
    expect(titleResultText({ ok: false, error: 'article-switched' }, dictionaries.en)).toBe(
      dictionaries.en.titleArticleSwitched,
    );
  });
});
