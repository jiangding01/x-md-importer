/**
 * 导入收尾「保存稳定窗」判定(纯函数,injector 只做 PerformanceObserver 接线与轮询)。
 *
 * 背景(真机取证 2026-11-13):X 偶发在导入收尾后 ≤1s(偶见 49s)把编辑器整体替换成更早的快照
 * (正文 + 撤销历史一起),触发者在 X 内部、未定(保存响应回写 或 上传管线陈旧闭包)。导入若在
 * 回退发生前就核对并返回,报告会把「之后被回退掉的图」报成成功。故收尾先等 X 的正文保存
 * (GraphQL `ArticleEntityUpdateContent`)在最后一次写入之后完成、且其后静默一段时间,再逐图核对。
 *
 * 时基:PerformanceResourceTiming 的 startTime / responseEnd 与 performance.now() 同一时基
 * (都相对 timeOrigin),调用方的 lastWriteAt 也必须用 performance.now() 记录。
 *
 * 已知局限:资源计时条目只在请求**完成**时产生,看不到在途的保存——静默期内新发起、尚未完成的
 * 保存不会阻止判稳。稳定窗只能压低「收尾后立刻被回退」的概率,不能保证;此后的回退由导入后守护兜底。
 */

/** 首次核对前的稳定窗上限:等不到条件也不再等,带着现状去核对(守护兜底此后的回退)。 */
export const QUIESCE_CAP_MS = 8000;
/** 补传之后再核对前的稳定窗上限(补传本身已耗时,复核窗收短)。 */
export const QUIESCE_RECHECK_CAP_MS = 4000;
/** 封面之后终核前的稳定窗上限:此前若无新写入,条件通常立即满足,不额外耗时。 */
export const QUIESCE_FINAL_CAP_MS = 1500;
/** 整个导入期间一条正文保存都没观察到(不支持 / 观察器失败 / X 改了接口名)时的退化条件。 */
export const QUIESCE_FALLBACK_MS = 3000;
/** 距最后一次写入至少这么久才可能判稳(回退实测在收尾后 ≤1s 内发生)。 */
export const MIN_SINCE_WRITE_MS = 1500;
/** 最后一次正文保存完成后需静默的时长。 */
export const QUIET_AFTER_SAVE_MS = 1000;
/** 轮询间隔。 */
export const QUIESCE_POLL_MS = 250;

/** X 正文保存的 GraphQL 操作名(URL 形如 /i/api/graphql/{queryId}/ArticleEntityUpdateContent)。 */
export const CONTENT_SAVE_OPERATION = 'ArticleEntityUpdateContent';

/** 资源条目 URL 是否为正文保存请求(用 includes 而非正则:queryId 会随 X 发版变)。 */
export function isContentSaveUrl(url: unknown): boolean {
  return typeof url === 'string' && url.includes(CONTENT_SAVE_OPERATION);
}

/** 一条已完成的正文保存请求的时间点(取自 PerformanceResourceTiming)。 */
export interface SaveTiming {
  startTime: number;
  responseEnd: number;
}

export interface SaveTracker {
  /** 记一条已完成的正文保存。非有限数的 startTime 丢弃;responseEnd 缺失 / 早于 startTime 时按 startTime 计。 */
  record(timing: SaveTiming): void;
  /** 已观察到的正文保存条数(本 tracker 生命周期内)。 */
  readonly observedCount: number;
  /** 最近一次保存完成时刻(各条 responseEnd 的最大值;无则 null)。 */
  readonly lastCompletionAt: number | null;
  /** 已完成保存中最晚的发起时刻(各条 startTime 的最大值;无则 null)。 */
  readonly lastStartAt: number | null;
  /**
   * 是否已稳定:距最后写入 ≥ MIN_SINCE_WRITE_MS,且
   * - 观察到过保存:有一条发起时刻晚于最后写入的保存已完成,且最近一次完成后静默 ≥ QUIET_AFTER_SAVE_MS;
   * - 一条都没观察到:退化为距最后写入 ≥ QUIESCE_FALLBACK_MS。
   */
  isQuiet(args: { lastWriteAt: number; now: number }): boolean;
  /** 距最近一次保存完成多少 ms(诊断用;无则 null)。 */
  msSinceLastSave(now: number): number | null;
}

export function createSaveTracker(): SaveTracker {
  let observedCount = 0;
  let lastCompletionAt: number | null = null;
  let lastStartAt: number | null = null;
  return {
    record({ startTime, responseEnd }) {
      if (typeof startTime !== 'number' || !Number.isFinite(startTime)) return;
      // 跨源受限时 responseEnd 可能为 0:退回 startTime,至少保住「何时发起」这条信息。
      const end =
        typeof responseEnd === 'number' && Number.isFinite(responseEnd) && responseEnd >= startTime
          ? responseEnd
          : startTime;
      observedCount += 1;
      // 条目完成顺序可能与发起顺序不同,一律取最大值。
      lastStartAt = lastStartAt === null ? startTime : Math.max(lastStartAt, startTime);
      lastCompletionAt = lastCompletionAt === null ? end : Math.max(lastCompletionAt, end);
    },
    get observedCount() {
      return observedCount;
    },
    get lastCompletionAt() {
      return lastCompletionAt;
    },
    get lastStartAt() {
      return lastStartAt;
    },
    isQuiet({ lastWriteAt, now }) {
      const sinceWrite = now - lastWriteAt;
      if (sinceWrite < MIN_SINCE_WRITE_MS) return false;
      if (observedCount === 0) return sinceWrite >= QUIESCE_FALLBACK_MS;
      // 只认最后一次写入之后发起的保存:更早发起的保存带的是写入前的内容,其响应回写正是嫌疑之一。
      if (lastStartAt === null || lastStartAt <= lastWriteAt) return false;
      return lastCompletionAt !== null && now - lastCompletionAt >= QUIET_AFTER_SAVE_MS;
    },
    msSinceLastSave(now) {
      return lastCompletionAt === null ? null : Math.max(0, Math.round(now - lastCompletionAt));
    },
  };
}
