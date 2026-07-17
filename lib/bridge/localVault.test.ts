// splitLocalPath —— 本地图片路径安全器单测。
// 只测该模块导出的纯函数;模块内其余函数(saveVaultHandle/getVaultHandle/...)在函数体内
// 触达 indexedDB,不在本文件测试范围(见 lib/bridge/localVault.ts 顶部注释 + vitest.config.ts)。
import { describe, expect, it } from 'vitest';
import { splitLocalPath } from './localVault';

describe('splitLocalPath', () => {
  describe('正常路径', () => {
    it('多级相对路径拆成各段', () => {
      expect(splitLocalPath('assets/x.png')).toEqual(['assets', 'x.png']);
    });

    it('单文件名(无目录)', () => {
      expect(splitLocalPath('x.png')).toEqual(['x.png']);
    });

    it('多级子目录', () => {
      expect(splitLocalPath('a/b/c/d.png')).toEqual(['a', 'b', 'c', 'd.png']);
    });
  });

  describe('归一化', () => {
    it('反斜杠归一为正斜杠', () => {
      expect(splitLocalPath('a\\b\\c.png')).toEqual(['a', 'b', 'c.png']);
    });

    it('%20 解码为空格', () => {
      expect(splitLocalPath('a%20b/c%20d.png')).toEqual(['a b', 'c d.png']);
    });

    it('URL 编码的中文文件名解码', () => {
      // encodeURIComponent('资产 图片.png') === '%E8%B5%84%E4%BA%A7%20%E5%9B%BE%E7%89%87.png'
      expect(splitLocalPath('assets/%E8%B5%84%E4%BA%A7%20%E5%9B%BE%E7%89%87.png')).toEqual([
        'assets',
        '资产 图片.png',
      ]);
    });

    it('`.` 段被忽略', () => {
      expect(splitLocalPath('./a/./b.png')).toEqual(['a', 'b.png']);
    });

    it('空段(连续斜杠)被忽略', () => {
      expect(splitLocalPath('a//b.png')).toEqual(['a', 'b.png']);
    });

    it('首尾空白被 trim', () => {
      expect(splitLocalPath('  a/b.png  ')).toEqual(['a', 'b.png']);
    });
  });

  describe('安全拒绝(路径逃逸闸)', () => {
    it('`../x` 相对上跳被拒', () => {
      expect(splitLocalPath('../x')).toBeNull();
    });

    it('`a/../../b` 中途 `..` 被拒', () => {
      expect(splitLocalPath('a/../../b')).toBeNull();
    });

    it('绝对路径 `/etc/passwd` 被拒', () => {
      expect(splitLocalPath('/etc/passwd')).toBeNull();
    });

    it('Windows 盘符 `C:\\x` 被拒', () => {
      expect(splitLocalPath('C:\\x')).toBeNull();
    });

    it('`%2e%2e` 编码绕过被拒(先 decode 再判 `..`)', () => {
      expect(splitLocalPath('%2e%2e/x')).toBeNull();
      expect(splitLocalPath('a/%2e%2e/b')).toBeNull();
    });

    it('编码后的绝对路径 `%2Fetc%2Fpasswd` 被拒(先 decode 再判绝对路径)', () => {
      expect(splitLocalPath('%2Fetc%2Fpasswd')).toBeNull();
    });

    it('纯 `..` 被拒', () => {
      expect(splitLocalPath('..')).toBeNull();
    });

    it('空串返回 null', () => {
      expect(splitLocalPath('')).toBeNull();
    });

    it('仅空白的字符串返回 null(trim 后为空)', () => {
      expect(splitLocalPath('   ')).toBeNull();
    });
  });

  describe('非法 URI 编码', () => {
    it('`%zz` 非法编码不抛异常,用原串继续处理', () => {
      expect(() => splitLocalPath('%zz/foo.png')).not.toThrow();
      expect(splitLocalPath('%zz/foo.png')).toEqual(['%zz', 'foo.png']);
    });
  });
});
