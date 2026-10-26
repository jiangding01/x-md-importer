import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { defaultPrefs, PREFS_KEY, savePrefs, type Prefs } from '@/lib/storage/prefs';
import { validatePrefs } from '@/lib/storage/schema';
import { useSyncedObject } from '@/lib/storage/syncedObject';
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
  // 持久化 + 多窗口同步见 lib/storage/syncedObject(第三批 C4,与设置共用):窗口 A 改了皮肤,
  // B 再改语言不会把 A 的皮肤覆盖回去。
  const [prefs, setState] = useSyncedObject<Prefs>({
    storageKey: PREFS_KEY,
    initial,
    defaults: defaultPrefs,
    validate: validatePrefs,
    save: savePrefs,
    label: 'prefs',
  });

  const setPrefs = useCallback((patch: Partial<Prefs>) => setState((prev) => ({ ...prev, ...patch })), [setState]);

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
