/**
 * 切文章判定(A11):写入流程跨越数十秒(图片上传最长 40s/张、清扫、封面、标题询问弹窗),
 * 期间用户可在**同一标签**内经 X 草稿列表 SPA 切到另一篇文章——X 不重挂编辑器,Draft 状态
 * 仍是原文章内容,但 URL / 自动保存目标已是新文章。此时插件再调 onChange,X 会把整份旧编辑器
 * 状态自动保存进**新文章**(数据覆盖)。injector 每次写入前都按本规则判定,命中即停手。
 *
 * 纯函数、零 DOM 依赖,injector(MAIN world)与单测共用同一实现。
 */

/** X 文章编辑相关路由前缀(列表 / 新建 / 编辑页均以此开头,与 injector 的 isArticleEditorRoute 同口径)。 */
export const ARTICLE_ROUTE_PREFIX = '/compose/articles';

/** 从文章编辑 URL 中提取草稿 id 的正则(与 injector 的 getArticleId 同口径)。 */
const ARTICLE_ID_RE = /articles\/edit\/(\d+)/;

/**
 * 归一化 pathname:去掉误传进来的 query / hash(只比路径),再去掉末尾斜杠
 * (根路径 `/` 保持不变)。`/compose/articles/edit/1/` 与 `/compose/articles/edit/1` 视为同一页。
 */
export function normalizePathname(pathname: string): string {
  const pathOnly = pathname.split(/[?#]/, 1)[0] ?? '';
  const trimmed = pathOnly.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

/** 从 pathname 解析文章草稿 id;不在编辑页(如新建页)返回 null。 */
export function articleIdFromPathname(pathname: string): string | null {
  const m = normalizePathname(pathname).match(ARTICLE_ID_RE);
  return m?.[1] ?? null;
}

export interface ArticleSwitchInput {
  /**
   * 写入开始时的 pathname 基线;null = 无基线(如从未导入过就设标题),跳过「路径变化」这一条。
   * 新建文章页 articleId 为 null,原有 id 比对对它完全不防——这条规则补上这个缺口。
   */
  baselinePathname: string | null;
  /** 期望的目标文章 id(sidepanel 钉死的双钥之一);null = 不做 id 比对(兼容旧调用方 / 新建页)。 */
  expectedArticleId: string | null;
  /** 当前 pathname(调用方传 location.pathname)。 */
  currentPathname: string;
}

/**
 * 是否已切换目标文章(任一条命中即视为已切换,宁可误停也不写错文章):
 * 1. 当前路径不在 `/compose/articles` 前缀下(离开了文章编辑路由);
 * 2. expectedArticleId 非 null 且当前路径解析出的 id 与之不等;
 * 3. 有基线且当前路径与基线不同(忽略末尾斜杠,不比较 query/hash)。
 *
 * 第 3 条「宁可误停」的误停风险经真机排除(2026-11-04,X 页面内装地址记录器实测):
 *  - 新建文章:点 Articles 列表的新建按钮后,X 直接 pushState 到 `/compose/articles/edit/<19位id>`,
 *    此后输入、自动保存都不再有任何 replaceState / 路径变化——不存在「无 id → 有 id」的跳转,
 *    写入途中路径不会因 X 自身行为而变;
 *  - 封面「Edit media」裁剪弹窗从打开到关闭 pathname 全程不变(不进子路由)。
 * 因此写入期间 pathname 一旦变化,只可能是用户切走了,停手不会误伤正常导入。
 */
export function isArticleSwitched(input: ArticleSwitchInput): boolean {
  const current = normalizePathname(input.currentPathname);
  if (!current.startsWith(ARTICLE_ROUTE_PREFIX)) return true;
  if (input.expectedArticleId != null && articleIdFromPathname(current) !== input.expectedArticleId) return true;
  if (input.baselinePathname != null && normalizePathname(input.baselinePathname) !== current) return true;
  return false;
}
