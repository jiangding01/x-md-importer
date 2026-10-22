/**
 * 备份与恢复:把全部本地数据(界面偏好 / 导入设置 / 历史记录 / 当前草稿)导出成一个 JSON,
 * 或从这样的 JSON 恢复。纯 chrome.storage 层操作,不碰 DOM(下载/选文件由 UI 侧做)。
 *
 * 恢复策略:先校验来源(app/kind/version,见 importBackup),各切片再**逐字段白名单校验**后
 * 顺序写回;`loadX` 会 `{...默认, ...存储}` 合并默认值,故切片内部分字段缺失/来自旧版本也
 * 不会崩(只是缺的用默认)。写回顺序执行、失败即停并如实报告哪些切片已恢复(B4-2/P2-16)。
 * 恢复后由 UI reload 重读生效。
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
  version: number; // 2=当前(id 可为 UUID string);1=旧版(id 为 number)。恢复侧按版本分支兼容。
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
  return { app: 'markflow', kind: 'backup', version: 2, exportedAt: new Date().toISOString(), prefs, options, history, draft };
}

/**
 * importBackup 失败原因(B4-1/P2-15):UI 据此区分文案,不能笼统一句「不是有效备份」——
 * 'wrong-kind' 专指「选中的文件不是备份」(最常见诱因是诊断快照 kind:'diagnostics',它同样
 * 带 app:'markflow' 与 prefs/options 字段,此前会被当备份「恢复成功」但草稿其实没动);
 * 'bad-version' 专指版本号不认识(既不是当前的 2 也不是兼容的 1),不能假装按旧格式硬读——
 * 静默解析未来版本号可能悄悄丢字段。
 */
export type BackupImportErrorReason = 'not-object' | 'wrong-kind' | 'bad-version' | 'empty';

export class BackupImportError extends Error {
  constructor(
    public readonly reason: BackupImportErrorReason,
    message: string,
  ) {
    super(message);
    this.name = 'BackupImportError';
  }
}

export type BackupSlice = 'prefs' | 'options' | 'history' | 'draft';

/** importBackup 的执行结果(B4-2/P2-16):哪些切片已成功写回、若中途失败停在哪个切片。 */
export interface RestoreReport {
  restored: BackupSlice[];
  failedAt?: { slice: BackupSlice; error: string };
}

/**
 * 从备份对象恢复:校验来源(app/kind/version)后,把各切片**逐字段白名单校验**再**顺序**写回
 * storage。至少要有一个可恢复的切片,否则视为无效文件抛错(BackupImportError)。
 *
 * 顺序执行而非 Promise.all(B4-2):此前并发写入时任一切片失败、其余已落盘的切片仍然生效,
 * 造成「部分恢复」的混合态且调用方无从知晓具体是哪个切片出的问题。顺序执行 + 失败即停,
 * 把「哪些已恢复 / 在哪个切片失败」如实报告给调用方(doRestoreBackup 据此提示,而不是
 * 笼统一句「恢复失败」)。写回后由调用方 reload 重读生效。
 */
export async function importBackup(raw: unknown): Promise<RestoreReport> {
  const d = raw as Partial<BackupData> | null;
  // 数组的 typeof 也是 'object'——显式排除,否则一个坏数组会落进下面的 'wrong-kind'
  // 分支(误导用户以为"选错了文件类型",实际上连对象形状都不是)。
  if (!d || typeof d !== 'object' || Array.isArray(d)) {
    throw new BackupImportError('not-object', 'not a MarkFlow backup: payload is not an object');
  }
  if (d.app !== 'markflow' || d.kind !== 'backup') {
    throw new BackupImportError(
      'wrong-kind',
      'not a MarkFlow backup (wrong app/kind — a diagnostics snapshot was selected instead?)',
    );
  }
  // 版本分支(跨批全局定案 2):2=当前原生;1=旧版兼容读入——旧版 history 条目 id 是 number,
  // validateHistory 本就双形状兼容(string UUID / number 时间戳都合法),无需额外分支逻辑。
  // 其余版本号(未来大版本 / 缺失 / 非数字)一律明确拒收。
  if (d.version !== 1 && d.version !== 2) {
    throw new BackupImportError('bad-version', `unsupported backup version: ${String(d.version)}`);
  }

  type SliceTask = { slice: BackupSlice; run: () => Promise<void> };
  const tasks: SliceTask[] = [];
  if (d.prefs !== undefined) tasks.push({ slice: 'prefs', run: () => savePrefs(validatePrefs(d.prefs)) });
  if (d.options !== undefined) tasks.push({ slice: 'options', run: () => saveOptions(validateOptions(d.options)) });
  if (Array.isArray(d.history)) tasks.push({ slice: 'history', run: () => saveHistory(validateHistory(d.history)) });
  if (typeof d.draft === 'string') {
    const draft = d.draft; // 闭包捕获前先落一个已窄化的 const——箭头函数体内的 d.draft 会丢失 typeof 窄化
    tasks.push({ slice: 'draft', run: () => saveDraft(draft) });
  }
  if (!tasks.length) throw new BackupImportError('empty', 'backup has no restorable data');

  const restored: BackupSlice[] = [];
  for (const task of tasks) {
    try {
      await task.run();
      restored.push(task.slice);
    } catch (err) {
      return { restored, failedAt: { slice: task.slice, error: String(err) } };
    }
  }
  return { restored };
}
