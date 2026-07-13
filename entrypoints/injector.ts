import {
  MAIN_SOURCE,
  isIsoMessage,
  type ImportBlock,
  type ImportMode,
  type ImportResult,
  type MainMessage,
  type PreparedImage,
  type ProbeResult,
  type SetTitleResult,
  type TitleConflict,
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
}

/** Draft.js SelectionState 类(从 editorState.getSelection().constructor 取得)。 */
interface DraftSelectionStatic {
  createEmpty(blockKey: string): DraftSelection;
}

/** Draft.js EditorState 实例。 */
interface DraftEditorState {
  getSelection(): DraftSelection;
  getCurrentContent(): DraftContentState;
}

/** Draft.js EditorState 类(静态方法,从 editorState.constructor 取得)。 */
interface DraftEditorStateStatic {
  push(editorState: DraftEditorState, content: DraftContentState, changeType: string): DraftEditorState;
  forceSelection(editorState: DraftEditorState, selection: DraftSelection): DraftEditorState;
}

export default defineUnlistedScript(() => {
  const post = (msg: MainMessage) => window.postMessage(msg, '*');

  // 并发导入护栏:一次写入正在进行时拒绝第二次(防止 content 误判超时后用户重试,
  // 两个 runImport 交错直改同一 Draft blockMap 造成重复/错位/按旧 key 找块崩溃)。
  let importInFlight = false;

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
    return { hasEditor, hasDraftNode, hasOnFilesAdded, articleId: getArticleId(), hasContent };
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

  /** atomic entity 的 mutability 映射(值为 xposter 源码实证,见 §2.2)。 */
  const atomicMutability = (entityType: 'DIVIDER' | 'MARKDOWN' | 'TWEET'): string =>
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

  /** 把光标钉到 marker 块起始——X 的 onFilesAdded 会把 MEDIA 块插到光标处。 */
  const placeSelectionAtMarker = (node: FiberStateNode, marker: string): boolean => {
    const es = readEditorState(node);
    const loc = findMarkerBlock(es.getCurrentContent(), marker);
    if (!loc) return false;
    const SelStatic = es.getSelection().constructor as unknown as DraftSelectionStatic;
    const ESStatic = es.constructor as unknown as DraftEditorStateStatic;
    const sel = SelStatic.createEmpty(loc.blockKey).merge({ anchorOffset: 0, focusOffset: 0 });
    (node.props?.onChange as (s: DraftEditorState) => void)(ESStatic.forceSelection(es, sel));
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

  /**
   * 轮询等待「快照外新增的 MEDIA atomic 块」。有 mediaId 即视为完成;budget 内始终 pending
   * (有块但无 mediaId)则返回该块 key(正文图不强依赖 mediaId,封面才需——留待下一里程碑)。
   */
  const waitForNewMedia = async (before: Set<string>, budgetMs: number): Promise<string | null> => {
    const deadline = Date.now() + budgetMs;
    let lastPending: string | null = null;
    while (Date.now() < deadline) {
      await delay(350);
      const node = findDraftStateNode();
      if (!node) continue;
      const content = readEditorState(node).getCurrentContent();
      let readyKey: string | null = null;
      content.getBlockMap().forEach((block, key) => {
        if (readyKey) return;
        if (block.getType() !== 'atomic' || before.has(key)) return;
        const ek = block.getEntityAt(0);
        if (!ek) return;
        try {
          const ent = content.getEntity(ek);
          if (ent.getType() !== 'MEDIA') return;
          if (extractMediaId(ent.getData()) !== null) readyKey = key;
          else lastPending = key;
        } catch {
          /* ignore */
        }
      });
      if (readyKey) return readyKey;
    }
    return lastPending;
  };

  /** 重排 blockMap:删除 marker 块,把 MEDIA 块移到 marker 原位置。 */
  const relocateMediaToMarker = (node: FiberStateNode, marker: string, mediaKey: string): boolean => {
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
    const sel = SelStatic.createEmpty(lastKey);
    const nc = content.set('blockMap', nextMap).set('selectionBefore', sel).set('selectionAfter', sel);
    let ns = ESStatic.push(es, nc, 'move-block');
    ns = ESStatic.forceSelection(ns, sel);
    (node.props?.onChange as (s: DraftEditorState) => void)(ns);
    return true;
  };

  /** 把 marker 块整体替换为一段普通文本(上传失败时写回 fallbackText 原文,不静默丢内容)。 */
  const replaceMarkerWithText = (node: FiberStateNode, marker: string, text: string): void => {
    const es = readEditorState(node);
    const content = es.getCurrentContent();
    const blockMap = content.getBlockMap();
    const loc = findMarkerBlock(content, marker);
    if (!loc) return;
    const block = blockMap.get(loc.blockKey);
    if (!block) return;
    const sample = findCharacterSample(blockMap);
    if (!sample) return;
    const nextText = loc.exact ? text : block.getText().split(marker).join(text);
    let characterList = block.getCharacterList().clear();
    const plain = sample.set('style', sample.getStyle().clear()).set('entity', null);
    for (let i = 0; i < nextText.length; i += 1) characterList = characterList.push(plain);
    const nextBlock = block.merge({ type: 'unstyled', text: nextText, characterList });
    const nextMap = blockMap.set(loc.blockKey, nextBlock);
    const SelStatic = es.getSelection().constructor as unknown as DraftSelectionStatic;
    const ESStatic = es.constructor as unknown as DraftEditorStateStatic;
    const sel = SelStatic.createEmpty(loc.blockKey);
    const nc = content.set('blockMap', nextMap).set('selectionBefore', sel).set('selectionAfter', sel);
    let ns = ESStatic.push(es, nc, 'change-block-data');
    ns = ESStatic.forceSelection(ns, sel);
    (node.props?.onChange as (s: DraftEditorState) => void)(ns);
  };

  /** 兜底清扫:把任何残留的 __MARKFLOW_IMG_ marker 块清空删除,防中断后正文留脏占位符。 */
  const sweepMarkers = (prefix: string): void => {
    const node = findDraftStateNode();
    if (!node) return;
    const es = readEditorState(node);
    const content = es.getCurrentContent();
    const blockMap = content.getBlockMap();
    const toDelete: string[] = [];
    blockMap.forEach((block, key) => {
      if (block.getType() === 'atomic') return;
      if (block.getText().includes(prefix)) toDelete.push(key);
    });
    if (!toDelete.length) return;
    // Draft 不接受空 blockMap:若待删覆盖全部块(如纯单图文档 + 上传与降级都失败),
    // 保留第一个待删块、把它清空为普通空段落,只删其余——避免空 map + 指向已删块的 selection 崩。
    let survivorCount = 0;
    blockMap.forEach((_b, key) => {
      if (!toDelete.includes(key)) survivorCount += 1;
    });
    let nextMap = blockMap;
    let delKeys = toDelete;
    if (survivorCount === 0) {
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
    // nextMap 此时保证非空(survivorCount===0 时已保留 keepKey),last() 必有值。
    const sel = SelStatic.createEmpty((last ?? blockMap.first()).getKey());
    const nc = content.set('blockMap', nextMap).set('selectionBefore', sel).set('selectionAfter', sel);
    let ns = ESStatic.push(es, nc, 'remove-range');
    ns = ESStatic.forceSelection(ns, sel);
    (node.props?.onChange as (s: DraftEditorState) => void)(ns);
  };

  /**
   * 上传单张图:钉光标到 marker → 找 onFilesAdded → 交 File → 轮询新 MEDIA → 归位 + 清 marker。
   * 成功 true;失败(无回调/超时)false——由调用方写回 fallbackText。
   */
  const uploadOneImage = async (marker: string, file: File, budgetMs: number): Promise<boolean> => {
    let node = findDraftStateNode();
    if (!node) return false;
    if (!placeSelectionAtMarker(node, marker)) return false;
    await delay(80);

    node = findDraftStateNode();
    if (!node) return false;
    const onFilesAdded = findOnFilesAdded();
    if (!onFilesAdded) return false;
    const before = snapshotMediaKeys(node);

    try {
      onFilesAdded([file]);
    } catch (err) {
      console.warn('[MarkFlow] onFilesAdded 调用失败', err);
      return false;
    }

    const mediaKey = await waitForNewMedia(before, budgetMs);
    if (!mediaKey) return false;

    await delay(120);
    node = findDraftStateNode();
    if (node) relocateMediaToMarker(node, marker, mediaKey);
    return true;
  };

  /**
   * 核心写入:借页面构造器逐块构造 blockMap 并经 X 自己的 onChange 提交。
   * 全程 try/catch,异常带「失败环节前缀」(stage)返回,便于诊断定位。
   */
  const runImport = async (
    blocks: ImportBlock[],
    mode: ImportMode,
    images: PreparedImage[],
  ): Promise<ImportResult> => {
    if (importInFlight) return { ok: false, error: 'import already in progress' };
    importInFlight = true;
    let stage = 'draft node';
    const imageCount = blocks.filter((b) => b.kind === 'image').length;
    console.info('[MarkFlow] 写入开始', { blocks: blocks.length, mode, images: imageCount });
    // 每次运行独立的 marker 前缀,避免与历史残留 / 并发写入串扰。
    const markerPrefix = `__MARKFLOW_IMG_${Math.random().toString(36).slice(2, 8)}_`;
    // 记录每个图片 marker、其在 images[] 中的下标(按文档顺序 = 第几个 ImageBlock)、及失败兜底原文。
    const imageMarkers: Array<{ marker: string; imageIndex: number; fallbackText: string }> = [];
    try {
      let draftNode = findDraftStateNode();
      if (!draftNode) return { ok: false, error: 'draft state node not found' };

      // --- 取样本字符 -------------------------------------------------------
      stage = 'sample character';
      let sample = findCharacterSample(readEditorState(draftNode).getCurrentContent().getBlockMap());
      // 凡走 execCommand 取样,后续一律按 replace 处理(插入的 'x' 会被整体替换掉)。
      let forcedReplace = false;

      if (!sample) {
        // 全空草稿:focus 编辑器 → execCommand 强插一个字符逼出样本 → 轮询重抓等 React 落盘。
        findEditorElement()?.focus();
        document.execCommand('insertText', false, 'x');
        for (let waited = 0; waited < 1600 && !sample; waited += 100) {
          await delay(100);
          const node = findDraftStateNode();
          if (!node) continue;
          const bm = readEditorState(node).getCurrentContent().getBlockMap();
          const s = findCharacterSample(bm);
          if (s) {
            sample = s;
            draftNode = node; // 采用取样后的最新状态节点
          }
        }
        if (!sample) return { ok: false, error: 'sample character: unable to acquire via execCommand' };
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
      console.info('[MarkFlow] 写入模式', { effectiveMode, forcedReplace, contentEmpty });

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
          const nextBlock = sampleBlock.merge({
            key,
            type: block.type,
            text: block.text,
            characterList,
            depth: 0,
            data: emptyBlockData,
          });
          built.push([key, nextBlock]);
        } else if (block.kind === 'atomic') {
          // 代码块 / 分割线 / 推文:M1 单趟构造(无需 marker,这三类不走异步上传)。
          const mutability = atomicMutability(block.entityType);
          nextContent = nextContent.createEntity(block.entityType, mutability, block.data);
          const entityKey = nextContent.getLastCreatedEntityKey();
          const char = sample.set('style', emptyStyle).set('entity', entityKey);
          const nextBlock = sampleBlock.merge({
            key,
            type: 'atomic',
            text: ' ', // atomic 块约定单空格文本,该字符挂 entity key
            characterList: emptyCharList.push(char),
            depth: 0,
            data: emptyBlockData,
          });
          built.push([key, nextBlock]);
        } else {
          // 图片:先写一个「仅含 marker」的 unstyled 占位块;上传阶段再替换为 MEDIA / fallback。
          // 图片上传是异步的,必须占位 + 事后归位(见 uploadOneImage)。
          const imageIndex = imageMarkers.length;
          const marker = `${markerPrefix}${imageIndex}__`;
          imageMarkers.push({ marker, imageIndex, fallbackText: block.fallbackText });
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
      let next = EditorStateClass.push(editorState, nextContent, 'insert-fragment');
      next = EditorStateClass.forceSelection(next, endSelection);
      (draftNode.props?.onChange as (s: DraftEditorState) => void)(next);
      console.info('[MarkFlow] onChange 已提交,块数', built.length);

      // --- 轻验证(仅 replace 强校验:新 blockMap 含我们的 key 数 ≥ blocks.length)------
      stage = 'verify';
      await delay(150);
      if (effectiveMode === 'replace') {
        const verifyNode = findDraftStateNode();
        if (verifyNode) {
          const verifyMap = readEditorState(verifyNode).getCurrentContent().getBlockMap();
          const ourKeys = new Set(built.map(([k]) => k));
          let hit = 0;
          verifyMap.forEach((b) => {
            if (ourKeys.has(b.getKey())) hit += 1;
          });
          if (hit < blocks.length) {
            return { ok: false, error: `verify: only ${hit}/${blocks.length} blocks landed` };
          }
        }
      }

      // --- 图片上传阶段(marker 占位已随正文提交;逐图异步上传 + 归位 + 清 marker)------
      stage = 'images';
      let imageOk = 0;
      let imageFail = 0;
      for (const { marker, imageIndex, fallbackText } of imageMarkers) {
        const file = images[imageIndex]?.file ?? null;
        if (!file) {
          // 准备失败(远程被拒/权限未授/本地暂不支持):写回原文,不静默丢内容。
          const node = findDraftStateNode();
          if (node) replaceMarkerWithText(node, marker, fallbackText);
          imageFail += 1;
          continue;
        }
        let uploaded = false;
        try {
          uploaded = await uploadOneImage(marker, file, 30_000);
        } catch (e) {
          console.warn('[MarkFlow] 图片上传异常', e);
        }
        if (uploaded) {
          imageOk += 1;
        } else {
          imageFail += 1;
          const node = findDraftStateNode();
          if (node) replaceMarkerWithText(node, marker, fallbackText);
        }
      }
      // 兜底清扫:任何残留 marker(中断/异常时)一并清掉,正文不留脏占位符。
      if (imageMarkers.length) sweepMarkers(markerPrefix);

      console.info('[MarkFlow] 写入成功', { blockCount: blocks.length, effectiveMode, imageOk, imageFail });
      return { ok: true, blockCount: blocks.length, effectiveMode, imageOk, imageFail };
    } catch (err) {
      // 打完整 err 对象(含堆栈),便于定位崩在 Draft 内部的哪一步
      console.error(`[MarkFlow] 写入异常 @${stage}`, err);
      // 出错也尽力清掉已写入的 marker 占位,避免正文残留脏 token。
      try {
        sweepMarkers(markerPrefix);
      } catch {
        /* 兜底清扫本身失败则放弃 */
      }
      return { ok: false, error: `${stage}: ${String(err)}` };
    } finally {
      importInFlight = false;
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
  const setTitle = (title: string, conflict: TitleConflict): SetTitleResult => {
    const field = findTitleField();
    if (!field) return { ok: false, error: 'title field not found' };

    // keep 策略:已有非空标题则跳过,不视为错误。
    const existing = readTitleValue(field);
    if (existing.trim().length > 0 && conflict === 'keep') {
      return { ok: true, applied: false };
    }

    try {
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
      // 执行探针,回显请求的 nonce/id 以便 content 侧精确匹配并发请求
      const result = runProbe();
      post({ source: MAIN_SOURCE, kind: 'probe-result', nonce: msg.nonce, id: msg.id, result });
    } else if (msg.kind === 'import') {
      // 执行写入(async:取样轮询 / 图片上传都要 await),回显 nonce/id
      const result = await runImport(msg.blocks, msg.mode, msg.images);
      post({ source: MAIN_SOURCE, kind: 'import-result', nonce: msg.nonce, id: msg.id, result });
    } else if (msg.kind === 'set-title') {
      // 设置标题(仅 UI 通道),回显 nonce/id
      console.info('[MarkFlow] 设置标题开始', { conflict: msg.conflict });
      const result = setTitle(msg.title, msg.conflict);
      console.info('[MarkFlow] 设置标题结果', result);
      post({ source: MAIN_SOURCE, kind: 'set-title-result', nonce: msg.nonce, id: msg.id, result });
    }
  });

  // 加载即广播就绪(content 可能已在监听;若晚于 content,content 的重试 hello 会兜底)。
  post({ source: MAIN_SOURCE, kind: 'ready' });
});
