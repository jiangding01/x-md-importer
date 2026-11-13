// 认图判定:X 偶发用旧快照整体覆盖正文后,按块 key / mediaId / 邻接 / 唯一未认领新图认回每张图。
import { describe, expect, it } from 'vitest';
import {
  claimedMediaKeys,
  findPlacedMedia,
  hasMarker,
  hasUnclaimedNewMedia,
  observeImage,
  unclaimedNewMedia,
  type SimpleBlock,
  type TrackIdentity,
} from './mediaIdentity';

const M0 = '__MARKFLOW_IMG_abc123_0__';
const M1 = '__MARKFLOW_IMG_abc123_1__';

const text = (key: string, t: string): SimpleBlock => ({ key, kind: 'text', mediaId: null, text: t });
const ready = (key: string, mediaId: string): SimpleBlock => ({ key, kind: 'media-ready', mediaId, text: '' });
const pending = (key: string): SimpleBlock => ({ key, kind: 'media-pending', mediaId: null, text: '' });

const track = (over: Partial<TrackIdentity> & { marker: string }): TrackIdentity => ({
  expected: 'placed',
  key: null,
  mediaId: null,
  ...over,
});

describe('claimedMediaKeys / unclaimedNewMedia / hasUnclaimedNewMedia', () => {
  it('已认领 = 其他账本 key + extra(不含自己、忽略 null)', () => {
    const a = track({ marker: M0, key: 'A' });
    const b = track({ marker: M1, key: 'B' });
    expect([...claimedMediaKeys([a, b], a, ['P', null])].sort()).toEqual(['B', 'P']);
  });

  it('未认领新 MEDIA 排除已认领与基线,文本 / 其他 atomic 不算', () => {
    const blocks = [ready('OLD', '1'), text('t', 'x'), ready('A', '2'), pending('N'), { key: 'd', kind: 'other' as const, mediaId: null, text: '' }];
    expect(unclaimedNewMedia(blocks, new Set(['A']), new Set(['OLD']))).toEqual(['N']);
    expect(hasUnclaimedNewMedia(blocks, new Set(['A']), new Set(['OLD']))).toBe(true);
    expect(hasUnclaimedNewMedia(blocks, new Set(['A', 'N']), new Set(['OLD']))).toBe(false);
  });

  it('无基线 → 按「有」处理(宁可不补传)', () => {
    expect(hasUnclaimedNewMedia([text('t', 'x')], new Set(), null)).toBe(true);
  });

  it('hasMarker 只在文本块里找', () => {
    expect(hasMarker([text('t', `前${M1}后`)], M1)).toBe(true);
    expect(hasMarker([text('t', M0)], M1)).toBe(false);
  });
});

describe('findPlacedMedia', () => {
  it('块 key 不变(回退到旧快照时 key 不变)→ 按 key 认', () => {
    const t = track({ marker: M1, key: 'B', mediaId: '2' });
    expect(findPlacedMedia([text('t', M1), ready('B', '2')], t, new Set(), new Set())).toEqual({ key: 'B', via: 'key' });
  });

  it('key 仍在但已不是 MEDIA 块 → 不按 key 认', () => {
    const t = track({ marker: M1, key: 'B' });
    expect(findPlacedMedia([text('B', 'x')], t, new Set(), new Set())).toBeNull();
  });

  it('换了 key 但带 mediaId → 按 mediaId 认回;已被其他图认领的不认', () => {
    const t = track({ marker: M1, key: 'B', mediaId: '2' });
    const blocks = [text('t', 'x'), ready('B2', '2')];
    expect(findPlacedMedia(blocks, t, new Set(), new Set())).toEqual({ key: 'B2', via: 'media-id' });
    expect(findPlacedMedia(blocks, t, new Set(['B2']), new Set())).toBeNull();
  });

  it('邻接认领:紧邻本图占位的未认领新 MEDIA(前后皆可)', () => {
    const t = track({ marker: M1 });
    expect(findPlacedMedia([text('p', M1), pending('N')], t, new Set(), new Set())).toEqual({ key: 'N', via: 'adjacent' });
    expect(findPlacedMedia([ready('N', '9'), text('p', M1)], t, new Set(), new Set())).toEqual({ key: 'N', via: 'adjacent' });
  });

  it('邻接认领排除基线内的旧图与已认领块', () => {
    const t = track({ marker: M1 });
    const blocks = [ready('A', '1'), text('p', M1), ready('OLD', '7')];
    expect(findPlacedMedia(blocks, t, new Set(['A']), new Set(['OLD']))).toBeNull();
  });

  it('无基线 → 不按邻接认领(分不清新旧)', () => {
    const t = track({ marker: M1 });
    expect(findPlacedMedia([text('p', M1), ready('N', '9')], t, new Set(), null)).toBeNull();
  });
});

describe('observeImage', () => {
  const baseline = new Set<string>();

  it('失败图不看 MEDIA,只报占位', () => {
    const t = track({ marker: M1, expected: 'failed', key: null });
    const s = observeImage([text('p', M1), ready('N', '9')], t, [t], [], baseline);
    expect(s).toMatchObject({ mediaKey: null, markerPresent: true, ambiguousCount: 0 });
  });

  it('块 key 不变 → 在;回带当前 mediaId 供补记', () => {
    const t = track({ marker: M1, key: 'B' });
    const s = observeImage([ready('B', '2')], t, [t], [], baseline);
    expect(s).toMatchObject({ mediaKey: 'B', via: 'key', mediaId: '2', pendingDespiteKnownId: false });
  });

  it('账本已知 mediaId、按 key 认到的块却仍是 pending → 标记诊断', () => {
    const t = track({ marker: M1, key: 'B', mediaId: '2' });
    expect(observeImage([pending('B')], t, [t], [], baseline).pendingDespiteKnownId).toBe(true);
  });

  it('风险 1:换 key 且无 mediaId、占位已删,正文恰 1 个未认领新图 → 认作本图,不报丢失', () => {
    const a = track({ marker: M0, key: 'A', mediaId: '1' });
    const b = track({ marker: M1, key: 'B' });
    const s = observeImage([ready('A', '1'), text('t', 'x'), ready('B2', '5')], b, [a, b], [], baseline);
    expect(s).toMatchObject({ mediaKey: 'B2', via: 'sole-unclaimed', mediaId: '5', ambiguousCount: 0 });
  });

  it('风险 1:同上但未认领新图不止 1 个 → 不认、不判丢失(ambiguousCount>0)', () => {
    const b = track({ marker: M1, key: 'B' });
    const s = observeImage([ready('X', '5'), pending('Y')], b, [b], [], baseline);
    expect(s).toMatchObject({ mediaKey: null, ambiguousCount: 2 });
  });

  it('风险 1:无基线时即使只有 1 个也不认(可能是导入前的旧图)', () => {
    const b = track({ marker: M1, key: 'B' });
    expect(observeImage([ready('X', '5')], b, [b], [], null)).toMatchObject({ mediaKey: null, ambiguousCount: 1 });
  });

  it('风险 1:无 mediaId、占位已删、无任何未认领新图 → 真丢失(ambiguousCount=0)', () => {
    const a = track({ marker: M0, key: 'A' });
    const b = track({ marker: M1, key: 'B' });
    expect(observeImage([ready('A', '1')], b, [a, b], [], baseline)).toMatchObject({ mediaKey: null, ambiguousCount: 0 });
  });

  it('有 mediaId 的图不走唯一认领门(有次身份却认不回 = 真不在)', () => {
    const b = track({ marker: M1, key: 'B', mediaId: '2' });
    expect(observeImage([ready('X', '5')], b, [b], [], baseline)).toMatchObject({ mediaKey: null, ambiguousCount: 0 });
  });

  it('占位还在时不走唯一认领门(交补传 / 写回原文)', () => {
    const b = track({ marker: M1, key: 'B' });
    const s = observeImage([text('p', M1), text('q', 'y'), ready('X', '5')], b, [b], [], baseline);
    expect(s).toMatchObject({ mediaKey: null, markerPresent: true, ambiguousCount: 0 });
  });

  it('extra 已认领(待追回 / 已追回图的块)不参与唯一认领与邻接认领', () => {
    const b = track({ marker: M1, key: 'B' });
    expect(observeImage([ready('L', '5')], b, [b], ['L'], baseline)).toMatchObject({ mediaKey: null, ambiguousCount: 0 });
    expect(observeImage([text('p', M1), ready('L', '5')], b, [b], ['L'], baseline).mediaKey).toBeNull();
  });

  it('补传失败后原图又回来(X 再次回退到较新快照):按原 key 认回', () => {
    const b = track({ marker: M1, key: 'B', mediaId: '2' });
    const s = observeImage([text('p', M1), ready('B', '2')], b, [b], [], baseline);
    expect(s).toMatchObject({ mediaKey: 'B', via: 'key', markerPresent: true });
  });
});
