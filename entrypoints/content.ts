import {
  FETCH_IMAGE_TYPE,
  ISO_SOURCE,
  classifyImageSource,
  createNonce,
  isClearFolderRequest,
  isConnectFolderRequest,
  isFolderStatusRequest,
  isImportRequest,
  isMainMessage,
  isProbeRequest,
  isSetTitleRequest,
  type FetchImageResponse,
  type FolderResponse,
  type ImageBlock,
  type ImportBlock,
  type ImportMode,
  type ImportResponse,
  type ImportResult,
  type IsoMessage,
  type PreparedImage,
  type ProbeResponse,
  type ProbeResult,
  type SetTitleResponse,
  type SetTitleResult,
  type TitleConflict,
} from '@/lib/bridge/protocol';
import {
  clearVaultHandle,
  getVaultHandle,
  hasReadPermission,
  requestReadPermission,
  resolveLocalFile,
  saveVaultHandle,
} from '@/lib/bridge/localVault';

/** 允许的图片 MIME(与 background 一致):dataURI 解析、本地图读取都据此校验。 */
const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
/** 本地图片大小上限,与远程 background 的 16MB 对齐——防超大/非图文件塞进 X 上传。 */
const MAX_LOCAL_IMAGE_BYTES = 16 * 1024 * 1024;

/**
 * base64 → Uint8Array(atob 逐字符;非法 base64 抛错由调用方兜底)。
 * 显式在 ArrayBuffer 上构造(而非 `new Uint8Array(len)`),以得到 `Uint8Array<ArrayBuffer>`——
 * TS 5.9 的 typed-array 泛型下,只有它能直接作 BlobPart 传给 File/Blob 构造器。
 */
function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** 解析 dataURI 图片为 File;非图片 / 非白名单 MIME / 解析失败 → null。 */
function dataUriToFile(uri: string): File | null {
  // mime 后允许任意参数段(如 ;charset=utf-8),base64 标记可能夹在参数中间。
  const m = /^data:([^;,]+)?((?:;[^;,]+)*),([\s\S]*)$/.exec(uri);
  if (!m) return null;
  const mime = (m[1] || '').toLowerCase();
  // 无 mime(data:,…)或非白名单图片一律拒绝——不默认 png,避免把文本字节当图片上传。
  if (!ALLOWED_IMAGE_MIME.has(mime)) return null;
  const isBase64 = /;base64\b/.test((m[2] || '').toLowerCase());
  const data = m[3] ?? '';
  try {
    let bytes: Uint8Array<ArrayBuffer>;
    if (isBase64) {
      bytes = base64ToBytes(data);
    } else {
      const enc = new TextEncoder().encode(decodeURIComponent(data));
      bytes = new Uint8Array(new ArrayBuffer(enc.length));
      bytes.set(enc);
    }
    const ext = mime.slice(mime.indexOf('/') + 1).replace('jpeg', 'jpg');
    return new File([bytes], `image.${ext}`, { type: mime });
  } catch {
    return null;
  }
}

/** 准备单张图片的字节:dataURI 就地解析,远程委托 background 代理,本地暂不支持(降级)。 */
async function prepareOneImage(block: ImageBlock): Promise<PreparedImage> {
  try {
    const kind = classifyImageSource(block.source);
    if (kind === 'data') return { file: dataUriToFile(block.source) };
    if (kind === 'remote') {
      const resp = (await browser.runtime.sendMessage({ type: FETCH_IMAGE_TYPE, url: block.source })) as
        | FetchImageResponse
        | undefined;
      if (resp?.ok) {
        return { file: new File([base64ToBytes(resp.base64)], resp.fileName, { type: resp.mime }) };
      }
      return { file: null };
    }
    // local(本地相对路径):从已连接的文件夹 handle(File System Access)读取。
    // 未连接 / 权限失效 / 未找到 → file:null,injector 降级为 fallbackText 写回原文。
    const handle = await getVaultHandle();
    if (!handle || !(await hasReadPermission(handle))) return { file: null };
    const file = await resolveLocalFile(handle, block.source, handle.name);
    // 与远程/dataURI 对齐:大小上限 + MIME 白名单(本地文件可能是非图或超大文件)。
    if (!file || file.size > MAX_LOCAL_IMAGE_BYTES || !ALLOWED_IMAGE_MIME.has(file.type)) {
      return { file: null };
    }
    return { file };
  } catch {
    return { file: null };
  }
}

/** 图片准备的最大并发数:多图时限流,避免几十个 fetch 同时打向 background + base64 编解码峰值内存 OOM。 */
const PREPARE_IMAGE_CONCURRENCY = 3;

/**
 * 按文档顺序准备 blocks 中所有 ImageBlock 的字节,返回与之对齐的 PreparedImage[]。
 *
 * 用「有限并发池 + 索引回填」串行泄流,而非 Promise.all 一次性全量并发:后者在多图场景会
 * 同时发起几十个 fetch(经 background 代理)并让 base64 编解码峰值内存叠加,存在 OOM 风险。
 * 结果按 imageBlocks 的原始索引回填到 results[i],故返回数组与 imageBlocks 的文档顺序严格一一对齐
 * ——这是 injector 侧 PreparedImage[k] 与第 k 张 ImageBlock 对齐的前提,务必保持。
 */
async function prepareImages(blocks: ImportBlock[]): Promise<PreparedImage[]> {
  const imageBlocks = blocks.filter((b): b is ImageBlock => b.kind === 'image');
  const results = new Array<PreparedImage>(imageBlocks.length);
  // 共享游标:各 worker 抢占下一个待处理索引,处理完把结果写回同索引位置(顺序无关紧要,索引对齐)。
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const block = imageBlocks[index];
      if (block === undefined) return; // 越界即池内所有图片已认领完毕,worker 退出。
      results[index] = await prepareOneImage(block);
    }
  };
  // 池大小取「并发上限」与「实际图片数」的较小值,避免为 0/少图场景空转 worker。
  const poolSize = Math.min(PREPARE_IMAGE_CONCURRENCY, imageBlocks.length);
  await Promise.all(Array.from({ length: poolSize }, worker));
  return results;
}

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

    // import 消息会携带本地图 / dataURI 的 File 私有字节,故 targetOrigin 收敛为
    // window.location.origin,挡住把这些字节投递给跨 origin 的 iframe/文档上下文读取。
    // (同 origin 的页面脚本因 MAIN world 与页面共享同一 window 仍能读到,这是 MAIN world
    //  固有限制,非本收敛能解决;后续可考虑改用 MessageChannel 做点对点私有通道。)
    const post = (msg: IsoMessage) => window.postMessage(msg, window.location.origin);
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
    const importInjector = async (
      blocks: ImportBlock[],
      mode: ImportMode,
      coverSource: string | null,
    ): Promise<ImportResponse> => {
      if (!handshaked) return { ok: false, error: 'no-injector' };
      // 先在 ISOLATED 侧准备图片字节(dataURI 就地解析 / 远程走 background 代理),
      // 再随 import 消息把 File 交给 injector——File 经结构化克隆跨 world 传递。
      const images = await prepareImages(blocks);
      // 封面同样在 content 准备好 File 再交给 injector(injector 在 MAIN world 设到封面 fileInput,
      // File 同世界赋值更稳)。
      const cover = coverSource
        ? (await prepareOneImage({ kind: 'image', source: coverSource, alt: '', fallbackText: '' })).file
        : null;
      // 通道超时必须显著大于「图片数 × injector 单图 30s 预算」,否则慢图/多图会先在通道超时,
      // 报失败并丢弃 injector 事后回来的成功结果(而 injector 仍在后台改写编辑器)。基础 45s +
      // 每图 40s(单图 30s 预算 + 归位/清理冗余)+ 封面 20s。
      const timeoutMs = 45_000 + images.length * 40_000 + (cover ? 20_000 : 0);
      return bridge.request<ImportResult, ImportResponse>(
        'import-result',
        (id) => post({ source: ISO_SOURCE, kind: 'import', nonce, id, blocks, mode, images, cover }),
        timeoutMs,
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

    // --- 本地图片文件夹(File System Access)------------------------------------
    // showDirectoryPicker 必须在**用户手势**内调用;sidepanel 的手势跨 runtime 消息会丢失,
    // 故在 X 页面注入一次性最小浮层,用户点「选择文件夹」(页面手势)时同步调 picker。
    interface WindowFsPicker {
      showDirectoryPicker(opts?: { id?: string; mode?: 'read' | 'readwrite' }): Promise<FileSystemDirectoryHandle>;
    }

    // 当前活动授权浮层的「外部取消」句柄:onInvalidated 时清屏 + resolve,防卡屏 / 悬挂 Promise。
    let dismissActiveVaultOverlay: (() => void) | null = null;

    const connectFolder = (): Promise<FolderResponse> =>
      new Promise((resolve) => {
        // 若上一次连接浮层仍在(用户快速再点「连接」),先取消它——否则旧浮层会成为
        // 没人能清的孤儿(dismissActiveVaultOverlay 只存最新句柄),且可能弹出第二个 picker。
        dismissActiveVaultOverlay?.();
        const overlay = document.createElement('div');
        overlay.setAttribute('data-markflow-vault', '');
        overlay.style.cssText =
          'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.45);display:grid;place-items:center;font-family:system-ui,-apple-system,sans-serif;';
        const card = document.createElement('div');
        card.style.cssText =
          'background:#fff;color:#0f1419;max-width:340px;padding:20px 22px;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.25);';
        const title = document.createElement('div');
        title.style.cssText = 'font-weight:700;font-size:15px;margin-bottom:8px;';
        title.textContent = 'MarkFlow · 连接本地图片文件夹';
        const desc = document.createElement('div');
        desc.style.cssText = 'font-size:13px;line-height:1.5;color:#536471;margin-bottom:16px;';
        desc.textContent =
          '选择存放本地图片的文件夹后,导入时将从中读取相对路径图片(仅读取,不修改)。重开浏览器后可能需要重新连接。';
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;';
        const pick = document.createElement('button');
        pick.textContent = '选择文件夹';
        pick.style.cssText =
          'background:#0f1419;color:#fff;border:0;border-radius:9999px;padding:8px 18px;font-size:14px;font-weight:600;cursor:pointer;';
        const cancel = document.createElement('button');
        cancel.textContent = '取消';
        cancel.style.cssText =
          'background:transparent;color:#536471;border:1px solid #cfd9de;border-radius:9999px;padding:8px 16px;font-size:14px;cursor:pointer;';
        row.append(cancel, pick);
        card.append(title, desc, row);
        overlay.append(card);
        document.body.append(overlay);

        let settled = false;
        // 180s 兜底超时:用户长时间不操作也不会让 sidepanel 的 await 永久 pending。
        const timer = setTimeout(() => finish({ ok: false, error: 'timeout' }), 180_000);
        const finish = (r: FolderResponse) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          dismissActiveVaultOverlay = null; // 交出「外部取消」句柄
          overlay.remove();
          resolve(r);
        };
        // 暴露给 onInvalidated:SPA 导航 / 扩展失效时清掉卡屏浮层并 resolve,不留悬挂 Promise。
        dismissActiveVaultOverlay = () => finish({ ok: false, error: 'cancelled' });
        cancel.addEventListener('click', () => finish({ ok: false, error: 'cancelled' }));
        overlay.addEventListener('click', (e) => {
          if (e.target === overlay) finish({ ok: false, error: 'cancelled' });
        });
        pick.addEventListener('click', async () => {
          try {
            const handle = await (window as unknown as WindowFsPicker).showDirectoryPicker({
              id: 'markflow_vault',
              mode: 'read',
            });
            const granted = await requestReadPermission(handle);
            if (!granted) return finish({ ok: false, error: 'permission-denied' });
            await saveVaultHandle(handle);
            finish({ ok: true, connected: true, folderName: handle.name });
          } catch {
            // 用户在系统弹窗取消 showDirectoryPicker,或该环境不支持 → 取消处理
            finish({ ok: false, error: 'cancelled' });
          }
        });
      });

    const clearFolder = async (): Promise<FolderResponse> => {
      await clearVaultHandle();
      return { ok: true, connected: false, folderName: null };
    };

    const folderStatus = async (): Promise<FolderResponse> => {
      const handle = await getVaultHandle();
      if (!handle) return { ok: true, connected: false, folderName: null };
      // 有 handle 但读权限失效(浏览器重启后 FS Access 权限常回落 prompt)→ connected:false,
      // 让 UI 显示「未连接」引导重连,避免「显示已连接却读不到本地图」的撒谎态。folderName 仍回传。
      const granted = await hasReadPermission(handle);
      return { ok: true, connected: granted, folderName: handle.name };
    };

    // sidepanel ↔ content 的 chrome.runtime 通道:probe/import/set-title → 转 injector;
    // connect/clear/folder-status → 本地文件夹(FS Access,不经 injector)。
    // 返回 Promise 即异步应答(WXT/webextension-polyfill 约定:回 Promise 或 return true)。
    const onRuntimeMessage = (
      message: unknown,
    ): Promise<ProbeResponse | ImportResponse | SetTitleResponse | FolderResponse> | undefined => {
      if (isProbeRequest(message)) return probeInjector();
      if (isImportRequest(message)) return importInjector(message.blocks, message.mode, message.coverSource ?? null);
      if (isSetTitleRequest(message)) return setTitleInjector(message.title, message.conflict);
      if (isConnectFolderRequest(message)) return connectFolder();
      if (isClearFolderRequest(message)) return clearFolder();
      if (isFolderStatusRequest(message)) return folderStatus();
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
      // 清掉可能卡屏的授权浮层并 resolve 其 Promise(否则失效时 sidepanel 永久 pending)。
      dismissActiveVaultOverlay?.();
    });
  },
});
