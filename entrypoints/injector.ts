import {
  MAIN_SOURCE,
  isIsoMessage,
  type MainMessage,
} from '@/lib/bridge/protocol';

/**
 * MAIN world 注入引擎 —— 经 content.ts 的 injectScript 注入,运行于**页面 JS 上下文**
 * (与 X 的 Draft.js 同一 world,可访问 React fiber / 页面构造器)。
 *
 * 本阶段(M1 地基)只做握手骨架:加载即广播 ready、响应 hello 回 hello-ack。
 * 后续步骤在此实现 fiber 定位 Draft 实例、合成 paste、atomic 直写、onFilesAdded
 * 上传桥等真实注入能力(参考 docs/research/xposter-analysis.md)。
 */
export default defineUnlistedScript(() => {
  const post = (msg: MainMessage) => window.postMessage(msg, '*');

  window.addEventListener('message', (e) => {
    if (!isIsoMessage(e)) return;
    const msg = e.data;
    if (msg.kind === 'hello') {
      // 回执握手,回显 ISOLATED 侧生成的 nonce
      post({ source: MAIN_SOURCE, kind: 'hello-ack', nonce: msg.nonce });
    }
    // 'probe' 等消息在后续步骤实现
  });

  // 加载即广播就绪(content 可能已在监听;若晚于 content,content 的重试 hello 会兜底)。
  post({ source: MAIN_SOURCE, kind: 'ready' });
});
