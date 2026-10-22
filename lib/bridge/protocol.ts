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
  /**
   * 当前页是否为 X **文章**编辑路由(`/compose/articles` 前缀,含列表/新建/编辑页)。
   * B3:推文 compose 弹窗 / 私信框同样是 Draft.js、尺寸达标即被前三灯判「可写」——
   * 「已连接」必须同时要求本字段为 true,否则 replace 会清掉用户的推文草稿。
   * 不能用 articleId 做闸门:新建文章页 articleId 本就为 null。
   */
  isArticleEditor: boolean;
  /**
   * 探针自身抛异常时的诊断串(B5:X 改版导致 `getCurrentContent` 不是函数等)。
   * 有此字段时其余三灯按「未就绪」填 false,content 仍能收到应答而非只见超时。
   */
  error?: string;
}

/**
 * 注入引擎的具名错误码(ImportResult / SetTitleResult 的 error 可取值之一;其余为自由诊断短语)。
 *  - 'article-switched'    写入期间目标文章被 SPA 切换(B2-1 双钥);
 *  - 'not-article-editor'  当前页不是 X 文章编辑路由(B3:拒绝对推文 compose / 私信框直写)。
 */
export const NOT_ARTICLE_EDITOR_ERROR = 'not-article-editor' as const;
export const ARTICLE_SWITCHED_ERROR = 'article-switched' as const;
export type InjectorErrorCode = typeof NOT_ARTICLE_EDITOR_ERROR | typeof ARTICLE_SWITCHED_ERROR;

// ---------------------------------------------------------------------------
// 写入(Import)数据结构 —— 解析器(lib/markdown/parser)产出、注入引擎消费。
// 形状对齐 Draft.js RawBlock,块映射遵循《技术方案设计.md》§4.2 矩阵。
// ---------------------------------------------------------------------------

/**
 * 行内样式区间。style 为 Draft.js 标准 inline style 名。
 * BOLD / ITALIC / STRIKETHROUGH 由 X Articles 正文原生支持。
 * **CODE(行内代码)X 正文实测不支持**——parser 已降级为「原样保留反引号纯文本」、不再产出 CODE;
 * 此枚举值仅保留兼容(injector 仍能处理,若 X 日后支持可快速恢复)。
 */
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
 * H4+→unstyled+全段 BOLD(X 仅两级标题);列表层级见 TextBlock.depth。
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
  /**
   * 列表嵌套层级(Draft.js `ContentBlock.depth` 原生字段,0 = 顶层)。仅列表项会带,
   * 且**仅在 > 0 时出现**——顶层项不写该字段,保持既有产出形状不变。
   * 上限 4:Draft 默认样式表只到 `public-DraftStyleDefault-depth4`,更深无额外缩进。
   * 可选字段是刻意的**向后兼容**:旧版 injector(用户未刷新 X 页面)读不到它,
   * 嵌套项会退化为扁平列表项——仍优于本字段引入前「退化成含字面量 `- x` 的段落」。
   */
  depth?: number;
  /** 任务列表项的勾选态(仅任务项有);供能力面板如实计数,注入引擎不读。 */
  task?: 'todo' | 'done';
}

/**
 * 特殊块:atomic block + X 编辑器内部 entity(类型名/数据形状为 xposter 源码实证 / 真机 dump 实证)。
 * M1 仅前三种(无需上传通道);图片/表格 MEDIA 在 M2 加入;LATEX 数学块见下。
 *
 * **LATEX 与前三种的形状差异(真机 dump 确认)**:前三种的公式/数据在 entity `data` 里、
 * 块文本恒为单空格(injector 硬编码);LATEX 反过来——`data` 为空、**公式本体在块 `text`**,
 * 且每个字符都挂同一个 LATEX entity key。故 LATEX 变体独有 `text` 字段承载公式原文。
 */
export type AtomicBlock =
  | { kind: 'atomic'; entityType: 'DIVIDER'; data: Record<string, never> }
  | { kind: 'atomic'; entityType: 'MARKDOWN'; data: { markdown: string } }
  | { kind: 'atomic'; entityType: 'TWEET'; data: { url: string; tweetId: string } }
  | { kind: 'atomic'; entityType: 'LATEX'; data: Record<string, never>; text: string };

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
  // data: 判定与 http(s) 一致地大小写不敏感——URL scheme 本就不分大小写,
  // 否则大写 `DATA:image/...` 会穿透误判为 local(单测钉出的不对称)。
  if (/^data:/i.test(src)) return 'data';
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
  /**
   * file 为 null 时的失败原因码;file 非 null 时缺省。
   * failDetail 为自由文本补充(如 background 代理回传的具体错误),仅诊断/报告展示用。
   */
  failReason?: ImageFailReason;
  failDetail?: string;
}

/**
 * 失败原因码的**单一事实来源**——content/injector 生产端用 ImageFailReason 联合类型收紧
 * (拼错编译即报);ImageFailure.reason 消费端保持 string(备份恢复可能带回任意字符串,
 * UI 对未知码原样展示)。「生产端强类型、消费端宽松」。
 */
export const IMAGE_FAIL_REASONS = [
  // prepare 阶段(content 字节准备)
  'remote-fetch-failed',
  'local-not-found',
  'local-too-large',
  'local-bad-type',
  'data-uri-invalid',
  'prepare-exception',
  'prepare-missing', // images[] 缺该项(典型:扩展更新后旧 content 未刷新,import 消息无 images)
  // upload 阶段(injector 借 X 上传管线 + 归位)
  'upload-no-editor', // Draft 节点丢失
  'upload-marker-lost', // marker 占位块定位失败(如用户中途手动删除)
  'upload-no-callback', // 页面 onFilesAdded 回调缺失
  'upload-timeout', // 超时:预算内未见新 MEDIA 确认
  'upload-relocate-failed', // 图已上传成功(MEDIA 已确认)但归位失败——图可能已在 X 媒体库
  'upload-exception',
  'marker-residue', // 图已落地但占位 marker 清扫未果、残留正文(需手动删除;不计入 imageFail)

  // 封面
  'cover-set-failed', // 封面 File 已备好但 setCoverImage 未落地
] as const;
export type ImageFailReason = (typeof IMAGE_FAIL_REASONS)[number];

/**
 * 报告/持久化用的展示截断:代理对安全(不产生孤立代理项),防超长 detail/dataURI
 * 撑爆 storage 配额与报告卡。content 与 injector 生产端、backup 恢复边界共用同一实现。
 */
export function truncateForReport(s: string, max: number): string {
  if (s.length <= max) return s;
  let cut = s.slice(0, max - 1);
  // 末位若是高位代理项(代理对被从中间切开)则一并去掉,避免孤立代理项进入存储/JSON。
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/**
 * 单张图片的失败明细(导入报告/诊断用)。injector 在图片阶段收集,随 ImportResult 回传;
 * 封面失败由 content 在通道层补记。reason 约定码见 IMAGE_FAIL_REASONS。
 */
export interface ImageFailure {
  /** 第几张图(**用户文档顺序**,0 起;UI 展示 +1)。**-1 = 封面**(非正文图)。 */
  index: number;
  /** 图片来源(经 truncateForReport 截断,只用于展示定位,不可回放)。 */
  source: string;
  /** 失败阶段:prepare=字节准备(content 侧);upload=X 上传/归位(injector 侧)。 */
  stage: 'prepare' | 'upload';
  reason: string;
  detail?: string;
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
      /** 图片失败明细(imageFail=0 时缺省)。可选字段,旧 injector 不回传时 UI 自然不展示。 */
      imageFailures?: ImageFailure[];
      /**
       * B1 诊断:哪些阶段在 onChange 后等待 React 提交超时(settle 1.5s 未观察到预期 state)。
       * 仅诊断用,content / sidepanel 不消费;缺省 = 全部阶段按时落盘。
       */
      settleTimeouts?: string[];
    }
  | {
      ok: false;
      error: InjectorErrorCode | string;
      /**
       * 正文是否已经过主 onChange 提交(B2-2):verify 不达标/图片阶段异常时旧内容已清、
       * 新内容已(部分)落地,与「提交前失败」必须区分——否则用户看到「失败」就重试,
       * append 整篇重复、图片重复上传。UI 据此提示「正文可能已写入,请先检查再重试」。
       */
      committed?: boolean;
      /** 同成功分支(B1 诊断);提交后失败时可能带有。 */
      settleTimeouts?: string[];
    };

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
  | { ok: false; error: InjectorErrorCode | string };

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
      /** 期望的目标文章 id(B2-1,见 RuntimeRequest 同名字段);缺省/null=不校验。 */
      expectedArticleId?: string | null;
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

/**
 * 本地图片文件夹的两级作用域(单一事实来源,localVault 与 UI 共用):
 *  - 'active'     = 素材板「当前文章」文件夹(优先级高、随时更换,记住最近连接);
 *  - 'persistent' = 设置里的默认文件夹(兜底)。
 * 读本地图时 active 优先、persistent 兜底、逐文件兜底(见 content 的 resolveLocalImageAcrossScopes)。
 */
export type VaultScope = 'active' | 'persistent';

/** 判别常量(收发两端共享,避免裸字符串散落)。 */
export const PROBE_REQUEST_TYPE = 'markflow:probe' as const;
export const IMPORT_REQUEST_TYPE = 'markflow:import' as const;
export const SET_TITLE_REQUEST_TYPE = 'markflow:set-title' as const;
export const CONNECT_FOLDER_TYPE = 'markflow:connect-folder' as const; // 触发 FS Access 授权
export const CLEAR_FOLDER_TYPE = 'markflow:clear-folder' as const; // 清除已连接文件夹
export const FOLDER_STATUS_TYPE = 'markflow:folder-status' as const; // 查询当前连接状态

/** sidepanel → content 的请求。 */
export type RuntimeRequest =
  | { type: typeof PROBE_REQUEST_TYPE }
  | {
      type: typeof IMPORT_REQUEST_TYPE;
      blocks: ImportBlock[];
      mode: ImportMode;
      /** 封面图来源(frontmatter cover / 正文首图);null=不设封面。content 准备后设到 X 封面 fileInput。 */
      coverSource?: string | null;
      /** 写入成功后是否把 X 编辑器滚回文章开头(对应设置「完成后滚动到顶部」)。 */
      scrollTop?: boolean;
      /** 图片压缩参数(对应设置 compress/maxEdge/quality);null/缺省=不压。content 侧压所有来源的 File。 */
      compress?: { maxEdge: string; quality: number } | null;
      /**
       * 期望的目标文章 id(B2-1 双钥):ask 弹窗挂起期间用户可能在**同一 tab** 内 SPA 切到
       * 另一篇草稿(tabId 不变,钉 tab 挡不住)。injector 在触碰编辑器前比对当前 articleId,
       * 不符即拒写(error 'article-switched')。缺省/null=不校验(向后兼容旧调用方)。
       */
      expectedArticleId?: string | null;
    }
  | { type: typeof SET_TITLE_REQUEST_TYPE; title: string; conflict: TitleConflict }
  // forcePick=true 强制重新 showDirectoryPicker 选文件夹(「更换」);缺省/false 时若存量 handle
  // 仅权限回落(浏览器重启)则一键 requestPermission 复用,免重选(「连接 / 恢复」)。
  | { type: typeof CONNECT_FOLDER_TYPE; scope: VaultScope; forcePick?: boolean }
  | { type: typeof CLEAR_FOLDER_TYPE; scope: VaultScope }
  | { type: typeof FOLDER_STATUS_TYPE; scope: VaultScope };

/**
 * content → sidepanel 的本地文件夹应答(连接 / 清除 / 状态查询共用)。
 * connected=true 时 folderName 为已连接文件夹名(供 UI 显示 + vault 首段剥离参考)。
 * connect 失败(用户取消 / 无手势 / 权限拒绝)→ ok:false + error。
 */
export type FolderResponse =
  | { ok: true; connected: boolean; folderName: string | null }
  | { ok: false; error: 'cancelled' | 'no-content' | 'timeout' | string };

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
      /** 图片失败明细(与 ImportResult 同源透传,imageFail=0 时缺省)。 */
      imageFailures?: ImageFailure[];
    }
  | {
      ok: false;
      error: 'no-injector' | 'timeout' | InjectorErrorCode | string;
      /** 与 ImportResult 同源透传(B2-2);通道层 timeout 时缺省(content 无从得知是否已提交)。 */
      committed?: boolean;
    };

/** content → sidepanel 的标题设置应答:透传 SetTitleResult,叠加通道层错误。 */
export type SetTitleResponse =
  | { ok: true; applied: boolean }
  | { ok: false; error: 'no-injector' | 'timeout' | InjectorErrorCode | string };

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
  scrollTop?: boolean;
  compress?: { maxEdge: string; quality: number } | null;
  expectedArticleId?: string | null;
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

/** 读取消息的 type 字段(用于本地文件夹三类请求的判别)。 */
function messageType(msg: unknown): string | undefined {
  if (typeof msg !== 'object' || msg === null) return undefined;
  const t = (msg as { type?: unknown }).type;
  return typeof t === 'string' ? t : undefined;
}

/**
 * 读取消息的 scope 字段并归一:仅 'active'/'persistent' 合法,缺省/非法一律回落
 * 'persistent'(兼容旧消息 + 防串扰)。三类文件夹守卫据此保证 scope 始终有值。
 */
export function messageScope(msg: unknown): VaultScope {
  const s = (msg as { scope?: unknown } | null)?.scope;
  return s === 'active' ? 'active' : 'persistent';
}

/**
 * 运行时守卫:本地文件夹连接 / 清除 / 状态查询(应答均为 FolderResponse)。
 * **有意不把 scope 收窄进类型**——守卫只校验 `type`,scope 的存在性/合法性由消费方用
 * `messageScope(msg)` 归一(旧消息缺字段、非法值一律回落 persistent)。避免「类型断言了 scope、
 * 运行时却没校验」的撒谎,逼后人走 messageScope 而非裸读 `msg.scope`。forcePick 同理由 content
 * 侧安全比较(`=== true`)。
 */
export const isConnectFolderRequest = (
  msg: unknown,
): msg is { type: typeof CONNECT_FOLDER_TYPE; forcePick?: boolean } =>
  messageType(msg) === CONNECT_FOLDER_TYPE;
export const isClearFolderRequest = (msg: unknown): msg is { type: typeof CLEAR_FOLDER_TYPE } =>
  messageType(msg) === CLEAR_FOLDER_TYPE;
export const isFolderStatusRequest = (msg: unknown): msg is { type: typeof FOLDER_STATUS_TYPE } =>
  messageType(msg) === FOLDER_STATUS_TYPE;

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
