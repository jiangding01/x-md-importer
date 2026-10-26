// W2(2026-10-26):自写回声队列。
import { describe, expect, it } from 'vitest';
import { createEchoQueue } from './echoQueue';

describe('createEchoQueue', () => {
  it('consume 命中第 k 项:连同其前各项一并出队,返回 true', () => {
    const q = createEchoQueue<string>(8);
    q.push('A');
    q.push('AB');
    q.push('ABC');
    expect(q.consume('AB')).toBe(true);
    expect(q.size).toBe(1);
    expect(q.consume('A')).toBe(false); // 已随 AB 出队
    expect(q.consume('ABC')).toBe(true);
    expect(q.size).toBe(0);
  });

  it('未命中返回 false,不改队列', () => {
    const q = createEchoQueue<string>(8);
    q.push('A');
    expect(q.consume('X')).toBe(false);
    expect(q.size).toBe(1);
  });

  it('drop 移除写入失败的值(不会有回声)', () => {
    const q = createEchoQueue<string>(8);
    q.push('A');
    q.push('B');
    q.drop('A');
    expect(q.consume('A')).toBe(false);
    expect(q.consume('B')).toBe(true);
  });

  it('超出容量丢最旧', () => {
    const q = createEchoQueue<number>(2);
    q.push(1);
    q.push(2);
    q.push(3);
    expect(q.size).toBe(2);
    expect(q.consume(1)).toBe(false);
    expect(q.consume(3)).toBe(true);
  });
});
