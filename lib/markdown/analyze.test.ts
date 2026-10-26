// 第三批 C2(O1):一次解析得出标题 / 正文块 / 去标题块,必须与各自的独立入口逐一等价。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { capability, capabilityFromAnalysis, firstTitle, titleText } from './capability';
import { analyzeDraft, blocksWithoutTitle, extractTitle, parseMarkdownWithoutTitle } from './frontmatter';
import { parseMarkdown, type ParseOptions } from './parser';
import { sampleEn, sampleZh } from './sample';

const fullFormat = readFileSync(new URL('../../docs/qa/测试样例-全格式.md', import.meta.url), 'utf8');
const noFm = fullFormat.replace(/^---\n[\s\S]*?\n---\n/, '');

let seed = 7;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pool = [
  '# 标题', '## 二级', '标题', '===', '---', '- 项', '  - 子', '1. x', '> q', '```', '```js', 'x = 1', '$$', '',
  '![](a.png)', '![[b.png]]', '[[w]]', '- [ ] 待办', '**粗** _斜_', '<!-- c -->', '| a |', '|---|', '---\ntitle: T\n---',
];
const fuzz = Array.from({ length: 1500 }, () =>
  Array.from({ length: 1 + Math.floor(rnd() * 8) }, () => pool[Math.floor(rnd() * pool.length)]).join('\n'),
);
const inputs = [fullFormat, noFm, `# 首标题\n\n${noFm}`, `导语\n${noFm}`, sampleZh, sampleEn, '', ...fuzz];
const optSets: ParseOptions[] = [
  {},
  { obsidianImg: false, wikilink: false, taskList: 'plain' },
  { obsidianImg: true, wikilink: false, taskList: 'symbol' },
];
const json = (v: unknown) => JSON.stringify(v);

describe('analyzeDraft · 与独立入口等价(C2)', () => {
  it('标题 ≡ extractTitle;正文块 ≡ parseMarkdown;去标题块 ≡ parseMarkdownWithoutTitle', () => {
    for (const o of optSets) {
      for (const md of inputs) {
        const a = analyzeDraft(md, o);
        expect([md, a.title]).toEqual([md, extractTitle(md, o)]);
        expect([md, json(a.blocks)]).toEqual([md, json(parseMarkdown(md, o))]);
        expect([md, json(blocksWithoutTitle(a))]).toEqual([md, json(parseMarkdownWithoutTitle(md, o))]);
      }
    }
  });

  it('图片块只取决于 obsidianImg(素材板改用完整开关后计数不变)', () => {
    const images = (md: string, o: ParseOptions) => json(analyzeDraft(md, o).blocks.filter((b) => b.kind === 'image'));
    for (const md of inputs) {
      for (const obsidianImg of [true, false]) {
        expect([md, images(md, { obsidianImg, wikilink: false, taskList: 'plain' })]).toEqual([md, images(md, { obsidianImg })]);
      }
    }
  });

  it('能力计数:capabilityFromAnalysis ≡ capability(含去标题 / 去封面调整)', () => {
    for (const md of [fullFormat, noFm, `# 首标题\n\n${noFm}`, sampleZh]) {
      for (const adjust of [{}, { removeTitle: true }, { removeTitle: true, removeCoverImage: true }]) {
        expect(capabilityFromAnalysis(analyzeDraft(md), false, adjust)).toEqual(capability(md, false, undefined, adjust));
      }
    }
  });

  it('显示标题:titleText ≡ firstTitle(含未命名回落)', () => {
    for (const md of [fullFormat, noFm, '正文', '']) {
      for (const en of [true, false]) expect(titleText(analyzeDraft(md).title, en)).toBe(firstTitle(md, en));
    }
  });
});
