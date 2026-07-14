import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  PROBE_REQUEST_TYPE,
  type ProbeResponse,
  type ProbeResult,
  type RuntimeRequest,
} from './protocol';
import { resolveTargetXTab } from './locateXTab';

/**
 * 侧边栏「三灯状态条」探针 —— sidepanel 侧的探针数据流:
 *   1. 定位目标 X 标签页(优先当前窗口的 active tab,其次任意一个);
 *   2. 经 browser.tabs.sendMessage 向该 tab 的 content script 发起 markflow:probe 请求;
 *   3. content 再转 injector,层层转译为下面五态之一。
 *
 * 触发时机:面板挂载时探一次 + 手动调用 refresh();不做轮询。
 *
 * M1 重构:由「每个消费组件各自独立探测」改为「整个面板共享一次探测」——
 * 状态与 runProbe 逻辑上提到 <ProbeProvider>,useProbe() 退化为消费 context。
 * 逻辑本身未改动(seq 防竞态、五态映射、tab 选取策略、错误兜底全保留)。
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

const PROBE_REQUEST: RuntimeRequest = { type: PROBE_REQUEST_TYPE };

const ProbeContext = createContext<ProbeState | null>(null);

interface ProbeProviderProps {
  children: ReactNode;
}

/**
 * 探针状态 Provider:持有面板级别唯一的一份探针状态与 runProbe 逻辑,
 * 挂载时自动探一次。所有消费者(StatusBar、useConnection)共享同一份状态。
 */
export function ProbeProvider({ children }: ProbeProviderProps) {
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

    const tabId = await resolveTargetXTab();
    if (tabId === null) {
      settle('disconnected', null);
      return;
    }

    try {
      // 直接复用 protocol 的 ProbeResponse,避免内联 union 与协议定义漂移
      const response = (await browser.tabs.sendMessage(tabId, PROBE_REQUEST)) as
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

  // 面板挂载时探一次(整个面板只探一次,而非每个消费者各探一次)。
  useEffect(() => {
    void runProbe();
  }, [runProbe]);

  // 自动重探:监听标签页事件,免用户手动点刷新。事件驱动(非轮询)——
  //  - onActivated:切换到别的标签(如切到 X 文章页)后重探;
  //  - onUpdated:X 标签内 URL 变化(含 SPA pushState,如 首页→articles/edit/切换文章)后重探。
  // 400ms 防抖:SPA 导航会连发多个事件,合并成一次探测。
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void runProbe(), 400);
    };
    const onActivated = () => schedule();
    const onUpdated = (
      _tabId: number,
      changeInfo: { url?: string },
      tab: { url?: string; active?: boolean },
    ) => {
      // 仅「当前活动 X 标签」内的 URL 变化(如 SPA 切换文章)才重探——跟随当前标签,
      // 后台标签的变化不影响当前显示。
      if (!changeInfo.url || !tab.active) return;
      if (/^https?:\/\/(?:[^/]+\.)?(?:x|twitter)\.com\//.test(tab.url ?? '')) schedule();
    };
    browser.tabs.onActivated.addListener(onActivated);
    browser.tabs.onUpdated.addListener(onUpdated);
    return () => {
      browser.tabs.onActivated.removeListener(onActivated);
      browser.tabs.onUpdated.removeListener(onUpdated);
      if (timer) clearTimeout(timer);
    };
  }, [runProbe]);

  const value = useMemo<ProbeState>(
    () => ({ status, result, loading: status === 'probing', refresh: runProbe }),
    [status, result, runProbe],
  );

  // 保持本文件为 .ts(不引入 JSX),用 createElement 挂 Provider。
  return createElement(ProbeContext.Provider, { value }, children);
}

/**
 * 消费共享探针状态。对外 API 与重构前完全一致:{status, result, loading, refresh}。
 * 必须在 <ProbeProvider> 内使用,否则抛出清晰错误。
 */
export function useProbe(): ProbeState {
  const ctx = useContext(ProbeContext);
  if (!ctx) throw new Error('useProbe 必须在 <ProbeProvider> 内使用');
  return ctx;
}
