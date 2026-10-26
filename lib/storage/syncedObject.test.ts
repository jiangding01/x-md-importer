// 第三批 C4(O4):Settings / Prefs 共用的同步判定(此前两个 Provider 各写一份,逐字相同)。
import { describe, expect, it } from 'vitest';
import { createEchoQueue } from './echoQueue';
import { decideSyncedChange, stableJson } from './syncedObject';

describe('stableJson', () => {
  it('与键序无关(chrome.storage 回读的键序未必与写入一致)', () => {
    expect(stableJson({ b: 1, a: 'x' })).toBe(stableJson({ a: 'x', b: 1 }));
    expect(stableJson({ a: 1 })).not.toBe(stableJson({ a: 2 }));
  });
});

describe('decideSyncedChange', () => {
  const S = (v: object) => stableJson(v);
  it('自己的回声(含快速连改时迟到的旧回声)→ echo,不回退', () => {
    const echoes = createEchoQueue<string>(20);
    echoes.push(S({ skin: 'a' }));
    echoes.push(S({ skin: 'b' }));
    expect(decideSyncedChange({ incoming: S({ skin: 'a' }), synced: S({ skin: 'b' }), echoes })).toBe('echo');
    expect(decideSyncedChange({ incoming: S({ skin: 'b' }), synced: S({ skin: 'b' }), echoes })).toBe('echo');
    expect(echoes.size).toBe(0);
  });
  it('另一窗口的改动 → adopt;与已同步值相同 → ignore', () => {
    const echoes = createEchoQueue<string>(20);
    expect(decideSyncedChange({ incoming: S({ skin: 'c' }), synced: S({ skin: 'a' }), echoes })).toBe('adopt');
    expect(decideSyncedChange({ incoming: S({ skin: 'a' }), synced: S({ skin: 'a' }), echoes })).toBe('ignore');
  });
});
