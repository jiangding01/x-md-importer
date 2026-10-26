import type { Dict } from '@/lib/i18n/dict';

/**
 * 本地文件夹操作(连接 / 清除)的错误码 → 可读文案,不把英文诊断码弹给用户。第三批 O8:此前 SettingsTab 与
 * AssetsCard 各有一份同样的实现,合并为一处。
 */
export function folderErrText(t: Dict, error: string): string {
  if (error === 'disconnected') return t.folderNeedXToast;
  if (error === 'permission-denied') return t.folderDeniedToast;
  if (error === 'timeout') return t.folderTimeoutToast;
  return t.folderFailToast;
}
