// 第三批 O8:文件夹操作错误码 → 文案(SettingsTab 与 AssetsCard 共用一份)。
import { describe, expect, it } from 'vitest';
import { dictionaries } from '../i18n/dict';
import { folderErrText } from './folderErrText';

describe('folderErrText', () => {
  const t = dictionaries.zh;
  it('各错误码映射', () => {
    expect(folderErrText(t, 'disconnected')).toBe(t.folderNeedXToast);
    expect(folderErrText(t, 'permission-denied')).toBe(t.folderDeniedToast);
    expect(folderErrText(t, 'timeout')).toBe(t.folderTimeoutToast);
    expect(folderErrText(t, 'whatever')).toBe(t.folderFailToast);
  });
});
