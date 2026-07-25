/**
 * 备份与恢复:把全部本地数据(界面偏好 / 导入设置 / 历史记录 / 当前草稿)导出成一个 JSON,
 * 或从这样的 JSON 恢复。纯 chrome.storage 层操作,不碰 DOM(下载/选文件由 UI 侧做)。
 *
 * 恢复策略:宽松写回——各切片按 key 保存后,下次 `loadX` 都会 `{...默认, ...存储}` 合并默认值,
 * 故即便备份里某字段缺失/来自旧版本也不会崩(只是缺的用默认)。恢复后由 UI reload 重读生效。
 */

import { loadPrefs, savePrefs } from './prefs';
import { loadOptions, saveOptions } from './optionsStore';
import { loadHistory, saveHistory } from './historyStore';
import { loadDraft, saveDraft } from './draftStore';
import { type Options } from '@/lib/settings/options';
// 校验器与结构定义同处 schema.ts —— 本模块与各 loader 共用同一套(见 schema.ts 顶部说明)。
// 校验器仍从这里 re-export:既有测试与调用点按 `from './backup'` 引入,保持不变。
import {
  validatePrefs,
  validateOptions,
  validateHistory,
  type Prefs,
  type HistoryItem,
} from './schema';

export {
  validatePrefs,
  validateOptions,
  validateHistory,
  validateImageFailures,
} from './schema';

/** 备份文件结构(带 app/kind/version 标识,便于恢复时校验来源与兼容)。 */
export interface BackupData {
  app: 'markflow';
  kind: 'backup';
  version: 1;
  exportedAt: string;
  prefs: Prefs;
  options: Options;
  history: HistoryItem[];
  draft: string;
}

/** 汇总全部本地数据为一个可导出的备份对象。 */
export async function exportBackup(): Promise<BackupData> {
  const [prefs, options, history, draft] = await Promise.all([
    loadPrefs(),
    loadOptions(),
    loadHistory(),
    loadDraft(),
  ]);
  return { app: 'markflow', kind: 'backup', version: 1, exportedAt: new Date().toISOString(), prefs, options, history, draft };
}

/**
 * 从备份对象恢复:校验来源(app==='markflow')后,把各切片**逐字段白名单校验**再写回 storage。
 * 至少要有一个可恢复的切片,否则视为无效文件抛错。写回后由调用方 reload 重读生效。
 */
export async function importBackup(raw: unknown): Promise<void> {
  const d = raw as Partial<BackupData> | null;
  if (!d || typeof d !== 'object' || d.app !== 'markflow') {
    throw new Error('not a MarkFlow backup');
  }
  const tasks: Promise<void>[] = [];
  if (d.prefs !== undefined) tasks.push(savePrefs(validatePrefs(d.prefs)));
  if (d.options !== undefined) tasks.push(saveOptions(validateOptions(d.options)));
  if (Array.isArray(d.history)) tasks.push(saveHistory(validateHistory(d.history)));
  if (typeof d.draft === 'string') tasks.push(saveDraft(d.draft));
  if (!tasks.length) throw new Error('backup has no restorable data');
  await Promise.all(tasks);
}
