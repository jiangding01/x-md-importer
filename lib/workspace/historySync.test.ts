// 第三批 H1:历史列表的保存回声(同第一批 W2 的草稿回声)。
import { describe, expect, it } from 'vitest';
import { createEchoQueue } from '../storage/echoQueue';
import { decideHistoryChange, historySignature } from './historySync';

const L = (...ids: string[]) => ids.map((id) => ({ id }));

describe('decideHistoryChange', () => {
  it('连续两次写入,前一次迟到的回声判 echo(不回退),后一次同样 echo', () => {
    const echoes = createEchoQueue<string>(8);
    echoes.push(historySignature(L('a')));
    echoes.push(historySignature(L('b', 'a')));
    expect(decideHistoryChange({ incoming: L('a'), current: L('b', 'a'), echoes })).toBe('echo');
    expect(decideHistoryChange({ incoming: L('b', 'a'), current: L('b', 'a'), echoes })).toBe('echo');
  });
  it('另一窗口的变更 → adopt;与当前相同 → ignore', () => {
    const echoes = createEchoQueue<string>(8);
    expect(decideHistoryChange({ incoming: L('c', 'a'), current: L('a'), echoes })).toBe('adopt');
    expect(decideHistoryChange({ incoming: L('a'), current: L('a'), echoes })).toBe('ignore');
  });
  it('签名区分顺序与内容', () => {
    expect(historySignature(L('a', 'b'))).not.toBe(historySignature(L('b', 'a')));
    expect(historySignature([])).toBe('');
  });
});
