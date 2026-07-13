import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PROBE_REQUEST_TYPE,
  type ProbeResponse,
  type ProbeResult,
  type RuntimeRequest,
} from './protocol';

/**
 * 侧边栏「三灯状态条」探针 hook —— sidepanel 侧的探针数据流:
 *   1. 定位目标 X 标签页(优先当前窗口的 active tab,其次任意一个);
 *   2. 经 browser.tabs.sendMessage 向该 tab 的 content script 发起 markflow:probe 请求;
 *   3. content 再转 injector,层层转译为下面五态之一。
 *
 * 触发时机:面板挂载时探一次 + 手动调用 refresh();不做轮询。
 */

/** 探针状态机:挂载即视为「探测中」,而非额外的 idle 态。 */
export type ProbeStatus = 'probing' | 'disconnected' | 'no-injector' | 'timeout' | 'ready';

export interface ProbeState {
  /** 当前探针状态。 */
  status: ProbeStatus;
  /** status === 'ready' 时的探针结果,否则为 null。 */
  result: ProbeResult | null;
  /** 是否正在探测中(用于刷新按钮 loading 态)。 */
  loading: boolean;
  /** 手动触发新一轮探测。 */
  refresh: () => void;
}

const X_TAB_MATCHES = ['*://x.com/*', '*://twitter.com/*'];
const PROBE_REQUEST: RuntimeRequest = { type: PROBE_REQUEST_TYPE };

export function useProbe(): ProbeState {
  const [status, setStatus] = useState<ProbeStatus>('probing');
  const [result, setResult] = useState<ProbeResult | null>(null);
  // 探测序号:防止「刷新中又刷新」时,上一轮迟到的结果覆盖新一轮已落地的状态。
  const seqRef = useRef(0);

  const runProbe = useCallback(async () => {
    const seq = ++seqRef.current;
    setStatus('probing');

    const settle = (nextStatus: ProbeStatus, nextResult: ProbeResult | null) => {
      if (seq !== seqRef.current) return; // 已有更新的一轮探测,本轮结果作废
      setStatus(nextStatus);
      setResult(nextResult);
    };

    let tabs: Awaited<ReturnType<typeof browser.tabs.query>>;
    try {
      tabs = await browser.tabs.query({ url: X_TAB_MATCHES });
    } catch {
      settle('disconnected', null);
      return;
    }
    if (tabs.length === 0) {
      settle('disconnected', null);
      return;
    }

    // 优先当前窗口的 active tab,取不到当前窗口时退回「任意一个匹配的 tab」。
    let target = tabs.find((tb) => tb.active) ?? tabs[0];
    try {
      const win = await browser.windows.getCurrent();
      target = tabs.find((tb) => tb.active && tb.windowId === win.id) ?? target;
    } catch {
      /* 拿不到当前窗口不影响兜底选择,忽略 */
    }

    if (target?.id === undefined) {
      settle('disconnected', null);
      return;
    }

    try {
      // 直接复用 protocol 的 ProbeResponse,避免内联 union 与协议定义漂移
      const response = (await browser.tabs.sendMessage(target.id, PROBE_REQUEST)) as
        | ProbeResponse
        | undefined;
      if (!response) {
        settle('disconnected', null);
      } else if (response.ok) {
        settle('ready', response.result);
      } else {
        settle(response.error, null);
      }
    } catch {
      // 目标 tab 没有 content script(非 X 文章编辑页 / 页面未刷新)→ 归为「未连接」
      settle('disconnected', null);
    }
  }, []);

  useEffect(() => {
    void runProbe();
  }, [runProbe]);

  return { status, result, loading: status === 'probing', refresh: runProbe };
}
