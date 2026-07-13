import {
  MAIN_SOURCE,
  isIsoMessage,
  type MainMessage,
  type ProbeResult,
} from '@/lib/bridge/protocol';

/**
 * MAIN world 注入引擎 —— 经 content.ts 的 injectScript 注入,运行于**页面 JS 上下文**
 * (与 X 的 Draft.js 同一 world,可访问 React fiber / 页面构造器)。
 *
 * 本阶段(M1 探针)在握手骨架之上实现真实探针:定位正文编辑器 DOM、沿 React fiber
 * 定位 Draft 实例(editorState + onChange)、深挖 onFilesAdded 上传回调、提取文章 id,
 * 组装 ProbeResult 回 probe-result。算法与宽容参数严格照搬 xposter 源码实证(见
 * docs/research/xposter-analysis.md §1.1/§1.2/§3.1),这些层数/尺寸阈值是实战打磨出的
 * 防改版宽容度,不做"优化"。
 * 后续步骤再实现合成 paste、atomic 直写、onFilesAdded 上传桥等真实写入能力。
 */

/**
 * React fiber 的最小化局部形状——只描述本文件遍历需要的字段,不引入 react 内部类型依赖。
 * stateNode 可能是 DOM 节点、类组件实例或 null;props/memoizedProps 结构由 X 决定,故用
 * 宽松的索引签名而非 any。
 */
interface FiberProps {
  editorState?: unknown;
  onChange?: unknown;
  onFilesAdded?: unknown;
  [key: string]: unknown;
}
interface FiberStateNode {
  props?: FiberProps;
  [key: string]: unknown;
}
interface FiberNode {
  return: FiberNode | null;
  child: FiberNode | null;
  sibling: FiberNode | null;
  stateNode: FiberStateNode | null;
  memoizedProps: FiberProps | null;
}

export default defineUnlistedScript(() => {
  const post = (msg: MainMessage) => window.postMessage(msg, '*');

  // 多级 fallback 选择器(照搬 xposter EDITOR_SELECTOR):优先精确匹配 Draft 正文容器,
  // 逐级放宽到任意 contenteditable,兼容 X 改版后的结构漂移。
  const EDITOR_SELECTOR =
    "[data-contents='true'] [contenteditable='true'], [contenteditable='true'][role='textbox'], [contenteditable='true'].public-DraftEditor-content, [contenteditable='true']";

  /**
   * 定位正文编辑器元素:遍历所有匹配,用几何尺寸(宽 > 200 且高 > 80)过滤掉标题输入框等
   * 小型 contenteditable,取第一个命中。
   */
  const findEditorElement = (): HTMLElement | null => {
    const nodes = document.querySelectorAll<HTMLElement>(EDITOR_SELECTOR);
    for (const el of nodes) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 200 && rect.height > 80) return el;
    }
    return null;
  };

  /** 从 DOM 元素上取 React fiber(兼容 React ≥17 的 __reactFiber$ 与 ≤16 的 __reactInternalInstance$)。 */
  const getFiberFromElement = (el: HTMLElement): FiberNode | null => {
    const fiberKey = Object.keys(el).find(
      (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'),
    );
    if (!fiberKey) return null;
    return (el as unknown as Record<string, FiberNode | undefined>)[fiberKey] ?? null;
  };

  /**
   * 沿 fiber.return 向上最多 80 层,找 `stateNode.props.editorState` 存在且
   * `props.onChange` 为函数的节点——即 X 包装的 DraftEditor 组件实例(同时握有读/写入口)。
   */
  const findDraftStateNode = (): FiberStateNode | null => {
    const editor = findEditorElement();
    if (!editor) return null;
    let fiber = getFiberFromElement(editor);
    for (let depth = 0; depth < 80 && fiber; depth += 1) {
      const stateNode = fiber.stateNode;
      if (stateNode?.props?.editorState && typeof stateNode.props.onChange === 'function') {
        return stateNode;
      }
      fiber = fiber.return;
    }
    return null;
  };

  /**
   * 在以 root 为根的子树内向下递归最多 maxDepth 层(遍历 child 及其 sibling),寻找
   * `memoizedProps.onFilesAdded` 或 `stateNode.props.onFilesAdded` 为函数的节点。
   */
  const findOnFilesAddedInChildren = (
    root: FiberNode | null,
    maxDepth: number,
  ): ((files: File[]) => unknown) | null => {
    if (!root || maxDepth < 0) return null;
    for (let child = root.child; child; child = child.sibling) {
      const fromMemoized = child.memoizedProps?.onFilesAdded;
      if (typeof fromMemoized === 'function') return fromMemoized as (files: File[]) => unknown;
      const fromStateNode = child.stateNode?.props?.onFilesAdded;
      if (typeof fromStateNode === 'function') return fromStateNode as (files: File[]) => unknown;
      const hit = findOnFilesAddedInChildren(child, maxDepth - 1);
      if (hit) return hit;
    }
    return null;
  };

  /**
   * 定位 X 原生上传回调 onFilesAdded:从编辑器 fiber 沿 return 向上最多 160 层,每层对其
   * 子树向下递归最多 8 层搜寻。宽容的双向搜索用于兜住 X 改版后回调挂载位置的漂移。
   */
  const findOnFilesAdded = (): ((files: File[]) => unknown) | null => {
    const editor = findEditorElement();
    if (!editor) return null;
    let fiber = getFiberFromElement(editor);
    for (let depth = 0; depth < 160 && fiber; depth += 1) {
      const fromMemoized = fiber.memoizedProps?.onFilesAdded;
      if (typeof fromMemoized === 'function') return fromMemoized as (files: File[]) => unknown;
      const fromStateNode = fiber.stateNode?.props?.onFilesAdded;
      if (typeof fromStateNode === 'function') return fromStateNode as (files: File[]) => unknown;
      const inChildren = findOnFilesAddedInChildren(fiber, 8);
      if (inChildren) return inChildren;
      fiber = fiber.return;
    }
    return null;
  };

  /** 从 URL 提取文章草稿 id:/articles/edit/(\d+) 的捕获组,未在编辑页则为 null。 */
  const getArticleId = (): string | null => {
    const m = location.pathname.match(/articles\/edit\/(\d+)/);
    return m?.[1] ?? null;
  };

  /** 执行三灯探针 + 文章 id,组装 ProbeResult。 */
  const runProbe = (): ProbeResult => {
    const hasEditor = findEditorElement() !== null;
    const hasDraftNode = findDraftStateNode() !== null;
    const hasOnFilesAdded = findOnFilesAdded() !== null;
    return { hasEditor, hasDraftNode, hasOnFilesAdded, articleId: getArticleId() };
  };

  window.addEventListener('message', (e) => {
    if (!isIsoMessage(e)) return;
    const msg = e.data;
    if (msg.kind === 'hello') {
      // 回执握手,回显 ISOLATED 侧生成的 nonce
      post({ source: MAIN_SOURCE, kind: 'hello-ack', nonce: msg.nonce });
    } else if (msg.kind === 'probe') {
      // 执行探针,回显请求的 nonce/id 以便 content 侧精确匹配并发请求
      const result = runProbe();
      post({ source: MAIN_SOURCE, kind: 'probe-result', nonce: msg.nonce, id: msg.id, result });
    }
  });

  // 加载即广播就绪(content 可能已在监听;若晚于 content,content 的重试 hello 会兜底)。
  post({ source: MAIN_SOURCE, kind: 'ready' });
});
