import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { OPTIONS_KEY, saveOptions } from '@/lib/storage/optionsStore';
import { validateOptions } from '@/lib/storage/schema';
import { useSyncedObject } from '@/lib/storage/syncedObject';
import { defaultOptions, type Options } from './options';

interface SettingsContextValue {
  opts: Options;
  setOpt: <K extends keyof Options>(key: K, value: Options[K]) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

interface SettingsProviderProps {
  initial?: Options;
  children: ReactNode;
}

export function SettingsProvider({ initial = defaultOptions, children }: SettingsProviderProps) {
  // 持久化 + 多窗口同步(自写回声、key 删除回落默认值)见 lib/storage/syncedObject(第三批 C4,与偏好共用)。
  // 设置无「未落盘编辑」概念,外部变更直接采纳:窗口 A 改了 onExisting,B 不会再把它覆盖回去。
  const [opts, setState] = useSyncedObject<Options>({
    storageKey: OPTIONS_KEY,
    initial,
    defaults: defaultOptions,
    validate: validateOptions,
    save: saveOptions,
    label: 'options',
  });

  const setOpt = useCallback(
    <K extends keyof Options>(key: K, value: Options[K]) => setState((prev) => ({ ...prev, [key]: value })),
    [setState],
  );

  const value = useMemo<SettingsContextValue>(() => ({ opts, setOpt }), [opts, setOpt]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings 必须在 <SettingsProvider> 内使用');
  return ctx;
}
