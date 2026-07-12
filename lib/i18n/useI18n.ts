import { usePrefs } from '@/lib/prefs/PrefsProvider';
import { dictionaries, resolveLang, type Dict, type Lang, type LangPref } from './dict';

/** 语言读写 API，派生自全局 prefs。 */
export function useI18n() {
  const { prefs, setPrefs } = usePrefs();
  const lang: Lang = resolveLang(prefs.lang);
  const t: Dict = dictionaries[lang];

  return {
    lang,
    langPref: prefs.lang,
    t,
    setLang: (langPref: LangPref) => setPrefs({ lang: langPref }),
  };
}
