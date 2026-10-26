/**
 * 空稿取样的残留判定(第三批 I2)。全空草稿没有可借的 CharacterMetadata 样本,injector 以
 * `execCommand('insertText', 'x')` 逼出一个字符;若之后取样失败,这个 `x` 会留在用户的编辑器里。
 * 只有正文**恰为**取样字符(忽略空白与零宽字符)才视为残留、才撤回——绝不误撤用户自己的内容。
 */
export const SAMPLE_CHAR = 'x';

/** 撤回不掉时附在错误短语末尾,侧边栏据此提示用户手动删除(见 lib/workspace/errorText)。 */
export const SAMPLE_RESIDUE_SUFFIX = ' (sample char left in editor)';

export function isSampleResidue(text: string): boolean {
  return text.replace(/[\s​﻿]/g, '') === SAMPLE_CHAR;
}
