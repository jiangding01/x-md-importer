/**
 * 备份与恢复:把全部本地数据(界面偏好 / 导入设置 / 历史记录 / 当前草稿)导出成一个 JSON,
 * 或从这样的 JSON 恢复。纯 chrome.storage 层操作,不碰 DOM(下载/选文件由 UI 侧做)。
 *
 * 恢复策略:宽松写回——各切片按 key 保存后,下次 `loadX` 都会 `{...默认, ...存储}` 合并默认值,
 * 故即便备份里某字段缺失/来自旧版本也不会崩(只是缺的用默认)。恢复后由 UI reload 重读生效。
 */

import { loadPrefs, savePrefs, defaultPrefs, type Prefs } from './prefs';
import { loadOptions, saveOptions } from './optionsStore';
import { loadHistory, saveHistory, type HistoryItem } from './historyStore';
import { loadDraft, saveDraft } from './draftStore';
import { defaultOptions, type Options } from '@/lib/settings/options';
import { SKINS } from '@/lib/theme/themes';
import { truncateForReport, type ImageFailure } from '@/lib/bridge/protocol';

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

// ── 逐字段白名单校验(review B2)──
// 背景:此前对 prefs/options/history 裸断言宽松写回,坏备份可注入非法值——非法 skin 让
// bootstrap 的 resolveDark→skinMeta[skin] 越界抛(白屏、设置页不可达);history 项缺 title
// 让 HistoryTab h.title.toLowerCase() 抛(卸载整树);非法 onExisting 静默变「总是覆盖」。
// 恢复入口是唯一能把外部脏数据带进 storage 的口子,故在此逐字段过白名单、非法回落默认。

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** 枚举字段:取值不在白名单则回落默认。 */
function pickEnum<T extends string>(v: unknown, allowed: readonly T[], dflt: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : dflt;
}
/** 布尔字段:非 boolean 回落默认。 */
function pickBool(v: unknown, dflt: boolean): boolean {
  return typeof v === 'boolean' ? v : dflt;
}
/** string | null 字段(文件夹名):非 string 且非 null 回落默认。 */
function pickStrOrNull(v: unknown, dflt: string | null): string | null {
  if (v === null) return null;
  return typeof v === 'string' ? v : dflt;
}
/** 有限数值字段:非有限数回落默认。 */
function pickNum(v: unknown, dflt: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : dflt;
}

const THEME_MODES = ['light', 'dark', 'system'] as const;
const LANGS = ['auto', 'zh', 'en'] as const;

/** 校验界面偏好:每字段过白名单,非法回落 defaultPrefs。accent 保留任意字符串(仅极简主题用作色值)。 */
export function validatePrefs(raw: unknown): Prefs {
  const p = isObj(raw) ? raw : {};
  return {
    skin: pickEnum(p.skin, SKINS, defaultPrefs.skin),
    theme: pickEnum(p.theme, THEME_MODES, defaultPrefs.theme),
    accent: typeof p.accent === 'string' ? p.accent : defaultPrefs.accent,
    lang: pickEnum(p.lang, LANGS, defaultPrefs.lang),
  };
}

/** 校验导入设置:每字段过白名单(取值集参照 options.ts),非法回落 defaultOptions。 */
export function validateOptions(raw: unknown): Options {
  const o = isObj(raw) ? raw : {};
  const D = defaultOptions;
  return {
    editorFont: pickEnum(o.editorFont, ['sm', 'md', 'lg'] as const, D.editorFont),
    wrap: pickBool(o.wrap, D.wrap),
    onExisting: pickEnum(o.onExisting, ['ask', 'append', 'overwrite'] as const, D.onExisting),
    scrollTop: pickBool(o.scrollTop, D.scrollTop),
    autoReport: pickEnum(o.autoReport, ['always', 'anomaly', 'never'] as const, D.autoReport),
    setTitle: pickBool(o.setTitle, D.setTitle),
    titleConflict: pickEnum(o.titleConflict, ['ask', 'overwrite', 'keep'] as const, D.titleConflict),
    h1Handle: pickEnum(o.h1Handle, ['remove', 'keep'] as const, D.h1Handle),
    setCover: pickBool(o.setCover, D.setCover),
    coverKeep: pickEnum(o.coverKeep, ['keep', 'remove'] as const, D.coverKeep),
    codeStrategy: pickEnum(o.codeStrategy, ['native', 'image', 'quote'] as const, D.codeStrategy),
    taskList: pickEnum(o.taskList, ['symbol', 'plain'] as const, D.taskList),
    obsidianImg: pickBool(o.obsidianImg, D.obsidianImg),
    wikilink: pickBool(o.wikilink, D.wikilink),
    punct: pickBool(o.punct, D.punct),
    zhConvert: pickEnum(o.zhConvert, ['off', 's2t', 't2s'] as const, D.zhConvert),
    folder: pickBool(o.folder, D.folder),
    folderName: pickStrOrNull(o.folderName, D.folderName),
    activeFolder: pickBool(o.activeFolder, D.activeFolder),
    activeFolderName: pickStrOrNull(o.activeFolderName, D.activeFolderName),
    compress: pickBool(o.compress, D.compress),
    maxEdge: pickEnum(o.maxEdge, ['960', '1280', '1600', 'orig'] as const, D.maxEdge),
    quality: pickEnum(o.quality, ['60', '70', '82', '90', '95'] as const, D.quality),
    confetti: pickBool(o.confetti, D.confetti),
    sound: pickBool(o.sound, D.sound),
    soundStyle: pickEnum(o.soundStyle, ['soft', 'crisp', 'mute'] as const, D.soundStyle),
    histLimit: pickEnum(o.histLimit, ['50', '200', 'inf'] as const, D.histLimit),
    retries: pickEnum(o.retries, ['0', '1', '3', '5'] as const, D.retries),
  };
}

/**
 * 校验图片失败明细:逐项校验字段类型,任一项不合格则整个数组**丢弃**(返回 undefined)——
 * 明细只用于展示,坏数据宁缺毋滥;缺省与旧备份自然兼容。stage 枚举、reason 任意字符串
 * (原因码约定见 protocol.ts ImageFailure,UI 对未知码原样展示)。
 * 生产端不变量在恢复边界重建:index 必须是 ≥ -1 的整数(-1=封面哨兵,负数/小数拒收);
 * source/detail 经 truncateForReport 重截——生产端的截断约束对手工构造/篡改的备份不生效,
 * 不重截则数 MB 字符串可直接持久化进 storage 并整段渲染进报告卡。
 */
export function validateImageFailures(raw: unknown): ImageFailure[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: ImageFailure[] = [];
  for (const f of raw) {
    if (
      !isObj(f) ||
      typeof f.index !== 'number' || !Number.isInteger(f.index) || f.index < -1 ||
      typeof f.source !== 'string' ||
      (f.stage !== 'prepare' && f.stage !== 'upload') ||
      typeof f.reason !== 'string' ||
      (f.detail !== undefined && typeof f.detail !== 'string')
    ) {
      return undefined;
    }
    out.push({
      index: f.index,
      source: truncateForReport(f.source, 80),
      stage: f.stage,
      reason: truncateForReport(f.reason, 60),
      detail: f.detail === undefined ? undefined : truncateForReport(f.detail, 200),
    });
  }
  return out;
}

/**
 * 校验历史记录:逐项校验必需字段,合格项规整为标准 HistoryItem,不合格的项**丢弃**。
 * id(number)是主键 / React key / 删除依据,缺失即无法安全承载 → 丢弃;title/md/date/数值
 * 缺失则补默认(不丢整项),保证下游 toLowerCase / 渲染不再抛。
 */
export function validateHistory(raw: unknown): HistoryItem[] {
  if (!Array.isArray(raw)) return [];
  const out: HistoryItem[] = [];
  for (const it of raw) {
    if (!isObj(it) || typeof it.id !== 'number' || !Number.isFinite(it.id)) continue;
    out.push({
      id: it.id,
      title: typeof it.title === 'string' ? it.title : '',
      date: typeof it.date === 'string' ? it.date : '',
      ok: pickNum(it.ok, 0),
      deg: pickNum(it.deg, 0),
      fail: pickNum(it.fail, 0),
      md: typeof it.md === 'string' ? it.md : '',
      imageFailures: validateImageFailures(it.imageFailures),
    });
  }
  return out;
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
