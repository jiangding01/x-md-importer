// 基建 smoke:验证 vitest 的 @ alias 解析、node 环境下 backup 导入链(chrome 守卫)可加载。
// 各域详细用例见同目录 / 对应模块的 *.test.ts。
import { describe, expect, it } from 'vitest';
import { validatePrefs } from './backup';

describe('基建 smoke', () => {
  it('backup 导入链在 node 下可加载,validatePrefs 对空输入回落默认', () => {
    const prefs = validatePrefs(undefined);
    expect(typeof prefs.skin).toBe('string');
  });
});
