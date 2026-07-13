import {
  ISO_SOURCE,
  createNonce,
  isImportRequest,
  isMainMessage,
  isProbeRequest,
  isSetTitleRequest,
  type ImportBlock,
  type ImportMode,
  type ImportResponse,
  type ImportResult,
  type IsoMessage,
  type ProbeResponse,
  type ProbeResult,
  type SetTitleResponse,
  type SetTitleResult,
  type TitleConflict,
} from '@/lib/bridge/protocol';

/**
 * ISOLATED world content script:x.com 文章编辑页的编排器。
 *
 * 职责:按需注入 MAIN world 注入引擎(injectScript)、与其做 nonce 握手、
 * 在 sidepanel 与 injector 之间中转消息(探针 / 写入 / 标题设置)。
 *
 * 采用 WXT 推荐的 injectScript(而非声明式 world:'MAIN'):由本 ISOLATED 侧
 * 持有扩展 API 并控制注入时机,更稳、更可控。
 */
export default defineContentScript({
  matches: ['*://x.com/*', '*://twitter.com/*'],
  runAt: 'document_idle',
  async main(ctx) {
    // 启动日志:无条件打印,用于确认 content script 是否被注入执行。
    console.info('[MarkFlow] content-script 已加载 @', location.href);

    const nonce = createNonce();
    let handshaked = false;
    let retry: ReturnType<typeof setInterval> | undefined;
    let attempts = 0;

    const post = (msg: IsoMessage) => window.postMessage(msg, '*');
    const stopRetry = () => {
      if (retry !== undefined) {
        clearInterval(retry);
        retry = undefined;
      }
    };

    /**
     * 通用「挂起请求」桥:统一 probe / import / set-title 三类中转的公共骨架
     * (生成 id → 登记 resolve+timer → 发消息 → 收到匹配 result 后兑现 → 超时兜底 → 失效清理)。
     *
     * 单一 Map 承载异构请求:各类请求的 id 均为 crypto.randomUUID,全局唯一、无碰撞,
     * 故无需按类型分表。nonce 匹配仍由调用方在 onMessage 里前置校验(拦截历史残留 / 串扰)。
     */
    const createBridge = () => {
      // 每项持有:期望的应答 kind、resolve 回调、超时定时器。
      // 存 kind 是为了让 resolve 校验「回来的 result 类型」与「该 id 登记时的请求类型」一致——
      // 单 Map 承载 probe/import/set-title 三类,虽 id 是 UUID 全局唯一,但页面 JS 能读到
      // postMessage('*') 广播的 nonce/id,加 kind 校验可挡住构造跨类型 result 的通道混淆。
      const pending = new Map<
        string,
        { kind: string; resolve: (raw: unknown) => void; timer: ReturnType<typeof setTimeout> }
      >();

      /**
       * 发起一次请求并等待应答:
       * - 生成唯一 id → 登记 kind+resolve+timer → 调用 send(id) 发消息;
       * - 收到匹配(id + kind)的 result → onResult(raw) 映射为最终应答;
       * - timeoutMs 超时 → onTimeout() 兜底(并把 id 出表)。
       * @param kind 期望的应答消息 kind(如 'probe-result'),resolve 时据此校验类型一致。
       */
      const request = <TRaw, TResponse>(
        kind: string,
        send: (id: string) => void,
        timeoutMs: number,
        onResult: (raw: TRaw) => TResponse,
        onTimeout: () => TResponse,
      ): Promise<TResponse> => {
        const id = crypto.randomUUID();
        return new Promise<TResponse>((resolve) => {
          const timer = setTimeout(() => {
            pending.delete(id);
            resolve(onTimeout());
          }, timeoutMs);
          pending.set(id, {
            kind,
            resolve: (raw) => resolve(onResult(raw as TRaw)),
            timer,
          });
          send(id);
        });
      };

      // 收到匹配的 result:id 命中且 kind 一致才兑现(否则忽略——跨类型/伪造的 result 不放行)。
      const resolve = (id: string, kind: string, raw: unknown) => {
        const entry = pending.get(id);
        if (!entry || entry.kind !== kind) return;
        clearTimeout(entry.timer);
        pending.delete(id);
        entry.resolve(raw);
      };

      // 一次性清理所有挂起项(content script 失效时):清定时器并清表,避免失效后回调仍触发。
      const clearAll = () => {
        for (const entry of pending.values()) clearTimeout(entry.timer);
        pending.clear();
      };

      return { request, resolve, clearAll };
    };

    const bridge = createBridge();

    const onMessage = (e: MessageEvent) => {
      if (!isMainMessage(e)) return;
      const msg = e.data;
      if (msg.kind === 'ready') {
        // 引擎就绪 → 发起握手(hello 携带本会话 nonce)
        post({ source: ISO_SOURCE, kind: 'hello', nonce });
      } else if (msg.kind === 'hello-ack' && msg.nonce === nonce && !handshaked) {
        handshaked = true;
        stopRetry();
        console.info('[MarkFlow] content↔injector 握手成功', { nonce });
      } else if (msg.kind === 'probe-result' && msg.nonce === nonce) {
        // 用 id + kind 精确匹配并发请求;nonce 校验拦截历史残留 / 其他会话的串扰
        bridge.resolve(msg.id, msg.kind, msg.result);
      } else if (msg.kind === 'import-result' && msg.nonce === nonce) {
        bridge.resolve(msg.id, msg.kind, msg.result);
      } else if (msg.kind === 'set-title-result' && msg.nonce === nonce) {
        bridge.resolve(msg.id, msg.kind, msg.result);
      }
    };
    window.addEventListener('message', onMessage);

    /**
     * 向 injector 发起一次探针并等待应答:
     * - 未握手 → 立即回 no-injector;
     * - 已握手 → 经桥发 probe,等匹配(nonce+id)的 probe-result;2500ms 超时回 timeout。
     */
    const probeInjector = (): Promise<ProbeResponse> => {
      if (!handshaked) return Promise.resolve({ ok: false, error: 'no-injector' });
      return bridge.request<ProbeResult, ProbeResponse>(
        'probe-result',
        (id) => post({ source: ISO_SOURCE, kind: 'probe', nonce, id }),
        2500,
        (result) => ({ ok: true, result }),
        () => ({ ok: false, error: 'timeout' }),
      );
    };

    /**
     * 向 injector 发起一次写入并等待应答:
     * - 未握手 → 立即回 no-injector;
     * - 已握手 → 经桥发 import(携带 blocks/mode),等匹配的 import-result;30s 超时回 timeout
     *   (写入含取样轮询 / DOM 落盘,给足冗余)。ImportResult 成功分支含 effectiveMode,透传即可。
     */
    const importInjector = (blocks: ImportBlock[], mode: ImportMode): Promise<ImportResponse> => {
      if (!handshaked) return Promise.resolve({ ok: false, error: 'no-injector' });
      return bridge.request<ImportResult, ImportResponse>(
        'import-result',
        (id) => post({ source: ISO_SOURCE, kind: 'import', nonce, id, blocks, mode }),
        30_000,
        (result) => result,
        () => ({ ok: false, error: 'timeout' }),
      );
    };

    /**
     * 向 injector 发起一次标题设置并等待应答:
     * - 未握手 → 立即回 no-injector;
     * - 已握手 → 经桥发 set-title(携带 title/conflict),等匹配的 set-title-result;
     *   8s 超时回 timeout。透传 injector 的 SetTitleResult(含 applied 语义)。
     */
    const setTitleInjector = (title: string, conflict: TitleConflict): Promise<SetTitleResponse> => {
      if (!handshaked) return Promise.resolve({ ok: false, error: 'no-injector' });
      return bridge.request<SetTitleResult, SetTitleResponse>(
        'set-title-result',
        (id) => post({ source: ISO_SOURCE, kind: 'set-title', nonce, id, title, conflict }),
        8000,
        (result) => result,
        () => ({ ok: false, error: 'timeout' }),
      );
    };

    // sidepanel ↔ content 的 chrome.runtime 通道:probe → 转探针;import → 转写入;set-title → 转标题。
    // 返回 Promise 即异步应答(WXT/webextension-polyfill 约定:回 Promise 或 return true)。
    const onRuntimeMessage = (
      message: unknown,
    ): Promise<ProbeResponse | ImportResponse | SetTitleResponse> | undefined => {
      if (isProbeRequest(message)) return probeInjector();
      if (isImportRequest(message)) return importInjector(message.blocks, message.mode);
      if (isSetTitleRequest(message)) return setTitleInjector(message.title, message.conflict);
      return undefined; // 非本扩展关心的消息:不应答,交给其他监听器
    };
    browser.runtime.onMessage.addListener(onRuntimeMessage);

    // 注入 MAIN world 引擎(WXT 会自动将 injector.js 加入 web_accessible_resources)。
    // x.com CSP 可能拦截 chrome-extension 脚本加载,故 try/catch 明确报错以便诊断。
    try {
      await injectScript('/injector.js', { keepInDom: true });
      console.info('[MarkFlow] injectScript 已调用,等待 injector 握手…');
    } catch (err) {
      console.error('[MarkFlow] 注入 injector.js 失败(可能被页面 CSP 拦截):', err);
    }

    // 兜底重试:injector 的 ready 可能早于本监听器就绪,故主动周期性 hello,
    // 收到 ack 即止;40 次(≈10s)仍无响应则判定超时。
    retry = setInterval(() => {
      if (handshaked) {
        stopRetry();
        return;
      }
      if (attempts >= 40) {
        stopRetry();
        console.warn('[MarkFlow] 握手超时:未收到 injector 响应');
        return;
      }
      attempts += 1;
      post({ source: ISO_SOURCE, kind: 'hello', nonce });
    }, 250);

    // content script 失效时清理(SPA 导航 / 扩展更新)。
    ctx.onInvalidated(() => {
      stopRetry();
      window.removeEventListener('message', onMessage);
      browser.runtime.onMessage.removeListener(onRuntimeMessage);
      // 一次性清掉所有悬挂请求(探针 / 写入 / 标题)的定时器,避免失效后回调仍触发。
      bridge.clearAll();
    });
  },
});
