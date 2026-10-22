import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { defaultPrefs, savePrefs, type Prefs } from '@/lib/storage/prefs';
import { applyThemeVars, resolveDark, skinVars } from '@/lib/theme/themes';

interface PrefsContextValue {
  prefs: Prefs;
  setPrefs: (patch: Partial<Prefs>) => void;
}

const PrefsContext = createContext<PrefsContextValue | null>(null);

interface PrefsProviderProps {
  initial?: Prefs;
  children: ReactNode;
}

export function PrefsProvider({ initial = defaultPrefs, children }: PrefsProviderProps) {
  const [prefs, setState] = useState<Prefs>(initial);

  const setPrefs = useCallback((patch: Partial<Prefs>) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      // 偏好写失败低危(下次改动会重写),不占 UI,但不许静默吞——落 console 便于诊断(P0-1 配套)。
      savePrefs(next).catch((err) => console.error('[MarkFlow] prefs persist failed:', err));
      return next;
    });
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
