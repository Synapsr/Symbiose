import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { dictionaries, type Dict, type Lang } from './i18n';

const STORAGE_KEY = 'symbiose-lang';

type LangValue = { lang: Lang; t: Dict; setLang: (lang: Lang) => void };

const LangContext = createContext<LangValue | null>(null);

/** The language the page should start in: `?lang=` wins, then the saved choice, then French. */
export function initialLang(): Lang {
  if (typeof window === 'undefined') return 'fr';
  try {
    const query = new URLSearchParams(window.location.search).get('lang');
    if (query === 'en' || query === 'fr') return query;
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'fr') return saved;
  } catch {
    // Storage can be blocked (private mode, strict settings): French it is.
  }
  return 'fr';
}

export function LangProvider({ initial, children }: { initial: Lang; children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initial);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not persisted, still switched for this visit.
    }
  }, []);

  useEffect(() => {
    const t = dictionaries[lang];
    document.documentElement.lang = lang;
    document.title = t.meta.title;
    document.querySelector('meta[name="description"]')?.setAttribute('content', t.meta.description);
  }, [lang]);

  const value = useMemo(() => ({ lang, t: dictionaries[lang], setLang }), [lang, setLang]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): LangValue {
  const value = useContext(LangContext);
  if (!value) throw new Error('useLang must be used inside <LangProvider>');
  return value;
}
