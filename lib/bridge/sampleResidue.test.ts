// 第三批 I2:空稿取样插入的 'x' 是否残留在编辑器里(只有正文恰为 'x' 才视为残留、才撤回)。
import { describe, expect, it } from 'vitest';
import { isSampleResidue } from './sampleResidue';

describe('isSampleResidue', () => {
  it('正文恰为取样字符(忽略空白与零宽字符)→ 是', () => {
    expect(isSampleResidue('x')).toBe(true);
    expect(isSampleResidue(' x\n')).toBe(true);
    expect(isSampleResidue('​x﻿')).toBe(true);
  });
  it('空、多字符、其他内容 → 否(不误撤用户内容)', () => {
    expect(isSampleResidue('')).toBe(false);
    expect(isSampleResidue('xx')).toBe(false);
    expect(isSampleResidue('X')).toBe(false);
    expect(isSampleResidue('x y')).toBe(false);
  });
});
