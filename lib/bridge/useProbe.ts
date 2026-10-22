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

/**
 * 探针状态机:挂载即视为「探测中」,而非额外的 idle 态。
 * 'disconnected' = 当前活动标签不是 X 编辑页(该去打开);
 * 'needs-refresh' = 当前**是** X 编辑页、但 content script 不应答(扩展更新后页面没刷新等,该刷新页面)。
 */
export type ProbeStatus =
  | 'probing'
  | 'disconnected'
  | 'needs-refresh'
  | 'no-injector'
  | 'timeout'
  | 'ready';

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

/**
 * content 正常应答后的状态判定(纯函数,便于单测)。
 * 旧 injector fail-closed 提示:扩展更新后未刷新的 X 页仍跑旧 injector,探针结果**缺**
 * `isArticleEditor` 字段(类型上必填,但旧版本运行时确实不回)——此时三灯可能全绿而
 * connected=false,若按 ready 处理,UI 会误导用户「去打开 X Articles」。故 hasDraftNode 为真
 * 且该字段缺失 → 归为 needs-refresh,复用「请刷新此 X 页面」文案。
 */
export function classifyProbeResult(result: ProbeResult): ProbeStatus {
  const isArticleEditor = (result as Partial<ProbeResult>).isArticleEditor;
  if (result.hasDraftNode && isArticleEditor === undefined) return 'needs-refresh';
  return 'ready';
}

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
      // 当前活动标签不是 X 编辑页 → 该去打开。
      settle('disconnected', null);
      return;
    }

    try {
      // 直接复用 protocol 的 ProbeResponse,避免内联 union 与协议定义漂移
      const response = (await browser.tabs.sendMessage(tabId, PROBE_REQUEST)) as
        | ProbeResponse
        | undefined;
      // 走到这里说明当前活动标签**就是** X 编辑页(resolveTargetXTab 已确认);content 不应答
      // (无回应)则是「页面里没有 content script」——扩展更新后没刷新等——归为「需刷新页面」,
      // 而非误导用户「去打开编辑页」。
      if (!response) {
        settle('needs-refresh', null);
      } else if (response.ok) {
        const next = classifyProbeResult(response.result);
        settle(next, next === 'ready' ? response.result : null);
      } else {
        settle(response.error, null);
      }
    } catch {
      // sendMessage 抛错 = 该 X 标签没有 content script(页面未刷新 / 扩展刚更新)→ 需刷新页面。
      settle('needs-refresh', null);
    }
  }, []);

  // 面板挂载时探一次(整个面板只探一次,而非每个消费者各探一次)。
  useEffect(() => {
    void runProbe();
  }, [runProbe]);

  // 自动重探:监听标签页事件,免用户手动点刷新。事件驱动(非轮询)——
  //  - onActivated:切换到别的标签(如切到 X 文章页)后重探;
  //  - onUpdated:当前活动标签的 ①URL 变化(SPA pushState,如切换文章)或 ②加载完成
  //    (status==='complete')后重探。**②不可省**:整页刷新(⌘R)/首次进入时 URL 不变、
  //    changeInfo.url 为空,只有 status——此时 content script 刚重新注入,必须靠 complete 感知,
  //    否则「刷新后连不上、要手动点刷新」(实测暴露)。
  //    **不按 URL 过滤是否 X 页**(C29):无 tabs 权限时非 X 页的 url 本就读不到;且从 x.com
  //    跳到 example.com 也必须重探,否则状态条停留「已连接」。探针对非 X 页自然落到断开态。
  // 400ms 防抖:SPA 导航 / 加载会连发多个事件,合并成一次探测。
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void runProbe(), 400);
    };
    const onActivated = () => schedule();
    const onUpdated = (
      _tabId: number,
      changeInfo: { url?: string; status?: string },
      tab: { active?: boolean },
    ) => {
      // 仅「当前活动标签」的 URL 变化 或 加载完成 才重探——跟随当前标签,后台标签不影响显示。
      // changeInfo.url 仅在有该页 host 权限(X 页)时出现;非 X 页只能靠 status==='complete'。
      if (!tab.active) return;
      if (changeInfo.url || changeInfo.status === 'complete') schedule();
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
