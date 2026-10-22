import {
  MAIN_SOURCE,
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
  // 跨实例单例守卫(B2-4):同一页面被二次注入(dev 热重载 / BFCache 恢复叠加重注入)时,
  // 两个实例会**各自**响应同一条 import 消息并发直写同一 blockMap(各自的 importInFlight
  // 互不可见)——草稿重复/损坏且 content 只认第一个回包,完全不可见。首个实例占坑,
  // 后来者直接退出(旧实例继续服务;「新代码不接管」是可接受取舍,生产首要目标是杜绝双执行)。
  const INSTANCE_KEY = Symbol.for('markflow.injector.v1');
  const w = window as unknown as Record<symbol, boolean | undefined>;
  if (w[INSTANCE_KEY]) {
    console.info('[MarkFlow] injector 已有存活实例,跳过重复初始化');
    return;
  }
  w[INSTANCE_KEY] = true;

  // targetOrigin 收敛为本页 origin(而非 '*'):MAIN world 与页面同 JS 上下文,此为**纵深收敛**
  // ——挡住把消息投递到跨 origin 的 iframe/嵌入上下文,缩小误发面;并非完全隔离(同源脚本仍可监听)。
  const post = (msg: MainMessage) => window.postMessage(msg, window.location.origin);

  // 并发导入护栏:一次写入正在进行时拒绝第二次(防止 content 误判超时后用户重试,
  // 两个 runImport 交错直改同一 Draft blockMap 造成重复/错位/按旧 key 找块崩溃)。
  let importInFlight = false;

  // 多级 fallback 选择器(B2-6 改造):**有序数组逐级尝试**——此前是逗号并集,
  // querySelectorAll 按文档顺序返回、书写顺序毫无优先级,"分级"实为假象;且原第一级
  // `[data-contents='true'] [contenteditable='true']` 按 Draft 结构 data-contents 是
  // contenteditable 的**子**节点,永不命中,已删除。层级从「真机实测指纹」到「裸 contenteditable」
  // 逐级放宽(data-testid="composer" 与 .public-DraftEditor-content 见 docs/技术方案设计.md §2.1)。
  // 标题字段是 textarea(非 contenteditable),天然不会被任何一级命中,无需显式排除。
  const EDITOR_SELECTOR_TIERS = [
    "[contenteditable='true'][data-testid='composer']",
    "[contenteditable='true'].public-DraftEditor-content",
    "[contenteditable='true'][role='textbox']",
    "[contenteditable='true']",
  ] as const;

  /**
   * 定位正文编辑器元素:按层级依次查询,级内用几何尺寸(宽 > 200 且高 > 80)过滤掉小型
   * contenteditable,取**面积最大者**(而非文档顺序第一个)——同级多命中时正文必然最大。
   */
  const findEditorElement = (): HTMLElement | null => {
    for (const selector of EDITOR_SELECTOR_TIERS) {
      let best: HTMLElement | null = null;
      let bestArea = 0;
      for (const el of document.querySelectorAll<HTMLElement>(selector)) {
        const rect = el.getBoundingClientRect();
        if (rect.width <= 200 || rect.height <= 80) continue;
        const area = rect.width * rect.height;
        if (area > bestArea) {
          best = el;
          bestArea = area;
        }
      }
      if (best) return best;
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
   * 轮询等待「快照外新增的 MEDIA atomic 块」。
   * - 出现 mediaId → confirmed:true(上传确认完成);
   * - 只有 entity、无 mediaId(pending)→ 按 §3.2「数据签名稳定性」判定:签名 5s 不变 + 出现 ≥20s,
   *   或出现满 32s 封顶 → confirmed:true(正文图放行);未达标而 budget 到点 → confirmed:false(未确认);
   * - 全程未出现新 MEDIA 块 → null。
   * 返回 confirmed 交由调用方决定成功/降级——**「有块但未确认」绝不谎报成功**。
   */
  const waitForNewMedia = async (
    before: Set<string>,
    budgetMs: number,
  ): Promise<{ key: string; confirmed: boolean } | null> => {
    const deadline = Date.now() + budgetMs;
    // 当前 pending 块的跟踪:firstSeen=首次出现时刻;signature/signatureSince=最近签名及其保持起始时刻。
    let pending: { key: string; firstSeen: number; signature: string; signatureSince: number } | null = null;
    while (Date.now() < deadline) {
      await delay(350);
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
      if (readyKey) return { key: readyKey, confirmed: true };

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
        if ((stableFor >= PENDING_STABLE_MS && age >= PENDING_MIN_AGE_MS) || age >= PENDING_CAP_MS) {
          return { key: pending.key, confirmed: true };
        }
      } else {
        pending = null; // pending 块消失(可能被 X 换成带 mediaId 的块,下轮会命中 readyKey)
      }
    }
    // budget 到点仍未确认:有 pending 块则如实标 confirmed:false(交调用方降级),无块则 null。
    return pending ? { key: pending.key, confirmed: false } : null;
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

  /**
   * §3.3 fallbackIndex 兜底配对:relocateMediaToMarker 归位失败(通常 marker 块已被 X 消费/找不到,
   * 无法精确顶替其位置)时的降级——只要目标 MEDIA 块确实存在于正文(X 已按我们钉的光标位置插入),
   * 即视为「已配对成功」:媒体已在文中,精确位置退让,残留 marker 交 sweepMarkers 收尾。
   * 仅当 MEDIA 块本身也不在 blockMap(真丢失)时才返回 false → 交调用方计 imageFail + 写回 fallbackText。
   */
  const relocateMediaByFallbackIndex = (node: FiberStateNode, mediaKey: string): boolean =>
    readEditorState(node).getCurrentContent().getBlockMap().has(mediaKey);

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
  ): Promise<boolean> => {
    let cleanStreak = 0;
    for (let round = 0; round < 6; round += 1) {
      await delay(round === 0 ? 120 : 220); // 首轮短等,后续留足 X commit 时间
      const r = sweepMarkersOnce(prefix, onSwept);
      if (r === 'clean') {
        cleanStreak += 1;
        if (cleanStreak >= 2) return true; // 连续两轮确认干净 → 收工
      } else {
        cleanStreak = 0; // 本轮扫掉了残留 / 读不到节点 → 重新累计确认
      }
    }
    return false;
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
   */
  const sweepMarkersOnce = (
    prefix: string,
    onSwept?: (markerText: string) => void,
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
      sweptMarkers.push(...matches);
      const stripped = text.replace(MARKER_FULL_RE, '');
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
    // nextMap 此时保证非空(survivorCount===0 时已保留 keepKey),last() 必有值。
    const sel = SelStatic.createEmpty((last ?? blockMap.first()).getKey());
    const nc = content.set('blockMap', nextMap).set('selectionBefore', sel).set('selectionAfter', sel);
    let ns = ESStatic.push(es, nc, 'remove-range');
    ns = ESStatic.forceSelection(ns, sel);
    (node.props?.onChange as (s: DraftEditorState) => void)(ns);
    if (onSwept) for (const m of sweptMarkers) onSwept(m);
    return 'swept'; // 本轮处理了残留 → 交外层再验(须此后连续两轮 clean 才算收工)
  };

  /** uploadOneImage 的结果:失败时带原因码(在知道原因的这一层产生,调用方只透传进失败明细)。 */
  type UploadOutcome = { ok: true } | { ok: false; reason: ImageFailReason; detail?: string };

  /**
   * 上传单张图:钉光标到 marker → 找 onFilesAdded → 交 File → 轮询新 MEDIA → 归位 + 清 marker。
   * 失败按路径回具体原因码——此前只回 boolean,8 条互异失败路径在调用点被统一猜成「超时」,
   * 失败明细的诊断价值在最复杂的 upload 阶段归零(review 批次三)。失败均由调用方写回 fallbackText。
   */
  const uploadOneImage = async (marker: string, file: File, budgetMs: number): Promise<UploadOutcome> => {
    let node = findDraftStateNode();
    if (!node) return { ok: false, reason: 'upload-no-editor' };
    if (!placeSelectionAtMarker(node, marker)) return { ok: false, reason: 'upload-marker-lost' };
    await delay(80);

    node = findDraftStateNode();
    if (!node) return { ok: false, reason: 'upload-no-editor' };
    const onFilesAdded = findOnFilesAdded();
    if (!onFilesAdded) return { ok: false, reason: 'upload-no-callback' };
    const before = snapshotMediaKeys(node);

    try {
      onFilesAdded([file]);
    } catch (err) {
      console.warn('[MarkFlow] onFilesAdded 调用失败', err);
      return { ok: false, reason: 'upload-exception', detail: String(err) };
    }

    const media = await waitForNewMedia(before, budgetMs);
    // 无新 MEDIA 块,或有块但未确认(无 mediaId 且稳定性未达标)→ 未确认成功,交调用方降级。
    if (!media || !media.confirmed) return { ok: false, reason: 'upload-timeout' };

    await delay(120);
    node = findDraftStateNode();
    // MEDIA 已确认后的失败一律归「归位失败」:图大概率已进 X 媒体库,只是没落进正文——
    // 与「超时」的排查方向完全不同(不该去查网络/重试,而该看正文结构)。
    if (!node) return { ok: false, reason: 'upload-relocate-failed' };
    // 归位:优先精确顶替 marker 位置;失败则走 §3.3 fallbackIndex 兜底;仍失败(MEDIA 块丢失)才算失败。
    if (relocateMediaToMarker(node, marker, media.key)) return { ok: true };
    node = findDraftStateNode();
    if (node && relocateMediaByFallbackIndex(node, media.key)) return { ok: true };
    return { ok: false, reason: 'upload-relocate-failed' };
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
        apply = findApplyButton();
        if (apply) break;
      }
      if (!apply) return false; // 8s 内没等到裁剪弹窗内的 Apply:未能落地,如实返回 false。

      // 点 Apply 并**确认弹窗真的关闭**才算成功——裸 .click() 对 X 裁剪按钮偶发不响应(点了、
      // coverSet 谎报 true、弹窗却残留)。故用 realClick 派发完整事件序列,并轮询到「弹窗内 Apply
      // 消失」为准;单次没关就重新定位再点(DOM 可能重渲染),最多 5 轮。
      for (let attempt = 0; attempt < 5; attempt += 1) {
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
    importInFlight = true;
    // 以下声明本身不会抛错,且 catch(stage)/finally 需引用,故留在 try 外层:
    let stage = 'draft node';
    // B2-2:主 onChange 提交后置 true。提交后再失败(verify 不达标/图片阶段异常)时正文已
    // (部分)落地,失败结果带上它,UI 才能提示「正文可能已写入」而不是诱导用户重试导致重复。
    let committed = false;
    // B2-1 持续校验(review 修复):入口校验只挡得住「点确认前」的切换;空稿取样最长再等 1.6s、
    // 图片/清扫/封面阶段可达数分钟,期间 SPA 切文章后 findDraftStateNode 会解析到**新文章**的
    // 编辑器——继续写就砸错目标。故 commit 前与每个后续阶段前都复查,切换即停手。
    const articleSwitched = (): boolean =>
      expectedArticleId != null && getArticleId() !== expectedArticleId;
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
      console.info('[MarkFlow] 写入开始', { blocks: blocks.length, mode, images: imageCount });
      // B2-1 双钥校验:在触碰编辑器之前比对目标文章——ask 弹窗挂起期间用户在同一 tab 内
      // SPA 切到另一篇草稿时(tabId 不变,sidepanel 的钉 tab 挡不住),这里是最后一道闸。
      if (expectedArticleId != null && getArticleId() !== expectedArticleId) {
        console.warn('[MarkFlow] 目标文章已切换,拒绝写入', { expected: expectedArticleId, actual: getArticleId() });
        return { ok: false, error: 'article-switched' };
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
      if (articleSwitched()) return { ok: false, error: 'article-switched' };
      let next = EditorStateClass.push(editorState, nextContent, 'insert-fragment');
      next = EditorStateClass.forceSelection(next, endSelection);
      (draftNode.props?.onChange as (s: DraftEditorState) => void)(next);
      committed = true; // B2-2:此后任何失败都属「提交后失败」,结果须如实带 committed
      console.info('[MarkFlow] onChange 已提交,块数', built.length);

      // --- 轻验证(仅 replace 强校验:新 blockMap 含我们的 key 数 ≥ blocks.length)------
      stage = 'verify';
      await delay(150);
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
          if (imageMarkers.length) await sweepMarkers(MARKER_SWEEP_PREFIX);
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
      for (const { marker, imageIndex, fallbackText, source } of imageMarkers) {
        // 每张图前复查:中途切文章立即停手(marker 留在原文章,由错误文案引导用户回去检查),
        // 绝不对切换后的文章做 replace/sweep/封面等任何改写。
        if (articleSwitched()) {
          return { ok: false, error: 'article-switched', committed };
        }
        const prep = images[imageIndex];
        const file = prep?.file ?? null;
        if (!file) {
          // 准备失败(远程被拒/本地读不到/超限/类型不符):写回原文,不静默丢内容。
          // 原因码由 content 的 prepareOneImage 随 PreparedImage 带来;prep 整项缺失
          // (典型:扩展更新后旧 content 未刷新,消息无 images)→ 'prepare-missing',
          // 提示刷新页面,不误报成崩溃类异常。
          const node = findDraftStateNode();
          if (node) replaceMarkerWithText(node, marker, fallbackText);
          if (prep) pushFailure(imageIndex, source, 'prepare', prep.failReason ?? 'prepare-exception', prep.failDetail);
          else pushFailure(imageIndex, source, 'prepare', 'prepare-missing');
          continue;
        }
        let outcome: UploadOutcome;
        try {
          // budget 需 ≥ PENDING_CAP_MS(32s),否则 pending 封顶放行分支永不触发。留足余量取 40s。
          outcome = await uploadOneImage(marker, file, 40_000);
        } catch (e) {
          console.warn('[MarkFlow] 图片上传异常', e);
          outcome = { ok: false, reason: 'upload-exception', detail: String(e) };
        }
        if (outcome.ok) {
          imageOk += 1;
        } else {
          pushFailure(imageIndex, source, 'upload', outcome.reason, outcome.detail);
          const node = findDraftStateNode();
          if (node) replaceMarkerWithText(node, marker, fallbackText);
        }
      }
      // 同一事实只记一份账:失败数从明细派生,天然不会与明细条数漂移。
      // 必须在 marker 残留审计**之前**取值:残留条目(marker-residue)只进明细、不计 imageFail
      // ——图本身多已落地(imageOk 已计),残留的是需手动删除的占位文本,计入会让
      // 「成功 = blockCount - imageFail」误减、toast「图片 N/M」分母虚高。
      const imageFail = imageFailures.length;
      // 兜底清扫:任何残留 marker(本次走 fallbackIndex 未删的 + 历史遗留的)一并清掉。
      // 用通用前缀而非本次随机 prefix——否则清不掉之前导入残留的其它 prefix 的 marker。
      let sweepConfirmedClean = true;
      // onSwept 只做诊断日志,不计失败明细:能被 sweep 清掉的 marker 主要来自 fallbackIndex
      // 「已配对成功」路径(图已在文中,marker 交清扫收尾)——图没丢,upload 失败的账在上传
      // 循环里已如实记过;清扫成功 = 无需用户手动处理,报 'marker-residue' 反而是虚警。
      // 真正清不掉的残留仍由下方审计如实上报。
      if (articleSwitched()) return { ok: false, error: 'article-switched', committed };
      if (imageMarkers.length) {
        sweepConfirmedClean = await sweepMarkers(MARKER_SWEEP_PREFIX, (markerText) =>
          console.info('[MarkFlow] 清扫收尾 marker', markerText),
        );
      }

      // --- 封面(如有):把 File 塞进封面 fileInput,X 自行上传;失败不影响正文成功结论 ---
      // 契约(D4,见 protocol.ts):未请求封面时 coverSet 为 undefined(而非 false);
      // 仅在真正请求了封面时才返回 true/false 表示是否落地。
      let coverSet: boolean | undefined;
      if (articleSwitched()) return { ok: false, error: 'article-switched', committed };
      if (cover) {
        stage = 'cover';
        coverSet = await setCoverImage(cover);
        console.info('[MarkFlow] 封面设置', { coverSet });
      }

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
          const auditMap = readEditorState(node).getCurrentContent().getBlockMap();
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
            pushFailure(idx, imageMarkers[idx]?.source ?? '', 'upload', 'marker-residue');
          }
          if (fragmentResidue) console.warn('[MarkFlow] 检测到本次导入 marker 的残片(不完整形状),请在正文手动检查删除');
          if (foreignResidue) console.warn('[MarkFlow] 检测到历史导入残留的 marker(非本次),清扫未果,请在正文手动删除');
        }
      }

      console.info('[MarkFlow] 写入成功', { blockCount: blocks.length, effectiveMode, imageOk, imageFail, coverSet });
      if (imageFailures.length) console.warn('[MarkFlow] 图片失败明细', imageFailures);
      return {
        ok: true,
        blockCount: blocks.length,
        effectiveMode,
        imageOk,
        imageFail,
        coverSet,
        imageFailures: imageFailures.length ? imageFailures : undefined,
      };
    } catch (err) {
      // 打完整 err 对象(含堆栈),便于定位崩在 Draft 内部的哪一步
      console.error(`[MarkFlow] 写入异常 @${stage}`, err);
      // 出错也尽力清掉已写入的 marker 占位(通用前缀,连历史遗留一并清),避免正文残留脏 token。
      try {
        await sweepMarkers(MARKER_SWEEP_PREFIX);
      } catch {
        /* 兜底清扫本身失败则放弃 */
      }
      return { ok: false, error: `${stage}: ${String(err)}`, committed };
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
      const result = await runImport(msg.blocks, msg.mode, msg.images, msg.cover, msg.expectedArticleId ?? null);
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
