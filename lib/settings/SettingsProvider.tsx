import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { saveOptions } from '@/lib/storage/optionsStore';
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
  const [opts, setState] = useState<Options>(initial);

  const setOpt = useCallback(<K extends keyof Options>(key: K, value: Options[K]) => {
    setState((prev) => {
      const next = { ...prev, [key]: value };
      // 设置写失败低危(下次改动会重写),不占 UI,但不许静默吞——落 console 便于诊断(P0-1 配套)。
      saveOptions(next).catch((err) => console.error('[MarkFlow] options persist failed:', err));
      return next;
    });
  }, []);

  const value = useMemo<SettingsContextValue>(() => ({ opts, setOpt }), [opts, setOpt]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings 必须在 <SettingsProvider> 内使用');
  return ctx;
}
