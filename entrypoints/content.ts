import {
  ISO_SOURCE,
  createNonce,
  isMainMessage,
  isProbeRequest,
  type IsoMessage,
  type ProbeResponse,
  type ProbeResult,
} from '@/lib/bridge/protocol';

/**
 * ISOLATED world content script:x.com 文章编辑页的编排器。
 *
 * 职责:按需注入 MAIN world 注入引擎(injectScript)、与其做 nonce 握手、
 * (后续)在 sidepanel 与 injector 之间中转消息。本阶段(M1 地基)只做
 * 「注入 + 握手 + 日志」,fiber/Draft 直写在 injector 的后续步骤实现。
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

    // 进行中的探针请求表:按 id 索引(而非单一全局变量),以支持同一时刻多个 probe 并发。
    // 每项持有 resolve 回调与超时定时器,收到匹配的 probe-result 或超时后从表中删除。
    const pendingProbes = new Map<
      string,
      { resolve: (r: ProbeResult) => void; timer: ReturnType<typeof setTimeout> }
    >();

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
        // 用 id 精确匹配并发探针;nonce 校验拦截历史残留 / 其他会话的串扰
        const p = pendingProbes.get(msg.id);
        if (p) {
          clearTimeout(p.timer);
          pendingProbes.delete(msg.id);
          p.resolve(msg.result);
        }
      }
    };
    window.addEventListener('message', onMessage);

    /**
     * 向 injector 发起一次探针并等待应答:
     * - 未握手 → 立即回 no-injector;
     * - 已握手 → 生成唯一 id,postMessage probe,等匹配(nonce+id)的 probe-result;
     *   2500ms 超时回 timeout。
     */
    const probeInjector = (): Promise<ProbeResponse> => {
      if (!handshaked) return Promise.resolve({ ok: false, error: 'no-injector' });
      const id = crypto.randomUUID();
      return new Promise<ProbeResponse>((resolve) => {
        const timer = setTimeout(() => {
          pendingProbes.delete(id);
          resolve({ ok: false, error: 'timeout' });
        }, 2500);
        pendingProbes.set(id, {
          resolve: (result) => resolve({ ok: true, result }),
          timer,
        });
        post({ source: ISO_SOURCE, kind: 'probe', nonce, id });
      });
    };

    // sidepanel ↔ content 的 chrome.runtime 通道:收到 markflow:probe 请求 → 转探针。
    // 返回 Promise 即异步应答(WXT/webextension-polyfill 约定:回 Promise 或 return true)。
    const onRuntimeMessage = (message: unknown): Promise<ProbeResponse> | undefined => {
      if (isProbeRequest(message)) return probeInjector();
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
      // 清掉悬挂的探针定时器,避免失效后回调仍触发
      for (const p of pendingProbes.values()) clearTimeout(p.timer);
      pendingProbes.clear();
    });
  },
});
