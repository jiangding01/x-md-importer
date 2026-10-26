// 第三批 I4:正文编辑器定位抽为 injector / content 共用(此前 content 的「滚动到顶部」取文档里第一个 contenteditable)。
import { describe, expect, it } from 'vitest';
import { EDITOR_SELECTOR_TIERS, findEditorElement } from './editorLocator';

type Fake = { id: string; w: number; h: number; tiers: number[] };
const el = (id: string, w: number, h: number, ...tiers: number[]): Fake => ({ id, w, h, tiers });
const root = (...els: Fake[]) => ({
  querySelectorAll: (sel: string) => els.filter((e) => e.tiers.includes(EDITOR_SELECTOR_TIERS.indexOf(sel as never))),
});
const rect = (e: Fake) => ({ width: e.w, height: e.h });
const find = (...els: Fake[]) => (findEditorElement(root(...els) as never, rect as never) as Fake | null)?.id ?? null;

describe('findEditorElement', () => {
  it('高一级的命中优先,即使低一级有更大的元素', () => {
    expect(find(el('big-bare', 900, 900, 3), el('composer', 600, 400, 0, 1, 2, 3))).toBe('composer');
  });
  it('级内取面积最大者,不按文档顺序', () => {
    expect(find(el('small', 300, 100, 1, 3), el('large', 600, 500, 1, 3))).toBe('large');
  });
  it('尺寸不达标(宽 ≤ 200 或高 ≤ 80)的跳过,落到下一级', () => {
    expect(find(el('tiny-composer', 200, 400, 0, 3), el('bare', 600, 400, 3))).toBe('bare');
    expect(find(el('flat', 600, 80, 0, 3))).toBe(null);
  });
  it('I4:文档里第一个 contenteditable 是小输入框时仍选中正文', () => {
    expect(find(el('first-small', 150, 30, 3), el('editor', 640, 900, 1, 3))).toBe('editor');
  });
  it('没有候选 → null', () => {
    expect(find()).toBe(null);
  });
});
