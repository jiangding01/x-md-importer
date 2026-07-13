import {
  MAIN_SOURCE,
  isIsoMessage,
  type ImportBlock,
  type ImportMode,
  type ImportResult,
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
  getText(): string;
  getCharacterList(): DraftCharacterList;
  getData(): DraftBlockData;
  merge(props: Record<string, unknown>): DraftBlock;
}

/**
 * Immutable.OrderedMap<string, ContentBlock>。用实例方法 clear()/set() 逐个构建
 * (set 新 key 追加在尾部,保序);不用 `constructor(entries)` 直造。
 */
interface DraftBlockMap {
  first(): DraftBlock;
  forEach(cb: (block: DraftBlock) => void): void;
  clear(): DraftBlockMap;
  set(key: string, block: DraftBlock): DraftBlockMap;
}

/** Draft.js ContentState(entity 存储 + blockMap 容器,均不可变)。 */
interface DraftContentState {
  getBlockMap(): DraftBlockMap;
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

  /**
   * 核心写入:借页面构造器逐块构造 blockMap 并经 X 自己的 onChange 提交。
   * 全程 try/catch,异常带「失败环节前缀」(stage)返回,便于诊断定位。
   */
  const runImport = async (blocks: ImportBlock[], mode: ImportMode): Promise<ImportResult> => {
    let stage = 'draft node';
    console.info('[MarkFlow] 写入开始', { blocks: blocks.length, mode });
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
        } else {
          // atomic 块:M1 单趟构造(无需 marker 占位再替换,那是 M2 图片时序才需要的)。
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

      console.info('[MarkFlow] 写入成功', { blockCount: blocks.length });
      return { ok: true, blockCount: blocks.length };
    } catch (err) {
      // 打完整 err 对象(含堆栈),便于定位崩在 Draft 内部的哪一步
      console.error(`[MarkFlow] 写入异常 @${stage}`, err);
      return { ok: false, error: `${stage}: ${String(err)}` };
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
      // 执行写入(async:取样轮询 / 提交后验证都要 await),回显 nonce/id
      const result = await runImport(msg.blocks, msg.mode);
      post({ source: MAIN_SOURCE, kind: 'import-result', nonce: msg.nonce, id: msg.id, result });
    }
  });

  // 加载即广播就绪(content 可能已在监听;若晚于 content,content 的重试 hello 会兜底)。
  post({ source: MAIN_SOURCE, kind: 'ready' });
});
