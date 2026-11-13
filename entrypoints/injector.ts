import {
  ARTICLE_SWITCHED_ERROR,
  MAIN_SOURCE,
  NOT_ARTICLE_EDITOR_ERROR,
  isIsoMessage,
  truncateForReport,
  type ImageFailReason,
  type ImageFailure,
  type ImportBlock,
  type ImportMode,
  type ImportResult,
  type MainMessage,
  type PreparedImage,
  type ProbeResult,
  type SetTitleResult,
  type TitleConflict,
} from '@/lib/bridge/protocol';
import { ARTICLE_ROUTE_PREFIX, articleIdFromPathname, isArticleSwitched } from '@/lib/bridge/articleGuard';
import { findEditorElement } from '@/lib/bridge/editorLocator';
import { isSampleResidue, SAMPLE_CHAR, SAMPLE_RESIDUE_SUFFIX } from '@/lib/bridge/sampleResidue';
import {
  createSaveTracker,
  isContentSaveUrl,
  QUIESCE_CAP_MS,
  QUIESCE_FINAL_CAP_MS,
  QUIESCE_POLL_MS,
  QUIESCE_RECHECK_CAP_MS,
  type SaveTracker,
} from '@/lib/bridge/saveQuiesce';
import {
  decideImageAction,
  decideRevival,
  isOriginalImageReturn,
  reuploadBlockReason,
  type ImageAction,
  type ImageExpectation,
} from '@/lib/bridge/imageReconcile';
import {
  claimedMediaKeys,
  hasUnclaimedNewMedia,
  observeImage,
  type ImageSighting,
  type SimpleBlock,
} from '@/lib/bridge/mediaIdentity';

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

/**
 * Draft.js / Immutable.js 的最小化局部形状——这些对象都来自**页面运行时**(X 打包的 Draft),
 * 本扩展不打包任何 Draft/Immutable 依赖,全部从现有 editorState 上「借」构造器(见
 * docs/research/xposter-analysis.md §1.3)。故这里按鸭子类型只声明本文件真正调用到的方法,
 * 不追求覆盖 Draft 完整 API;边界处用受控 `as` 收口,避免裸 any 蔓延到逻辑层。
 */

/** Immutable.OrderedSet<string>(inline style 集合):不可变,每次操作返回新实例。 */
interface DraftStyleSet {
  clear(): DraftStyleSet;
  add(style: string): DraftStyleSet;
}

/** Draft.js CharacterMetadata:无公开构造器,靠「样本字符」派生克隆(set 返回新实例)。 */
interface DraftCharacter {
  getStyle(): DraftStyleSet;
  set(key: string, value: unknown): DraftCharacter;
}

/**
 * Immutable.List<CharacterMetadata>。用**实例方法** clear()/push() 逐个构建,
 * 不用 `constructor(数组)` 直造(对 Draft 内部子类不安全)。
 */
interface DraftCharacterList {
  forEach(cb: (ch: DraftCharacter) => void): void;
  clear(): DraftCharacterList;
  push(ch: DraftCharacter): DraftCharacterList;
}

/** Immutable.Map(ContentBlock 的 data 字段):只用到 clear。 */
interface DraftBlockData {
  clear(): DraftBlockData;
}

/** Draft.js ContentBlock。 */
interface DraftBlock {
  getKey(): string;
  getType(): string;
  getText(): string;
  getCharacterList(): DraftCharacterList;
  getData(): DraftBlockData;
  /** 取该块 offset 处字符挂的 entity key(无则 null)——用于识别 atomic 块的 MEDIA entity。 */
  getEntityAt(offset: number): string | null;
  merge(props: Record<string, unknown>): DraftBlock;
}

/**
 * Immutable.OrderedMap<string, ContentBlock>。用实例方法 clear()/set() 逐个构建
 * (set 新 key 追加在尾部,保序);不用 `constructor(entries)` 直造。
 * forEach 回调按 Immutable 约定接 (value, key)。
 */
interface DraftBlockMap {
  first(): DraftBlock;
  last(): DraftBlock;
  get(key: string): DraftBlock | undefined;
  has(key: string): boolean;
  forEach(cb: (block: DraftBlock, key: string) => void): void;
  clear(): DraftBlockMap;
  set(key: string, block: DraftBlock): DraftBlockMap;
  delete(key: string): DraftBlockMap;
}

/** Draft.js EntityInstance(createEntity 后按 key 取回)。 */
interface DraftEntity {
  getType(): string;
  getData(): unknown;
}

/** Draft.js ContentState(entity 存储 + blockMap 容器,均不可变)。 */
interface DraftContentState {
  getBlockMap(): DraftBlockMap;
  getEntity(key: string): DraftEntity;
  createEntity(type: string, mutability: string, data: unknown): DraftContentState;
  getLastCreatedEntityKey(): string;
  set(key: string, value: unknown): DraftContentState;
}

/** Draft.js SelectionState 实例(Immutable Record:merge 返回新实例)。 */
interface DraftSelection {
  merge(props: Record<string, unknown>): DraftSelection;
  /** 锚点所在块 key(settle 判定「光标已钉到 marker 块」用;调用处先 typeof 守卫,X 包装可能缺)。 */
  getAnchorKey?(): string;
  /** 焦点所在块 key(导入后守护判定「用户光标是否落在被改写的块里」用;同样先 typeof 守卫)。 */
  getFocusKey?(): string;
}

/** Draft.js SelectionState 类(从 editorState.getSelection().constructor 取得)。 */
interface DraftSelectionStatic {
  createEmpty(blockKey: string): DraftSelection;
}

/** Immutable.Stack<ContentState>(撤销 / 重做栈;仅诊断读取,字段都可能缺)。 */
interface DraftStack {
  toArray?(): DraftContentState[];
  size?: number;
}

/** Draft.js EditorState 实例。 */
interface DraftEditorState {
  getSelection(): DraftSelection;
  getCurrentContent(): DraftContentState;
  /** 最近一次变更类型(EditorState.undo/redo 会置为 'undo'/'redo';导入后守护据此让位,先 typeof 守卫)。 */
  getLastChangeType?(): string | null;
  /** 撤销 / 重做栈(Immutable.Stack<ContentState>;仅撤销诊断读取,先 typeof 守卫)。 */
  getUndoStack?(): DraftStack;
  getRedoStack?(): DraftStack;
}

/** Draft.js EditorState 类(静态方法,从 editorState.constructor 取得)。 */
interface DraftEditorStateStatic {
  push(editorState: DraftEditorState, content: DraftContentState, changeType: string): DraftEditorState;
  forceSelection(editorState: DraftEditorState, selection: DraftSelection): DraftEditorState;
}

export default defineUnlistedScript(() => {
  // 跨实例单例守卫(B2-4):同一页面被二次注入(dev 热重载 / BFCache 恢复叠加重注入)时,
  // 两个实例会**各自**响应同一条 import 消息并发直写同一 blockMap(各自的 importInFlight
  // 互不可见)——草稿重复/损坏且 content 只认第一个回包,完全不可见。首个实例占坑,
  // 后来者直接退出(旧实例继续服务;「新代码不接管」是可接受取舍,生产首要目标是杜绝双执行)。
  const INSTANCE_KEY = Symbol.for('markflow.injector.v1');
  const w = window as unknown as Record<symbol, boolean | undefined>;
  if (w[INSTANCE_KEY]) {
    if (import.meta.env.DEV) console.info('[MarkFlow] injector 已有存活实例,跳过重复初始化');
    return;
  }
  w[INSTANCE_KEY] = true;

  // targetOrigin 收敛为本页 origin(而非 '*'):MAIN world 与页面同 JS 上下文,此为**纵深收敛**
  // ——挡住把消息投递到跨 origin 的 iframe/嵌入上下文,缩小误发面;并非完全隔离(同源脚本仍可监听)。
  const post = (msg: MainMessage) => window.postMessage(msg, window.location.origin);

  // 并发导入护栏:一次写入正在进行时拒绝第二次(防止 content 误判超时后用户重试,
  // 两个 runImport 交错直改同一 Draft blockMap 造成重复/错位/按旧 key 找块崩溃)。
  let importInFlight = false;

  // 正文编辑器定位(多级选择器 + 尺寸过滤 + 取面积最大者)抽到 lib/bridge/editorLocator,与 content 的
  // 「完成后滚动到顶部」同口径(第三批 I4)。

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

  /** 从 URL 提取文章草稿 id:/articles/edit/(\d+) 的捕获组,未在编辑页则为 null(规则在 articleGuard,单一实现)。 */
  const getArticleId = (): string | null => articleIdFromPathname(location.pathname);

  /**
   * 当前页是否为 X 文章编辑路由(B3)。文章列表 / 新建 / 编辑页 URL 均以 `/compose/articles`
   * 为前缀(docs/技术方案设计.md §入口 实测)。推文 compose 弹窗(`/compose/post`)、私信框等
   * 同样是 Draft.js 且尺寸达标,三灯探针会误判「可写」——写入/设标题入口与 connected 判定
   * 都以此为闸门。前缀常量与 articleGuard 共用(A11 J3:单一实现)。
   */
  const isArticleEditorRoute = (): boolean => location.pathname.startsWith(ARTICLE_ROUTE_PREFIX);

  /**
   * 执行三灯探针 + 文章 id + 路由判定,组装 ProbeResult。
   * B5:整体 try/catch——X 改版导致 `getCurrentContent` 不是函数等异常此前会让 promise reject、
   * `probe-result` 永不发出,content 只见 timeout;现在异常时回「三灯全灭 + error 诊断串」。
   */
  const runProbe = (): ProbeResult => {
    const isArticleEditor = isArticleEditorRoute();
    try {
      const hasEditor = findEditorElement() !== null;
      const draftNode = findDraftStateNode();
      const hasDraftNode = draftNode !== null;
      const hasOnFilesAdded = findOnFilesAdded() !== null;
      // hasContent:遍历 blockMap 任一块 text 非空即为 true;拿不到 draftNode 时恒 false。
      let hasContent = false;
      if (draftNode) {
        readEditorState(draftNode)
          .getCurrentContent()
          .getBlockMap()
          .forEach((block) => {
            if (block.getText().length > 0) hasContent = true;
          });
      }
      return { hasEditor, hasDraftNode, hasOnFilesAdded, articleId: getArticleId(), hasContent, isArticleEditor };
    } catch (err) {
      console.warn('[MarkFlow] 探针异常', err);
      return {
        hasEditor: false,
        hasDraftNode: false,
        hasOnFilesAdded: false,
        articleId: null,
        hasContent: false,
        isArticleEditor,
        error: String(err),
      };
    }
  };

  // -------------------------------------------------------------------------
  // 写入引擎(runImport)—— 借页面 Draft 构造器直写 blockMap,不打包任何依赖。
  // 蓝本见 docs/research/xposter-analysis.md §1.3/§1.4/§2.2。
  // -------------------------------------------------------------------------

  const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  /** 从 draftNode 上取 Draft EditorState 实例(受控收口)。 */
  const readEditorState = (node: FiberStateNode): DraftEditorState =>
    node.props?.editorState as DraftEditorState;

  /**
   * 写入闸门(A11):返回 true = 禁止写编辑器。runImport 入口挂上「基于 articleGuard 的切文章判定」,
   * finally 复位为「一律禁止」。所有改写编辑器的函数(placeSelectionAtMarker / relocate* /
   * replaceMarkerWithText / sweepMarkersOnce / 主提交 / 封面 / 晚到追回)都只在 runImport 内被调用,
   * 故 runImport 外一律禁止不影响任何既有调用(见 commitEditorState)。
   * 写入由 importInFlight 串行化,同一时刻只有一次 runImport 在用它。
   */
  let writeBlocked: () => boolean = () => true;

  /**
   * 最近一次 runImport 开始时的 pathname(A11)。导入成功后侧边栏才设标题(ask 冲突弹窗可挂起很久),
   * setTitle 据此判定「是否已不在导入时那篇文章」——新建文章页 articleId 为 null,只比 id 防不住。
   * 不在 runImport 的 finally 清空(标题阶段在导入返回之后);null = 本页尚未导入过,跳过该条。
   */
  let lastImportPathname: string | null = null;

  /**
   * 最近一次经 commitEditorState 写编辑器的时刻(performance.now() 时基,与资源计时条目同一时基)。
   * 收尾保存稳定窗据此判断「写入之后 X 是否已保存并静默」(见 waitForSaveQuiesce)。
   */
  let lastWriteAt = 0;

  /**
   * 本次 runImport 调用上传回调的次数(含收尾补传;runImport 入口清零)。为 0 时收尾跳过保存稳定窗:
   * 没有上传,回退的两个嫌疑(上传管线陈旧提交 / 上传后保存回写)都无从发生。
   */
  let filesAddedCount = 0;

  /**
   * 编辑器写入的**唯一出口**(A11):同步检查写入闸门,已切文章就不调 onChange 并返回 false;
   * 否则调 X 的 onChange 提交并返回 true。返回 false 只有「被闸门拦截」这一种含义,调用方据此
   * 视为本步失败/中止(绝不当成功)。onChange 直调只允许出现在这里(injectorWriteGate.test.ts 结构断言)。
   * 背景:同标签 SPA 切文章后 X 不重挂编辑器,Draft 仍是旧文章内容,此时任何 onChange 都会让 X
   * 把整份旧状态自动保存进新文章(真机回归 A11 对照实验证实 X 自身切换不会保存)。
   */
  const commitEditorState = (node: FiberStateNode, state: DraftEditorState): boolean => {
    if (writeBlocked()) {
      console.warn('[MarkFlow] 目标文章已切换或不在写入流程中,拦截编辑器写入', location.pathname);
      return false;
    }
    (node.props?.onChange as (s: DraftEditorState) => void)(state);
    lastWriteAt = performance.now();
    return true;
  };

  /**
   * B1 诊断账本:本次 runImport 中 settle 超时的阶段名(随 ImportResult.settleTimeouts 回传)。
   * 模块级而非逐层传参——写入由 importInFlight 串行化,同一时刻只有一次 runImport 在用它;
   * runImport 入口清空。
   */
  let settleTimeouts: string[] = [];

  /**
   * 等待 React 提交(B1 核心)。`onChange(ns)` 只是把新 state 交给 X 的 setState,
   * `stateNode.props.editorState` 要等 React 重渲染才更新;此前「读 props → 改 → onChange」
   * 连做两轮、中间不等待,第二轮读到的是**陈旧** state,会把第一轮的改动整体回滚(≥2 图且
   * 非最后一张失败时:写回的原文被回滚、marker 重现、再被 sweepMarkers 整块删掉)。
   * xposter §9「所有 sleep 都是等待 React 提交」的节奏控制,这里换成**按预期状态轮询**。
   *
   * 每 ~50ms 重新 findDraftStateNode()(React 重渲染后旧 stateNode 的 editorState 已过期,
   * 找不到时退回传入的 node)并用 `expect(content, editorState)` 判定预期是否已落盘;
   * **不用 `props.editorState === ns` 恒等判定**——X 的 onChange 可能包装/派生 state,恒等可能
   * 永不成立。超时返回 false(不抛、不中断导入):记 warn + 账本,调用方继续走降级/清扫。
   */
  const settle = async (
    stageName: string,
    node: FiberStateNode | null,
    expect: (content: DraftContentState, editorState: DraftEditorState) => boolean,
    timeoutMs = 1500,
  ): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const current = findDraftStateNode() ?? node;
      if (current) {
        try {
          const es = readEditorState(current);
          if (es && expect(es.getCurrentContent(), es)) return true;
        } catch {
          /* 中间态读取抛错:视为尚未提交,下一轮再试 */
        }
      }
      if (Date.now() >= deadline) break;
      await delay(50);
    }
    console.warn(`[MarkFlow] settle timeout: ${stageName}`);
    settleTimeouts.push(stageName);
    return false;
  };

  /**
   * 遍历 blockMap 各块的 characterList,找出第一个带 `set`/`getStyle` 方法的字符实例作为样本。
   * CharacterMetadata 无公开构造器,后续新字符全靠 `sample.set(...)` 克隆派生。
   */
  const findCharacterSample = (blockMap: DraftBlockMap): DraftCharacter | null => {
    let found: DraftCharacter | null = null;
    blockMap.forEach((block) => {
      if (found) return;
      block.getCharacterList().forEach((ch) => {
        if (found) return;
        if (ch && typeof ch.set === 'function' && typeof ch.getStyle === 'function') {
          found = ch;
        }
      });
    });
    return found;
  };

  /** atomic entity 的 mutability 映射(值为 xposter 源码实证 / LATEX 真机 dump 实证,见 §2.2)。 */
  const atomicMutability = (entityType: 'DIVIDER' | 'MARKDOWN' | 'TWEET' | 'LATEX'): string =>
    entityType === 'MARKDOWN' ? 'MUTABLE' : 'IMMUTABLE';

  // -------------------------------------------------------------------------
  // 图片上传引擎(M2 Phase 2)—— marker 占位 → onFilesAdded → 轮询 MEDIA → 归位 → 清 marker。
  // 蓝本 docs/research/xposter-analysis.md §3.1–3.3。图片上传是**异步**的(X 自己压缩/分片/
  // 插入 MEDIA 块),故不能像 M1 文本那样单趟构造,必须占位 + 事后归位。
  // 每步都重新 findDraftStateNode()——onChange 后旧 stateNode 过期。
  // -------------------------------------------------------------------------

  /** 定位 marker 所在块:返回 blockKey 与「该块是否仅含 marker」(exact)。 */
  const findMarkerBlock = (
    content: DraftContentState,
    marker: string,
  ): { blockKey: string; exact: boolean } | null => {
    let hit: { blockKey: string; exact: boolean } | null = null;
    content.getBlockMap().forEach((block, key) => {
      if (hit) return;
      const text = block.getText();
      if (text.indexOf(marker) >= 0) hit = { blockKey: key, exact: text.trim() === marker };
    });
    return hit;
  };

  /**
   * 把光标钉到 marker 块起始——X 的 onFilesAdded 会把 MEDIA 块插到光标处。
   * 提交后 settle 等 selection 的 anchorKey 指向 marker 块(B1);页面 SelectionState 缺
   * getAnchorKey 时无法从 state 判定,退化为固定 delay(250)。
   * 写入闸门拦截(已切文章)时也返回 false,调用方须再查 writeBlocked() 区分「marker 丢失」与「已切换」。
   */
  const placeSelectionAtMarker = async (node: FiberStateNode, marker: string): Promise<boolean> => {
    const es = readEditorState(node);
    const loc = findMarkerBlock(es.getCurrentContent(), marker);
    if (!loc) return false;
    const SelStatic = es.getSelection().constructor as unknown as DraftSelectionStatic;
    const ESStatic = es.constructor as unknown as DraftEditorStateStatic;
    const sel = SelStatic.createEmpty(loc.blockKey).merge({ anchorOffset: 0, focusOffset: 0 });
    if (!commitEditorState(node, ESStatic.forceSelection(es, sel))) return false;
    if (typeof sel.getAnchorKey === 'function') {
      await settle('place-selection', node, (_c, state) => {
        const s = state.getSelection();
        return typeof s.getAnchorKey === 'function' && s.getAnchorKey() === loc.blockKey;
      });
    } else {
      await delay(250);
    }
    return true;
  };

  /** 快照当前所有 MEDIA atomic 块的 key(上传前)——上传后据此识别「新增」的媒体块。 */
  const snapshotMediaKeys = (node: FiberStateNode): Set<string> => {
    const set = new Set<string>();
    const content = readEditorState(node).getCurrentContent();
    content.getBlockMap().forEach((block, key) => {
      if (block.getType() !== 'atomic') return;
      const ek = block.getEntityAt(0);
      if (!ek) return;
      try {
        if (content.getEntity(ek).getType() === 'MEDIA') set.add(key);
      } catch {
        /* entity 读取失败忽略 */
      }
    });
    return set;
  };

  /** 从 MEDIA entity data 递归穷举 mediaId(键名/形状防御,照搬 xposter §3.2)。 */
  const extractMediaId = (data: unknown, depth = 0): string | null => {
    if (depth > 5 || data == null) return null;
    if (typeof data === 'string') return /^\d+$/.test(data.trim()) ? data.trim() : null;
    if (typeof data === 'number') return Number.isInteger(data) ? String(data) : null;
    if (typeof data !== 'object') return null;
    const obj = data as Record<string, unknown>;
    for (const k of ['mediaId', 'media_id', 'media_id_string', 'mediaKey', 'media_key', 'id_str', 'id', 'rest_id']) {
      const v = obj[k];
      if (typeof v === 'string' && /^\d/.test(v)) return v;
      if (typeof v === 'number' && Number.isInteger(v)) return String(v);
    }
    for (const v of Object.values(obj)) {
      const r = extractMediaId(v, depth + 1);
      if (r) return r;
    }
    return null;
  };

  /** MEDIA entity data 的 JSON 签名——pending 稳定性判定用(签名不变 = data 已停止变动)。 */
  const mediaEntityDataSignature = (data: unknown): string => {
    try {
      return JSON.stringify(data) ?? 'null';
    } catch {
      // 循环引用等无法序列化:退化为类型串,至少能区分「有无」
      return String(data);
    }
  };

  // pending 稳定性判定参数(照搬 xposter §3.2 实证,不做等价简化):
  // 签名连续 5s 无变化 且 该块已出现 ≥20s → 放行;或出现满 32s 封顶放行(仅正文图,封面不放行 pending)。
  const PENDING_STABLE_MS = 5_000;
  const PENDING_MIN_AGE_MS = 20_000;
  const PENDING_CAP_MS = 32_000;
  /**
   * 单张图上传预算(上传循环与收尾补传共用):需 ≥ PENDING_CAP_MS,否则 pending 封顶放行分支永不触发,
   * 留足余量取 40s。content.ts 的通道超时按此预算 + 余量(每图 45s)计算。
   */
  const IMAGE_UPLOAD_BUDGET_MS = 40_000;

  /**
   * 图片被判定上传成功的路径(诊断用):'ready'=已带 mediaId;'pending-stable'/'pending-cap'=
   * 无 mediaId、按签名稳定 / 出现满 32s 放行(此时 X 的上传可能仍在进行,其完成时的提交有可能
   * 覆盖我们的归位);'fallback-index'=精确归位失败、按「MEDIA 块已在正文」兜底配对。
   */
  type ReleaseVia = 'ready' | 'pending-stable' | 'pending-cap' | 'fallback-index';

  /** waitForNewMedia 的「已切文章」哨兵(A11):调用方据此立即中止,不归位、不写回原文。 */
  const MEDIA_WAIT_SWITCHED = 'article-switched' as const;


  // -------------------------------------------------------------------------
  // B2 晚到追回 —— 图 k 超时降级(写回原文)后,X 的上传并未取消;k 的 MEDIA 若在图 k+1 的
  // 等待期才插入,会被当成 k+1 的结果归位到 marker k+1,此后逐张错位、末张成孤儿。
  // 登记每张超时图的「原文写回位置」与超时那刻的 pending 块 key;该块拿到 mediaId 时**按 key
  // 精确**还给该图:删掉其原文、MEDIA 归位到该处,再继续等本图自己的 MEDIA。
  // 无 key 可追踪(超时时尚无块 / 块后来消失)的晚到块**不猜归属**(曾有的末轮 FIFO 无归属证据、
  // 猜错即两图对调且全报成功,已删除):收尾时若有孤儿 MEDIA 且其后有图成功归位,如实上报一条
  // media-order-uncertain 提示用户核对(见 runImport 孤儿审计)。
  // -------------------------------------------------------------------------

  /**
   * 一张超时降级、等待晚到 MEDIA 的图。
   * - fallbackKey:replaceMarkerWithText 写回原文所在块 key(块 merge 保 key)。定位时还要求
   *   该块文本仍含 fallbackText;不满足(X 重建了块 key)则退回「整块文本 === fallbackText」搜索。
   * - pendingKey:超时那刻已出现但未确认(无 mediaId)的 MEDIA 块 key。它已在后续图的 before
   *   快照内、不会被误当新块;只按 key 精确等它拿到 mediaId。为空或该块消失(X 可能换新 key
   *   落定)即「不可追踪」:不再追回,收尾按 media-order-uncertain 规则如实上报。
   */
  type LateEntry = {
    imageIndex: number;
    fallbackKey: string | null;
    fallbackText: string;
    pendingKey: string | null;
  };
  /** 待追回队列(按超时先后排列)。模块级同 settleTimeouts:importInFlight 串行化,runImport 入口清零。 */
  let pendingLate: LateEntry[] = [];
  /**
   * 已追回的图片(runImport 收尾据此 imageOk++、移除对应 upload-timeout 明细,并把该图登记为已归位;
   * mediaKey 是追回归位的 MEDIA 块 key,供收尾核对 / 导入后守护判定「图在不在」)。
   */
  let lateRecovered: Array<{ imageIndex: number; mediaKey: string }> = [];
  // 追回会**写正文**(此前 waitForNewMedia 只读),服从统一写入闸门 writeBlocked(A11 起与其余写入
  // 共用同一闸门,原 lateWriteBlocked 并入;见 commitEditorState)。

  /** MEDIA atomic 块的 mediaId(不是 MEDIA 块或尚无 mediaId 时 null)——收尾核对按 mediaId 认图用。 */
  const mediaIdOfBlock = (content: DraftContentState, block: DraftBlock): string | null => {
    if (block.getType() !== 'atomic') return null;
    const ek = block.getEntityAt(0);
    if (!ek) return null;
    try {
      const ent = content.getEntity(ek);
      return ent.getType() === 'MEDIA' ? extractMediaId(ent.getData()) : null;
    } catch {
      return null;
    }
  };

  /** 块是否为 MEDIA atomic 块:'ready'=已带 mediaId;'pending'=entity 在但无 mediaId;null=不是。 */
  const mediaBlockState = (content: DraftContentState, block: DraftBlock): 'ready' | 'pending' | null => {
    if (block.getType() !== 'atomic') return null;
    const ek = block.getEntityAt(0);
    if (!ek) return null;
    try {
      const ent = content.getEntity(ek);
      if (ent.getType() !== 'MEDIA') return null;
      return extractMediaId(ent.getData()) !== null ? 'ready' : 'pending';
    } catch {
      return null;
    }
  };

  /**
   * 把晚到 MEDIA 归位到超时图的原文处:原文独占整块 → MEDIA 顶替该块;原文混在其他文字中
   * (marker 当初非独占) → 抠掉原文子串、MEDIA 插在该块之前(同 xposter §3.3 relocate 口径)。
   * 单次 blockMap 重排 + 一次 onChange,提交后 settle 等落盘。找不到原文返回 false(不改正文)。
   */
  const relocateLateMedia = async (node: FiberStateNode, entry: LateEntry, mediaKey: string): Promise<boolean> => {
    const es = readEditorState(node);
    const content = es.getCurrentContent();
    const blockMap = content.getBlockMap();
    if (!blockMap.has(mediaKey)) return false;
    const holds = (key: string | null): key is string => {
      if (!key || key === mediaKey) return false;
      const b = blockMap.get(key);
      return !!b && b.getType() !== 'atomic' && b.getText().includes(entry.fallbackText);
    };
    let targetKey: string | null = holds(entry.fallbackKey) ? entry.fallbackKey : null;
    if (!targetKey) {
      // 兜底:整块文本恰为原文;排除其他待追回图登记的块,免得抢走别人的位置。
      const othersKeys = new Set(pendingLate.filter((e) => e !== entry).map((e) => e.fallbackKey));
      const want = entry.fallbackText.trim();
      blockMap.forEach((b, k) => {
        if (targetKey || othersKeys.has(k) || b.getType() === 'atomic') return;
        if (b.getText().trim() === want) targetKey = k;
      });
    }
    if (!targetKey) return false;
    const tk: string = targetKey;
    const target = blockMap.get(tk)!;
    const text = target.getText();
    const at = text.indexOf(entry.fallbackText);
    const remainder = at >= 0 ? text.slice(0, at) + text.slice(at + entry.fallbackText.length) : '';
    const dropTarget = remainder.trim().length === 0;
    let rewritten: DraftBlock | null = null;
    if (!dropTarget) {
      const sample = findCharacterSample(blockMap);
      if (!sample) return false;
      const plain = sample.set('style', sample.getStyle().clear()).set('entity', null);
      let characterList = target.getCharacterList().clear();
      for (let i = 0; i < remainder.length; i += 1) characterList = characterList.push(plain);
      rewritten = target.merge({ type: 'unstyled', text: remainder, characterList });
    }

    const orderedKeys: string[] = [];
    blockMap.forEach((_b, key) => {
      if (key === mediaKey) return;
      if (key === tk) {
        orderedKeys.push(mediaKey);
        if (!dropTarget) orderedKeys.push(key);
      } else {
        orderedKeys.push(key);
      }
    });
    let nextMap = blockMap.clear();
    for (const k of orderedKeys) {
      const b = k === tk && rewritten ? rewritten : blockMap.get(k);
      if (b) nextMap = nextMap.set(k, b);
    }
    const SelStatic = es.getSelection().constructor as unknown as DraftSelectionStatic;
    const ESStatic = es.constructor as unknown as DraftEditorStateStatic;
    const sel = SelStatic.createEmpty(orderedKeys[orderedKeys.length - 1] ?? mediaKey);
    const nc = content.set('blockMap', nextMap).set('selectionBefore', sel).set('selectionAfter', sel);
    let ns = ESStatic.push(es, nc, 'move-block');
    ns = ESStatic.forceSelection(ns, sel);
    if (!commitEditorState(node, ns)) return false; // 闸门拦截(已切文章):未改正文
    await settle('late-relocate', node, (c) => {
      const bm = c.getBlockMap();
      if (!bm.has(mediaKey)) return false;
      return dropTarget ? !bm.has(tk) : bm.get(tk)?.getText() === remainder;
    });
    return true;
  };

  /**
   * 单次追回尝试:读最新 state,至多追回**一张**,返回是否发生了认领(调用方据此重钉光标/再试)。
   * 只做**精确**追回:登记了 pendingKey 且该块仍在、已拿到 mediaId → 还给该图。无 pendingKey 或
   * 其块已消失的超时图不追回——没有归属证据,猜即可能两图对调且全报成功(B2:末轮 FIFO 已删除),
   * 交收尾的孤儿审计与 media-order-uncertain 提示如实上报。
   * 认领即出队——即使归位失败(原文找不到)也不再重试,留给收尾的 orphan-media 审计如实上报。
   * 被认领的 pendingKey 块在超时那刻已存在,天然在后续图的 before 快照内,不会被本图当成新块。
   */
  const recoverLateOnce = async (): Promise<boolean> => {
    if (!pendingLate.length || writeBlocked()) return false;
    const node = findDraftStateNode();
    if (!node) return false;
    const content = readEditorState(node).getCurrentContent();
    const bm = content.getBlockMap();
    let pick: { entry: LateEntry; mediaKey: string } | null = null;
    for (const entry of pendingLate) {
      const pk = entry.pendingKey;
      if (!pk) continue;
      const b = bm.get(pk);
      if (b && mediaBlockState(content, b) === 'ready') {
        pick = { entry, mediaKey: pk };
        break;
      }
    }
    if (!pick) return false;
    const { entry, mediaKey } = pick;
    pendingLate = pendingLate.filter((e) => e !== entry);
    if (await relocateLateMedia(node, entry, mediaKey)) {
      lateRecovered.push({ imageIndex: entry.imageIndex, mediaKey });
      if (import.meta.env.DEV) console.info('[MarkFlow] 晚到图片已追回归位', { imageIndex: entry.imageIndex, mediaKey });
    } else {
      console.warn('[MarkFlow] 晚到图片认领但原文位置已找不到,留待孤儿审计', { imageIndex: entry.imageIndex });
    }
    return true;
  };

  /**
   * 轮询等待「快照外新增的 MEDIA atomic 块」。
   * - 出现 mediaId → confirmed:true(上传确认完成);
   * - 只有 entity、无 mediaId(pending)→ 按 §3.2「数据签名稳定性」判定:签名 5s 不变 + 出现 ≥20s,
   *   或出现满 32s 封顶 → confirmed:true(正文图放行);未达标而 budget 到点 → confirmed:false(未确认);
   * - 全程未出现新 MEDIA 块 → null。
   * 返回 confirmed 交由调用方决定成功/降级——**「有块但未确认」绝不谎报成功**。
   * B2:每轮先给此前超时图按 pendingKey 精确追回晚到 MEDIA(recoverLateOnce,只认登记过的 key,
   * 不猜归属);追回会改 selection,随后把光标重钉回本图 marker 再继续等本图——budget 不延长
   * (通道超时预算不放大)。
   * A11:每轮先查写入闸门,切文章即刻返回 MEDIA_WAIT_SWITCHED(不再空等满 budget,也不再归位)。
   */
  const waitForNewMedia = async (
    before: Set<string>,
    budgetMs: number,
    marker: string,
  ): Promise<{ key: string; confirmed: boolean; via?: ReleaseVia } | null | typeof MEDIA_WAIT_SWITCHED> => {
    const deadline = Date.now() + budgetMs;
    // 当前 pending 块的跟踪:firstSeen=首次出现时刻;signature/signatureSince=最近签名及其保持起始时刻。
    let pending: { key: string; firstSeen: number; signature: string; signatureSince: number } | null = null;
    while (Date.now() < deadline) {
      await delay(350);
      if (writeBlocked()) return MEDIA_WAIT_SWITCHED;
      if (pendingLate.length && (await recoverLateOnce())) {
        if (writeBlocked()) return MEDIA_WAIT_SWITCHED;
        const n = findDraftStateNode();
        if (n) await placeSelectionAtMarker(n, marker);
        continue;
      }
      const node = findDraftStateNode();
      if (!node) continue;
      const content = readEditorState(node).getCurrentContent();
      let readyKey: string | null = null;
      let pendingKey: string | null = null;
      let pendingData: unknown = null;
      content.getBlockMap().forEach((block, key) => {
        if (readyKey) return;
        if (block.getType() !== 'atomic' || before.has(key)) return;
        const ek = block.getEntityAt(0);
        if (!ek) return;
        try {
          const ent = content.getEntity(ek);
          if (ent.getType() !== 'MEDIA') return;
          const data = ent.getData();
          if (extractMediaId(data) !== null) {
            readyKey = key;
          } else if (!pendingKey) {
            pendingKey = key;
            pendingData = data;
          }
        } catch {
          /* ignore */
        }
      });
      if (readyKey) return { key: readyKey, confirmed: true, via: 'ready' };

      if (pendingKey) {
        const now = Date.now();
        const sig = mediaEntityDataSignature(pendingData);
        if (!pending || pending.key !== pendingKey) {
          pending = { key: pendingKey, firstSeen: now, signature: sig, signatureSince: now };
        } else if (pending.signature !== sig) {
          pending.signature = sig;
          pending.signatureSince = now; // 签名变动:重置稳定计时
        }
        const stableFor = now - pending.signatureSince;
        const age = now - pending.firstSeen;
        const stableOk = stableFor >= PENDING_STABLE_MS && age >= PENDING_MIN_AGE_MS;
        if (stableOk || age >= PENDING_CAP_MS) {
          return { key: pending.key, confirmed: true, via: stableOk ? 'pending-stable' : 'pending-cap' };
        }
      } else {
        pending = null; // pending 块消失(可能被 X 换成带 mediaId 的块,下轮会命中 readyKey)
      }
    }
    // budget 到点仍未确认:有 pending 块则如实标 confirmed:false(交调用方降级),无块则 null。
    return pending ? { key: pending.key, confirmed: false } : null;
  };

  /**
   * 重排 blockMap:删除 marker 块,把 MEDIA 块移到 marker 原位置。
   * 提交后 settle 等「MEDIA 块仍在位 且 marker 已清」落盘(B1),再让下一张图读 state。
   * 返回 true 表示已提交重排(settle 超时也算已提交,不回滚、只记账)。
   * 构造与提交在同步内核 relocateMediaToMarkerOnce 里(导入后守护每轮同步换闸门,只能同步写)。
   */
  const relocateMediaToMarker = async (node: FiberStateNode, marker: string, mediaKey: string): Promise<boolean> => {
    if (!relocateMediaToMarkerOnce(node, marker, mediaKey)) return false;
    await settle(
      'relocate-media',
      node,
      (c) => c.getBlockMap().has(mediaKey) && findMarkerBlock(c, marker) === null,
    );
    return true;
  };

  /**
   * relocateMediaToMarker 的同步内核:读 state → 按 xposter 蓝本原样构造 blockMap 重排(不做等价简化)
   * → commitEditorState,返回是否已提交。不等落盘——异步调用方须自行 settle。
   * keepSelection(导入后守护用,口径同 sweepMarkersOnce / replaceMarkerWithTextOnce):用户光标的
   * anchor / focus 都不在被删的 marker 块里时原样保留选区、不 forceSelection,不把光标拽到文末;
   * 光标恰在被删的 marker 块里(或页面 SelectionState 缺 getter 无法判定)时,把光标落在被归位的 MEDIA
   * 块的下一块(没有下一块则落在 MEDIA 块本身)——守护期用户可能正在编辑,落到文末等于把光标拽走。
   * 不带 keepSelection(导入内)保持蓝本原选区行为(落在最后一块)。
   */
  const relocateMediaToMarkerOnce = (
    node: FiberStateNode,
    marker: string,
    mediaKey: string,
    opts?: { keepSelection?: boolean },
  ): boolean => {
    const es = readEditorState(node);
    const content = es.getCurrentContent();
    const blockMap = content.getBlockMap();
    const loc = findMarkerBlock(content, marker);
    if (!loc || !blockMap.has(mediaKey) || loc.blockKey === mediaKey) return false;

    // 目标顺序:原顺序遍历,marker 处放 MEDIA 块、丢弃 marker 块;MEDIA 原位置删除。
    const orderedKeys: string[] = [];
    blockMap.forEach((_b, key) => {
      if (key === mediaKey) return;
      if (key === loc.blockKey) orderedKeys.push(mediaKey);
      else orderedKeys.push(key);
    });

    let nextMap = blockMap.clear();
    for (const k of orderedKeys) {
      const b = blockMap.get(k);
      if (b) nextMap = nextMap.set(k, b);
    }

    const SelStatic = es.getSelection().constructor as unknown as DraftSelectionStatic;
    const ESStatic = es.constructor as unknown as DraftEditorStateStatic;
    const lastKey = orderedKeys[orderedKeys.length - 1] ?? mediaKey;
    const cur = es.getSelection();
    const keepCur =
      !!opts?.keepSelection &&
      typeof cur.getAnchorKey === 'function' &&
      typeof cur.getFocusKey === 'function' &&
      cur.getAnchorKey() !== loc.blockKey &&
      cur.getFocusKey() !== loc.blockKey;
    const mediaAt = orderedKeys.indexOf(mediaKey);
    const fallbackKey = opts?.keepSelection ? (orderedKeys[mediaAt + 1] ?? mediaKey) : lastKey;
    const sel = keepCur ? cur : SelStatic.createEmpty(fallbackKey);
    const nc = content.set('blockMap', nextMap).set('selectionBefore', sel).set('selectionAfter', sel);
    let ns = ESStatic.push(es, nc, 'move-block');
    if (!keepCur) ns = ESStatic.forceSelection(ns, sel);
    // 闸门拦截(已切文章)返回 false;调用方须再查 writeBlocked(),不得走 fallbackIndex 当成功。
    return commitEditorState(node, ns);
  };

  /**
   * §3.3 fallbackIndex 兜底配对:relocateMediaToMarker 归位失败(通常 marker 块已被 X 消费/找不到,
   * 无法精确顶替其位置)时的降级——只要目标 MEDIA 块确实存在于正文(X 已按我们钉的光标位置插入),
   * 即视为「已配对成功」:媒体已在文中,精确位置退让,残留 marker 交 sweepMarkers 收尾。
   * 仅当 MEDIA 块本身也不在 blockMap(真丢失)时才返回 false → 交调用方计 imageFail + 写回 fallbackText。
   */
  const relocateMediaByFallbackIndex = (node: FiberStateNode, mediaKey: string): boolean =>
    readEditorState(node).getCurrentContent().getBlockMap().has(mediaKey);

  /**
   * 把 marker 块整体替换为一段普通文本(上传失败时写回 fallbackText 原文,不静默丢内容)。
   * 提交后 settle 等「该 marker 已不在任何块中」落盘(B1)——否则下一张图的读-改-写会基于
   * 陈旧 state 把这次写回整体回滚,marker 重现后被 sweepMarkers 整块删掉(原文静默丢失)。
   * 返回写回所在块的 key(块 merge 保 key)——B2 晚到追回据此定位该段原文;未写回返回 null。
   * 构造与提交在同步内核 replaceMarkerWithTextOnce 里(导入后守护每轮同步换闸门,只能同步写)。
   */
  const replaceMarkerWithText = async (node: FiberStateNode, marker: string, text: string): Promise<string | null> => {
    const key = replaceMarkerWithTextOnce(node, marker, text);
    if (key === null) return null;
    await settle('replace-marker', node, (c) => findMarkerBlock(c, marker) === null);
    return key;
  };

  /**
   * replaceMarkerWithText 的同步内核:读 state → 构造 → commitEditorState,返回写回所在块 key 或 null
   * (marker 不在 / 取不到样本 / 被闸门拦截)。不等落盘——异步调用方须自行 settle。
   * keepSelection(导入后守护用,口径同 sweepMarkersOnce):用户光标不在被改写的块里就原样保留,
   * 不把光标拽到占位处;否则(或页面 SelectionState 缺 getter 无法判定)退回原行为。
   */
  const replaceMarkerWithTextOnce = (
    node: FiberStateNode,
    marker: string,
    text: string,
    opts?: { keepSelection?: boolean },
  ): string | null => {
    const es = readEditorState(node);
    const content = es.getCurrentContent();
    const blockMap = content.getBlockMap();
    const loc = findMarkerBlock(content, marker);
    if (!loc) return null;
    const block = blockMap.get(loc.blockKey);
    if (!block) return null;
    const sample = findCharacterSample(blockMap);
    if (!sample) return null;
    const nextText = loc.exact ? text : block.getText().split(marker).join(text);
    let characterList = block.getCharacterList().clear();
    const plain = sample.set('style', sample.getStyle().clear()).set('entity', null);
    for (let i = 0; i < nextText.length; i += 1) characterList = characterList.push(plain);
    const nextBlock = block.merge({ type: 'unstyled', text: nextText, characterList });
    const nextMap = blockMap.set(loc.blockKey, nextBlock);
    const SelStatic = es.getSelection().constructor as unknown as DraftSelectionStatic;
    const ESStatic = es.constructor as unknown as DraftEditorStateStatic;
    const cur = es.getSelection();
    const keepCur =
      !!opts?.keepSelection &&
      typeof cur.getAnchorKey === 'function' &&
      typeof cur.getFocusKey === 'function' &&
      cur.getAnchorKey() !== loc.blockKey &&
      cur.getFocusKey() !== loc.blockKey;
    const sel = keepCur ? cur : SelStatic.createEmpty(loc.blockKey);
    const nc = content.set('blockMap', nextMap).set('selectionBefore', sel).set('selectionAfter', sel);
    let ns = ESStatic.push(es, nc, 'change-block-data');
    if (!keepCur) ns = ESStatic.forceSelection(ns, sel);
    if (!commitEditorState(node, ns)) return null; // 闸门拦截(已切文章):未写回
    return loc.blockKey;
  };

  /**
   * 兜底清扫:把任何残留的 __MARKFLOW_IMG_ marker 块清空删除,防中断后正文留脏占位符。
   * **多轮重试 + 连续两轮确认**:X 的 onChange 是异步 commit,单次读 fiber state 可能读到
   * 中间态、漏掉刚移动的 marker 块。旧实现「某轮没读到残留就收工」——一次陈旧的"干净"读取
   * 会直接终止清扫,残留静默留在正文(真机回归批次三 T6 复现:fallbackIndex 路径的 marker
   * 躲过全部 4 轮)。现在必须**连续两轮**读到干净(两轮间留 X commit 时间)才确认收工;
   * 读不到状态节点不再当"干净"。返回「结束时是否确认无残留」,false 交调用方审计上报。
   */
  /**
   * 完整 marker 形状:`__MARKFLOW_IMG_{6位随机[0-9a-z]}_{序号}__`(见 runImport 的 markerPrefix)。
   * 清扫只认**完整形状**——用户正文恰好写了 `__MARKFLOW_IMG_` 字面量(如介绍本扩展的文章)
   * 不匹配完整形状,一律不动(B2-3:此前含前缀即整块删除,连带删掉用户内容)。
   */
  const MARKER_FULL_RE = /__MARKFLOW_IMG_[0-9a-z]+_\d+__/g;

  const sweepMarkers = async (
    prefix: string,
    onSwept?: (markerText: string) => void,
    // 透传给 sweepMarkersOnce:命中的完整 marker 不剥、不计入「未清干净」(交逐图核对处理)。
    protect?: (markerText: string) => boolean,
  ): Promise<boolean> => {
    let cleanStreak = 0;
    for (let round = 0; round < 6; round += 1) {
      await delay(round === 0 ? 120 : 220); // 首轮短等,后续留足 X commit 时间
      // A11:每轮先查写入闸门——切文章即停,返回「未确认干净」(调用方另行判定已切换)。
      if (writeBlocked()) return false;
      const r = sweepMarkersOnce(prefix, onSwept, { protect });
      if (r === 'clean') {
        cleanStreak += 1;
        if (cleanStreak >= 2) return true; // 连续两轮确认干净 → 收工
      } else {
        cleanStreak = 0; // 本轮扫掉了残留 / 读不到节点 → 重新累计确认
        // B1:本轮删了块就等它真正落盘再进下一轮——否则下一轮读到的陈旧 state 里 marker
        // "还在",会对同一批块再提交一次删除(基于旧 map 的二次 onChange 可能回滚中间的变更)。
        // 超时不中断:连续两轮干净的退出条件(HANDOFF §8)原样保留在上面。
        if (r === 'swept') await settle('sweep-markers', null, (c) => !hasFullMarker(c, prefix, protect));
      }
    }
    return false;
  };

  /**
   * 任一非 atomic 块是否仍含**完整形状**、且未被 protect 保护的 marker(settle 判定用,与
   * sweepMarkersOnce 口径一致——受保护的 marker 本就不剥,不能让 settle 一直等它消失)。
   */
  const hasFullMarker = (
    content: DraftContentState,
    prefix: string,
    protect?: (markerText: string) => boolean,
  ): boolean => {
    let found = false;
    content.getBlockMap().forEach((block) => {
      if (found || block.getType() === 'atomic') return;
      const text = block.getText();
      if (!text.includes(prefix)) return;
      MARKER_FULL_RE.lastIndex = 0;
      const matches = text.match(MARKER_FULL_RE);
      if (matches && matches.some((m) => !protect?.(m))) found = true;
    });
    MARKER_FULL_RE.lastIndex = 0;
    return found;
  };

  /**
   * 单轮清扫(B2-3 改造:剥 marker 保文本,单事务提交):读最新 state,对含 prefix 的
   * 非 atomic 块剥掉**完整形状**的 marker 串——剥后仍有内容(用户在占位行内打过字)则改写
   * 块文本保留之,剥后为空才删块;完全不含完整 marker 的块(用户正文含前缀字面量)不动。
   * 所有改写/删除合并进**一次** blockMap 变更、一次 onChange——逐块各自读写会在同 tick 内
   * 互相覆盖(每次都读到尚未 commit 的旧 state,只有最后一次生效)。
   * 'clean'=读到最新 state 且无残留;'swept'=发现并处理了残留;'no-node'=读不到状态节点
   * (不可当"干净"——那只是没读到,不是没有)。
   * onSwept:每处理一个完整 marker 回调一次(供主路径把被清扫的图片索引记入失败明细)。
   * protect:返回 true 的完整 marker 跳过(不剥、不计 swept)——X 偶发用旧快照覆盖正文,图被回退
   * 丢失时占位是它唯一的位置锚点,盲删即静默丢图;这类占位交逐图核对(补传 / 写回原文)处理。
   */
  const sweepMarkersOnce = (
    prefix: string,
    onSwept?: (markerText: string) => void,
    opts?: { keepSelection?: boolean; protect?: (markerText: string) => boolean },
  ): 'clean' | 'swept' | 'no-node' => {
    const node = findDraftStateNode();
    if (!node) return 'no-node';
    const es = readEditorState(node);
    const content = es.getCurrentContent();
    const blockMap = content.getBlockMap();
    const toDelete: string[] = [];
    const toRewrite: Array<[string, string]> = []; // [blockKey, strippedText]
    const sweptMarkers: string[] = [];
    blockMap.forEach((block, key) => {
      if (block.getType() === 'atomic') return;
      const text = block.getText();
      if (!text.includes(prefix)) return;
      MARKER_FULL_RE.lastIndex = 0;
      const matches = text.match(MARKER_FULL_RE);
      if (!matches) return; // 只含前缀字面量、无完整 marker → 用户内容,不动
      const toStrip = matches.filter((m) => !opts?.protect?.(m));
      if (!toStrip.length) return; // 全部受保护 → 本块不动
      sweptMarkers.push(...toStrip);
      MARKER_FULL_RE.lastIndex = 0;
      const stripped = text.replace(MARKER_FULL_RE, (m) => (toStrip.includes(m) ? '' : m));
      if (stripped.trim().length === 0) toDelete.push(key);
      else toRewrite.push([key, stripped]);
    });
    if (!toDelete.length && !toRewrite.length) return 'clean';
    // 改写块需要样本字符重建 characterList;取不到样本时退回删块(与既有降级一致)。
    const sample = findCharacterSample(blockMap);
    if (!sample && toRewrite.length) {
      for (const [key] of toRewrite) toDelete.push(key);
      toRewrite.length = 0;
    }
    let nextMap = blockMap;
    for (const [key, textAfter] of toRewrite) {
      const block = blockMap.get(key);
      if (!block) continue;
      const plain = sample!.set('style', sample!.getStyle().clear()).set('entity', null);
      let characterList = block.getCharacterList().clear();
      for (let i = 0; i < textAfter.length; i += 1) characterList = characterList.push(plain);
      nextMap = nextMap.set(key, block.merge({ type: 'unstyled', text: textAfter, characterList }));
    }
    // Draft 不接受空 blockMap:若待删覆盖全部剩余块(改写块计入幸存者),
    // 保留第一个待删块、把它清空为普通空段落,只删其余——避免空 map + 指向已删块的 selection 崩。
    let survivorCount = toRewrite.length;
    blockMap.forEach((_b, key) => {
      if (!toDelete.includes(key) && !toRewrite.some(([k]) => k === key)) survivorCount += 1;
    });
    let delKeys = toDelete;
    if (survivorCount === 0 && toDelete.length) {
      const keepKey = toDelete[0]!;
      delKeys = toDelete.slice(1);
      const keepBlock = blockMap.get(keepKey);
      if (keepBlock) {
        nextMap = nextMap.set(
          keepKey,
          keepBlock.merge({ type: 'unstyled', text: '', characterList: keepBlock.getCharacterList().clear() }),
        );
      }
    }
    for (const k of delKeys) nextMap = nextMap.delete(k);
    const last = nextMap.last();
    const SelStatic = es.getSelection().constructor as unknown as DraftSelectionStatic;
    const ESStatic = es.constructor as unknown as DraftEditorStateStatic;
    // keepSelection(导入后守护用):导入已结束、用户可能正在编辑,只要其光标不在被删 / 改写的块里
    // 就原样保留,不把光标拽到文末;否则(或页面 SelectionState 缺 getter 无法判定)退回原行为。
    const cur = es.getSelection();
    const touched = new Set<string>([...toDelete, ...toRewrite.map(([k]) => k)]);
    const keepCur =
      !!opts?.keepSelection &&
      typeof cur.getAnchorKey === 'function' &&
      typeof cur.getFocusKey === 'function' &&
      !touched.has(cur.getAnchorKey()) &&
      !touched.has(cur.getFocusKey());
    // nextMap 此时保证非空(survivorCount===0 时已保留 keepKey),last() 必有值。
    const sel = keepCur ? cur : SelStatic.createEmpty((last ?? blockMap.first()).getKey());
    const nc = content.set('blockMap', nextMap).set('selectionBefore', sel).set('selectionAfter', sel);
    let ns = ESStatic.push(es, nc, 'remove-range');
    if (!keepCur) ns = ESStatic.forceSelection(ns, sel);
    // 闸门拦截(已切文章):未提交,按「读不到」处理(不可当干净);外层下一轮查闸门即退出。
    if (!commitEditorState(node, ns)) return 'no-node';
    if (onSwept) for (const m of sweptMarkers) onSwept(m);
    return 'swept'; // 本轮处理了残留 → 交外层再验(须此后连续两轮 clean 才算收工)
  };

  // -------------------------------------------------------------------------
  // 导入后守护(真机复现 2026-11-13):runImport 收尾的清扫 + 审计都读到「干净」并报成功后,
  // 正文里仍可能**重新出现**本次的 marker——有提交基于「X 插入该图 MEDIA 那一刻」的旧
  // editorState 落盘(只读探针实证:lastChangeType=change-block-data、撤销栈里我们那次归位
  // 整个消失、marker 块紧挨在已带 mediaId 的 MEDIA 块之前),把我们的归位覆盖了。触发者
  // 疑为 X 上传完成时的晚提交,或用户点击编辑器时 Draft 用未刷新的内部缓存处理聚焦。
  // 守护在导入返回后继续观察 MARKER_GUARD_MS:本次前缀的完整 marker 一出现就剥掉,并带
  // 放行方式 + 交互时间线打 warn 供诊断。覆盖可能反复发生,故不是删一次就走而是守到截止。
  // 2026-11-13 追加取证:回退的快照也可能停在「某图插入之前」——图丢失、占位重现;此时再删占位就连
  // 位置锚点都没了(静默丢图)。故守护改为逐图核对(guardReconcileOnce):图在才删占位,图不在则把占位
  // 换回该图原文并告警;守护阶段不补传(结果已返回,补传结论无处上报)。
  // -------------------------------------------------------------------------

  const MARKER_GUARD_MS = 60_000;
  const MARKER_GUARD_INTERVAL_MS = 1_000;
  /** 守护里同一张图写回原文累计失败的上限(写回成功才清零;达到后不再优先尝试,见 guardReconcileOnce)。 */
  const GUARD_RESTORE_MAX_FAILURES = 3;
  /** 当前守护的停止函数(新一次导入开始时先停掉旧守护)。 */
  let stopMarkerGuard: (() => void) | null = null;

  /** 导入期间编辑器上的用户交互时间线(诊断用:只记事件类型与相对时刻,不记按键内容)。 */
  type InteractionLog = { events: string[]; detach: () => void };

  const startInteractionLog = (): InteractionLog => {
    const startedAt = Date.now();
    const events: string[] = [];
    // 在 runImport 的 try 之外调用:定位抛错(B5:X 改版 DOM 形状变化)只放弃诊断,
    // 绝不能让异常逃出、使 importInFlight 卡死。
    let editor: HTMLElement | null = null;
    try {
      editor = findEditorElement();
    } catch {
      editor = null;
    }
    if (!editor) return { events, detach: () => {} };
    const record = (e: Event): void => {
      if (events.length < 60) events.push(`+${Date.now() - startedAt}ms ${e.type}`);
    };
    const types = ['pointerdown', 'focusin', 'focusout', 'keydown'];
    for (const type of types) editor.addEventListener(type, record, { capture: true, passive: true });
    return {
      events,
      detach: () => {
        for (const type of types) editor.removeEventListener(type, record, { capture: true });
      },
    };
  };

  /**
   * 正文结构摘要(诊断用):图片 / 特殊块与 marker 各在第几块,只记序号、类型与 marker 串,
   * 不含正文内容。形如 `blocks=49 atomic=[5:MARKDOWN,26:MEDIA] markers=[35:__MARKFLOW_IMG_x_1__]`。
   */
  const summarizeContent = (content: DraftContentState): string => {
    const atomic: string[] = [];
    const markers: string[] = [];
    let i = 0;
    content.getBlockMap().forEach((block) => {
      if (block.getType() === 'atomic') {
        const ek = block.getEntityAt(0);
        let type = '?';
        try {
          if (ek) type = content.getEntity(ek).getType();
        } catch {
          /* entity 读取失败按未知 */
        }
        atomic.push(`${i}:${type}`);
      } else {
        MARKER_FULL_RE.lastIndex = 0;
        const m = block.getText().match(MARKER_FULL_RE);
        if (m) markers.push(`${i}:${m.join('+')}`);
      }
      i += 1;
    });
    MARKER_FULL_RE.lastIndex = 0;
    return `blocks=${i} atomic=[${atomic.join(',')}] markers=[${markers.join(',')}]`;
  };

  /**
   * 编辑器现场诊断(守护告警 / 撤销诊断共用):当前 lastChangeType、撤销栈长度、距最近一次正文
   * 保存完成多少 ms(无则 null)——用于判断回退是否紧跟保存响应(保存回写嫌疑)还是与保存无关
   * (上传管线陈旧闭包嫌疑)。纯只读,读失败的字段记 null。
   */
  const editorDiag = (
    es: DraftEditorState | null,
    tracker: SaveTracker | null,
  ): { lastChangeType: string | null; undoDepth: number | null; msSinceSave: number | null } => {
    let lastChangeType: string | null = null;
    let undoDepth: number | null = null;
    try {
      lastChangeType = es?.getLastChangeType?.() ?? null;
      const stack = es?.getUndoStack?.();
      undoDepth = typeof stack?.size === 'number' ? stack.size : (stack?.toArray?.()?.length ?? null);
    } catch {
      /* 诊断读取失败按 null */
    }
    return { lastChangeType, undoDepth, msSinceSave: tracker ? tracker.msSinceLastSave(performance.now()) : null };
  };

  /**
   * 撤销诊断(真机 2026-11-13:一次 Cmd+Z 跳回「第 2 张图归位之前」——图回文末、`_1` 重现、
   * 用户刚输入的内容消失,按 Draft 每步一条撤销记录的规则本应只退一步;现场已失,未能取证)。
   * 守护检测到撤销 / 重做而让位时,打出当前与撤销 / 重做栈顶的结构摘要,下次复现即可据此判断
   * 撤销到底退到了哪个状态、栈里缺了哪一步。纯只读,任何异常都吞掉,不影响守护停止。
   */
  const logUndoDiagnostic = (
    es: DraftEditorState,
    lastChange: string,
    afterMs: number,
    releases: string[],
    tracker: SaveTracker | null,
  ): void => {
    try {
      const top = (stack: DraftStack | undefined): string[] =>
        (stack?.toArray?.() ?? []).slice(0, 3).map(summarizeContent);
      const diag = editorDiag(es, tracker);
      console.info('[MarkFlow] 检测到撤销 / 重做,导入后守护停止(撤销诊断)', {
        lastChange,
        afterMs,
        releases,
        undoDepth: diag.undoDepth,
        msSinceSave: diag.msSinceSave,
        current: summarizeContent(es.getCurrentContent()),
        undoTop3: top(es.getUndoStack?.()),
        redoTop3: top(es.getRedoStack?.()),
      });
    } catch (err) {
      console.warn('[MarkFlow] 撤销诊断读取失败', err);
    }
  };

  /**
   * 启动导入后守护。每 MARKER_GUARD_INTERVAL_MS 读一次最新 state,只认**本次** markerPrefix 的完整
   * marker(用户正文 / 其他导入的不动),逐图核对(guardReconcileOnce):图在才剥占位(方式同
   * sweepMarkersOnce:单事务、保留同块用户文字、不拽用户光标),图不在则写回原文。切文章 / 新导入开始 /
   * 到期即停,停时摘掉交互监听并断开正文保存观察。
   * 写入闸门:runImport 的 finally 已把 writeBlocked 复位为「一律禁止」;守护每轮**同步**地临时换成
   * 本次的切文章判定、核对完立即复位——全程同步,不会与下一次 runImport 交错(其入口先停守护,
   * 且本函数每轮先查 importInFlight)。
   */
  const startMarkerGuard = (
    markerPrefix: string,
    isSwitched: () => boolean,
    log: InteractionLog,
    releases: string[],
    guard: { tracks: ImageTrack[]; baselineMedia: Set<string> | null; saves: SaveWatch },
  ): void => {
    stopMarkerGuard?.();
    const endedAt = Date.now();
    const deadline = endedAt + MARKER_GUARD_MS;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const stop = (): void => {
      if (stopped) return;
      stopped = true;
      if (timer) clearTimeout(timer);
      log.detach();
      guard.saves.disconnect();
      if (stopMarkerGuard === stop) stopMarkerGuard = null;
    };
    const tick = (): void => {
      timer = null;
      if (stopped) return;
      // 整轮包 try:定位 / 读 state / 诊断任一处抛错(X 改版等)都会让守护静默死掉、交互监听与保存观察
      // 泄漏到下次导入——异常即告警并 stop()。换闸门的内层 try/finally 原样保留(同步复位)。
      try {
        if (importInFlight || isSwitched() || Date.now() >= deadline) {
          stop();
          return;
        }
        // 用户在撤销 / 重做:让位并停止守护。否则守护清掉 marker 的那步压在撤销栈顶,用户每按一次
        // Cmd+Z 都会还原出 marker、守护又删掉并再压一条,60s 内永远撤销不过这一步。
        const probeNode = findDraftStateNode();
        const probeState = probeNode ? readEditorState(probeNode) : null;
        const lastChange = probeState?.getLastChangeType?.() ?? null;
        if (lastChange === 'undo' || lastChange === 'redo') {
          logUndoDiagnostic(probeState!, lastChange, Date.now() - endedAt, releases, guard.saves.tracker);
          stop();
          return;
        }
        // 诊断取写入之前的现场(回退刚发生时的 lastChangeType / 撤销栈深度 / 距上次保存)。
        const diag = editorDiag(probeState, guard.saves.tracker);
        let outcome: GuardOutcome = {
          swept: [],
          restored: [],
          restoreFailed: [],
          lost: [],
          ambiguous: [],
          relocated: [],
          unfixed: [],
        };
        writeBlocked = isSwitched;
        try {
          outcome = guardReconcileOnce(markerPrefix, guard.tracks, guard.baselineMedia);
        } catch (err) {
          console.warn('[MarkFlow] 导入后守护核对异常', err);
        } finally {
          writeBlocked = () => true;
        }
        const afterMs = Date.now() - endedAt;
        if (outcome.swept.length) {
          console.warn('[MarkFlow] 导入结束后图片占位符重新出现,已自动清除', {
            afterMs,
            markers: outcome.swept,
            releases,
            interactions: [...log.events],
            ...diag,
          });
        }
        for (const image of outcome.relocated) {
          console.warn('[MarkFlow] 导入结束后图片被编辑器回退到旧位置,已重新归位到占位处', {
            afterMs,
            image,
            releases,
            interactions: [...log.events],
            ...diag,
          });
        }
        for (const image of outcome.restoreFailed) {
          console.warn('[MarkFlow] 导入结束后图片占位符需换回原文,但写回失败,占位符仍在,请在正文核对', {
            afterMs,
            image,
            releases,
            ...diag,
          });
        }
        for (const image of outcome.unfixed) {
          console.warn('[MarkFlow] 导入结束后图片占位符重新出现,已删除占位符,但图片位置未能校正(占位行有其他文字或归位失败),请核对', {
            afterMs,
            image,
            releases,
            ...diag,
          });
        }
        for (const r of outcome.restored) {
          console.warn(
            r.wasPlaced
              ? '[MarkFlow] 导入结束后图片被编辑器回退丢失,已把占位符换回原文,请在正文核对并手动补图'
              : '[MarkFlow] 导入结束后失败图片的原文被编辑器回退成占位符,已重新写回原文',
            { afterMs, image: r.image, releases, interactions: [...log.events], ...diag },
          );
        }
        for (const image of outcome.lost) {
          console.warn('[MarkFlow] 导入结束后图片被编辑器回退丢失(占位符也已不在),请在正文核对并手动补图', {
            afterMs,
            image,
            releases,
            interactions: [...log.events],
            ...diag,
          });
        }
        for (const image of outcome.ambiguous) {
          console.warn('[MarkFlow] 导入结束后图片块已认不出(占位符也已不在),正文有多张来历不明的新图,无法确认是否丢失,请核对', {
            afterMs,
            image,
            releases,
            ...diag,
          });
        }
      } catch (err) {
        console.warn('[MarkFlow] 导入后守护异常,已停止', err);
        stop();
        return;
      }
      timer = setTimeout(tick, MARKER_GUARD_INTERVAL_MS);
    };
    stopMarkerGuard = stop;
    timer = setTimeout(tick, MARKER_GUARD_INTERVAL_MS);
  };

  /** uploadOneImage 的结果:失败时带原因码(在知道原因的这一层产生,调用方只透传进失败明细)。 */
  type UploadOutcome =
    // mediaKey / mediaId:归位后的 MEDIA 块 key 与其 mediaId(放行时尚无则 null)——收尾核对与导入后
    // 守护据此判定这张图是否被编辑器回退丢失(块 key 在回退到旧快照时不变,是主身份)。
    | { ok: true; via: ReleaseVia; mediaKey: string; mediaId: string | null }
    // A11:中途切文章——runImport 须立即返回 ARTICLE_SWITCHED_ERROR,不写回原文、不记失败明细。
    | { ok: false; switched: true }
    // pendingKey:仅 upload-timeout 且超时时已有未确认 MEDIA 块时带上(B2 晚到追回按 key 精确等它)。
    | { ok: false; reason: ImageFailReason; detail?: string; pendingKey?: string };

  /**
   * 上传单张图:钉光标到 marker → 找 onFilesAdded → 交 File → 轮询新 MEDIA → 归位 + 清 marker。
   * 失败按路径回具体原因码——此前只回 boolean,8 条互异失败路径在调用点被统一猜成「超时」,
   * 失败明细的诊断价值在最复杂的 upload 阶段归零(review 批次三)。失败均由调用方写回 fallbackText。
   */
  const uploadOneImage = async (marker: string, file: File, budgetMs: number): Promise<UploadOutcome> => {
    // A11:各写入点前后都查写入闸门,切文章即返回 switched(区别于普通失败,调用方不写回原文)。
    if (writeBlocked()) return { ok: false, switched: true };
    let node = findDraftStateNode();
    if (!node) return { ok: false, reason: 'upload-no-editor' };
    // placeSelectionAtMarker 内部已 settle 等 selection 落盘(B1);这 80ms 留给 DOM selection 同步。
    if (!(await placeSelectionAtMarker(node, marker))) {
      return writeBlocked() ? { ok: false, switched: true } : { ok: false, reason: 'upload-marker-lost' };
    }
    await delay(80);

    node = findDraftStateNode();
    if (!node) return { ok: false, reason: 'upload-no-editor' };
    const onFilesAdded = findOnFilesAdded();
    if (!onFilesAdded) return { ok: false, reason: 'upload-no-callback' };
    const before = snapshotMediaKeys(node);

    // 计数放在闸门复查之前、不插在闸门与调用之间(结构断言要求调用前就近有闸门检查);被拦下时多计
    // 一次无害——已切文章,调用方随即按切换返回,不会再走收尾稳定窗。
    filesAddedCount += 1;
    // onFilesAdded 会让 X 自己往编辑器插 MEDIA 块并提交——切文章后同样会把旧状态存进新文章,同步复查。
    if (writeBlocked()) return { ok: false, switched: true };
    try {
      onFilesAdded([file]);
    } catch (err) {
      console.warn('[MarkFlow] onFilesAdded 调用失败', err);
      return { ok: false, reason: 'upload-exception', detail: String(err) };
    }

    const media = await waitForNewMedia(before, budgetMs, marker);
    if (media === MEDIA_WAIT_SWITCHED) return { ok: false, switched: true };
    // 无新 MEDIA 块,或有块但未确认(无 mediaId 且稳定性未达标)→ 未确认成功,交调用方降级。
    if (!media || !media.confirmed) return { ok: false, reason: 'upload-timeout', pendingKey: media?.key };

    await delay(120);
    if (writeBlocked()) return { ok: false, switched: true };
    node = findDraftStateNode();
    // MEDIA 已确认后的失败一律归「归位失败」:图大概率已进 X 媒体库,只是没落进正文——
    // 与「超时」的排查方向完全不同(不该去查网络/重试,而该看正文结构)。
    if (!node) return { ok: false, reason: 'upload-relocate-failed' };
    // 归位:优先精确顶替 marker 位置;失败则走 §3.3 fallbackIndex 兜底;仍失败(MEDIA 块丢失)才算失败。
    if (await relocateMediaToMarker(node, marker, media.key)) return placedOutcome(media.via ?? 'ready', media.key);
    // 归位被闸门拦截(已切文章)≠ marker 丢失:不得走 fallbackIndex 把「MEDIA 块存在」当成功。
    if (writeBlocked()) return { ok: false, switched: true };
    node = findDraftStateNode();
    if (node && relocateMediaByFallbackIndex(node, media.key)) return placedOutcome('fallback-index', media.key);
    return { ok: false, reason: 'upload-relocate-failed' };
  };

  /** 组装 uploadOneImage 的成功结果:顺带读出该 MEDIA 块当前的 mediaId(读不到为 null)。 */
  const placedOutcome = (via: ReleaseVia, mediaKey: string): UploadOutcome => {
    let mediaId: string | null = null;
    try {
      const node = findDraftStateNode();
      if (node) {
        const content = readEditorState(node).getCurrentContent();
        const block = content.getBlockMap().get(mediaKey);
        if (block) mediaId = mediaIdOfBlock(content, block);
      }
    } catch {
      mediaId = null; // 只为补身份信息,读失败不影响成功结论
    }
    return { ok: true, via, mediaKey, mediaId };
  };

  // -------------------------------------------------------------------------
  // 收尾稳定窗 + 逐图核对(真机取证 2026-11-13):X 偶发在导入收尾后 ≤1s(偶见 49s)把编辑器整体
  // 替换成更早的快照(正文 + 撤销历史一起),触发者在 X 内部、未定(保存响应回写 或 上传管线的
  // 陈旧闭包)。快照若是「某图已插入、尚未归位」→ 图上方残留占位;若是「某图插入之前」→ 图丢失、
  // 占位重现。此前清扫 / 守护见占位就删,丢图时连位置锚点都没了(静默丢图)。现在:
  //  1) 收尾先等 X 的正文保存在最后一次写入之后完成并静默(waitForSaveQuiesce;判定在 saveQuiesce);
  //  2) 再按「这张图该是什么样」逐张核对(决策在 imageReconcile):图在占位在 → 删占位;图不在占位在
  //     → 原位补传(复用 uploadOneImage,不新增上传回调调用点)或写回原文;都不在 → 如实计 image-lost;
  //  3) 清扫与导入后守护不再盲删「图不在」的占位。
  // 只在 xposter 蓝本(钉光标 / 上传回调 / waitForNewMedia 放行参数 / relocateMediaToMarker)外围加核对,
  // 不改其构造方式(不做等价简化)。
  // -------------------------------------------------------------------------

  /** 一张图的核对账本:runImport 建立,收尾核对与导入后守护共用、就地更新。 */
  type ImageTrack = {
    imageIndex: number;
    marker: string;
    fallbackText: string;
    source: string;
    /** 预期终态:placed = 已归位成图;failed = 已写回原文(或应写回原文)。 */
    expected: ImageExpectation;
    /** 归位时的 MEDIA 块 key——主身份:回退到旧快照时块 key 不变。 */
    key: string | null;
    /** 该 MEDIA 的 mediaId——key 不在时的次身份;放行时尚无则 null,核对时见到即补记。 */
    mediaId: string | null;
    /** 是否已补传过(每张最多一次)。 */
    reuploaded: boolean;
    /** 导入后守护是否已就「图与占位都不在」告警过(每张只报一次)。 */
    lostWarned: boolean;
    /** 是否已就「图与占位都不在、但正文有不唯一的来历不明新图」告警过(每张只报一次)。 */
    ambiguousWarned: boolean;
    /** 是否已就「已知 mediaId 但块读不到 mediaId」告警过(每张只报一次)。 */
    pendingIdWarned: boolean;
    /**
     * 残留审计把「已归位却认不回」的图转为 failed、但尚未写回原文时置 true:守护随后写回时据此仍按
     * 「图被回退丢失」告警,而不是「失败图片的原文被回退」(复审 N2)。守护写回后清零。
     */
    lostAwaitingFallback: boolean;
    /** 写回原文所在块 key(replaceMarkerWithText 的返回值;原图回来时据此用图顶替原文行)。 */
    fallbackKey: string | null;
    /** 本次导入里是否经 onLost 计过丢失(终核后复查:原图回来则撤销记账)。 */
    lostCounted: boolean;
    /** 守护写回原文累计失败的次数(写回成功清零;达上限后不再优先尝试,免得饿死其他图的归位)。 */
    restoreFailures: number;
  };

  /** 正文保存观察:PerformanceObserver 只读接线(不 hook fetch / XHR)。 */
  type SaveWatch = { tracker: SaveTracker; disconnect: () => void };

  /**
   * 开始观察正文保存请求(URL 含 ArticleEntityUpdateContent 的资源条目,完成时才会产生)。
   * runImport 入口建立;导入有图且守护接手时交给守护、守护停止时断开,否则 runImport 的 finally 断开。
   * 不支持 / 构造失败时 tracker 一条也记不到,稳定窗自动退化为「距最后写入 ≥3s」。
   */
  const startSaveWatch = (): SaveWatch => {
    const tracker = createSaveTracker();
    let observer: PerformanceObserver | null = null;
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!isContentSaveUrl(entry.name)) continue;
          const timing = entry as PerformanceResourceTiming;
          tracker.record({ startTime: timing.startTime, responseEnd: timing.responseEnd });
        }
      });
      observer.observe({ type: 'resource', buffered: false });
    } catch (err) {
      try {
        observer?.disconnect();
      } catch {
        /* 断开失败忽略 */
      }
      observer = null;
      console.info('[MarkFlow] 正文保存观察不可用,收尾稳定窗退化为按写入时间判定', err);
    }
    return {
      tracker,
      disconnect: () => {
        try {
          observer?.disconnect();
        } catch {
          /* 断开失败忽略 */
        }
        observer = null;
      },
    };
  };

  /**
   * 等收尾保存稳定窗(判定见 saveQuiesce.isQuiet):每 QUIESCE_POLL_MS 轮询,每轮先查写入闸门
   * (A11:切文章即返回 'switched',调用方按 ARTICLE_SWITCHED_ERROR 返回);到上限返回 'cap'
   * (带着现状去核对,此后的回退由导入后守护兜底)。本函数不写编辑器。
   */
  const waitForSaveQuiesce = async (tracker: SaveTracker, capMs: number): Promise<'quiet' | 'cap' | 'switched'> => {
    const startedAt = performance.now();
    for (;;) {
      if (writeBlocked()) return 'switched';
      const now = performance.now();
      if (tracker.isQuiet({ lastWriteAt, now })) return 'quiet';
      if (now - startedAt >= capMs) return 'cap';
      await delay(QUIESCE_POLL_MS);
    }
  };

  /**
   * Draft state → 认图用的简化块列表(判定逻辑在 lib/bridge/mediaIdentity,可单测;这里只做转换)。
   * MEDIA atomic 块按「有无 mediaId」分 ready / pending;其他 atomic 块记 other(不参与占位匹配)。
   */
  const toSimpleBlocks = (content: DraftContentState): SimpleBlock[] => {
    const out: SimpleBlock[] = [];
    content.getBlockMap().forEach((block, key) => {
      const state = mediaBlockState(content, block);
      if (state) {
        const kind = state === 'ready' ? 'media-ready' : 'media-pending';
        out.push({ key, kind, mediaId: mediaIdOfBlock(content, block), text: '' });
      } else if (block.getType() === 'atomic') {
        out.push({ key, kind: 'other', mediaId: null, text: '' });
      } else {
        out.push({ key, kind: 'text', mediaId: null, text: block.getText() });
      }
    });
    return out;
  };

  /**
   * 额外视为「已认领」的 MEDIA 块:待追回超时图的 pendingKey,以及已追回(可能尚未被 runImport
   * 吸收进账本)的晚到图 mediaKey——否则补传途中刚追回的图会被当成「未认领新图」误拦补传或被误认。
   */
  const extraClaimedKeys = (): string[] => [
    ...pendingLate.map((e) => e.pendingKey ?? ''),
    ...lateRecovered.map((r) => r.mediaKey),
  ].filter((k) => k !== '');

  /** observeTrack 的产出:在 ImageSighting 基础上加「图在不在」的布尔量。 */
  type TrackSeen = ImageSighting & { mediaPresent: boolean };

  /**
   * 读一张图在当前正文中的状况(判定见 mediaIdentity.observeImage)。预期已归位的图在正文时就地补记
   * 身份:key 变了以新 key 为准;放行时没有的 mediaId 此时有了就记上,便于之后 key 再变时仍能认出。
   * 账本已知 mediaId、块却仍是 pending 实体时告警一次(诊断:X 是否把已落定的图又换回了上传中状态)。
   */
  const observeTrack = (
    content: DraftContentState,
    t: ImageTrack,
    tracks: ImageTrack[],
    baseline: Set<string> | null,
  ): TrackSeen => {
    const seen = observeImage(toSimpleBlocks(content), t, tracks, extraClaimedKeys(), baseline);
    if (seen.mediaKey) {
      if (seen.via === 'sole-unclaimed' || seen.via === 'media-id') {
        console.warn('[MarkFlow] 核对:图片块 key 已变,按身份认回', { image: t.imageIndex + 1, via: seen.via });
      }
      t.key = seen.mediaKey;
      if (!t.mediaId && seen.mediaId) t.mediaId = seen.mediaId;
    }
    if (seen.pendingDespiteKnownId && !t.pendingIdWarned) {
      t.pendingIdWarned = true;
      console.warn('[MarkFlow] 核对:图片已知 mediaId,但其块当前读不到 mediaId(仍是上传中实体)', {
        image: t.imageIndex + 1,
        mediaId: t.mediaId,
      });
    }
    return { ...seen, mediaPresent: seen.mediaKey !== null };
  };

  /**
   * 收尾核对上下文(runImport 建立)。onLost / onRevived 由 runImport 提供:前者 imageOk 减 1 + 推
   * image-lost 明细,后者撤销之(原图回来时)。
   */
  type ReconcileCtx = {
    tracks: ImageTrack[];
    markerPrefix: string;
    baselineMedia: Set<string> | null;
    /** 每张图的 File(按 imageIndex;补传用)。 */
    files: Array<File | null>;
    releases: string[];
    /** 本次导入已发起的补传张数(含失败;上限见 MAX_REUPLOADS_PER_IMPORT)。 */
    reuploadsUsed: number;
    onLost: (t: ImageTrack, detail: string) => void;
    onRevived: (t: ImageTrack) => void;
  };

  /** image-lost 明细的英文诊断串(detail 不走 i18n,同 orphan-media)。 */
  const lostDetail = (allowReupload: boolean, blocked: string | null, restored: boolean): string => {
    // 写回原文失败时如实说明占位还留着,不能写「已写回」(审计随后另记 marker-residue)。
    const tail = restored ? 'original text restored' : 'restoring original text failed, placeholder left';
    if (blocked === 'unclaimed-media') return `reverted by editor; re-upload skipped (unclaimed image block in body); ${tail}`;
    if (blocked === 'already-reuploaded') return `reverted by editor again after re-upload; ${tail}`;
    if (blocked === 'limit-reached') return `reverted by editor; re-upload limit reached; ${tail}`;
    return allowReupload ? `reverted by editor; ${tail}` : `reverted by editor after checks; ${tail}`;
  };

  /** 删一张图自己的占位(单事务剥除,只动这一个 marker),提交后等落盘。 */
  const stripTrackMarker = async (t: ImageTrack, markerPrefix: string): Promise<void> => {
    const r = sweepMarkersOnce(markerPrefix, undefined, { protect: (m) => m !== t.marker });
    if (r === 'swept') await settle('reconcile-strip', null, (c) => findMarkerBlock(c, t.marker) === null);
  };

  /**
   * 「图在、占位在」的收口(收尾核对 / 残留审计 / 原图回来复查共用):不能只删占位——X 常把图先插在
   * 文末、再由插件挪到占位处,回退到「插入后、归位前」的快照时图回到了文末(真机 R-B20 a:只删占位后
   * 图停在文末,报告仍 2/2)。故按蓝本原构造重新归位;占位行里有用户文字(非独占,整块顶替会连文字一起
   * 删)或归位未提交时,退回只剥占位串并告警位置未能校正。读最新 state;phase 只用于告警文案。
   */
  const relocateOrStrip = async (
    ctx: ReconcileCtx,
    t: ImageTrack,
    phase: string,
  ): Promise<'switched' | 'relocated' | 'stripped' | 'absent'> => {
    if (writeBlocked()) return 'switched';
    const node = findDraftStateNode();
    if (!node) return 'absent';
    const loc = findMarkerBlock(readEditorState(node).getCurrentContent(), t.marker);
    if (!loc) return 'absent';
    const n = t.imageIndex + 1;
    if (loc.exact && t.key) {
      if (await relocateMediaToMarker(node, t.marker, t.key)) {
        console.warn(`[MarkFlow] ${phase}:图片被编辑器回退到旧位置,已重新归位到占位处`, { image: n });
        return 'relocated';
      }
      if (writeBlocked()) return 'switched';
      await stripTrackMarker(t, ctx.markerPrefix);
      console.warn(`[MarkFlow] ${phase}:图片重新归位失败,已删除占位符,图片位置未能校正,请核对`, { image: n });
    } else {
      await stripTrackMarker(t, ctx.markerPrefix);
      console.warn(`[MarkFlow] ${phase}:占位符所在行有其他文字,只删除占位符,图片位置未能校正,请核对`, { image: n });
    }
    return writeBlocked() ? 'switched' : 'stripped';
  };

  /**
   * 已写回原文所在块:优先登记的 fallbackKey(块仍含原文);登记块已不含原文(X 换了块 key)时,再找
   * 「整块文本恰为原文」的非 atomic 块,但排除其他图登记过的原文行。本图从没写回过原文(fallbackKey
   * 为 null,如 report-lost)时不做整块文本搜索——否则可能命中另一张同 alt / 同 src 失败图的原文行或
   * 用户恰好手写的同一行,用本图顶掉别人的内容(复审 N1)。
   */
  const findFallbackBlockKey = (content: DraftContentState, t: ImageTrack, tracks: ImageTrack[]): string | null => {
    if (!t.fallbackKey) return null;
    const bm = content.getBlockMap();
    const own = bm.get(t.fallbackKey);
    if (own && own.getType() !== 'atomic' && own.getText().includes(t.fallbackText)) return t.fallbackKey;
    const others = new Set(tracks.filter((x) => x !== t && x.fallbackKey).map((x) => x.fallbackKey as string));
    const want = t.fallbackText.trim();
    const hits: string[] = [];
    bm.forEach((b, k) => {
      if (!hits.length && !others.has(k) && b.getType() !== 'atomic' && b.getText().trim() === want) hits.push(k);
    });
    return hits[0] ?? null;
  };

  /**
   * 终核之后复查被计过丢失的图(决策见 imageReconcile.decideRevival):X 的回退可能是瞬时的,随后又恢复
   * 较新状态、原图回到正文。只按原身份(块 key / mediaId)认回才撤销丢失记账(onRevived:imageOk +1、
   * 移除 image-lost 明细、回到已归位),并收口位置:占位又在 → 挪回占位处;已写回的原文行还在 → 用图
   * 顶替原文行(复用 B2 晚到追回的 relocateLateMedia,不另造构造),免得原文与图重复出现。
   */
  const reviveLostTracks = async (ctx: ReconcileCtx): Promise<'switched' | 'done'> => {
    for (const t of ctx.tracks) {
      if (!t.lostCounted) continue;
      if (writeBlocked()) return 'switched';
      const node = findDraftStateNode();
      if (!node) return 'done';
      const content = readEditorState(node).getCurrentContent();
      // 以「已归位」身份只读探查(不改账本);probe 替换掉 tracks 里的自己,认领集合才不把原 key 当别人的。
      const probe: ImageTrack = { ...t, expected: 'placed' };
      const seen = observeImage(
        toSimpleBlocks(content),
        probe,
        ctx.tracks.map((x) => (x === t ? probe : x)),
        extraClaimedKeys(),
        ctx.baselineMedia,
      );
      const matched = seen.mediaKey !== null && (seen.via === 'key' || seen.via === 'media-id');
      const fallbackAt = matched ? findFallbackBlockKey(content, t, ctx.tracks) : null;
      const action = decideRevival({
        lostCounted: true,
        matchedByIdentity: matched,
        markerPresent: seen.markerPresent,
        fallbackPresent: fallbackAt !== null,
      });
      if (action === 'none' || !seen.mediaKey) continue;
      t.key = seen.mediaKey;
      if (!t.mediaId && seen.mediaId) t.mediaId = seen.mediaId;
      t.expected = 'placed';
      t.lostCounted = false;
      t.lostAwaitingFallback = false;
      ctx.onRevived(t);
      console.warn('[MarkFlow] 收尾核对:此前判定丢失的图片已重新出现(编辑器又恢复了较新状态),撤销丢失记账', {
        image: t.imageIndex + 1,
        action,
      });
      if (action === 'relocate-to-marker') {
        if ((await relocateOrStrip(ctx, t, '收尾核对')) === 'switched') return 'switched';
      } else if (action === 'replace-fallback') {
        const entry: LateEntry = { imageIndex: t.imageIndex, fallbackKey: fallbackAt, fallbackText: t.fallbackText, pendingKey: null };
        if (!(await relocateLateMedia(node, entry, seen.mediaKey)) && !writeBlocked()) {
          console.warn('[MarkFlow] 收尾核对:原图已回来,但未能用它顶替已写回的原文行,请手动删除重复的原文', { image: t.imageIndex + 1 });
        }
        if (writeBlocked()) return 'switched';
      }
    }
    return 'done';
  };

  /**
   * 在占位处补传一张被回退丢失的图:复用 uploadOneImage(钉光标 → 上传回调 → 等新 MEDIA → 归位),
   * 不新增上传调用点。成功更新身份;失败写回原文并计 image-lost。每张最多一次(调用前已判定未受限)。
   */
  const reuploadTrack = async (ctx: ReconcileCtx, t: ImageTrack): Promise<'switched' | 'done'> => {
    ctx.reuploadsUsed += 1;
    t.reuploaded = true;
    // 原身份留底:补传期间原图若回来,其 key 不在补传前快照里,会被等新图的轮询当成补传结果(见下)。
    const origKey = t.key;
    const origMediaId = t.mediaId;
    const file = ctx.files[t.imageIndex] ?? null;
    let outcome: UploadOutcome;
    if (!file) {
      outcome = { ok: false, reason: 'upload-exception', detail: 'file missing for re-upload' };
    } else {
      try {
        // 预算同上传循环(≥ PENDING_CAP_MS);通道超时已按 MAX_REUPLOADS_PER_IMPORT 张补传预留(见 content.ts)。
        outcome = await uploadOneImage(t.marker, file, IMAGE_UPLOAD_BUDGET_MS);
      } catch (e) {
        console.warn('[MarkFlow] 补传异常', e);
        outcome = { ok: false, reason: 'upload-exception', detail: String(e) };
      }
    }
    if ('switched' in outcome || writeBlocked()) return 'switched';
    const n = t.imageIndex + 1;
    if (outcome.ok) {
      t.key = outcome.mediaKey;
      t.mediaId = outcome.mediaId ?? (outcome.mediaKey === origKey ? origMediaId : null);
      if (isOriginalImageReturn({ origKey, origMediaId, gotKey: outcome.mediaKey, gotMediaId: outcome.mediaId })) {
        // 归位的其实是回来的原图:不记作补传。补传自己若也插了块,它成了多余的图,交孤儿审计如实上报,
        // 不去删(无法确证哪块是补传插的)。
        ctx.releases.push(`#${n} original-returned ${outcome.via}`);
        console.warn('[MarkFlow] 补传期间原图已回来,按原图归位处理', { image: n, via: outcome.via });
        return 'done';
      }
      ctx.releases.push(`#${n} re-upload ${outcome.via}`);
      console.warn('[MarkFlow] 图片被编辑器回退丢失,已在原位补传', { image: n, via: outcome.via });
      return 'done';
    }
    const node = findDraftStateNode();
    if (node) {
      // 补传失败期间 X 可能又回退到较新的快照、原图回来了:先复查,按原身份(块 key / mediaId)认得回
      // 就恢复为已归位、不写回原文、不计丢失(残留的占位交下一轮核对删除)。只认原身份:邻接 / 唯一
      // 未认领认到的可能正是这次失败补传自己留下的未确认块,不能当成功。
      // 用只读的 observeImage(不用会就地改账本的 observeTrack):认图不被采纳时,账本不能指向那个块——
      // 否则它此后一直算「已认领」,后续图的补传拦截与守护的唯一认领门都看不到它(复审 N1)。
      const recheck = observeImage(
        toSimpleBlocks(readEditorState(node).getCurrentContent()),
        t,
        ctx.tracks,
        extraClaimedKeys(),
        ctx.baselineMedia,
      );
      if (recheck.mediaKey && (recheck.via === 'key' || recheck.via === 'media-id')) {
        t.key = recheck.mediaKey;
        if (!t.mediaId && recheck.mediaId) t.mediaId = recheck.mediaId;
        console.warn('[MarkFlow] 补传未成功,但原图已重新出现在正文,按已归位处理', { image: n, reason: outcome.reason });
        return 'done';
      }
      t.fallbackKey = await replaceMarkerWithText(node, t.marker, t.fallbackText);
    }
    if (writeBlocked()) return 'switched';
    t.expected = 'failed';
    const restoredNote = t.fallbackKey ? 'original text restored' : 'restoring original text failed, placeholder left';
    ctx.onLost(t, `re-upload failed: ${outcome.reason}${outcome.detail ? ` (${outcome.detail})` : ''}; ${restoredNote}`);
    console.warn('[MarkFlow] 图片被编辑器回退丢失,补传未成功,已写回原文', { image: n, reason: outcome.reason });
    return 'done';
  };

  /**
   * 收尾逐图核对一轮(导入内,结果返回前;决策见 imageReconcile.decideImageAction)。每张图先读最新
   * state;每次写入都等落盘后才看下一张(B1:不基于陈旧 state 二次写)。allowReupload=false 用于
   * 补传后复核与封面后终核(不再补传,图不在、占位在 → 写回原文)。A11:每张前后查闸门。
   * 读不到编辑器节点返回 'no-node'(本轮其余图不核对):本次占位在兜底清扫里一律受保护,首核 / 复核
   * 跳过的交终核;终核也跳过的交 runImport 的残留审计(图不在 → 报 image-lost;图在 → 重新归位)。
   */
  const reconcileImages = async (
    ctx: ReconcileCtx,
    allowReupload: boolean,
  ): Promise<'switched' | 'done' | 'no-node'> => {
    for (const t of ctx.tracks) {
      if (writeBlocked()) return 'switched';
      const node = findDraftStateNode();
      if (!node) {
        console.warn('[MarkFlow] 收尾核对读不到编辑器状态节点,本轮跳过', { image: t.imageIndex + 1 });
        return 'no-node';
      }
      const content = readEditorState(node).getCurrentContent();
      const seen = observeTrack(content, t, ctx.tracks, ctx.baselineMedia);
      const blocked =
        t.expected === 'placed' && !seen.mediaPresent && seen.markerPresent
          ? reuploadBlockReason({
              alreadyReuploaded: t.reuploaded,
              reuploadsUsed: ctx.reuploadsUsed,
              hasUnclaimedMedia: hasUnclaimedNewMedia(
                toSimpleBlocks(content),
                claimedMediaKeys(ctx.tracks, null, extraClaimedKeys()),
                ctx.baselineMedia,
              ),
            })
          : null;
      const action: ImageAction = decideImageAction({
        expected: t.expected,
        mediaPresent: seen.mediaPresent,
        markerPresent: seen.markerPresent,
        allowReupload,
        reuploadBlocked: blocked !== null,
        mediaAmbiguous: seen.ambiguousCount > 0,
      });
      if (action === 'none') continue;
      const n = t.imageIndex + 1;
      if (action === 'report-ambiguous') {
        // 不判丢失、不调 onLost:多出来的新图里可能就有本图(换了 key、又无 mediaId 可比对),
        // 交孤儿审计按「新增 MEDIA − imageOk」如实上报,不诱导用户删图。
        if (!t.ambiguousWarned) {
          t.ambiguousWarned = true;
          console.warn('[MarkFlow] 收尾核对:图片块已认不出(占位也已不在),正文有多张来历不明的新图,无法确认是否丢失', {
            image: n,
            candidates: seen.ambiguousCount,
          });
        }
        continue;
      }
      if (action === 'relocate') {
        if ((await relocateOrStrip(ctx, t, '收尾核对')) === 'switched') return 'switched';
      } else if (action === 'reupload') {
        if ((await reuploadTrack(ctx, t)) === 'switched') return 'switched';
      } else if (action === 'report-lost') {
        t.expected = 'failed';
        ctx.onLost(t, 'reverted by editor; image and placeholder both missing');
        console.warn('[MarkFlow] 收尾核对:图片被编辑器回退丢失(占位也已不在),请在正文核对并手动补图', { image: n });
      } else {
        // write-fallback(已归位的图被回退丢失,不补传)/ rewrite-fallback(失败图的原文被回退成占位)
        const fallbackKey = await replaceMarkerWithText(node, t.marker, t.fallbackText);
        if (writeBlocked()) return 'switched';
        if (fallbackKey) t.fallbackKey = fallbackKey;
        if (action === 'write-fallback') {
          t.expected = 'failed';
          ctx.onLost(t, lostDetail(allowReupload, blocked, fallbackKey !== null));
          console.warn(
            fallbackKey
              ? '[MarkFlow] 收尾核对:图片被编辑器回退丢失,已在原位写回原文'
              : '[MarkFlow] 收尾核对:图片被编辑器回退丢失,写回原文失败,占位符仍在',
            { image: n, blocked },
          );
        } else {
          console.warn(
            fallbackKey
              ? '[MarkFlow] 收尾核对:失败图片的原文被编辑器回退成占位符,已重新写回原文'
              : '[MarkFlow] 收尾核对:失败图片的原文被编辑器回退成占位符,重新写回失败,占位符仍在',
            { image: n },
          );
        }
      }
      if (writeBlocked()) return 'switched';
    }
    return 'done';
  };

  /** 先等保存稳定窗(上限 capMs)再核对一轮。label 仅用于诊断日志。 */
  const quiesceAndReconcile = async (
    ctx: ReconcileCtx,
    tracker: SaveTracker,
    capMs: number,
    allowReupload: boolean,
    label: string,
  ): Promise<'switched' | 'done' | 'no-node'> => {
    // 本次导入一次上传回调都没调过(含补传;典型:所有图都在准备阶段失败):回退的两个嫌疑——上传管线
    // 的陈旧提交、上传完成后的保存回写——都无从发生,不等稳定窗、直接核对(用户决定,省掉 1.5–8s)。
    if (filesAddedCount === 0) {
      if (import.meta.env.DEV) console.info('[MarkFlow] 本次导入未调用上传回调,跳过收尾保存稳定窗', { label });
      return writeBlocked() ? 'switched' : reconcileImages(ctx, allowReupload);
    }
    const startedAt = performance.now();
    const q = await waitForSaveQuiesce(tracker, capMs);
    if (q === 'switched') return 'switched';
    const info = { label, result: q, waitedMs: Math.round(performance.now() - startedAt), saves: tracker.observedCount };
    // 到上限仍未稳定:生产环境也留一条,便于真机判断稳定窗是否常态性等满(X 改接口名 / 保存不触发等)。
    if (q === 'cap') console.info('[MarkFlow] 收尾保存稳定窗到上限,按现状核对', info);
    else if (import.meta.env.DEV) console.info('[MarkFlow] 收尾保存稳定窗', info);
    return reconcileImages(ctx, allowReupload);
  };

  /** 导入后守护单轮核对的产出(由守护打告警)。 */
  type GuardOutcome = {
    /** 本轮剥掉的占位(图在、占位也在但无法重新归位,或未登记的本次 marker)。 */
    swept: string[];
    /** 本轮重新归位到占位处的图(1 起编号)。 */
    relocated: number[];
    /** 本轮只剥了占位、图片位置未能校正的图(1 起编号;占位行有用户文字或归位提交失败)。 */
    unfixed: number[];
    /** 本轮写回原文的图(1 起编号);wasPlaced=该图原本已归位(被回退丢失)而非失败图。 */
    restored: Array<{ image: number; wasPlaced: boolean }>;
    /** 本轮首次写回原文失败的图(1 起编号;每张只报一次)。 */
    restoreFailed: number[];
    /** 本轮首次发现「图与占位都不在」的图(1 起编号;每张只报一次)。 */
    lost: number[];
    /** 本轮首次发现「图与占位都不在、但正文有不唯一的来历不明新图」的图(无法确认丢失;每张只报一次)。 */
    ambiguous: number[];
  };

  /**
   * 导入后守护的单轮**同步**核对(复用 observeTrack + decideImageAction,不补传):
   * 图在、占位在 → 把图重新归位到占位处(relocateMediaToMarkerOnce,不拽光标;占位行有用户文字时只剥
   * 占位串);图不在、占位在 → 写回该图原文(不拽光标);图与占位都不在 → 只记一次告警。
   * 守护每轮同步换闸门、finally 复位,故这里只做同步写,且**每轮至多一次提交**——同步写完立即再读
   * props 只能读到提交前的旧 state,第二次写会把第一次回滚(B1),余下的交下一轮(1s 后)。
   * 优先级:写回原文 > 重新归位 > 剥占位(前者关乎图的位置锚点,其次是图的位置)。写回未提交时本轮
   * 不算用掉提交名额,继续归位 / 剥占位;同一张写回连续失败 GUARD_RESTORE_MAX_FAILURES 次后不再优先。
   */
  const guardReconcileOnce = (
    markerPrefix: string,
    tracks: ImageTrack[],
    baseline: Set<string> | null,
  ): GuardOutcome => {
    const out: GuardOutcome = {
      swept: [],
      restored: [],
      restoreFailed: [],
      lost: [],
      ambiguous: [],
      relocated: [],
      unfixed: [],
    };
    const node = findDraftStateNode();
    if (!node) return out;
    const content = readEditorState(node).getCurrentContent();
    const decisions = new Map<string, ImageAction>();
    let restore: ImageTrack | null = null;
    /** 可重新归位的图(决策 relocate、占位块独占、有 MEDIA key)。 */
    const relocatable: ImageTrack[] = [];
    /** 本轮只剥占位、不挪图的 marker。 */
    const stripOnly = new Set<string>();
    for (const t of tracks) {
      const seen = observeTrack(content, t, tracks, baseline);
      const action = decideImageAction({
        expected: t.expected,
        mediaPresent: seen.mediaPresent,
        markerPresent: seen.markerPresent,
        allowReupload: false,
        reuploadBlocked: true,
        mediaAmbiguous: seen.ambiguousCount > 0,
      });
      decisions.set(t.marker, action);
      if (action === 'report-lost' && !t.lostWarned) {
        t.lostWarned = true;
        out.lost.push(t.imageIndex + 1);
      }
      if (action === 'report-ambiguous' && !t.ambiguousWarned) {
        t.ambiguousWarned = true;
        out.ambiguous.push(t.imageIndex + 1);
      }
      // 写回连续失败达上限的图不再优先尝试:否则它每轮占住「唯一一次提交」的名额,饿死其他图的归位。
      const restoreWanted = action === 'write-fallback' || action === 'rewrite-fallback';
      if (!restore && restoreWanted && t.restoreFailures < GUARD_RESTORE_MAX_FAILURES) restore = t;
      if (action === 'relocate') {
        const loc = findMarkerBlock(content, t.marker);
        if (loc && loc.exact && t.key) relocatable.push(t);
        else stripOnly.add(t.marker); // 占位行有用户文字:只剥占位串,不挪图
      }
    }
    if (restore) {
      const wasPlaced = restore.expected === 'placed' || restore.lostAwaitingFallback;
      const fallbackKey = replaceMarkerWithTextOnce(node, restore.marker, restore.fallbackText, { keepSelection: true });
      if (fallbackKey !== null) {
        restore.expected = 'failed';
        restore.lostAwaitingFallback = false;
        restore.fallbackKey = fallbackKey;
        restore.restoreFailures = 0;
        out.restored.push({ image: restore.imageIndex + 1, wasPlaced });
        return out;
      }
      if (writeBlocked()) return out; // 已切文章:不再写,下一轮 tick 查到切换即停
      // 写回未提交(取不到样本字符等):本轮没有发生提交,继续处理归位 / 剥占位;首次失败告警一次。
      restore.restoreFailures += 1;
      if (restore.restoreFailures === 1) out.restoreFailed.push(restore.imageIndex + 1);
    }
    const target = relocatable[0];
    if (target && target.key) {
      if (relocateMediaToMarkerOnce(node, target.marker, target.key, { keepSelection: true })) {
        out.relocated.push(target.imageIndex + 1);
        return out;
      }
      if (writeBlocked()) return out; // 已切文章:不再写,下一轮 tick 查到切换即停
      stripOnly.add(target.marker); // 归位未提交(state 已变等):退回只剥占位,图片位置未能校正
    }
    // 只剥 stripOnly 里的占位;其余已登记图的占位受保护(可归位的留到下一轮逐张归位)。
    // 未登记的本次前缀 marker 照旧剥除。
    sweepMarkersOnce(
      markerPrefix,
      (m) => {
        out.swept.push(m);
        const t = tracks.find((x) => x.marker === m);
        if (t && stripOnly.has(m)) out.unfixed.push(t.imageIndex + 1);
      },
      {
        keepSelection: true,
        protect: (m) => decisions.has(m) && !stripOnly.has(m),
      },
    );
    return out;
  };
  /**
   * 派发**完整鼠标事件序列**(pointer/mouse down→up→click)。裸 `.click()` 对某些 React
   * 组件(处理器挂在 pointerdown/mousedown、或依赖真实事件序列)偶发不触发——X 裁剪弹窗的
   * Apply 实测出现「点了、回调却没跑、弹窗残留」,故改用完整序列确保命中。
   */
  const realClick = (el: HTMLElement): void => {
    const init: MouseEventInit = { bubbles: true, cancelable: true, view: window };
    try {
      el.dispatchEvent(new PointerEvent('pointerdown', init));
      el.dispatchEvent(new MouseEvent('mousedown', init));
      el.dispatchEvent(new PointerEvent('pointerup', init));
      el.dispatchEvent(new MouseEvent('mouseup', init));
      el.dispatchEvent(new MouseEvent('click', init));
    } catch {
      el.click(); // 环境不支持 PointerEvent 构造时兜底
    }
  };

  /**
   * 只在**真实裁剪弹窗**(`[role="dialog"]` / `[aria-modal="true"]`)内找「应用/裁剪确认」按钮。
   * **绝不退回整个 document**——否则无弹窗时会全文搜按钮,可能误点编辑器工具栏的不可逆动作
   * (发布/保存草稿等)。宁可设不上封面,也绝不误点页面级按钮。
   * 优先用稳定的 `data-testid="applyButton"`(实证,跨语言、抗文案变动);兜底再按收窄文案。
   */
  const findApplyButton = (): HTMLElement | null => {
    const modals = Array.from(
      document.querySelectorAll<HTMLElement>('[aria-modal="true"], [role="dialog"]'),
    );
    if (!modals.length) return null; // 无弹窗:放弃,绝不退回 document 全文搜索。
    // 1) 稳定 testid 优先——X 裁剪弹窗应用按钮实证为 data-testid="applyButton"。
    for (const root of modals) {
      const byTestId = root.querySelector<HTMLElement>('[data-testid="applyButton"]');
      if (byTestId) return byTestId;
    }
    // 2) 兜底:明确的「应用/裁剪确认」文案(精确匹配);不含泛化单词,避免命中取消/删除/其它动作。
    const labels = ['apply', '应用', 'save changes', '完成裁剪', '应用裁剪', '确认裁剪'];
    for (const root of modals) {
      for (const b of Array.from(root.querySelectorAll<HTMLElement>('[role="button"], button'))) {
        const rect = b.getBoundingClientRect();
        if (rect.width < 4 || rect.height < 4) continue;
        const text = (b.textContent || b.getAttribute('aria-label') || '').trim().toLowerCase();
        if (labels.includes(text)) return b;
      }
    }
    return null;
  };

  /**
   * 设置文章封面:把 File 塞进 X 的封面 fileInput → X 弹出「Edit media」裁剪弹窗 → 自动点 Apply 落地。
   * 封面输入的 accept 只含图片、不含 video(正文媒体那个含 gif/mp4),据此筛选;**不做通用兜底**,
   * 找不到确证的封面输入宁可返回 false 也不误伤正文。File 由 content 经 postMessage 送到本 world。
   * 返回 true 表示已点 Apply(真机确认);弹窗未出现(未能落地)返回 false,不谎报成功。
   */
  const setCoverImage = async (file: File): Promise<boolean> => {
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'));
    const coverInput =
      inputs.find((inp) => {
        const accept = (inp.getAttribute('accept') || '').toLowerCase();
        return accept.includes('image') && !accept.includes('video');
      }) ?? null;
    if (!coverInput) return false;
    try {
      // A11:封面不经 onChange,但同样会写进「当前 URL 对应的文章」——塞 File 前与每次点 Apply 前
      // 都查写入闸门,切文章即放弃(返回 false、不点击;runImport 随后判定已切换并返回)。
      if (writeBlocked()) return false;
      const dt = new DataTransfer();
      dt.items.add(file);
      coverInput.files = dt.files;
      coverInput.dispatchEvent(new Event('input', { bubbles: true }));
      coverInput.dispatchEvent(new Event('change', { bubbles: true }));
      // X 会弹出「Edit media」裁剪弹窗,必须点弹窗内的 Apply 才真正设为封面。轮询等其出现。
      // findApplyButton 仅在真实弹窗内查找、绝不退回 document——8s 内无弹窗/弹窗内无按钮即放弃。
      const deadline = Date.now() + 8000;
      let apply: HTMLElement | null = null;
      while (Date.now() < deadline) {
        await delay(200);
        if (writeBlocked()) return false;
        apply = findApplyButton();
        if (apply) break;
      }
      if (!apply) return false; // 8s 内没等到裁剪弹窗内的 Apply:未能落地,如实返回 false。

      // 点 Apply 并**确认弹窗真的关闭**才算成功——裸 .click() 对 X 裁剪按钮偶发不响应(点了、
      // coverSet 谎报 true、弹窗却残留)。故用 realClick 派发完整事件序列,并轮询到「弹窗内 Apply
      // 消失」为准;单次没关就重新定位再点(DOM 可能重渲染),最多 5 轮。
      for (let attempt = 0; attempt < 5; attempt += 1) {
        if (writeBlocked()) return false;
        realClick(apply);
        const closeDeadline = Date.now() + 1500;
        while (Date.now() < closeDeadline) {
          await delay(150);
          if (!findApplyButton()) return true; // 弹窗内 Apply 已不在 → 弹窗已关,封面落地
        }
        apply = findApplyButton(); // 仍在:重新定位(可能已重渲染)后再试
        if (!apply) return true; // 期间关掉了
      }
      // 多轮点击弹窗仍未关闭:如实返回 false(不谎报),弹窗留给用户手动处理。
      return false;
    } catch (err) {
      console.warn('[MarkFlow] 设置封面失败', err);
      return false;
    }
  };

  /**
   * 核心写入:借页面构造器逐块构造 blockMap 并经 X 自己的 onChange 提交。
   * 全程 try/catch,异常带「失败环节前缀」(stage)返回,便于诊断定位。
   */
  const runImport = async (
    blocks: ImportBlock[],
    mode: ImportMode,
    // 默认 []:防御旧版 content(未带 images 字段,如页面未刷新仍跑旧 content script)——
    // 缺失时图片一律降级为原文,绝不能因 `images[i]` 读 undefined 而崩(正文已提交却报失败)。
    images: PreparedImage[] = [],
    // 封面 File(可选);默认 null 防御旧 content。
    cover: File | null = null,
    // 期望的目标文章 id(B2-1 双钥,可选;null=不校验,兼容旧 content)。
    expectedArticleId: string | null = null,
  ): Promise<ImportResult> => {
    if (importInFlight) return { ok: false, error: 'import already in progress' };
    // B3:非文章编辑路由(推文 compose 弹窗 / 私信框也是 Draft.js)一律拒写,放在占坑之前、
    // 不触碰编辑器,零副作用。
    if (!isArticleEditorRoute()) {
      console.warn('[MarkFlow] 当前不是 X 文章编辑页,拒绝写入', location.pathname);
      return { ok: false, error: NOT_ARTICLE_EDITOR_ERROR };
    }
    importInFlight = true;
    settleTimeouts = []; // B1 诊断账本按次清零
    // 导入后守护(见 startMarkerGuard):新导入开始先停旧守护;交互时间线从本次开始记录,
    // 成功且有图时交给守护在其结束时摘监听,否则在 finally 摘掉。
    stopMarkerGuard?.();
    const interactionLog = startInteractionLog();
    // 正文保存观察(收尾保存稳定窗 + 守护诊断用,只读;内部吞掉构造异常,不会抛)。与交互时间线同生命周期:
    // 守护接手时由守护停止时断开,否则 finally 断开。
    const saveWatch = startSaveWatch();
    let guardStarted = false;
    /** 每张图的成功判定路径(诊断用,形如 `#1 pending-cap`;随守护告警输出)。 */
    const releases: string[] = [];
    // 以下声明本身不会抛错,且 catch(stage)/finally 需引用,故留在 try 外层:
    let stage = 'draft node';
    // B2-2:主 onChange 提交后置 true。提交后再失败(verify 不达标/图片阶段异常)时正文已
    // (部分)落地,失败结果带上它,UI 才能提示「正文可能已写入」而不是诱导用户重试导致重复。
    let committed = false;
    // B2-1 持续校验(review 修复):入口校验只挡得住「点确认前」的切换;空稿取样最长再等 1.6s、
    // 图片/清扫/封面阶段可达数分钟,期间 SPA 切文章后(A11 实测:X 不重挂编辑器,findDraftStateNode
    // 拿到的仍是旧文章内容,但保存目标已是新文章)继续写,X 会把旧内容自动保存进新文章。故 commit 前、
    // 每个后续阶段前、以及每次编辑器写入时(commitEditorState 闸门)都复查,切换即停手。
    // 路由也纳入:SPA 离开文章编辑路由(如切到推文 compose)时无论是否带 articleId 都视为切换。
    // A11:再加「pathname 与写入开始时的基线不同」——新建文章页 articleId 为 null,只比 id 完全不防;
    // 宁可误停也不写错文章。规则见 lib/bridge/articleGuard.ts。
    const baselinePathname = location.pathname;
    lastImportPathname = baselinePathname; // 供导入后的 setTitle 复核(不在 finally 清空)
    const articleSwitched = (): boolean =>
      isArticleSwitched({ baselinePathname, expectedArticleId, currentPathname: location.pathname });
    // B2 晚到追回的模块级账本按次清零;A11 起所有编辑器写入统一服从本次的切文章闸门
    // (commitEditorState / 封面 / 晚到追回;finally 复位为一律禁止)。
    pendingLate = [];
    lateRecovered = [];
    filesAddedCount = 0;
    writeBlocked = articleSwitched;
    // 每次运行独立的 marker 前缀,避免与历史残留 / 并发写入串扰。
    const markerPrefix = `__MARKFLOW_IMG_${Math.random().toString(36).slice(2, 8)}_`;
    // 清扫用**通用**前缀:不仅清本次,也清掉「历史遗留」——同一草稿反复导入时,之前某次
    // 走 fallbackIndex 未删、又因随机 prefix 不匹配而漏清的残留 marker(否则永远赖在正文里)。
    const MARKER_SWEEP_PREFIX = '__MARKFLOW_IMG_';
    // 记录每个图片 marker、其在 images[] 中的下标(按文档顺序 = 第几个 ImageBlock)、失败兜底原文
    // 及来源(仅供失败明细展示定位)。
    const imageMarkers: Array<{ marker: string; imageIndex: number; fallbackText: string; source: string }> = [];
    try {
      // 触碰 blocks 的语句必须在 try 内:页面可伪造无 blocks 字段的 import 消息,
      // blocks.filter / blocks.length 会抛 TypeError——放 try 外会跳过 finally 的
      // importInFlight 复位,导致该页此后所有合法导入永久收到 'import already in progress'。
      const imageCount = blocks.filter((b) => b.kind === 'image').length;
      if (import.meta.env.DEV) console.info('[MarkFlow] 写入开始', { blocks: blocks.length, mode, images: imageCount });
      // B2-1 双钥校验:在触碰编辑器之前比对目标文章——ask 弹窗挂起期间用户在同一 tab 内
      // SPA 切到另一篇草稿时(tabId 不变,sidepanel 的钉 tab 挡不住),这里是最后一道闸。
      if (articleSwitched()) {
        console.warn('[MarkFlow] 目标文章已切换,拒绝写入', { expected: expectedArticleId, actual: getArticleId() });
        return { ok: false, error: ARTICLE_SWITCHED_ERROR };
      }
      let draftNode = findDraftStateNode();
      if (!draftNode) return { ok: false, error: 'draft state node not found' };

      // --- 取样本字符 -------------------------------------------------------
      stage = 'sample character';
      let sample = findCharacterSample(readEditorState(draftNode).getCurrentContent().getBlockMap());
      // 凡走 execCommand 取样,后续一律按 replace 处理(插入的 'x' 会被整体替换掉)。
      let forcedReplace = false;

      if (!sample) {
        // 全空草稿:focus 编辑器 → execCommand 强插一个字符逼出样本 → 轮询重抓等 React 落盘。
        // 第三批 I2:插入前先复查目标文章——插入后若再因切文章拒写,这个字符就留在用户的编辑器里。
        if (articleSwitched()) return { ok: false, error: ARTICLE_SWITCHED_ERROR };
        // 定位不到编辑器就不插:execCommand 会插进页面当前聚焦的任意元素(如标题框)。
        const sampleEditor = findEditorElement();
        if (!sampleEditor) return { ok: false, error: 'sample character: editor element not found' };
        sampleEditor.focus();
        document.execCommand('insertText', false, SAMPLE_CHAR);
        for (let waited = 0; waited < 1600 && !sample; waited += 100) {
          await delay(100);
          // 轮询期间切了文章:立即停手,不再取样、不再写入。A11 实测 X 同标签切文章**不重挂编辑器**,
          // Draft 仍是原文章内容而保存目标已是新文章——此时再 undo 撤回插入的字符,会经 X 的 onChange
          // 把旧编辑器状态自动保存进新文章。故不撤回(字符可能残留在原文章),这一窗口通常只有取样落盘前的约 100ms。
          if (articleSwitched()) return { ok: false, error: ARTICLE_SWITCHED_ERROR };
          const node = findDraftStateNode();
          if (!node) continue;
          const bm = readEditorState(node).getCurrentContent().getBlockMap();
          const s = findCharacterSample(bm);
          if (s) {
            sample = s;
            draftNode = node; // 采用取样后的最新状态节点
          }
        }
        if (!sample) {
          // I2:取样失败 → 撤回本次插入(正文恰为取样字符才撤,不误撤用户内容);只试一次,撤不掉如实报告。
          let residue = false;
          if (isSampleResidue(sampleEditor.textContent ?? '')) {
            sampleEditor.focus();
            try {
              document.execCommand('undo');
            } catch {
              /* 撤回失败按残留处理 */
            }
            await delay(200);
            residue = isSampleResidue(sampleEditor.textContent ?? '');
          }
          return {
            ok: false,
            error: `sample character: unable to acquire via execCommand${residue ? SAMPLE_RESIDUE_SUFFIX : ''}`,
          };
        }
        forcedReplace = true;
      }

      // --- 借构造器(从取样后的最新 draftNode 上取)---------------------------
      const editorState = readEditorState(draftNode);
      const EditorStateClass = editorState.constructor as unknown as DraftEditorStateStatic;
      // 借 SelectionState 类:提交时必须构造「指向新块」的合法 selection——
      // 沿用旧 selection(携带被替换掉的旧块 key)会让 X 的 onChange 内部按旧 key
      // 找块得到 undefined 而崩(_getPlaintextFromCurrentBlock,本次事故根因)。
      const SelectionStateClass = editorState.getSelection()
        .constructor as unknown as DraftSelectionStatic;
      const contentState = editorState.getCurrentContent();
      const blockMap = contentState.getBlockMap();
      const sampleBlock = blockMap.first();
      // 空 characterList 模板:从真实 Immutable 实例 clear() 得到,后续用 push() 逐个填充。
      // **不**用 `constructor(数组)` 直造——那样对 Draft 内部 Immutable 子类不安全,
      // 会产出畸形集合,Draft 遍历时拿到 undefined block → getText 崩(本次事故根因)。
      const emptyCharList = sampleBlock.getCharacterList().clear();
      // 空 data 模板:merge 不覆盖的字段会继承 sampleBlock 的——若首块 data 非空
      // (如 append 到首块为 atomic 的文章),新块会悄悄继承那份 data,故显式清空。
      const emptyBlockData = sampleBlock.getData().clear();

      // append 语义:现有内容为空(所有块 text 均为空)时等价 replace。
      let contentEmpty = true;
      blockMap.forEach((b) => {
        if (b.getText().length > 0) contentEmpty = false;
      });
      const effectiveMode: ImportMode = forcedReplace || contentEmpty ? 'replace' : mode;
      if (import.meta.env.DEV) console.info('[MarkFlow] 写入模式', { effectiveMode, forcedReplace, contentEmpty });

      // --- 逐块构造(在一个 contentState 事务里累积 entity)---------------------
      stage = 'build blocks';
      let nextContent = contentState;
      const emptyStyle = sample.getStyle().clear();
      const built: Array<[string, DraftBlock]> = [];

      blocks.forEach((block, index) => {
        const key = Math.random().toString(36).slice(2, 7) + index.toString(36);

        if (block.kind === 'text') {
          // 每个 link 区间创建一个共享的 LINK entity(同区间字符共用一个 entity key)。
          const linkKeys = block.links.map((link) => {
            nextContent = nextContent.createEntity('LINK', 'MUTABLE', { url: link.url });
            return { range: link, entityKey: nextContent.getLastCreatedEntityKey() };
          });

          const chars: DraftCharacter[] = [];
          for (let i = 0; i < block.text.length; i += 1) {
            // style:清空后叠加所有命中 inlineStyleRanges 的样式名。
            let style = sample.getStyle().clear();
            for (const r of block.inlineStyleRanges) {
              if (i >= r.offset && i < r.offset + r.length) style = style.add(r.style);
            }
            // entity:命中 link 区间时挂对应 LINK entity key,否则为 null。
            let entity: string | null = null;
            for (const lk of linkKeys) {
              if (i >= lk.range.offset && i < lk.range.offset + lk.range.length) {
                entity = lk.entityKey;
                break;
              }
            }
            chars.push(sample.set('style', style).set('entity', entity));
          }

          // characterList:从空模板用实例方法 push() 逐个追加(不用 constructor 直造)。
          let characterList = emptyCharList;
          for (const c of chars) characterList = characterList.push(c);
          // depth:列表嵌套层级(Draft 原生字段)。截顶到 [0,4]——Draft 默认样式表只到 depth4,
          // 且负数/超大值会让 X 的列表渲染算 padding 时出界。非列表块 parser 不产出 depth,取 0。
          // 先过 isFinite:单纯 clamp 挡不住 NaN(Math.max/min 遇 NaN 一路返回 NaN),
          // 而 NaN 写进 Draft 的数值字段会让列表渲染出难以排查的怪状态。
          const rawDepth = Number(block.depth ?? 0);
          const depth = Number.isFinite(rawDepth) ? Math.max(0, Math.min(4, Math.trunc(rawDepth))) : 0;
          const nextBlock = sampleBlock.merge({
            key,
            type: block.type,
            text: block.text,
            characterList,
            depth,
            data: emptyBlockData,
          });
          built.push([key, nextBlock]);
        } else if (block.kind === 'atomic') {
          // 代码块 / 分割线 / 推文 / 数学公式:单趟构造(无需 marker,这四类不走异步上传)。
          const mutability = atomicMutability(block.entityType);
          nextContent = nextContent.createEntity(block.entityType, mutability, block.data);
          const entityKey = nextContent.getLastCreatedEntityKey();
          // 文本承载分两种形态(真机 dump 实证,见 protocol AtomicBlock):
          //  - LATEX:公式本体在块 text,**每个字符都挂同一 LATEX entity key**(与 X 原生插入一致);
          //    空公式兜底退单空格(parser 已挡空公式,这里双保险防空 characterList / 空块崩)。
          //  - DIVIDER/MARKDOWN/TWEET:约定单空格文本,该 1 字符挂 entity key、数据在 entity data。
          const atomicText = block.entityType === 'LATEX' && block.text !== '' ? block.text : ' ';
          const atomicChar = sample.set('style', emptyStyle).set('entity', entityKey);
          let atomicCharList = emptyCharList;
          for (let ci = 0; ci < atomicText.length; ci += 1) atomicCharList = atomicCharList.push(atomicChar);
          const nextBlock = sampleBlock.merge({
            key,
            type: 'atomic',
            text: atomicText,
            characterList: atomicCharList,
            depth: 0,
            data: emptyBlockData,
          });
          built.push([key, nextBlock]);
        } else {
          // 图片:先写一个「仅含 marker」的 unstyled 占位块;上传阶段再替换为 MEDIA / fallback。
          // 图片上传是异步的,必须占位 + 事后归位(见 uploadOneImage)。
          const imageIndex = imageMarkers.length;
          const marker = `${markerPrefix}${imageIndex}__`;
          imageMarkers.push({ marker, imageIndex, fallbackText: block.fallbackText, source: block.source });
          let characterList = emptyCharList;
          const plain = sample.set('style', emptyStyle).set('entity', null);
          for (let ci = 0; ci < marker.length; ci += 1) characterList = characterList.push(plain);
          const nextBlock = sampleBlock.merge({
            key,
            type: 'unstyled',
            text: marker,
            characterList,
            depth: 0,
            data: emptyBlockData,
          });
          built.push([key, nextBlock]);
        }
      });

      // --- blockMap 组装(实例方法 set 逐个填充:replace 从空建,append 从现有续)----
      stage = 'assemble blockMap';
      let nextBlockMap = effectiveMode === 'replace' ? blockMap.clear() : blockMap;
      for (const [k, b] of built) nextBlockMap = nextBlockMap.set(k, b);

      // --- 提交(走 X 自己的 onChange,undo 栈 / 自动保存全由 X 接管)-----------
      stage = 'commit';
      // 光标钉到「最后一个新块」的末尾:selectionBefore/After 与编辑器 selection 三处
      // 都必须指向新 blockMap 中真实存在的块,X 内部任何按 key 找块的读取才不会落空。
      const lastEntry = built[built.length - 1];
      if (!lastEntry) return { ok: false, error: 'commit: no blocks to write' };
      const [lastKey, lastBlock] = lastEntry;
      const lastLen = lastBlock.getText().length;
      const endSelection = SelectionStateClass.createEmpty(lastKey).merge({
        anchorOffset: lastLen,
        focusOffset: lastLen,
      });
      nextContent = nextContent
        .set('blockMap', nextBlockMap)
        .set('selectionBefore', endSelection)
        .set('selectionAfter', endSelection);
      // 主提交前最后复查目标文章(空稿取样循环可能 await 过 1.6s):切换即拒写,零副作用。
      if (articleSwitched()) return { ok: false, error: ARTICLE_SWITCHED_ERROR };
      let next = EditorStateClass.push(editorState, nextContent, 'insert-fragment');
      next = EditorStateClass.forceSelection(next, endSelection);
      // 经统一出口提交;被闸门拦截 = 已切文章,零副作用返回(committed 仍为 false)。
      if (!commitEditorState(draftNode, next)) return { ok: false, error: ARTICLE_SWITCHED_ERROR };
      committed = true; // B2-2:此后任何失败都属「提交后失败」,结果须如实带 committed
      if (import.meta.env.DEV) console.info('[MarkFlow] onChange 已提交,块数', built.length);

      // --- 轻验证(仅 replace 强校验:新 blockMap 含我们的 key 数 ≥ blocks.length)------
      stage = 'verify';
      // B1:replace / append 两条路径都等「全部新块 key 已出现在 blockMap」真正落盘,再进入
      // 后续读-改-写(此前只 delay(150) 且 append 不复核,图片阶段首轮可能读到提交前的旧 state)。
      // 超时不中断:replace 路径下方 verify 仍会重数并判定;append 路径记账后继续。
      await settle('commit', draftNode, (c) => {
        const bm = c.getBlockMap();
        return built.every(([k]) => bm.has(k));
      });
      if (effectiveMode === 'replace') {
        const ourKeys = new Set(built.map(([k]) => k));
        // 重读一轮最新 blockMap 并重数命中的新块 key。X 的 onChange 是异步 commit
        // (见 sweepMarkers 注释:单次读 fiber 可能读到中间态),封装成可重试的计数器。
        // 读不到状态节点时不作数,按「通过」处理(返回 blocks.length),避免误报失败。
        const countHits = (): number => {
          const verifyNode = findDraftStateNode();
          if (!verifyNode) return blocks.length;
          const verifyMap = readEditorState(verifyNode).getCurrentContent().getBlockMap();
          let n = 0;
          verifyMap.forEach((b) => {
            if (ourKeys.has(b.getKey())) n += 1;
          });
          return n;
        };
        let hit = countHits();
        if (hit < blocks.length) {
          // 首轮不达标不立即判失败:X 可能尚未 commit 完,再等一轮重读最新 blockMap 复核,
          // 给 X 足够时间落盘,消除「150ms 读到旧 state → hit 偏小」的误报。
          await delay(200);
          hit = countHits();
        }
        if (hit < blocks.length) {
          // 确实仍不达标才判失败。此 return 不走 catch,故此处显式补一次清扫——
          // 否则随正文提交的 __MARKFLOW_IMG_* 占位块会残留用户草稿(仅在确有图片 marker 时清)。
          // A11:已切文章则跳过清扫(不写),直接报切换;清扫中途切换同样按切换返回。
          if (articleSwitched()) return { ok: false, error: ARTICLE_SWITCHED_ERROR, committed };
          if (imageMarkers.length) await sweepMarkers(MARKER_SWEEP_PREFIX);
          if (articleSwitched()) return { ok: false, error: ARTICLE_SWITCHED_ERROR, committed };
          return { ok: false, error: `verify: only ${hit}/${blocks.length} blocks landed`, committed };
        }
      }

      // --- 图片上传阶段(marker 占位已随正文提交;逐图异步上传 + 归位 + 清 marker)------
      stage = 'images';
      let imageOk = 0;
      // 失败明细:序号/来源/阶段/原因,随 ImportResult 回传供报告展示——此前只有 imageFail
      // 汇总数,失败了不知道是哪张、哪步(QA T6 引出)。imageFail 由明细长度**派生**(见循环后),
      // 不再记两份手工账。source/detail 经 truncateForReport 截断(代理对安全)再持久化。
      const imageFailures: ImageFailure[] = [];
      const pushFailure = (
        imageIndex: number,
        source: string,
        failStage: 'prepare' | 'upload',
        reason: ImageFailReason,
        detail?: string,
      ): void => {
        imageFailures.push({
          index: imageIndex,
          source: truncateForReport(source, 80),
          stage: failStage,
          reason,
          detail: detail === undefined ? undefined : truncateForReport(detail, 200),
        });
      };
      // B2:图片阶段开始时正文已有的 MEDIA(append 模式的旧图)——收尾 orphan-media 审计的
      // 基线(新增 MEDIA 数 = 终态 MEDIA − 基线)。
      const mediaBaseNode = imageMarkers.length ? findDraftStateNode() : null;
      const initialMedia = mediaBaseNode ? snapshotMediaKeys(mediaBaseNode) : null;
      // B2:上传循环里成功归位的图片下标——收尾判定「不可追踪的超时图之后是否有图成功归位」
      // (media-order-uncertain 的条件之一)。
      const placedIndices: number[] = [];
      // 逐图核对账本(见 ImageTrack):上传循环登记每张图「已归位(MEDIA 身份)」或「应为原文」,
      // 收尾核对与导入后守护据此判断回退后该删占位、补传还是写回原文。
      const tracks: ImageTrack[] = imageMarkers.map((m) => ({
        ...m,
        expected: 'failed',
        key: null,
        mediaId: null,
        reuploaded: false,
        lostWarned: false,
        ambiguousWarned: false,
        pendingIdWarned: false,
        lostAwaitingFallback: false,
        fallbackKey: null,
        lostCounted: false,
        restoreFailures: 0,
      }));
      for (const { marker, imageIndex, fallbackText, source } of imageMarkers) {
        // 每张图前复查:中途切文章立即停手(marker 留在原文章,由错误文案引导用户回去检查),
        // 绝不对切换后的文章做 replace/sweep/封面等任何改写。
        if (articleSwitched()) {
          return { ok: false, error: ARTICLE_SWITCHED_ERROR, committed };
        }
        const prep = images[imageIndex];
        const file = prep?.file ?? null;
        if (!file) {
          // 准备失败(远程被拒/本地读不到/超限/类型不符):写回原文,不静默丢内容。
          // 原因码由 content 的 prepareOneImage 随 PreparedImage 带来;prep 整项缺失
          // (典型:扩展更新后旧 content 未刷新,消息无 images)→ 'prepare-missing',
          // 提示刷新页面,不误报成崩溃类异常。
          const node = findDraftStateNode();
          if (node) await replaceMarkerWithText(node, marker, fallbackText);
          if (prep) pushFailure(imageIndex, source, 'prepare', prep.failReason ?? 'prepare-exception', prep.failDetail);
          else pushFailure(imageIndex, source, 'prepare', 'prepare-missing');
          continue;
        }
        let outcome: UploadOutcome;
        try {
          outcome = await uploadOneImage(marker, file, IMAGE_UPLOAD_BUDGET_MS);
        } catch (e) {
          console.warn('[MarkFlow] 图片上传异常', e);
          outcome = { ok: false, reason: 'upload-exception', detail: String(e) };
        }
        // A11:上传途中切了文章(含异常/超时后才发现)→ 立即停手,**不得**写回原文(那会经 onChange
        // 把旧编辑器状态存进新文章)。marker 留在原文章,由错误文案引导用户回去检查。
        if ('switched' in outcome || articleSwitched()) {
          return { ok: false, error: ARTICLE_SWITCHED_ERROR, committed };
        }
        if (outcome.ok) {
          imageOk += 1;
          placedIndices.push(imageIndex);
          releases.push(`#${imageIndex + 1} ${outcome.via}`);
          const track = tracks[imageIndex];
          if (track) {
            track.expected = 'placed';
            track.key = outcome.mediaKey;
            track.mediaId = outcome.mediaId;
          }
          // 非 ready 放行:X 的上传可能仍在进行,其完成时的提交有覆盖归位的风险(由导入后守护兜底)。
          if (outcome.via !== 'ready') {
            console.warn('[MarkFlow] 图片未拿到 mediaId 即按放行规则判定成功', { image: imageIndex + 1, via: outcome.via });
          }
        } else {
          pushFailure(imageIndex, source, 'upload', outcome.reason, outcome.detail);
          const node = findDraftStateNode();
          const fallbackKey = node ? await replaceMarkerWithText(node, marker, fallbackText) : null;
          // B2:超时 ≠ X 放弃上传——登记待追回,其 pending 块后续拿到 mediaId 时按 key 精确还给它。
          if (outcome.reason === 'upload-timeout') {
            pendingLate.push({ imageIndex, fallbackKey, fallbackText, pendingKey: outcome.pendingKey ?? null });
          }
        }
      }
      // B2 末轮追回:只按 pendingKey **精确**扫一遍当前 state(无归属证据的块不猜,末轮 FIFO 已删除)。
      // 不额外等待——通道超时不随此放大(见 content.ts);此后才到的、以及不可追踪超时图的
      // 晚到块计入 orphan-media 审计与 media-order-uncertain 提示。
      while (pendingLate.length && (await recoverLateOnce())) {
        /* 每轮至多追回一张,直至无可认领 */
      }
      // 追回的图:计成功、移除其 upload-timeout 明细(同一事实只记一份账,imageFail 仍由明细派生),
      // 并登记为已归位。收尾补传途中(其 waitForNewMedia 每轮也会追回)可能再追回,故做成可重复调用、
      // 只吸收新增条目。
      const recoveredSet = new Set<number>();
      const absorbLateRecovered = (): void => {
        for (const r of lateRecovered) {
          if (recoveredSet.has(r.imageIndex)) continue;
          recoveredSet.add(r.imageIndex);
          imageOk += 1;
          for (let i = imageFailures.length - 1; i >= 0; i -= 1) {
            const f = imageFailures[i]!;
            if (f.reason === 'upload-timeout' && f.index === r.imageIndex) imageFailures.splice(i, 1);
          }
          const track = tracks[r.imageIndex];
          if (track) {
            track.expected = 'placed';
            track.key = r.mediaKey;
            track.mediaId = null; // 核对时见到即补记
          }
        }
      };
      absorbLateRecovered();

      // --- 收尾保存稳定窗 + 逐图核对(X 偶发用旧快照整体覆盖正文,见 reconcileImages 段首注释)---
      // 结果返回前先等 X 的正文保存在最后一次写入后完成并静默(上限 8s),再逐张核对:残留占位删除、
      // 丢失的图在原位补传(每张最多一次、单次导入最多 2 张)、补不回如实计 image-lost。
      // 有补传则再等一次稳定窗(上限 4s)做不补传的复核。
      const reconcileCtx: ReconcileCtx = {
        tracks,
        markerPrefix,
        baselineMedia: initialMedia,
        files: imageMarkers.map((m) => images[m.imageIndex]?.file ?? null),
        releases,
        reuploadsUsed: 0,
        onLost: (t, detail) => {
          t.lostCounted = true;
          imageOk -= 1;
          pushFailure(t.imageIndex, t.source, 'upload', 'image-lost', detail);
        },
        onRevived: (t) => {
          imageOk += 1;
          for (let i = imageFailures.length - 1; i >= 0; i -= 1) {
            const f = imageFailures[i]!;
            if (f.reason === 'image-lost' && f.index === t.imageIndex) imageFailures.splice(i, 1);
          }
        },
      };
      if (tracks.length) {
        stage = 'reconcile';
        if ((await quiesceAndReconcile(reconcileCtx, saveWatch.tracker, QUIESCE_CAP_MS, true, 'first')) === 'switched') {
          return { ok: false, error: ARTICLE_SWITCHED_ERROR, committed };
        }
        absorbLateRecovered();
        if (reconcileCtx.reuploadsUsed > 0) {
          const recheck = await quiesceAndReconcile(reconcileCtx, saveWatch.tracker, QUIESCE_RECHECK_CAP_MS, false, 'recheck');
          if (recheck === 'switched') return { ok: false, error: ARTICLE_SWITCHED_ERROR, committed };
          absorbLateRecovered();
        }
      }
      // 兜底清扫:清历史遗留与未登记的 marker。本次已登记图的占位**一律受保护**,交封面后终核处理
      // (挪回占位处 / 剥占位 / 写回原文,并等落盘)与残留审计——清扫只会剥占位、不会挪图:首核之后、
      // 清扫期间若 X 又回退到「图在文末、占位重现」,只剥占位会让图停在文末,终核看到「图在、占位不在」
      // 就无从发现(复审 H1)。
      // 用通用前缀而非本次随机 prefix——否则清不掉之前导入残留的其它 prefix 的 marker。
      let sweepConfirmedClean = true;
      // onSwept 只做诊断日志,不计失败明细:能被 sweep 清掉的 marker 主要来自 fallbackIndex
      // 「已配对成功」路径(图已在文中,marker 交清扫收尾)——图没丢,upload 失败的账在上传
      // 循环里已如实记过;清扫成功 = 无需用户手动处理,报 'marker-residue' 反而是虚警。
      // 真正清不掉的残留仍由下方审计如实上报。
      if (articleSwitched()) return { ok: false, error: ARTICLE_SWITCHED_ERROR, committed };
      if (imageMarkers.length) {
        sweepConfirmedClean = await sweepMarkers(
          MARKER_SWEEP_PREFIX,
          (markerText) => {
            if (import.meta.env.DEV) console.info('[MarkFlow] 清扫收尾 marker', markerText);
          },
          (markerText) => tracks.some((t) => t.marker === markerText),
        );
      }

      // --- 封面(如有):把 File 塞进封面 fileInput,X 自行上传;失败不影响正文成功结论 ---
      // 契约(D4,见 protocol.ts):未请求封面时 coverSet 为 undefined(而非 false);
      // 仅在真正请求了封面时才返回 true/false 表示是否落地。
      let coverSet: boolean | undefined;
      if (articleSwitched()) return { ok: false, error: ARTICLE_SWITCHED_ERROR, committed };
      if (cover) {
        stage = 'cover';
        coverSet = await setCoverImage(cover);
        if (import.meta.env.DEV) console.info('[MarkFlow] 封面设置', { coverSet });
        // A11:封面阶段(最长 8s 等弹窗 + 多轮点 Apply)中途切文章 → setCoverImage 已放弃,如实报切换。
        if (articleSwitched()) return { ok: false, error: ARTICLE_SWITCHED_ERROR, committed };
      }

      // --- 封面后终核(不补传):清扫 / 封面期间若又被回退,按同一规则收口,保证报告与正文一致 ---
      // 稳定窗用短上限:此前无新写入时条件立即满足、不额外耗时;清扫刚写过则最多再等 1.5s。
      // 此后(结果返回后)的回退交导入后守护。终核读不到编辑器节点(返回 no-node)时不另行处理:下方残留
      // 审计会把「图已不在」的残留占位报为 image-lost,而不是 marker-residue。
      if (tracks.length) {
        stage = 'reconcile-final';
        if ((await quiesceAndReconcile(reconcileCtx, saveWatch.tracker, QUIESCE_FINAL_CAP_MS, false, 'final')) === 'switched') {
          return { ok: false, error: ARTICLE_SWITCHED_ERROR, committed };
        }
        absorbLateRecovered();
        // 被计过丢失的图若原图又回来了(瞬时回退后 X 恢复较新状态),撤销丢失记账并收口位置。
        if ((await reviveLostTracks(reconcileCtx)) === 'switched') {
          return { ok: false, error: ARTICLE_SWITCHED_ERROR, committed };
        }
      }
      // 同一事实只记一份账:失败数从明细派生,天然不会与明细条数漂移。
      // 取值位置:逐图核对(含封面后终核)之后——image-lost(图被编辑器回退丢失)计入 imageFail;
      // marker 残留审计**之前**——残留条目(marker-residue)只进明细、不计 imageFail(图本身多已
      // 落地、imageOk 已计,残留的是需手动删除的占位文本,计入会让「成功 = blockCount - imageFail」
      // 误减、toast「图片 N/M」分母虚高);其后的 orphan-media / media-order-uncertain 同样不计。
      // 例外:残留审计把「图已不在」的残留占位改报 image-lost 时同步 +1(见下)。
      let imageFail = imageFailures.length;

      // --- marker 残留审计:sweep 未能确认干净时,读最终 state 如实上报,不再静默 ---
      // 此前残留完全不可见:报告 0 失败、console 无 error(真机回归批次三 T6)。本次 run 的
      // marker 能从尾部序号映射回第几张图 → 计入明细(reason 'marker-residue');历史前缀的
      // 残留映射不回本次图,仅 console 告警。放在封面阶段之后审计,多留 X 异步 commit 的时间。
      // 审计**始终执行**(review 修复):sweep 只认完整 marker 形状,用户中途在占位行内回车/
      // X commit 切块可能留下「残片」(含本次随机前缀但缺尾部 `__`)——sweep 对残片按用户内容
      // 跳过并报 clean,若审计只在 !sweepConfirmedClean 时跑,残片就静默留在正文。本次随机
      // 前缀不会与用户正文撞车(用户写 `__MARKFLOW_IMG_` 字面量不含随机段),据此精确识别。
      if (imageMarkers.length || !sweepConfirmedClean) {
        const node = findDraftStateNode();
        if (node) {
          const auditContent = readEditorState(node).getCurrentContent();
          const auditMap = auditContent.getBlockMap();
          const re = new RegExp(`${markerPrefix}(\\d+)__`, 'g'); // markerPrefix 仅含字母数字下划线,无需转义
          const residueIdx = new Set<number>();
          let foreignResidue = false;
          let fragmentResidue = false;
          auditMap.forEach((block) => {
            if (block.getType() === 'atomic') return;
            const text = block.getText();
            let m: RegExpExecArray | null;
            re.lastIndex = 0;
            while ((m = re.exec(text))) residueIdx.add(Number(m[1]));
            // 剥掉全部完整形状后仍含本次前缀 → 残片(不完整 marker,sweep 不动它)。
            if (text.replace(new RegExp(`${markerPrefix}\\d+__`, 'g'), '').includes(markerPrefix)) {
              fragmentResidue = true;
            }
            if (text.includes(MARKER_SWEEP_PREFIX) && !text.includes(markerPrefix)) foreignResidue = true;
          });
          for (const idx of residueIdx) {
            const t = tracks[idx];
            if (t && t.expected === 'placed') {
              if (!observeTrack(auditContent, t, tracks, initialMedia).mediaPresent) {
                // 已归位的图却认不回(终核读不到编辑器节点而跳过,或终核之后又被回退):这行占位是它仅剩的
                // 位置锚点,报 marker-residue 会引导用户把它当垃圾删掉——改报 image-lost(计入 imageFail),
                // 并转为「应为原文」,导入后守护随后把占位写回该图原文。
                t.expected = 'failed';
                t.lostAwaitingFallback = true;
                reconcileCtx.onLost(t, 'reverted by editor; placeholder kept as the only position anchor');
                imageFail += 1;
                continue;
              }
              // 图在、占位也在(同样只会出现在终核跳过或终核之后又被回退时):报 marker-residue 会诱导用户删掉
              // 占位、图却仍停在被回退到的旧位置(常为文末)。此处仍在 runImport 内、写入闸门有效,按终核同一
              // 口径顺手收口一次(挪回占位处;不能挪则只剥占位串并告警);收口不了才如实报残留。
              if ((await relocateOrStrip(reconcileCtx, t, '残留审计')) === 'switched') {
                return { ok: false, error: ARTICLE_SWITCHED_ERROR, committed };
              }
              // 读最新 state 复核:占位确已不在才算收口;仍在(写入未落地)则如实报残留。
              const after = findDraftStateNode();
              // 读不到节点时无法确认已收口:保守地照报残留,不静默放过(复审 N2)。
              if (after && findMarkerBlock(readEditorState(after).getCurrentContent(), t.marker) === null) continue;
            }
            // 失败图的残留(原文写回失败等)照旧报 marker-residue。
            pushFailure(idx, imageMarkers[idx]?.source ?? '', 'upload', 'marker-residue');
          }
          if (fragmentResidue) console.warn('[MarkFlow] 检测到本次导入 marker 的残片(不完整形状),请在正文手动检查删除');
          if (foreignResidue) console.warn('[MarkFlow] 检测到历史导入残留的 marker(非本次),清扫未果,请在正文手动删除');
        }
      }

      // --- B2 孤儿图审计:正文新增 MEDIA 块数 > imageOk → 有晚到却无法归属的图,如实上报 ---
      // 放在封面之后,给末张超时图的晚到上传多留时间被「看见」(此时不再归位,只上报)。
      // 不计 imageFail(同 marker-residue,在 imageFail 取值之后才推入明细)。
      let orphanMedia = 0;
      if (initialMedia) {
        const node = findDraftStateNode();
        if (node) {
          let added = 0;
          for (const k of snapshotMediaKeys(node)) if (!initialMedia.has(k)) added += 1;
          orphanMedia = Math.max(0, added - imageOk);
          if (orphanMedia > 0) {
            // 归属取「最可能的来源」:最早仍未追回的超时图;无则首个 upload 失败图;再无取末张图。
            const firstUploadFail = imageFailures.find((f) => f.stage === 'upload' && f.index >= 0);
            const idx = pendingLate[0]?.imageIndex ?? firstUploadFail?.index ?? imageMarkers.length - 1;
            pushFailure(idx, imageMarkers[idx]?.source ?? '', 'upload', 'orphan-media', `${orphanMedia} unmatched MEDIA block(s)`);
            console.warn('[MarkFlow] 正文多出无法归属的图片,请手动检查删除', { orphanMedia, added, imageOk });
            // B2 不确定提示(不猜归属,如实上报):存在「不可追踪」的未追回超时图 k(无 pendingKey,
            // 或其块已不在当前 blockMap)且 k 之后有图在循环里成功归位——那张图可能认领了 k 的
            // 晚到块,k+1 起位置可能错位。只推**一条**(index = 最早的不可追踪 k),不计 imageFail
            // (同 orphan-media,在 imageFail 取值之后推入)。以「来历不明的多余 MEDIA」> 0 为门槛
            // 压误报:X 拒收某图时全程无 pending 块是常态,不能每次都报错位;代价是错位链末块在本
            // 审计之后才到时漏报(此时孤儿也不可见),属已知残留。
            // 门槛扣除可追踪超时图自己的块:snapshotMediaKeys 把 pending 块也算 MEDIA,pendingKey 仍在
            // blockMap 的超时图(未追回)自身就会让 orphanMedia > 0,那不是错位证据。
            const auditBm = readEditorState(node).getCurrentContent().getBlockMap();
            const trackedPending = pendingLate.filter((e) => e.pendingKey !== null && auditBm.has(e.pendingKey)).length;
            const untracked =
              orphanMedia - trackedPending > 0
                ? pendingLate.find(
                    (e) => (!e.pendingKey || !auditBm.has(e.pendingKey)) && placedIndices.some((i) => i > e.imageIndex),
                  )
                : undefined;
            if (untracked) {
              const k = untracked.imageIndex;
              const last = imageMarkers.length - 1; // imageIndex 即 imageMarkers 下标(见 marker 生成处)
              // detail 不带编号:原因文案已说「这张及之后」;引擎编号在 coverKeep=remove 时会与报告卡
              // 序号(sidepanel 侧 +1)差 1,且 detail 不走 i18n——与 orphan-media 同为英文诊断串。
              pushFailure(k, imageMarkers[k]?.source ?? '', 'upload', 'media-order-uncertain', 'earlier upload timed out (untracked); this and later images may be misplaced');
              console.warn('[MarkFlow] 超时图片的晚到结果无法追踪,后续图片位置可能错位,请核对', { from: k, to: last });
            }
          }
        }
      }

      if (import.meta.env.DEV) console.info('[MarkFlow] 写入成功', { blockCount: blocks.length, effectiveMode, imageOk, imageFail, coverSet });
      if (imageFailures.length) console.warn('[MarkFlow] 图片失败明细', imageFailures);
      if (settleTimeouts.length) console.warn('[MarkFlow] settle 超时阶段', settleTimeouts);
      if (imageMarkers.length) {
        startMarkerGuard(markerPrefix, articleSwitched, interactionLog, releases, {
          tracks,
          baselineMedia: initialMedia,
          saves: saveWatch,
        });
        guardStarted = true;
      }
      return {
        ok: true,
        blockCount: blocks.length,
        effectiveMode,
        imageOk,
        imageFail,
        coverSet,
        imageFailures: imageFailures.length ? imageFailures : undefined,
        settleTimeouts: settleTimeouts.length ? [...settleTimeouts] : undefined,
        imageLateRecovered: recoveredSet.size || undefined,
        orphanMedia: orphanMedia || undefined,
      };
    } catch (err) {
      // 打完整 err 对象(含堆栈),便于定位崩在 Draft 内部的哪一步
      console.error(`[MarkFlow] 写入异常 @${stage}`, err);
      // 出错也尽力清掉已写入的 marker 占位(通用前缀,连历史遗留一并清),避免正文残留脏 token。
      // A11:已切文章则跳过清扫(清扫会经 onChange 把旧状态存进新文章),改报切换(保留 committed 等字段)。
      if (!articleSwitched()) {
        try {
          await sweepMarkers(MARKER_SWEEP_PREFIX);
        } catch {
          /* 兜底清扫本身失败则放弃 */
        }
      }
      return {
        ok: false,
        error: articleSwitched() ? ARTICLE_SWITCHED_ERROR : `${stage}: ${String(err)}`,
        committed,
        settleTimeouts: settleTimeouts.length ? [...settleTimeouts] : undefined,
      };
    } finally {
      // 复位为「一律禁止」:编辑器写入只发生在 runImport 内(见 writeBlocked 注释),不影响其他路径。
      writeBlocked = () => true;
      pendingLate = [];
      importInFlight = false;
      if (!guardStarted) {
        interactionLog.detach();
        saveWatch.disconnect();
      }
    }
  };

  // -------------------------------------------------------------------------
  // 标题设置(setTitle)—— 仅 UI 通道:打分定位标题输入框 + 原生 value setter 绕过
  // React 受控组件。蓝本见 docs/research/xposter-analysis.md §3.5(setTitleViaUi 打分法)。
  // TODO(M2+): GraphQL 补充通道(ArticleEntityUpdateTitle)——queryId 硬编码易随 X 发版
  // 失效,本阶段不落地,仅保留 UI 单通道。
  // -------------------------------------------------------------------------

  /**
   * 标题候选元素:三类字段目标(input/textarea/contenteditable)统一为 HTMLElement,
   * 具体读写时用 instanceof 收窄到 HTMLInputElement/HTMLTextAreaElement,无需额外鸭子字段。
   */
  type TitleFieldLike = HTMLElement;

  /**
   * 对单个候选元素打分:aria-label/placeholder/data-testid 含 title/标题/add title +10;
   * 位于页面上部(rect.top 较小)+3;宽 > 240 +2。返回 0 表示明显不是标题框。
   */
  const scoreTitleField = (el: HTMLElement): number => {
    const rect = el.getBoundingClientRect();
    // 不可见元素(零尺寸)直接淘汰。
    if (rect.width <= 0 || rect.height <= 0) return 0;
    const hints = [
      el.getAttribute('aria-label'),
      el.getAttribute('placeholder'),
      el.getAttribute('data-testid'),
    ]
      .filter((v): v is string => typeof v === 'string')
      .join(' ')
      .toLowerCase();
    // 关键词是**硬门槛**:未命中 title/标题 一律 0 分——否则正文大 contenteditable 会因
    // 「页面上部 + 够宽」的几何分被误选为标题框,setTitle 的 overwrite 会全选替换、
    // 把刚写入的正文清空成一行标题(数据破坏)。找不到带关键词的框宁可不设标题也不误伤正文。
    if (!/title|标题/.test(hints)) return 0;
    let score = 10;
    if (rect.top < 240) score += 3;
    if (rect.width > 240) score += 2;
    return score;
  };

  /** 遍历所有可见 input/textarea/[contenteditable],取打分最高且 > 0 者(排除正文编辑器)。 */
  const findTitleField = (): TitleFieldLike | null => {
    const editor = findEditorElement(); // 正文编辑器绝不能当标题框,双保险显式排除
    const nodes = document.querySelectorAll<HTMLElement>(
      "input, textarea, [contenteditable='true'], [contenteditable='']",
    );
    let best: TitleFieldLike | null = null;
    let bestScore = 0;
    for (const el of nodes) {
      if (el === editor) continue;
      const score = scoreTitleField(el);
      if (score > bestScore) {
        bestScore = score;
        best = el as TitleFieldLike;
      }
    }
    return bestScore > 0 ? best : null;
  };

  /** 读取候选元素的现有标题值:input/textarea 用 .value;contenteditable 用 textContent。 */
  const readTitleValue = (el: TitleFieldLike): string => {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value;
    return el.textContent ?? '';
  };

  /**
   * 设置标题(仅 UI 通道):打分定位输入框 → 冲突策略判断 → 原生 setter 写入并派发事件。
   * applied=false 表示因 keep 策略遇到已有非空标题而跳过(非错误)。
   */
  const setTitle = (title: string, conflict: TitleConflict, expectedArticleId: string | null): SetTitleResult => {
    // B3:非文章编辑路由一律拒绝——推文 compose 弹窗没有标题框,但 findTitleField 的打分
    // 可能命中页面其它带 title 关键词的输入框(搜索框等),覆盖掉用户输入。
    if (!isArticleEditorRoute()) return { ok: false, error: NOT_ARTICLE_EDITOR_ERROR };
    // A11:标题在导入成功后才设(ask 冲突弹窗可挂起很久),期间同标签 SPA 切到别篇就会改错标题。
    // expectedArticleId(导入时钉死的同一值;旧版 content 不带 → null 不比 id)+ 最近一次导入的
    // pathname 基线双重复核,任一不符即拒写。
    if (isArticleSwitched({ baselinePathname: lastImportPathname, expectedArticleId, currentPathname: location.pathname })) {
      console.warn('[MarkFlow] 目标文章已切换,拒绝设置标题', {
        expected: expectedArticleId,
        baseline: lastImportPathname,
        actual: location.pathname,
      });
      return { ok: false, error: ARTICLE_SWITCHED_ERROR };
    }

    // B5:定位阶段也可能抛(findEditorElement → fiber 遍历 / X 改版 DOM 形状变化),此前无 try
    // → promise reject、set-title-result 永不发出、content 只见 timeout。明确失败码便于归类。
    let field: TitleFieldLike | null;
    try {
      field = findTitleField();
    } catch (err) {
      console.warn('[MarkFlow] 标题框定位异常', err);
      return { ok: false, error: `title-field-lookup-exception: ${String(err)}` };
    }
    if (!field) return { ok: false, error: 'title field not found' };

    try {
      const existing = readTitleValue(field);
      // C33:现有标题与目标相同 → 视同已设好,不构成冲突(ask 模式以 keep 探测,此前会
      // 返回 applied:false 触发「覆盖/保留」弹窗,同标题也问一遍)。不写入,免得无谓派发事件。
      if (existing.trim().length > 0 && existing.trim() === title.trim()) {
        return { ok: true, applied: true };
      }
      // keep 策略:已有非空标题则跳过,不视为错误。
      if (existing.trim().length > 0 && conflict === 'keep') {
        return { ok: true, applied: false };
      }

      if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
        // 原生 value setter 绕过 React 受控组件(直接赋 .value 不会触发 React 的 change 追踪)。
        const proto =
          field instanceof HTMLInputElement
            ? HTMLInputElement.prototype
            : HTMLTextAreaElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(field, title);
        else field.value = title;
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        // contenteditable:focus + 全选 + execCommand insertText 覆盖。
        // 关键:只有**成功全选**后才用 insertText——无选区时 insertText 会在光标处
        // 追加而非替换,得到「旧标题+新标题」;故无选区/失败一律走 textContent 覆盖。
        field.focus();
        const selection = window.getSelection();
        let replaced = false;
        if (selection) {
          const range = document.createRange();
          range.selectNodeContents(field);
          selection.removeAllRanges();
          selection.addRange(range);
          replaced = document.execCommand('insertText', false, title);
        }
        if (!replaced) {
          field.textContent = title;
          field.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
      return { ok: true, applied: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  };

  window.addEventListener('message', async (e) => {
    if (!isIsoMessage(e)) return;
    const msg = e.data;
    if (msg.kind === 'hello') {
      // 回执握手,回显 ISOLATED 侧生成的 nonce
      post({ source: MAIN_SOURCE, kind: 'hello-ack', nonce: msg.nonce });
    } else if (msg.kind === 'probe') {
      // 执行探针,回显请求的 nonce/id 以便 content 侧精确匹配并发请求。
      // B5:runProbe 内部已兜底 try/catch,这里再兜一层——无论如何都要发出 probe-result,
      // 否则 content 只见 2.5s timeout、三灯无从得知真实原因。
      let result: ProbeResult;
      try {
        result = runProbe();
      } catch (err) {
        result = {
          hasEditor: false,
          hasDraftNode: false,
          hasOnFilesAdded: false,
          articleId: null,
          hasContent: false,
          isArticleEditor: isArticleEditorRoute(),
          error: String(err),
        };
      }
      post({ source: MAIN_SOURCE, kind: 'probe-result', nonce: msg.nonce, id: msg.id, result });
    } else if (msg.kind === 'import') {
      // 执行写入(async:取样轮询 / 图片上传都要 await),回显 nonce/id。
      // runImport 自身全程 try/catch;这里兜底的是其 try 之外的极少数语句(B5 同类:永远有应答)。
      let result: ImportResult;
      try {
        result = await runImport(msg.blocks, msg.mode, msg.images, msg.cover, msg.expectedArticleId ?? null);
      } catch (err) {
        console.error('[MarkFlow] runImport 未捕获异常', err);
        result = { ok: false, error: `import-exception: ${String(err)}` };
      }
      post({ source: MAIN_SOURCE, kind: 'import-result', nonce: msg.nonce, id: msg.id, result });
    } else if (msg.kind === 'set-title') {
      // 设置标题(仅 UI 通道),回显 nonce/id;B5:任何异常都回明确失败码而非无应答。
      if (import.meta.env.DEV) console.info('[MarkFlow] 设置标题开始', { conflict: msg.conflict });
      let result: SetTitleResult;
      try {
        // 旧版 content 不带 expectedArticleId(或页面伪造非字符串)→ 按 null 兼容(不比 id,pathname 基线仍复核)。
        const expectedArticleId = typeof msg.expectedArticleId === 'string' ? msg.expectedArticleId : null;
        result = setTitle(msg.title, msg.conflict, expectedArticleId);
      } catch (err) {
        console.error('[MarkFlow] setTitle 未捕获异常', err);
        result = { ok: false, error: `set-title-exception: ${String(err)}` };
      }
      if (import.meta.env.DEV) console.info('[MarkFlow] 设置标题结果', result);
      post({ source: MAIN_SOURCE, kind: 'set-title-result', nonce: msg.nonce, id: msg.id, result });
    }
  });

  // 加载即广播就绪(content 可能已在监听;若晚于 content,content 的重试 hello 会兜底)。
  post({ source: MAIN_SOURCE, kind: 'ready' });
});
