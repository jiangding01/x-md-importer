// A11:切文章判定规则(injector 写入闸门 + setTitle 复核共用)。
import { describe, expect, it } from 'vitest';
import { articleIdFromPathname, isArticleSwitched, normalizePathname } from './articleGuard';

const EDIT_A = '/compose/articles/edit/1111111111111111111';
const EDIT_B = '/compose/articles/edit/2222222222222222222';
const NEW_PAGE = '/compose/articles';

describe('normalizePathname / articleIdFromPathname', () => {
  it('去末尾斜杠、去 query/hash,根路径保持 /', () => {
    expect(normalizePathname(`${EDIT_A}/`)).toBe(EDIT_A);
    expect(normalizePathname(`${EDIT_A}//`)).toBe(EDIT_A);
    expect(normalizePathname(`${EDIT_A}?x=1#h`)).toBe(EDIT_A);
    expect(normalizePathname('/')).toBe('/');
    expect(normalizePathname('')).toBe('/');
  });
  it('解析 id 与 injector getArticleId 同口径;新建页无 id', () => {
    expect(articleIdFromPathname(EDIT_A)).toBe('1111111111111111111');
    expect(articleIdFromPathname(`${EDIT_A}/`)).toBe('1111111111111111111');
    expect(articleIdFromPathname(NEW_PAGE)).toBeNull();
  });
});

describe('isArticleSwitched', () => {
  it('有 id 且一致、路径未变 → 未切换', () => {
    expect(
      isArticleSwitched({ baselinePathname: EDIT_A, expectedArticleId: '1111111111111111111', currentPathname: EDIT_A }),
    ).toBe(false);
  });

  it('有 id 但当前 id 不一致 → 已切换', () => {
    expect(
      isArticleSwitched({ baselinePathname: EDIT_A, expectedArticleId: '1111111111111111111', currentPathname: EDIT_B }),
    ).toBe(true);
    // 无基线时仅凭 id 也能判出(setTitle 在本页未导入过的情形)
    expect(
      isArticleSwitched({ baselinePathname: null, expectedArticleId: '1111111111111111111', currentPathname: EDIT_B }),
    ).toBe(true);
  });

  it('基线为新建页(expectedArticleId=null)后 pathname 变化 → 已切换(原逻辑不防的缺口)', () => {
    expect(isArticleSwitched({ baselinePathname: NEW_PAGE, expectedArticleId: null, currentPathname: EDIT_B })).toBe(
      true,
    );
    expect(isArticleSwitched({ baselinePathname: NEW_PAGE, expectedArticleId: null, currentPathname: NEW_PAGE })).toBe(
      false,
    );
  });

  it('expectedArticleId=null 但基线是编辑页,切到另一篇编辑页 → 已切换', () => {
    expect(isArticleSwitched({ baselinePathname: EDIT_A, expectedArticleId: null, currentPathname: EDIT_B })).toBe(true);
  });

  it('离开 /compose/articles 路由 → 已切换(无论 id / 基线)', () => {
    expect(isArticleSwitched({ baselinePathname: null, expectedArticleId: null, currentPathname: '/compose/post' })).toBe(
      true,
    );
    expect(isArticleSwitched({ baselinePathname: EDIT_A, expectedArticleId: null, currentPathname: '/home' })).toBe(true);
  });

  it('末尾斜杠差异不算切换', () => {
    expect(
      isArticleSwitched({
        baselinePathname: EDIT_A,
        expectedArticleId: '1111111111111111111',
        currentPathname: `${EDIT_A}/`,
      }),
    ).toBe(false);
    expect(isArticleSwitched({ baselinePathname: `${NEW_PAGE}/`, expectedArticleId: null, currentPathname: NEW_PAGE })).toBe(
      false,
    );
  });

  it('query / hash 变化不算切换', () => {
    expect(
      isArticleSwitched({
        baselinePathname: EDIT_A,
        expectedArticleId: '1111111111111111111',
        currentPathname: `${EDIT_A}?foo=1#bar`,
      }),
    ).toBe(false);
  });

  it('无基线 + 无 id(旧版 content 且本页未导入过)→ 只看路由', () => {
    expect(isArticleSwitched({ baselinePathname: null, expectedArticleId: null, currentPathname: EDIT_B })).toBe(false);
  });
});
