import { usePrefs } from '@/lib/prefs/PrefsProvider';
import { resolveDark, skinMeta, type Accent, type Skin, type ThemeMode } from './themes';

/** 主题读写 API，派生自全局 prefs。 */
export function useTheme() {
  const { prefs, setPrefs } = usePrefs();
  const dark = resolveDark(prefs.skin, prefs.theme);
  const canToggleTheme = skinMeta[prefs.skin].length > 1;

  return {
    skin: prefs.skin,
    theme: prefs.theme,
    accent: prefs.accent,
    dark,
    canToggleTheme,
    setSkin: (skin: Skin) => setPrefs({ skin }),
    setTheme: (theme: ThemeMode) => setPrefs({ theme }),
    setAccent: (accent: Accent) => setPrefs({ accent }),
    toggleTheme: () => setPrefs({ theme: dark ? 'light' : 'dark' }),
  };
}
