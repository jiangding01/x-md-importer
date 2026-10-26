// 第二批 W4:只有拖入文件才拦截默认行为;拖文字交给 textarea 原生处理。
import { describe, expect, it } from 'vitest';
import { isFileDrag } from './drag';

describe('isFileDrag', () => {
  it('types 含 Files → true', () => {
    expect(isFileDrag(['Files'])).toBe(true);
    expect(isFileDrag(['text/plain', 'Files'])).toBe(true);
  });
  it('纯文字 / 空 / 缺失 → false', () => {
    expect(isFileDrag(['text/plain', 'text/html'])).toBe(false);
    expect(isFileDrag([])).toBe(false);
    expect(isFileDrag(undefined)).toBe(false);
  });
});
