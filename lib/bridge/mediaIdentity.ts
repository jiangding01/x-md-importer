/**
 * 收尾核对 / 导入后守护的「认图」判定(纯函数)。injector 只负责把 Draft state 转成简化块列表
 * (SimpleBlock[]),判定「这张图在不在、占位在不在、正文里有没有来历不明的新图」都在这里,便于单测
 * 钉住各种回退形态(X 偶发用旧快照整体覆盖正文,见 imageReconcile.ts 顶部背景)。
 */
import type { ImageExpectation } from './imageReconcile';

/**
 * 正文块的简化形态(按 blockMap 顺序):
 * - text:非 atomic 块,text 为其文本(占位就在这里找);
 * - media-ready / media-pending:MEDIA atomic 块,前者 entity data 里已有 mediaId;
 * - other:其他 atomic 块(分割线 / 代码块 / 推文 / 公式),text 不参与匹配。
 */
export interface SimpleBlock {
  key: string;
  kind: 'text' | 'media-ready' | 'media-pending' | 'other';
  mediaId: string | null;
  text: string;
}

/** 一张图的身份账本(injector 的 ImageTrack 结构上满足它)。 */
export interface TrackIdentity {
  marker: string;
  expected: ImageExpectation;
  /** 归位时的 MEDIA 块 key——主身份:回退到旧快照时块 key 不变。 */
  key: string | null;
  /** 该 MEDIA 的 mediaId——key 不在时的次身份;放行时尚无则 null。 */
  mediaId: string | null;
}

/**
 * 认图方式:key=块 key 仍在;media-id=按 mediaId 认回(X 换了块 key);adjacent=紧邻本图占位的
 * 未认领新 MEDIA(快照停在「已插入、未归位」);sole-unclaimed=本图无 mediaId、占位已不在,正文
 * 恰有 1 个未认领新 MEDIA(X 换了块 key 而放行时没拿到 mediaId,只能按「唯一来历不明的新图」认回)。
 */
export type MatchVia = 'key' | 'media-id' | 'adjacent' | 'sole-unclaimed';

const isMedia = (b: SimpleBlock): boolean => b.kind === 'media-ready' || b.kind === 'media-pending';

/** 已被认领的 MEDIA 块 key:除 self 外各账本的 key + extra(待追回超时图的 pendingKey、已追回图的 mediaKey)。 */
export function claimedMediaKeys(
  tracks: readonly TrackIdentity[],
  self: TrackIdentity | null,
  extra: Iterable<string | null> = [],
): Set<string> {
  const set = new Set<string>();
  for (const t of tracks) if (t !== self && t.key) set.add(t.key);
  for (const k of extra) if (k) set.add(k);
  return set;
}

/** 未被认领、且不在导入前 MEDIA 基线里的 MEDIA 块 key(按正文顺序);无基线时返回全部未认领 MEDIA。 */
export function unclaimedNewMedia(
  blocks: readonly SimpleBlock[],
  claimed: ReadonlySet<string>,
  baseline: ReadonlySet<string> | null,
): string[] {
  return blocks.filter((b) => isMedia(b) && !claimed.has(b.key) && !baseline?.has(b.key)).map((b) => b.key);
}

/**
 * 正文是否有「未被认领的新 MEDIA」(补传前的拦截条件:它可能就是丢失的那张,补传会出重复图)。
 * 无基线时分不清新旧,按「有」处理(宁可不补传、如实上报)。
 */
export function hasUnclaimedNewMedia(
  blocks: readonly SimpleBlock[],
  claimed: ReadonlySet<string>,
  baseline: ReadonlySet<string> | null,
): boolean {
  return baseline === null || unclaimedNewMedia(blocks, claimed, baseline).length > 0;
}

/** 占位是否在正文(只在非 atomic 块里找)。 */
export function hasMarker(blocks: readonly SimpleBlock[], marker: string): boolean {
  return blocks.some((b) => b.kind === 'text' && b.text.includes(marker));
}

/**
 * 「这张图在不在」:主身份 = 块 key 且该块仍是 MEDIA;key 不在时按 mediaId 相等认领(排除已被其他图
 * 认领的块);再不行认领「紧邻本图占位块的未认领新 MEDIA」(排除导入前就有的;无基线时不按邻接认领)。
 */
export function findPlacedMedia(
  blocks: readonly SimpleBlock[],
  t: TrackIdentity,
  claimed: ReadonlySet<string>,
  baseline: ReadonlySet<string> | null,
): { key: string; via: Exclude<MatchVia, 'sole-unclaimed'> } | null {
  if (t.key) {
    const own = blocks.find((b) => b.key === t.key);
    if (own && isMedia(own)) return { key: own.key, via: 'key' };
  }
  if (t.mediaId) {
    const byId = blocks.find((b) => isMedia(b) && !claimed.has(b.key) && b.mediaId === t.mediaId);
    if (byId) return { key: byId.key, via: 'media-id' };
  }
  if (!baseline) return null;
  const at = blocks.findIndex((b) => b.kind === 'text' && b.text.includes(t.marker));
  if (at < 0) return null;
  for (const b of [blocks[at - 1], blocks[at + 1]]) {
    if (b && isMedia(b) && !claimed.has(b.key) && !baseline.has(b.key)) return { key: b.key, via: 'adjacent' };
  }
  return null;
}

/** 一张图在当前正文中的状况(observeImage 的产出)。 */
export interface ImageSighting {
  /** 认到的 MEDIA 块 key(不在为 null)。 */
  mediaKey: string | null;
  via: MatchVia | null;
  /** 认到的块当前的 mediaId(无则 null),供调用方补记身份。 */
  mediaId: string | null;
  markerPresent: boolean;
  /** 账本已知 mediaId,但按 key 认到的块仍是 pending 实体(读不到 mediaId)——诊断告警用。 */
  pendingDespiteKnownId: boolean;
  /**
   * 「图与占位都不在」且本图无 mediaId 时,正文里未认领新 MEDIA 的个数(>0 即无法确认丢失:其中之一
   * 可能就是本图换了 key);恰 1 个且有基线时已直接认作本图(via=sole-unclaimed),此处为 0。
   */
  ambiguousCount: number;
}

/**
 * 读一张图的状况。失败图(expected=failed)不看 MEDIA,只报占位在不在。
 * 防误报门(风险 1):已归位的图「图与占位都不在」、且它放行时没拿到 mediaId(无次身份可比对)时,
 * X 若把它的块换了 key,按身份规则会被误判丢失,进而让孤儿审计把它当「多出来的图」诱导用户删除。
 * 故此时看正文里的未认领新 MEDIA:恰好 1 个且有基线 → 认作本图;有但不唯一(或无基线分不清新旧)
 * → 只报 ambiguousCount,不判丢失(交孤儿审计如实上报);一个都没有 → 才是真丢失。
 */
export function observeImage(
  blocks: readonly SimpleBlock[],
  t: TrackIdentity,
  tracks: readonly TrackIdentity[],
  extraClaimed: Iterable<string | null>,
  baseline: ReadonlySet<string> | null,
): ImageSighting {
  const markerPresent = hasMarker(blocks, t.marker);
  const none: ImageSighting = {
    mediaKey: null,
    via: null,
    mediaId: null,
    markerPresent,
    pendingDespiteKnownId: false,
    ambiguousCount: 0,
  };
  if (t.expected !== 'placed') return none;
  const claimed = claimedMediaKeys(tracks, t, extraClaimed);
  const hit = findPlacedMedia(blocks, t, claimed, baseline);
  if (hit) {
    const block = blocks.find((b) => b.key === hit.key);
    return {
      ...none,
      mediaKey: hit.key,
      via: hit.via,
      mediaId: block?.mediaId ?? null,
      pendingDespiteKnownId: hit.via === 'key' && t.mediaId !== null && block?.kind === 'media-pending',
    };
  }
  if (markerPresent || t.mediaId !== null) return none;
  const candidates = unclaimedNewMedia(blocks, claimed, baseline);
  if (baseline && candidates.length === 1) {
    const block = blocks.find((b) => b.key === candidates[0]);
    return { ...none, mediaKey: candidates[0]!, via: 'sole-unclaimed', mediaId: block?.mediaId ?? null };
  }
  return { ...none, ambiguousCount: candidates.length };
}
