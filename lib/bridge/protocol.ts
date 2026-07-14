/**
 * 跨 world 消息协议(类型化)——三方通信的单一事实来源:
 *   sidepanel ↔ content(ISOLATED world)↔ injector(MAIN world)
 *
 * 相对 xposter「12 种消息 kind 全靠约定」的工程化改进:所有消息用 discriminated
 * union 描述,收发两端共享同一份类型 + 运行时守卫(source 判别 + event.source 守卫,
 * nonce 由业务层校验)。
 *
 * 本阶段(M1 地基)只落地 content ↔ injector 的握手与探针骨架;sidepanel ↔ content
 * 的 chrome.runtime 消息在后续步骤补充。
 */

/** 消息来源标识:在同一个 window 上用于区分两个 world 的 postMessage 通道。 */
export const ISO_SOURCE = 'markflow-iso' as const; //  content(ISOLATED)→ injector
export const MAIN_SOURCE = 'markflow-main' as const; // injector(MAIN)→ content

export type IsoSource = typeof ISO_SOURCE;
export type MainSource = typeof MAIN_SOURCE;

/**
 * 编辑器探针结果(骨架)。后续 fiber/Draft 探针会填充真实判定;
 * 字段对齐技术方案 §5.2.1 的「编辑器 / Draft 实例 / 上传通道」三灯。
 */
export interface ProbeResult {
  /** 找到正文 contenteditable 编辑器元素 */
  hasEditor: boolean;
  /** fiber 上定位到 Draft 实例(props.editorState + onChange) */
  hasDraftNode: boolean;
  /** fiber 上定位到 X 的 onFilesAdded 上传回调 */
  hasOnFilesAdded: boolean;
  /** 从 URL 提取到的文章草稿 id(未在编辑页则为 null) */
  articleId: string | null;
  /**
   * 编辑器正文是否已有文本(blockMap 任一块 text 非空)。
   * 供「已有内容时询问追加/覆盖」使用;hasDraftNode 为 false 时恒为 false。
   */
  hasContent: boolean;
}

// ---------------------------------------------------------------------------
// 写入(Import)数据结构 —— 解析器(lib/markdown/parser)产出、注入引擎消费。
// 形状对齐 Draft.js RawBlock,块映射遵循《技术方案设计.md》§4.2 矩阵。
// ---------------------------------------------------------------------------

/** 行内样式区间。style 为 Draft.js 标准 inline style 名(X 原生支持这四种)。 */
export interface InlineStyleRange {
  offset: number;
  length: number;
  style: 'BOLD' | 'ITALIC' | 'STRIKETHROUGH' | 'CODE';
}

/** 链接区间:按字符区间挂 LINK entity(MUTABLE)。 */
export interface LinkRange {
  offset: number;
  length: number;
  url: string;
}

/**
 * 文本类块的 Draft block type(M1 范围)。映射:H1/H2→header-one、H3→header-two、
 * H4+→unstyled+全段 BOLD(X 仅两级标题);列表不嵌套(depth 恒 0)。
 */
export type TextBlockType =
  | 'unstyled'
  | 'header-one'
  | 'header-two'
  | 'blockquote'
  | 'unordered-list-item'
  | 'ordered-list-item';

/** 文本类块。 */
export interface TextBlock {
  kind: 'text';
  type: TextBlockType;
  text: string;
  inlineStyleRanges: InlineStyleRange[];
  links: LinkRange[];
}

/**
 * 特殊块:atomic block + X 编辑器内部 entity(类型名/数据形状为 xposter 源码实证)。
 * M1 仅这三种(无需上传通道);图片/表格 MEDIA 在 M2 加入。
 */
export type AtomicBlock =
  | { kind: 'atomic'; entityType: 'DIVIDER'; data: Record<string, never> }
  | { kind: 'atomic'; entityType: 'MARKDOWN'; data: { markdown: string } }
  | { kind: 'atomic'; entityType: 'TWEET'; data: { url: string; tweetId: string } };

/**
 * 图片块(M2 Phase 2)。解析器只产出「来源 + alt + 兜底原文」,不含字节;
 * 字节由 content(ISOLATED)按来源准备(dataURI 就地解析 / 远程走 background 代理),
 * 再以 PreparedImage 随 import 消息经 window.postMessage 交给 injector 走 onFilesAdded 上传。
 * 上传失败 → injector 把 marker 占位替换回 fallbackText(原始 `![alt](src)`),不静默丢内容。
 */
export interface ImageBlock {
  kind: 'image';
  /** 原始图片来源:远程 http(s) URL / dataURI / 本地相对路径。 */
  source: string;
  /** 图片替代文本(M2 Phase 2b 将写入 X 图注)。 */
  alt: string;
  /** 上传失败时写回正文的原始 Markdown(如 `![alt](src)`)。 */
  fallbackText: string;
}

/** 写入块 = 文本块 | 特殊块 | 图片块,按文档顺序排列。 */
export type ImportBlock = TextBlock | AtomicBlock | ImageBlock;

/** 图片来源分类:决定字节的准备路径。 */
export type ImageSourceKind = 'remote' | 'data' | 'local';

/**
 * 判定图片来源类别(决定字节准备路径)。
 * 协议相对 URL(`//host/a.png`)继承页面协议、本质是跨域远程资源,与 http(s) 同走
 * background 代理,故归 'remote'(而非误判为 'local' 走本地读取路径)。
 */
export function classifyImageSource(src: string): ImageSourceKind {
  if (src.startsWith('data:')) return 'data';
  if (/^https?:\/\//i.test(src) || src.startsWith('//')) return 'remote';
  return 'local';
}

/**
 * content 准备好、随 import 消息交给 injector 的单张图片字节。
 * file 为 null 表示该图准备失败(远程被拒/权限未授/本地暂不支持)——injector 据此走
 * fallbackText 降级。数组按**文档顺序**与 blocks 中的 ImageBlock 一一对齐(第 k 个
 * ImageBlock 用 images[k]),不额外传 marker,避免跨数组 key 维护。
 */
export interface PreparedImage {
  file: File | null;
}

/** 写入模式:replace 整体替换编辑器内容;append 在现有内容之后追加。 */
export type ImportMode = 'replace' | 'append';

/**
 * 注入引擎的写入结果。error 为面向诊断的英文短语(UI 层负责本地化归类)。
 * effectiveMode 回传实际生效的写入模式——引擎在取样失败/内容为空时会把 append
 * 降级为 replace,UI 依此感知「用户所选」与「实际执行」的偏差,不再静默。
 */
export type ImportResult =
  | {
      ok: true;
      blockCount: number;
      effectiveMode: ImportMode;
      imageOk: number;
      imageFail: number;
      /** 封面是否已设置(未请求封面时 undefined)。 */
      coverSet?: boolean;
    }
  | { ok: false; error: string };

/**
 * 标题冲突策略(编辑器已有非空标题时):overwrite 强制覆盖;keep 保留原标题、跳过设置。
 * 设置页的 'ask' 由 UI 层先询问用户,再转换为这两者之一下发。
 */
export type TitleConflict = 'overwrite' | 'keep';

/**
 * 标题设置结果。applied=false 表示因 keep 策略遇到已有标题而跳过(非错误)。
 * error 为诊断用英文短语(如 'title field not found')。
 */
export type SetTitleResult =
  | { ok: true; applied: boolean }
  | { ok: false; error: string };

/** ISOLATED → MAIN 的消息。 */
export type IsoMessage =
  | { source: IsoSource; kind: 'hello'; nonce: string }
  | { source: IsoSource; kind: 'probe'; nonce: string; id: string }
  | {
      source: IsoSource;
      kind: 'import';
      nonce: string;
      id: string;
      blocks: ImportBlock[];
      mode: ImportMode;
      /** 与 blocks 中 ImageBlock 按文档顺序对齐的已准备图片字节(File 经结构化克隆传递)。 */
      images: PreparedImage[];
      /** 封面图 File(已在 content 准备好);null=不设封面。injector 设到 X 封面 fileInput。 */
      cover: File | null;
    }
  | { source: IsoSource; kind: 'set-title'; nonce: string; id: string; title: string; conflict: TitleConflict };

/** MAIN → ISOLATED 的消息。 */
export type MainMessage =
  | { source: MainSource; kind: 'ready' }
  | { source: MainSource; kind: 'hello-ack'; nonce: string }
  | { source: MainSource; kind: 'probe-result'; nonce: string; id: string; result: ProbeResult }
  | { source: MainSource; kind: 'import-result'; nonce: string; id: string; result: ImportResult }
  | { source: MainSource; kind: 'set-title-result'; nonce: string; id: string; result: SetTitleResult };

/**
 * sidepanel ↔ content 的 chrome.runtime 消息(第二条通道,区别于上面 window.postMessage
 * 的 content ↔ injector 通道)。用 discriminated union(判别字段 `type`)描述请求,便于
 * 以后扩展更多 type(如 'markflow:import'、'markflow:page-status');应答复用 ProbeResult。
 */

/** 判别常量(收发两端共享,避免裸字符串散落)。 */
export const PROBE_REQUEST_TYPE = 'markflow:probe' as const;
export const IMPORT_REQUEST_TYPE = 'markflow:import' as const;
export const SET_TITLE_REQUEST_TYPE = 'markflow:set-title' as const;

/** sidepanel → content 的请求。 */
export type RuntimeRequest =
  | { type: typeof PROBE_REQUEST_TYPE }
  | {
      type: typeof IMPORT_REQUEST_TYPE;
      blocks: ImportBlock[];
      mode: ImportMode;
      /** 封面图来源(frontmatter cover / 正文首图);null=不设封面。content 准备后设到 X 封面 fileInput。 */
      coverSource?: string | null;
    }
  | { type: typeof SET_TITLE_REQUEST_TYPE; title: string; conflict: TitleConflict };

/** content → sidepanel 的探针应答:成功回结果,失败回明确的错误码。 */
export type ProbeResponse =
  | { ok: true; result: ProbeResult }
  | { ok: false; error: 'no-injector' | 'timeout' };

/**
 * content → sidepanel 的写入应答:透传注入引擎的 ImportResult;
 * 通道层错误(未握手/超时)与引擎错误共用 ok:false 形状,error 短语区分。
 */
export type ImportResponse =
  | {
      ok: true;
      blockCount: number;
      effectiveMode: ImportMode;
      imageOk: number;
      imageFail: number;
      /** 封面是否已设置(未请求封面时为 undefined)。 */
      coverSet?: boolean;
    }
  | { ok: false; error: 'no-injector' | 'timeout' | string };

/** content → sidepanel 的标题设置应答:透传 SetTitleResult,叠加通道层错误。 */
export type SetTitleResponse =
  | { ok: true; applied: boolean }
  | { ok: false; error: 'no-injector' | 'timeout' | string };

/** 运行时守卫:窄化「探针请求」——只认判别字段 `type` 匹配的对象。 */
export function isProbeRequest(msg: unknown): msg is { type: typeof PROBE_REQUEST_TYPE } {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as { type?: unknown }).type === PROBE_REQUEST_TYPE
  );
}

/** 运行时守卫:窄化「写入请求」。blocks/mode 的字段校验由 TS 端到端类型保证,这里只判别 type。 */
export function isImportRequest(msg: unknown): msg is {
  type: typeof IMPORT_REQUEST_TYPE;
  blocks: ImportBlock[];
  mode: ImportMode;
  coverSource?: string | null;
} {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as { type?: unknown }).type === IMPORT_REQUEST_TYPE
  );
}

/** 运行时守卫:窄化「标题设置请求」。 */
export function isSetTitleRequest(
  msg: unknown,
): msg is { type: typeof SET_TITLE_REQUEST_TYPE; title: string; conflict: TitleConflict } {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as { type?: unknown }).type === SET_TITLE_REQUEST_TYPE
  );
}

// ---------------------------------------------------------------------------
// 远程图片抓取(content → background)。content script 受页面 CORS 约束不能跨域取图,
// 故委托给 background service worker(持扩展 host 权限)代理下载,base64 回传。
// ---------------------------------------------------------------------------

export const FETCH_IMAGE_TYPE = 'markflow:fetch-image' as const;

/** content → background:请求代理下载一张远程图片。 */
export interface FetchImageRequest {
  type: typeof FETCH_IMAGE_TYPE;
  url: string;
}

/** background → content:成功回 base64 + MIME;失败回诊断短语。 */
export type FetchImageResponse =
  | { ok: true; base64: string; mime: string; fileName: string }
  | { ok: false; error: string };

/** 运行时守卫:窄化「抓图请求」。 */
export function isFetchImageRequest(msg: unknown): msg is FetchImageRequest {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as { type?: unknown }).type === FETCH_IMAGE_TYPE &&
    typeof (msg as { url?: unknown }).url === 'string'
  );
}

/** 生成一次会话的 nonce:每次注入独立,防止与历史残留 / 其他扩展的消息串扰。 */
export function createNonce(): string {
  return crypto.randomUUID();
}

/** 窄化「来自 MAIN world 的消息」:必须同 window(event.source===window)且 source 匹配。 */
export function isMainMessage(e: MessageEvent): e is MessageEvent<MainMessage> {
  const data = e.data as { source?: unknown } | null;
  return e.source === window && typeof data === 'object' && data !== null && data.source === MAIN_SOURCE;
}

/** 窄化「来自 ISOLATED world 的消息」:必须同 window 且 source 匹配。 */
export function isIsoMessage(e: MessageEvent): e is MessageEvent<IsoMessage> {
  const data = e.data as { source?: unknown } | null;
  return e.source === window && typeof data === 'object' && data !== null && data.source === ISO_SOURCE;
}
