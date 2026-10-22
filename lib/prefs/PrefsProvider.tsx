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
import { defaultPrefs, PREFS_KEY, savePrefs, type Prefs } from '@/lib/storage/prefs';
import { validatePrefs } from '@/lib/storage/schema';
import { applyThemeVars, resolveDark, skinVars } from '@/lib/theme/themes';

interface PrefsContextValue {
  prefs: Prefs;
  setPrefs: (patch: Partial<Prefs>) => void;
}

const PrefsContext = createContext<PrefsContextValue | null>(null);

/**
 * 键序无关的序列化:chrome.storage 回读的对象键序未必与写入时一致(底层字典可能按键排序),
 * 直接 JSON.stringify 比较会把自己的回声误判成外部变更。Prefs 是扁平对象,顶层键排序即可。
 */
function stableJson(v: Prefs): string {
  return JSON.stringify(v, Object.keys(v).sort());
}

interface PrefsProviderProps {
  initial?: Prefs;
  children: ReactNode;
}

export function PrefsProvider({ initial = defaultPrefs, children }: PrefsProviderProps) {
  const [prefs, setState] = useState<Prefs>(initial);
  // 「已与 storage 一致」的值(序列化):初值来自 storage、外部变更采纳后同步更新——
  // 持久化 effect 见到相等即跳过,既跳过首渲染,也不把刚采纳的外部值再写回去(避免乒乓)。
  const syncedJson = useRef(stableJson(initial));
  // 本实例已发出、尚未收到 onChanged 回声的写入(序列化队列):回声到达时按队列匹配吞掉,
  // 快速连改 A→B 时 A 的迟到回声不会把状态倒回 A。上限防 storage 值未变(不发事件)时堆积。
  const pendingEchoes = useRef<string[]>([]);

  // 只改内存态;持久化移到下方 effect(C13):此前在 setState 更新函数里发 IO,
  // StrictMode 下更新函数会被调用两次,且更新函数应保持纯净。
  const setPrefs = useCallback((patch: Partial<Prefs>) => {
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  useEffect(() => {
    const json = stableJson(prefs);
    if (json === syncedJson.current) return;
    syncedJson.current = json;
    pendingEchoes.current.push(json);
    if (pendingEchoes.current.length > 20) pendingEchoes.current.shift();
    // 偏好写失败低危(下次改动会重写),不占 UI,但不许静默吞——落 console 便于诊断(P0-1 配套)。
    savePrefs(prefs).catch((err) => console.error('[MarkFlow] prefs persist failed:', err));
  }, [prefs]);

  // ── 多窗口同步(C2)──
  // 每个浏览器窗口一个 sidePanel 实例,此前各持挂载时快照、整对象写回 last-write-wins:
  // 窗口 A 改了皮肤,B 再改语言就把 A 的皮肤覆盖回去。订阅 onChanged 直接采纳外部变更
  // (设置无「未落盘编辑」概念,无需草稿那样的 pending 闸门)。
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return;
    const handler = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== 'local') return;
      const change = changes[PREFS_KEY];
      if (!change) return;
      // newValue 为 undefined = key 被删除(另一窗口 wipeAll)→ 按默认值采纳。
      const incoming = change.newValue === undefined ? defaultPrefs : validatePrefs(change.newValue);
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

  // 应用主题变量（skin/theme/accent 变化时）
  useEffect(() => {
    const dark = resolveDark(prefs.skin, prefs.theme);
    applyThemeVars(skinVars(prefs.skin, dark, prefs.accent));
  }, [prefs.skin, prefs.theme, prefs.accent]);

  // 跟随系统明暗（仅 theme === 'system' 时重算）
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (prefs.theme !== 'system') return;
      const dark = resolveDark(prefs.skin, 'system');
      applyThemeVars(skinVars(prefs.skin, dark, prefs.accent));
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [prefs.skin, prefs.theme, prefs.accent]);

  const value = useMemo<PrefsContextValue>(() => ({ prefs, setPrefs }), [prefs, setPrefs]);

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): PrefsContextValue {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error('usePrefs 必须在 <PrefsProvider> 内使用');
  return ctx;
}
