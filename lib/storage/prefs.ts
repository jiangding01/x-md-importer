import type { Accent, Skin, ThemeMode } from '@/lib/theme/themes';
import type { LangPref } from '@/lib/i18n/dict';
import { getItem, setItem } from './store';

/** 主题 / 语言等界面偏好，需在首帧前同步读取以避免闪烁。 */
export interface Prefs {
  skin: Skin;
  theme: ThemeMode;
  accent: Accent;
  lang: LangPref;
}

export const defaultPrefs: Prefs = {
  skin: 'minimal',
  theme: 'system',
  accent: '#1D9BF0',
  lang: 'auto',
};

const KEY = 'markflow:prefs';

export async function loadPrefs(): Promise<Prefs> {
  const stored = await getItem<Partial<Prefs>>(KEY, {});
  return { ...defaultPrefs, ...stored };
}

export function savePrefs(prefs: Prefs): Promise<void> {
  return setItem(KEY, prefs);
}
