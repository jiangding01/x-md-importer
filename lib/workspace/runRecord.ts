import type { ImageFailure } from '@/lib/bridge/protocol';
import { capability, firstTitle, type CapabilityAdjust } from '@/lib/markdown/capability';
import type { HistoryItem } from '@/lib/storage/schema';

/** 本次导入实际使用的解析开关(与 HistoryItem.parseOpts 同形)。 */
export type RunParseOpts = { obsidianImg: boolean; wikilink: boolean; taskList: 'symbol' | 'plain' };

/**
 * 报告卡的数据快照(B4-6/P2-25):导入收尾时钉死,ReportCard 只认它,不读当前 md/当前设置
 * (会随后续编辑/切换开关跳变),也不读 history[0](用户在「记录」页删除/清空历史会让它
 * 突然跳变甚至消失)。ok/deg/fail/imageFailures 来自本次写入的真实结果(图片上传是否失败等,
 * 单靠重新 parse md 推不出来),一并冻结,让「明细」与「汇总」共享同一个不可变数据源。
 */
export interface LastRunSnapshot {
  md: string;
  parseOpts: RunParseOpts;
  /** 第三批 P11:本次写入移除了标题块 / 封面首图——报告卡按它重算明细,与 deg 同口径。 */
  adjust: CapabilityAdjust;
  ok: number;
  deg: number;
  fail: number;
  imageFailures?: ImageFailure[];
}

/** buildRunRecord 的输入:全部取自**本次运行**(W1),不读组件闭包里可能已过期的 md / 设置。 */
export interface RunInput {
  /** 点击写入时刻的草稿(startImport 解析用的同一份)。 */
  md: string;
  /** startImport 解析用的同一份开关。 */
  parseOpts: RunParseOpts;
  /** 第三批 P11:与写入流程同一判定的移除项(h1Handle=remove 的标题、coverKeep=remove 的首图)。 */
  adjust: CapabilityAdjust;
  en: boolean;
  /** 引擎回传的实际写入块数。 */
  blockCount: number;
  /** 正文图片失败数(引擎回传)。 */
  imageFail: number;
  imageFailures?: ImageFailure[];
  id: string;
  now: Date;
}

/**
 * 导入收尾的纯计算(W1):历史条目 + 报告快照 + 是否异常。此前在 finishImport 里读组件闭包的
 * `opts.obsidianImg/wikilink/taskList`,而 useCallback 依赖漏了这三项——切开关后不改稿直接写入,
 * 报告与历史就记下旧开关。抽成纯函数、由 startImport 显式传入本次运行的数据,不再有依赖可漏。
 *
 * 口径(与此前 finishImport 一致):
 *  - ok = 实际写入块数 − 图片失败数(失败图已降级为文本块,不重复计)。**必须用引擎回传的 blockCount**:
 *    曾拿 capability 的格式计数凑数,纯文本段落任何类目都不计,「实际写入成功、报告 0 成功」(真机回归 T5);
 *  - deg = 能力面板 warn 项计数之和(格式降级「处」,与块数不同单位);
 *  - fail = 正文图失败数 + 封面失败条目(index<0 哨兵,content 在通道层补记;C26:此前只进明细不进 fail,
 *    报告「失败 0」却列出封面失败)。marker-residue 图已落地、只是占位残留,即便出现在封面哨兵上也不计;
 *  - hasAnomaly = 有降级 / 失败 / 任一失败明细(orphan-media / media-order-uncertain 不计数但需用户介入)。
 */
export function buildRunRecord(input: RunInput): { item: HistoryItem; snapshot: LastRunSnapshot; hasAnomaly: boolean } {
  const { md, parseOpts, adjust, en, blockCount, imageFail, imageFailures, id, now } = input;
  const cap = capability(md, en, parseOpts, adjust);
  const ok = Math.max(0, blockCount - imageFail);
  const deg = cap.filter((c) => c.badge === 'warn').reduce((a, c) => a + c.count, 0);
  const coverFail = (imageFailures ?? []).filter((f) => f.index < 0 && f.reason !== 'marker-residue').length;
  const fail = imageFail + coverFail;
  const pad = (n: number) => String(n).padStart(2, '0');
  const item: HistoryItem = {
    id,
    title: firstTitle(md, en, parseOpts),
    date: `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`,
    ok,
    deg,
    fail,
    md,
    imageFailures,
    parseOpts,
  };
  const hasAnomaly = deg > 0 || fail > 0 || (imageFailures?.length ?? 0) > 0;
  return { item, snapshot: { md, parseOpts, adjust, ok, deg, fail, imageFailures }, hasAnomaly };
}

/**
 * 报告卡标题栏的语气(第二批 W7):有失败 → 'fail';无失败但有降级或失败明细(orphan / 错位提示等不计数但
 * 需用户介入)→ 'warn';否则 'ok'。此前标题栏的绿色对勾写死,全部失败时也显示成功。底栏「查看报告」入口的
 * 异常色同用此函数(两处判定一致)。
 */
export function reportTone(snapshot: Pick<LastRunSnapshot, 'deg' | 'fail' | 'imageFailures'>): 'ok' | 'warn' | 'fail' {
  if (snapshot.fail > 0) return 'fail';
  if (snapshot.deg > 0 || (snapshot.imageFailures?.length ?? 0) > 0) return 'warn';
  return 'ok';
}

/**
 * 按「记录保留上限」裁剪历史(第二批 W8):保留列表头(最新)的 limit 条。未超限 / 不限时返回**同一引用**,
 * 调用方据此判断是否需要写回(不触发无谓的 storage 写入)。
 */
export function pruneHistory<T>(list: T[], histLimit: '50' | '200' | 'inf'): T[] {
  const limit = histLimit === 'inf' ? Infinity : Number(histLimit);
  return list.length > limit ? list.slice(0, limit) : list;
}
