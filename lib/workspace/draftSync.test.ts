// W2(2026-10-26):草稿 onChanged 采纳判定。审查复现:前一次较慢写入的回声晚于下一次 flush 才到,
// 旧判定(incoming !== 当前 && 无 pending && 未在导入)把它当成另一窗口的编辑采纳 → 编辑框回退、丢字。
import { describe, expect, it } from 'vitest';
import { createEchoQueue } from '../storage/echoQueue';
import { decideDraftChange } from './draftSync';

describe('decideDraftChange', () => {
  it('审查复现:写 A → 键入 B → flush AB → A 的迟到回声判 echo(不回退),AB 的回声同样判 echo', () => {
    const echoes = createEchoQueue<string>(8);
    echoes.push('A'); // flush A(写入慢)
    echoes.push('AB'); // 键入 B 后 flush AB,pending 已清空
    expect(decideDraftChange({ incoming: 'A', current: 'AB', hasPending: false, importing: false, echoes })).toBe('echo');
    expect(decideDraftChange({ incoming: 'AB', current: 'AB', hasPending: false, importing: false, echoes })).toBe('echo');
  });

  it('另一窗口写入新值、本地无 pending → adopt', () => {
    const echoes = createEchoQueue<string>(8);
    expect(decideDraftChange({ incoming: 'X', current: 'AB', hasPending: false, importing: false, echoes })).toBe('adopt');
  });

  it('本地有未落盘编辑 / 导入中 / 值与当前相同 → ignore(既有闸门不变)', () => {
    const echoes = createEchoQueue<string>(8);
    expect(decideDraftChange({ incoming: 'X', current: 'AB', hasPending: true, importing: false, echoes })).toBe('ignore');
    expect(decideDraftChange({ incoming: 'X', current: 'AB', hasPending: false, importing: true, echoes })).toBe('ignore');
    expect(decideDraftChange({ incoming: 'AB', current: 'AB', hasPending: false, importing: false, echoes })).toBe('ignore');
  });

  it('回声在导入中 / 有 pending 时到达也照样出队(不滞留,避免日后误吞同值外部写入)', () => {
    const echoes = createEchoQueue<string>(8);
    echoes.push('A');
    expect(decideDraftChange({ incoming: 'A', current: 'AB', hasPending: true, importing: true, echoes })).toBe('echo');
    expect(echoes.size).toBe(0);
  });
});
