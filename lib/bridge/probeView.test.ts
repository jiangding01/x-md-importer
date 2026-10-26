// 第二批 W3:页面状态按路由判定(新建文章页 articleId 为 null 也是文章编辑页)。
import { describe, expect, it } from 'vitest';
import { dictionaries } from '../i18n/dict';
import { pageNote, pageState } from './probeView';
import type { ProbeResult } from './protocol';

const r = (over: Partial<ProbeResult>): ProbeResult => ({
  hasEditor: true, hasDraftNode: true, hasOnFilesAdded: true, articleId: null, hasContent: false, isArticleEditor: true, ...over,
});

describe('pageState / pageNote', () => {
  it('有 id 的编辑页 → article', () => {
    expect(pageState(r({ articleId: '123' }))).toBe('article');
    expect(pageNote(dictionaries.zh, r({ articleId: '123' }))).toBe('x.com 文章编辑页 #123');
  });
  it('新建文章页(无 id、但在文章路由)→ new-article,不再显示「未在文章编辑页」', () => {
    expect(pageState(r({}))).toBe('new-article');
    expect(pageNote(dictionaries.zh, r({}))).toBe('新文章(尚未保存)');
    expect(pageNote(dictionaries.en, r({}))).toBe('New article (not saved yet)');
  });
  it('非文章路由(推文框 / 私信)→ not-article;旧 injector 缺字段同样不算', () => {
    expect(pageState(r({ isArticleEditor: false, articleId: '1' }))).toBe('not-article');
    expect(pageState(r({ isArticleEditor: undefined as unknown as boolean }))).toBe('not-article');
    expect(pageNote(dictionaries.zh, r({ isArticleEditor: false }))).toBe('未在文章编辑页');
  });
});
