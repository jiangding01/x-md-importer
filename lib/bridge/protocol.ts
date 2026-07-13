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
}

/** ISOLATED → MAIN 的消息。 */
export type IsoMessage =
  | { source: IsoSource; kind: 'hello'; nonce: string }
  | { source: IsoSource; kind: 'probe'; nonce: string; id: string };

/** MAIN → ISOLATED 的消息。 */
export type MainMessage =
  | { source: MainSource; kind: 'ready' }
  | { source: MainSource; kind: 'hello-ack'; nonce: string }
  | { source: MainSource; kind: 'probe-result'; nonce: string; id: string; result: ProbeResult };

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
