// protocol.ts 纯函数 + 运行时守卫单测。
import { describe, expect, it } from 'vitest';
import {
  classifyImageSource,
  IMAGE_FAIL_REASONS,
  isImportRequest,
  isProbeRequest,
  isSetTitleRequest,
  IMPORT_REQUEST_TYPE,
  messageScope,
  PROBE_REQUEST_TYPE,
  SET_TITLE_REQUEST_TYPE,
  truncateForReport,
} from './protocol';

describe('classifyImageSource', () => {
  it('http URL → remote', () => {
    expect(classifyImageSource('http://example.com/a.png')).toBe('remote');
  });

  it('https URL → remote', () => {
    expect(classifyImageSource('https://example.com/a.png')).toBe('remote');
  });

  it('协议相对 URL(`//host/a.png`)→ remote', () => {
    expect(classifyImageSource('//example.com/a.png')).toBe('remote');
  });

  it('data URI → data', () => {
    expect(classifyImageSource('data:image/png;base64,AAAA')).toBe('data');
  });

  it('相对路径 → local', () => {
    expect(classifyImageSource('assets/x.png')).toBe('local');
  });

  it('Obsidian 风格的裸文件名 → local', () => {
    expect(classifyImageSource('图片.png')).toBe('local');
  });

  it('协议大小写不敏感(HTTP:// / HTTPS://)→ remote', () => {
    expect(classifyImageSource('HTTP://example.com/a.png')).toBe('remote');
    expect(classifyImageSource('HTTPS://example.com/a.png')).toBe('remote');
  });

  // 疑似 bug:data: 前缀判定用 startsWith('data:'),大小写敏感;与 http(s) 分支的
  // 大小写不敏感(/i 正则)不一致。大写 `DATA:` 前缀的数据 URI 会被误判为 'local'
  // (穿透两个判断均不命中,落到最终 return 'local')而非 'data'。按当前实际行为写死。
  it('[疑似 bug] 大写 `DATA:` 前缀不被识别为 data,误判为 local', () => {
    expect(classifyImageSource('DATA:image/png;base64,AAAA')).toBe('local');
  });
});

describe('truncateForReport', () => {
  it('短串原样返回', () => {
    expect(truncateForReport('abc', 10)).toBe('abc');
  });

  it('长度恰好等于 max 时原样返回(不截断、不加省略号)', () => {
    expect(truncateForReport('abcde', 5)).toBe('abcde');
  });

  it('超长时截断并加省略号,总长度为 max', () => {
    const out = truncateForReport('abcdefgh', 5);
    expect(out).toBe('abcd…');
    expect(out.length).toBe(5);
  });

  it('末位若切在代理对中间(高位代理项收尾),连同高位代理项一并去掉,不产生孤立代理项', () => {
    // 'a' + 😀(😀,占 2 个 UTF-16 code unit) + 'b',总 length = 4
    const s = 'a😀b';
    // max=3 → slice(0, 2) = 'a' + 高位代理项,末位是孤立高位代理项 → 应被一并砍掉
    const out = truncateForReport(s, 3);
    expect(out).toBe('a…');
    expect(/[\uD800-\uDBFF]/.test(out)).toBe(false); // 结果中不含孤立代理项
  });

  it('截断点落在完整代理对之后(不切半)时,emoji 完整保留', () => {
    const s = 'ab😀cd'; // length = 6
    const out = truncateForReport(s, 5); // slice(0,4) = 'ab😀' 完整,不以高位代理项结尾
    expect(out).toBe('ab😀…');
  });
});

describe('IMAGE_FAIL_REASONS', () => {
  it('包含预期的关键失败码', () => {
    const expectedSubset = [
      'upload-timeout',
      'marker-residue',
      'cover-set-failed',
      'remote-fetch-failed',
      'local-not-found',
      'local-too-large',
      'local-bad-type',
      'data-uri-invalid',
      'prepare-exception',
      'prepare-missing',
      'upload-no-editor',
      'upload-marker-lost',
      'upload-no-callback',
      'upload-relocate-failed',
      'upload-exception',
    ];
    for (const code of expectedSubset) {
      expect(IMAGE_FAIL_REASONS).toContain(code);
    }
  });

  it('无重复项', () => {
    const unique = new Set(IMAGE_FAIL_REASONS);
    expect(unique.size).toBe(IMAGE_FAIL_REASONS.length);
  });
});

describe('消息守卫', () => {
  describe('isProbeRequest', () => {
    it('正确判别探针请求', () => {
      expect(isProbeRequest({ type: PROBE_REQUEST_TYPE })).toBe(true);
    });

    it('type 不匹配时拒绝', () => {
      expect(isProbeRequest({ type: IMPORT_REQUEST_TYPE })).toBe(false);
    });

    it('非对象 / null 拒绝', () => {
      expect(isProbeRequest(null)).toBe(false);
      expect(isProbeRequest(undefined)).toBe(false);
      expect(isProbeRequest('probe')).toBe(false);
      expect(isProbeRequest(42)).toBe(false);
    });
  });

  describe('isImportRequest', () => {
    it('正确判别写入请求', () => {
      expect(
        isImportRequest({ type: IMPORT_REQUEST_TYPE, blocks: [], mode: 'replace' }),
      ).toBe(true);
    });

    it('type 不匹配时拒绝', () => {
      expect(isImportRequest({ type: PROBE_REQUEST_TYPE })).toBe(false);
    });

    it('非对象 / null 拒绝', () => {
      expect(isImportRequest(null)).toBe(false);
      expect(isImportRequest(undefined)).toBe(false);
      expect(isImportRequest([])).toBe(false);
    });
  });

  describe('isSetTitleRequest', () => {
    it('正确判别标题设置请求', () => {
      expect(
        isSetTitleRequest({ type: SET_TITLE_REQUEST_TYPE, title: 'x', conflict: 'keep' }),
      ).toBe(true);
    });

    it('type 不匹配时拒绝', () => {
      expect(isSetTitleRequest({ type: PROBE_REQUEST_TYPE })).toBe(false);
    });

    it('非对象 / null 拒绝', () => {
      expect(isSetTitleRequest(null)).toBe(false);
      expect(isSetTitleRequest(undefined)).toBe(false);
      expect(isSetTitleRequest(123)).toBe(false);
    });
  });

  describe('messageScope', () => {
    it('scope 为 active 时原样返回', () => {
      expect(messageScope({ scope: 'active' })).toBe('active');
    });

    it('scope 为 persistent 时原样返回', () => {
      expect(messageScope({ scope: 'persistent' })).toBe('persistent');
    });

    it('缺省 scope 回落 persistent', () => {
      expect(messageScope({ type: PROBE_REQUEST_TYPE })).toBe('persistent');
    });

    it('非法 scope 值回落 persistent', () => {
      expect(messageScope({ scope: 'evil' })).toBe('persistent');
      expect(messageScope({ scope: 123 })).toBe('persistent');
      expect(messageScope({ scope: null })).toBe('persistent');
    });

    it('null / 非对象输入回落 persistent(不抛异常)', () => {
      expect(() => messageScope(null)).not.toThrow();
      expect(messageScope(null)).toBe('persistent');
      expect(messageScope(undefined)).toBe('persistent');
    });
  });
});
