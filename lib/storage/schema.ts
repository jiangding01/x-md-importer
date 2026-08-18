/**
 * 持久化数据的**结构定义与逐字段校验**——storage 各切片的单一事实来源。
 *
 * 为什么单独成模块(而非留在 backup.ts):校验器原本只服务「恢复备份」,而 `backup.ts`
 * 自身 import 了四个 loader(导出时要读当前数据)。若让 loader 反过来 import 它以复用校验,
 * 就会形成 `prefs.ts → backup.ts → prefs.ts` 的运行时循环依赖。把「类型 + 默认值 + 校验」
 * 下沉到本模块(只依赖 options / themes / protocol,不依赖任何 loader),依赖图即为无环:
 *
 *   schema.ts  ←── loaders(prefs / optionsStore / historyStore)
 *        ↑                      ↑
 *        └────── backup.ts ─────┘
 *
 * `Prefs` / `defaultPrefs` / `HistoryItem` 迁入本模块后,原模块继续 re-export,
 * 既有导入点(PrefsProvider / WorkspaceProvider / HistoryTab 等)无需改动。
 */

import type { Accent, Skin, ThemeMode } from '@/lib/theme/themes';
import type { LangPref } from '@/lib/i18n/dict';
import { defaultOptions, type Options } from '@/lib/settings/options';
import { SKINS } from '@/lib/theme/themes';
import { truncateForReport, type ImageFailure } from '@/lib/bridge/protocol';

// ---------------------------------------------------------------------------
// 结构定义与默认值
// ---------------------------------------------------------------------------

/** 主题 / 语言等界面偏好，需在首帧前同步读取以避免闪烁。 */
export interface Prefs {
  skin: Skin;
  theme: ThemeMode;
  accent: Accent;
  lang: LangPref;
}

export const defaultPrefs: Prefs = {
  skin: 'minimal',
  theme: 'system',
  accent: '#1D9BF0',
  lang: 'auto',
};

/**
 * 一条导入历史。
 * id:新记录用 `crypto.randomUUID()`(string,双窗口同毫秒导入不再撞 key);
 * 旧记录是 `Date.now()`(number),读入照收——两种形状都是合法主键。
 */
export interface HistoryItem {
  id: string | number;
  title: string;
  date: string;
  ok: number;
  deg: number;
  fail: number;
  md: string;
  /** 图片失败明细(fail=0 或旧记录时缺省)——存进历史供事后排查,不只当次展示。 */
  imageFailures?: ImageFailure[];
}

// ---------------------------------------------------------------------------
// 逐字段白名单校验(review B2)
//
// 背景:此前对 prefs/options/history 裸断言宽松写回,坏数据可注入非法值——非法 skin 让
// bootstrap 的 resolveDark→skinMeta[skin] 越界抛(白屏、设置页不可达);history 项缺 title
// 让 HistoryTab h.title.toLowerCase() 抛(卸载整树);非法 onExisting 静默变「总是覆盖」。
//
// **校验同时用于「恢复备份」与「日常加载」两条路径**:恢复入口是外部脏数据的入口,而
// 日常加载面对的是「已经落在 storage 里的脏数据」(扩展早期版本写入 / 版本迁移遗留 /
// 手工篡改 / 其他扩展写入)。此前只有恢复路径校验、加载路径裸信任,是一处不对称——
// 后果不只是崩,更是**恢复手段过重**:一个坏 skin 字段就要用户「清空全部本地数据」,
// 草稿与历史一并陪葬。加载路径接上校验后,坏字段静默回落默认,用户数据得以保全。
// ---------------------------------------------------------------------------

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
 * source/detail 经 truncateForReport 重截——生产端的截断约束对手工构造/篡改的数据不生效,
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
 * id 是主键 / React key / 删除依据,缺失即无法安全承载 → 丢弃;合法形状 = 非空 string
 * (新版 UUID)或有限 number(旧版时间戳)。title/md/date/数值缺失则补默认(不丢整项),
 * 保证下游 toLowerCase / 渲染不再抛。
 */
export function validateHistory(raw: unknown): HistoryItem[] {
  if (!Array.isArray(raw)) return [];
  const out: HistoryItem[] = [];
  for (const it of raw) {
    if (!isObj(it)) continue;
    const idOk =
      (typeof it.id === 'string' && it.id.length > 0 && it.id.length <= 64) ||
      (typeof it.id === 'number' && Number.isFinite(it.id));
    if (!idOk) continue;
    out.push({
      id: it.id as string | number,
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
 * 校验草稿:必须是字符串,否则回落空串。
 * `getItem` 只在值为 `undefined` 时用 fallback,故 storage 里若躺着 number / object /
 * null,会被原样返回 → `md.trim()` 之类在渲染期抛(整树卸载)。这里挡住。
 */
export function validateDraft(raw: unknown): string {
  return typeof raw === 'string' ? raw : '';
}
