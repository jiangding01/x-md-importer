// 逐图核对决策:把核对表每一格钉住(X 偶发用旧快照覆盖正文,清扫 / 守护不再盲删占位)。
import { describe, expect, it } from 'vitest';
import {
  decideImageAction,
  decideRevival,
  isOriginalImageReturn,
  MAX_REUPLOADS_PER_IMPORT,
  reuploadBlockReason,
  type ImageObservation,
} from './imageReconcile';

const base: ImageObservation = {
  expected: 'placed',
  mediaPresent: true,
  markerPresent: false,
  allowReupload: true,
  reuploadBlocked: false,
};

describe('decideImageAction:预期已归位', () => {
  it('图在、占位不在 → 无动作', () => {
    expect(decideImageAction({ ...base, mediaPresent: true, markerPresent: false })).toBe('none');
  });

  it('图在、占位在 → 重新归位到占位处(无论是否允许补传)', () => {
    expect(decideImageAction({ ...base, mediaPresent: true, markerPresent: true })).toBe('relocate');
    expect(decideImageAction({ ...base, mediaPresent: true, markerPresent: true, allowReupload: false })).toBe(
      'relocate',
    );
  });

  it('图不在、占位在、允许且未受限 → 补传', () => {
    expect(decideImageAction({ ...base, mediaPresent: false, markerPresent: true })).toBe('reupload');
  });

  it('图不在、占位在、补传受限(已补过 / 名额用尽 / 有未认领 MEDIA)→ 写回原文并计丢失', () => {
    expect(
      decideImageAction({ ...base, mediaPresent: false, markerPresent: true, reuploadBlocked: true }),
    ).toBe('write-fallback');
  });

  it('图不在、占位在、不允许补传(补传后复核 / 封面后终核 / 守护)→ 写回原文', () => {
    expect(
      decideImageAction({ ...base, mediaPresent: false, markerPresent: true, allowReupload: false }),
    ).toBe('write-fallback');
  });

  it('图与占位都不在、但有不唯一的未认领新 MEDIA → 不判丢失,只告警', () => {
    expect(
      decideImageAction({ ...base, mediaPresent: false, markerPresent: false, mediaAmbiguous: true }),
    ).toBe('report-ambiguous');
    // 占位在时不受影响(仍按补传 / 写回原文处理)
    expect(
      decideImageAction({ ...base, mediaPresent: false, markerPresent: true, mediaAmbiguous: true }),
    ).toBe('reupload');
  });

  it('图不在、占位不在 → 计丢失(无处写回)', () => {
    expect(decideImageAction({ ...base, mediaPresent: false, markerPresent: false })).toBe('report-lost');
    expect(
      decideImageAction({ ...base, mediaPresent: false, markerPresent: false, allowReupload: false }),
    ).toBe('report-lost');
  });
});

describe('decideImageAction:预期已失败(写过原文)', () => {
  it('占位在 → 重新写回原文(不看 MEDIA、不补传)', () => {
    for (const mediaPresent of [true, false]) {
      for (const allowReupload of [true, false]) {
        expect(
          decideImageAction({ expected: 'failed', mediaPresent, markerPresent: true, allowReupload, reuploadBlocked: false }),
        ).toBe('rewrite-fallback');
      }
    }
  });

  it('占位不在 → 无动作', () => {
    for (const mediaPresent of [true, false]) {
      expect(
        decideImageAction({ expected: 'failed', mediaPresent, markerPresent: false, allowReupload: true, reuploadBlocked: false }),
      ).toBe('none');
    }
  });
});

describe('reuploadBlockReason', () => {
  it('未补过、名额未满、无未认领 MEDIA → 可补传', () => {
    expect(reuploadBlockReason({ alreadyReuploaded: false, reuploadsUsed: 0, hasUnclaimedMedia: false })).toBeNull();
    expect(
      reuploadBlockReason({ alreadyReuploaded: false, reuploadsUsed: MAX_REUPLOADS_PER_IMPORT - 1, hasUnclaimedMedia: false }),
    ).toBeNull();
  });

  it('同一张已补过一次 → 不再补', () => {
    expect(reuploadBlockReason({ alreadyReuploaded: true, reuploadsUsed: 0, hasUnclaimedMedia: false })).toBe(
      'already-reuploaded',
    );
  });

  it('单次导入最多补传 2 张', () => {
    expect(MAX_REUPLOADS_PER_IMPORT).toBe(2);
    expect(
      reuploadBlockReason({ alreadyReuploaded: false, reuploadsUsed: MAX_REUPLOADS_PER_IMPORT, hasUnclaimedMedia: false }),
    ).toBe('limit-reached');
  });

  it('正文有未认领的新 MEDIA → 不补传(防重复图)', () => {
    expect(reuploadBlockReason({ alreadyReuploaded: false, reuploadsUsed: 0, hasUnclaimedMedia: true })).toBe(
      'unclaimed-media',
    );
  });

  it('与决策组合:受限即写回原文', () => {
    const reason = reuploadBlockReason({ alreadyReuploaded: false, reuploadsUsed: 0, hasUnclaimedMedia: true });
    expect(
      decideImageAction({ ...base, mediaPresent: false, markerPresent: true, reuploadBlocked: reason !== null }),
    ).toBe('write-fallback');
  });
});

describe('decideRevival(被计丢失的图又回来了)', () => {
  const base = { lostCounted: true, matchedByIdentity: true, markerPresent: false, fallbackPresent: false };

  it('未计过丢失 / 未按原身份认回 → 不动', () => {
    expect(decideRevival({ ...base, lostCounted: false })).toBe('none');
    expect(decideRevival({ ...base, matchedByIdentity: false, markerPresent: true, fallbackPresent: true })).toBe('none');
  });

  it('占位又在 → 撤销记账并挪回占位处(优先于原文行)', () => {
    expect(decideRevival({ ...base, markerPresent: true, fallbackPresent: true })).toBe('relocate-to-marker');
  });

  it('已写回的原文行还在 → 撤销记账并用图顶替原文行', () => {
    expect(decideRevival({ ...base, fallbackPresent: true })).toBe('replace-fallback');
  });

  it('占位与原文都不在 → 只撤销记账', () => {
    expect(decideRevival(base)).toBe('revive-only');
  });
});

describe('isOriginalImageReturn(补传期间原图回来)', () => {
  it('补传认到的块 key 等于原 key → 原图', () => {
    expect(isOriginalImageReturn({ origKey: 'B', origMediaId: null, gotKey: 'B', gotMediaId: null })).toBe(true);
  });

  it('mediaId 等于原 mediaId → 原图', () => {
    expect(isOriginalImageReturn({ origKey: 'B', origMediaId: '2', gotKey: 'N', gotMediaId: '2' })).toBe(true);
  });

  it('key 与 mediaId 都不同 / 原 mediaId 未知 → 真补传', () => {
    expect(isOriginalImageReturn({ origKey: 'B', origMediaId: '2', gotKey: 'N', gotMediaId: '9' })).toBe(false);
    expect(isOriginalImageReturn({ origKey: null, origMediaId: null, gotKey: 'N', gotMediaId: '9' })).toBe(false);
    expect(isOriginalImageReturn({ origKey: 'B', origMediaId: null, gotKey: 'N', gotMediaId: null })).toBe(false);
  });
});
