import type { ImageFailure } from '@/lib/bridge/protocol';
import { capability, firstTitle } from '@/lib/markdown/capability';
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
  const { md, parseOpts, en, blockCount, imageFail, imageFailures, id, now } = input;
  const cap = capability(md, en, parseOpts);
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
  return { item, snapshot: { md, parseOpts, ok, deg, fail, imageFailures }, hasAnomaly };
}
