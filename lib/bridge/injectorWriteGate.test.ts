// A11 结构回归:injector.ts 依赖页面 Draft.js fiber 环境,无诚实单测缝隙(见 vitest.config.ts),
// 故读源码文本做结构断言——锁死「编辑器写入只走统一出口 commitEditorState(内含切文章闸门)」、
// 「其返回值必被消费」「上传/封面写入前查闸门」「runImport 挂闸门、finally 复位」,防止日后新增
// 写入点绕过闸门、把旧编辑器状态存进切换后的新文章。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const RAW = readFileSync(new URL('../../entrypoints/injector.ts', import.meta.url), 'utf8');

/**
 * 去掉注释、保留代码与字符串原文:逐字符扫描,识别 '…' / "…" / `…`(含转义)字符串,
 * 字符串内的 `//`、`/*` 不当注释;字符串外的 `//…` 行注释与 `/* … *\/` 块注释删除(换行保留)。
 * 已知限制:不识别正则字面量——若正则里含引号或 `//`、`/*`,扫描可能错位。injector 现有正则都不含
 * 这些字符;一旦误判,下方断言会以莫名失败暴露,而不会静默放过。模板字符串的 `${}` 内若再嵌套反引号
 * 同样不支持(现有代码无此写法)。
 */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    const next = src[i + 1];
    if (ch === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, ''); // 只保留换行,行结构不变
      i = stop;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== ch) {
        if (src[j] === '\\') j += 1;
        else if (ch !== '`' && src[j] === '\n') break; // 普通字符串不跨行:防御性截断
        j += 1;
      }
      out += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * 找出所有「直接触达 onChange」的位置(返回在 code 中的下标):
 * `.onChange` / `?.onChange` 属性访问,排除 `typeof xxx.onChange` 这类只读探测
 * (findDraftStateNode 用它判定是否为 Draft 实例);另把 `['onChange']` 方括号访问与
 * `{ onChange }` / `{ onChange: … }` 解构/对象字面量也算作触达,防绕过。
 */
function findOnChangeAccesses(code: string): number[] {
  const hits: number[] = [];
  for (const m of code.matchAll(/\.onChange\b/g)) {
    const idx = m.index ?? 0;
    const lineStart = code.lastIndexOf('\n', idx) + 1;
    const before = code.slice(lineStart, idx);
    if (/typeof\s+[\w.?!]*$/.test(before)) continue; // typeof 探测,不是调用
    hits.push(idx);
  }
  for (const m of code.matchAll(/\[\s*['"`]onChange['"`]\s*\]/g)) hits.push(m.index ?? 0);
  for (const m of code.matchAll(/[{,]\s*onChange\s*[,}:]/g)) hits.push(m.index ?? 0);
  return hits.sort((a, b) => a - b);
}

/** 取 `const <name> =` 起到其所在缩进层(2 空格)的 `};` 为止的函数体文本与区间。 */
function functionSpan(code: string, name: string): { start: number; end: number; body: string } | null {
  const start = code.indexOf(`const ${name} =`);
  if (start < 0) return null;
  const endMark = code.indexOf('\n  };', start);
  if (endMark < 0) return null;
  const end = endMark + '\n  };'.length;
  return { start, end, body: code.slice(start, end) };
}

/** 某下标所在行(去首尾空白),用于失败信息可读。 */
function lineAt(code: string, i: number): string {
  const nl = code.indexOf('\n', i);
  return code.slice(code.lastIndexOf('\n', i) + 1, nl < 0 ? code.length : nl).trim();
}

/** 每个 `pattern` 命中点之前 `window` 字符内(已去注释)都须出现 `writeBlocked()`;返回不满足者所在行。 */
function ungatedCalls(code: string, pattern: RegExp, window = 160): string[] {
  const bad: string[] = [];
  for (const m of code.matchAll(pattern)) {
    const at = m.index ?? 0;
    if (!code.slice(Math.max(0, at - window), at).includes('writeBlocked()')) bad.push(lineAt(code, at));
  }
  return bad;
}

const CODE = stripComments(RAW);

describe('injector 写入闸门(A11 结构回归)', () => {
  it('扫描器自检:能命中直接调用,且不把 typeof 探测与注释算进去', () => {
    const sample = [
      "if (typeof node.props.onChange === 'function') {}",
      '(node.props?.onChange as (s: unknown) => void)(a);',
      '// (node.props?.onChange as F)(b);',
      '/* node.props.onChange(c) */',
      'node.props.onChange(d);',
    ].join('\n');
    expect(findOnChangeAccesses(stripComments(sample))).toHaveLength(2);
  });

  it('stripComments 自检:字符串里的 // 与 /* 不被当注释吃掉,尾随注释里的字样不算代码', () => {
    const sample = [
      "const u = 'https://x.com/a'; node.props.onChange(1);",
      'const s = " // not comment "; node.props.onChange(2);',
      'const t = `/* tpl ${a} */`; node.props.onChange(3);',
      'doWrite(); // writeBlocked() 只在注释里',
    ].join('\n');
    const code = stripComments(sample);
    expect(findOnChangeAccesses(code)).toHaveLength(3);
    expect(code).toContain("'https://x.com/a'");
    expect(code).toContain('" // not comment "');
    expect(code).not.toContain('writeBlocked()'); // 尾随注释已去掉,不能让注释冒充闸门检查
  });

  it('统一出口 commitEditorState 存在,且其中恰有一处 onChange 被扫到(正向断言)', () => {
    const span = functionSpan(CODE, 'commitEditorState');
    expect(span).not.toBeNull();
    const inside = findOnChangeAccesses(CODE).filter((i) => i >= span!.start && i < span!.end);
    expect(inside).toHaveLength(1);
    // 出口内先查闸门再调 onChange
    expect(span!.body.indexOf('writeBlocked()')).toBeGreaterThanOrEqual(0);
    expect(span!.body.indexOf('writeBlocked()')).toBeLessThan(span!.body.indexOf('.onChange'));
  });

  it('全文件直接触达 onChange 的位置只有统一出口这一处', () => {
    const span = functionSpan(CODE, 'commitEditorState');
    const all = findOnChangeAccesses(CODE);
    const outside = all.filter((i) => !span || i < span.start || i >= span.end);
    expect(outside.map((i) => lineAt(CODE, i))).toEqual([]);
    expect(all).toHaveLength(1);
  });

  it('commitEditorState 的每个调用点都消费返回值(不得作为语句单独调用)', () => {
    const calls = [...CODE.matchAll(/(?<![\w.])commitEditorState\(/g)].map((m) => m.index ?? 0);
    // 正向:6 处写入(钉光标 / 晚到归位 / 归位 / 写回原文 / 清扫 / 主提交)都已改走统一出口
    expect(calls.length).toBeGreaterThanOrEqual(6);
    const unconsumed = calls.filter((at) => {
      const before = CODE.slice(CODE.lastIndexOf('\n', at) + 1, at);
      // 允许 `!commitEditorState(` / `= commitEditorState(` / `(commitEditorState(` / `return commitEditorState(` 等
      return !/(?:[!=(&|?:]|\breturn)\s*$/.test(before);
    });
    expect(unconsumed.map((i) => lineAt(CODE, i))).toEqual([]);
  });

  it('onFilesAdded 调用前就近检查闸门(它会让 X 自己插 MEDIA 并保存)', () => {
    const pattern = /(?<![\w.])onFilesAdded\(/g;
    expect([...CODE.matchAll(pattern)].length).toBeGreaterThan(0);
    expect(ungatedCalls(CODE, pattern)).toEqual([]);
  });

  it('setCoverImage:塞 File 之前、每次点 Apply 之前都检查闸门', () => {
    const span = functionSpan(CODE, 'setCoverImage');
    expect(span).not.toBeNull();
    const body = span!.body;
    const firstGate = body.indexOf('writeBlocked()');
    const fileAssign = body.indexOf('.files =');
    expect(fileAssign).toBeGreaterThan(0);
    expect(firstGate).toBeGreaterThanOrEqual(0);
    expect(firstGate).toBeLessThan(fileAssign);
    expect([...body.matchAll(/realClick\(/g)].length).toBeGreaterThan(0);
    expect(ungatedCalls(body, /realClick\(/g)).toEqual([]);
  });

  it('runImport 入口挂上切文章闸门,finally 复位为一律禁止', () => {
    const span = functionSpan(CODE, 'runImport');
    expect(span).not.toBeNull();
    const body = span!.body;
    expect(body).toMatch(/\bwriteBlocked\s*=\s*articleSwitched\s*;/);
    const finallyAt = body.lastIndexOf('} finally {');
    expect(finallyAt).toBeGreaterThan(0);
    expect(body.slice(finallyAt)).toMatch(/\bwriteBlocked\s*=\s*\(\)\s*=>\s*true\s*;/);
  });
});
