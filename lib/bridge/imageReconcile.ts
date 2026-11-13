/**
 * 导入收尾 / 导入后守护的「逐图核对」决策(纯函数;injector 只负责读编辑器状态与执行动作)。
 *
 * 背景(真机取证 2026-11-13):X 偶发把编辑器整体替换成更早的快照。快照若是「某图已插入、尚未归位」,
 * 图上方残留占位;若是「某图插入之前」,图丢失、占位重现。此前清扫 / 守护见到占位就删,丢图时连位置
 * 锚点都没了(静默丢图)。现在先判断「这张图该是什么样」与「图在不在、占位在不在」,再决定动作。
 */

/** 这张图在导入流程里的预期终态:placed = 已归位成图;failed = 已写回原文(失败图)。 */
export type ImageExpectation = 'placed' | 'failed';

/**
 * 核对动作:
 * - none:无需处理;
 * - relocate:图在、占位也在 → 把图挪回占位处并删占位(X 常把图先插在文末再由插件挪到占位处,
 *   回退到「插入后、归位前」的快照时图回到了文末;占位行里有用户文字等无法挪时由调用方退回只剥占位);
 * - reupload:图不在、占位在 → 在占位处补传(仅导入内、未受限时);
 * - write-fallback:图不在、占位在,但不允许 / 不能补传 → 写回原文,计「图片被回退丢失」;
 * - report-lost:图与占位都不在 → 计「图片被回退丢失」(没有位置可写回原文);
 * - rewrite-fallback:失败图的原文被回退成占位 → 重新写回原文(该图早已计过失败,不再重复计);
 * - report-ambiguous:图与占位都不在,但正文有不止一个来历不明的新图(其一可能就是本图换了 key)→
 *   不判丢失、只告警,交孤儿审计如实上报(防误报后诱导用户删掉正常的图)。
 */
export type ImageAction =
  | 'none'
  | 'relocate'
  | 'reupload'
  | 'write-fallback'
  | 'report-lost'
  | 'rewrite-fallback'
  | 'report-ambiguous';

export interface ImageObservation {
  expected: ImageExpectation;
  /** 该图的 MEDIA 块是否仍在正文(按块 key / mediaId / 紧邻占位的未认领新 MEDIA 认定)。 */
  mediaPresent: boolean;
  /** 该图的完整占位是否在正文。 */
  markerPresent: boolean;
  /** 本轮是否允许补传(导入内首轮核对 true;补传后复核、封面后终核、守护均为 false)。 */
  allowReupload: boolean;
  /** 补传是否受限(已补过 / 本次导入补传名额用尽 / 正文有未认领的新 MEDIA,见 reuploadBlockReason)。 */
  reuploadBlocked: boolean;
  /** 图与占位都不在时,能否确认丢失:true = 正文有不唯一的未认领新 MEDIA,无法确认(见 mediaIdentity.observeImage)。 */
  mediaAmbiguous?: boolean;
}

export function decideImageAction(o: ImageObservation): ImageAction {
  if (o.expected === 'failed') {
    // 失败图不看 MEDIA:它从未归位成图,正文里与它相关的只有原文 / 占位。
    return o.markerPresent ? 'rewrite-fallback' : 'none';
  }
  if (o.mediaPresent) return o.markerPresent ? 'relocate' : 'none';
  if (!o.markerPresent) return o.mediaAmbiguous ? 'report-ambiguous' : 'report-lost';
  return o.allowReupload && !o.reuploadBlocked ? 'reupload' : 'write-fallback';
}

/** 单次导入最多补传几张(补传每张最长 40s,通道超时按 min(n, 2) 张预留)。 */
export const MAX_REUPLOADS_PER_IMPORT = 2;

export type ReuploadBlockReason = 'already-reuploaded' | 'limit-reached' | 'unclaimed-media';

/**
 * 补传是否受限及原因(null = 可补传):
 * - already-reuploaded:这张已补传过一次,不再补(防 X 持续回退时无限重传);
 * - limit-reached:本次导入的补传名额已用尽;
 * - unclaimed-media:正文里有不属于任何已登记图片的新 MEDIA——它可能就是这张图(换了 key、又无
 *   mediaId 可比对),此时补传可能造成重复图;宁可写回原文如实上报,由孤儿审计提示多出的那张。
 */
export function reuploadBlockReason(args: {
  alreadyReuploaded: boolean;
  reuploadsUsed: number;
  hasUnclaimedMedia: boolean;
}): ReuploadBlockReason | null {
  if (args.alreadyReuploaded) return 'already-reuploaded';
  if (args.reuploadsUsed >= MAX_REUPLOADS_PER_IMPORT) return 'limit-reached';
  if (args.hasUnclaimedMedia) return 'unclaimed-media';
  return null;
}

/**
 * 「此前判定丢失、后来又回来了」的复查动作(封面后终核之后、残留审计之前跑一次):X 的回退可能是瞬时的,
 * 随后又恢复了较新状态,原图回到正文——此时丢失记账必须撤销,否则报告把在场的图报成丢失。
 * - none:不是被计过丢失的图,或没按原身份(块 key / mediaId)认回——邻接 / 唯一未认领认到的块可能是
 *   补传自己插的未确认块,不能据此撤销;
 * - relocate-to-marker:占位又在 → 撤销记账,并把图挪回占位处;
 * - replace-fallback:已写回的原文行还在 → 撤销记账,并用图顶替该原文行(否则原文与图重复出现);
 * - revive-only:占位与原文都不在 → 只撤销记账。
 */
export type RevivalAction = 'none' | 'relocate-to-marker' | 'replace-fallback' | 'revive-only';

export function decideRevival(o: {
  lostCounted: boolean;
  matchedByIdentity: boolean;
  markerPresent: boolean;
  fallbackPresent: boolean;
}): RevivalAction {
  if (!o.lostCounted || !o.matchedByIdentity) return 'none';
  if (o.markerPresent) return 'relocate-to-marker';
  if (o.fallbackPresent) return 'replace-fallback';
  return 'revive-only';
}

/**
 * 补传「成功」认到的块其实是原图(补传期间 X 恢复了较新状态、原图回来了):原图 key 不在补传前的
 * 快照里,会被等新图的轮询当成补传结果。按原 key 或原 mediaId 相等判定,此时按原图归位处理、不记补传。
 */
export function isOriginalImageReturn(o: {
  origKey: string | null;
  origMediaId: string | null;
  gotKey: string;
  gotMediaId: string | null;
}): boolean {
  if (o.origKey !== null && o.gotKey === o.origKey) return true;
  return o.origMediaId !== null && o.gotMediaId !== null && o.gotMediaId === o.origMediaId;
}
