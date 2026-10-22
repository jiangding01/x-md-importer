import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { OPTIONS_KEY, saveOptions } from '@/lib/storage/optionsStore';
import { validateOptions } from '@/lib/storage/schema';
import { defaultOptions, type Options } from './options';

interface SettingsContextValue {
  opts: Options;
  setOpt: <K extends keyof Options>(key: K, value: Options[K]) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

/**
 * 键序无关的序列化:chrome.storage 回读的对象键序未必与写入时一致(底层字典可能按键排序),
 * 直接 JSON.stringify 比较会把自己的回声误判成外部变更。Options 是扁平对象,顶层键排序即可。
 */
function stableJson(v: Options): string {
  return JSON.stringify(v, Object.keys(v).sort());
}

interface SettingsProviderProps {
  initial?: Options;
  children: ReactNode;
}

export function SettingsProvider({ initial = defaultOptions, children }: SettingsProviderProps) {
  const [opts, setState] = useState<Options>(initial);
  // 「已与 storage 一致」的值(序列化):初值来自 storage、外部变更采纳后同步更新——
  // 持久化 effect 见到相等即跳过,既跳过首渲染,也不把刚采纳的外部值再写回去(避免乒乓)。
  const syncedJson = useRef(stableJson(initial));
  // 本实例已发出、尚未收到 onChanged 回声的写入(序列化队列):回声到达时按队列匹配吞掉,
  // 快速连改 A→B 时 A 的迟到回声不会把状态倒回 A。上限防 storage 值未变(不发事件)时堆积。
  const pendingEchoes = useRef<string[]>([]);

  // 只改内存态;持久化移到下方 effect(C13):此前在 setState 更新函数里发 IO,
  // StrictMode 下更新函数会被调用两次,且更新函数应保持纯净。
  const setOpt = useCallback(<K extends keyof Options>(key: K, value: Options[K]) => {
    setState((prev) => ({ ...prev, [key]: value }));
  }, []);

  useEffect(() => {
    const json = stableJson(opts);
    if (json === syncedJson.current) return;
    syncedJson.current = json;
    pendingEchoes.current.push(json);
    if (pendingEchoes.current.length > 20) pendingEchoes.current.shift();
    // 设置写失败低危(下次改动会重写),不占 UI,但不许静默吞——落 console 便于诊断(P0-1 配套)。
    saveOptions(opts).catch((err) => console.error('[MarkFlow] options persist failed:', err));
  }, [opts]);

  // ── 多窗口同步(C2)──
  // 每个浏览器窗口一个 sidePanel 实例,此前各持挂载时快照、整对象写回 last-write-wins:
  // 窗口 A 改了 onExisting,B 再改任一设置就把 A 的改动覆盖回去。订阅 onChanged 直接采纳
  // 外部变更(设置无「未落盘编辑」概念,无需草稿那样的 pending 闸门)。
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return;
    const handler = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== 'local') return;
      const change = changes[OPTIONS_KEY];
      if (!change) return;
      // newValue 为 undefined = key 被删除(另一窗口 wipeAll)→ 按默认值采纳。
      const incoming = change.newValue === undefined ? defaultOptions : validateOptions(change.newValue);
      const json = stableJson(incoming);
      const echoAt = pendingEchoes.current.indexOf(json);
      if (echoAt >= 0) {
        // 自己的回声:连同其之前(已被覆盖的更早写入)一并出队,不触发 render。
        pendingEchoes.current.splice(0, echoAt + 1);
        return;
      }
      if (json === syncedJson.current) return;
      syncedJson.current = json;
      setState(incoming);
    };
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  }, []);

  const value = useMemo<SettingsContextValue>(() => ({ opts, setOpt }), [opts, setOpt]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings 必须在 <SettingsProvider> 内使用');
  return ctx;
}
