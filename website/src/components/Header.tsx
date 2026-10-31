import { useEffect, useState } from 'react';

import { REPO } from '../i18n';
import { useLang } from '../lang';
import { GitHub, Moon, Sun } from './Icons';
import { Logo } from './Logo';
import { Wordmark } from './Wordmark';
import './Header.css';

const THEME_KEY = 'symbiose-theme';

function ThemeToggle({ label }: { label: string }) {
  // Unknown until mounted: the prerendered HTML can't know the visitor's theme.
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    setDark(root.dataset.theme === 'dark');
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const follow = (event: MediaQueryListEvent) => {
      let saved: string | null = null;
      try {
        saved = window.localStorage.getItem(THEME_KEY);
      } catch {
        // ignore
      }
      if (saved) return;
      root.dataset.theme = event.matches ? 'dark' : 'light';
      setDark(event.matches);
    };
    media.addEventListener('change', follow);
    return () => media.removeEventListener('change', follow);
  }, []);

  function toggle() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    setDark(next === 'dark');
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      // Not persisted, still switched.
    }
  }

  return (
    <button type="button" className="icon-btn theme-toggle" onClick={toggle} aria-pressed={dark ?? undefined} aria-label={label}>
      <span className="swap-icon">
        <Moon size={19} className="swap-off" />
        <Sun size={19} className="swap-on" />
      </span>
    </button>
  );
}

function LangSwitch() {
  const { lang, setLang, t } = useLang();
  return (
    <div className="lang-switch" role="group" aria-label={t.nav.language} data-lang={lang}>
      <span className="lang-switch-thumb" aria-hidden="true" />
      {(['fr', 'en'] as const).map((code) => (
        <button
          key={code}
          type="button"
          lang={code}
          aria-pressed={lang === code}
          aria-label={code === 'fr' ? 'Français' : 'English'}
          onClick={() => setLang(code)}>
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

export function Header() {
  const { t } = useLang();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setScrolled(window.scrollY > 8));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  const links = [
    ['#how', t.nav.how],
    ['#features', t.nav.features],
    ['#precision', t.nav.precision],
    ['#self-host', t.nav.privacy],
    ['#faq', t.nav.faq],
  ] as const;

  return (
    <header className="header" data-scrolled={scrolled || undefined}>
      <div className="wrap header-inner">
        <a className="brand" href="#top" aria-label={t.nav.home}>
          <Logo size={30} />
          <Wordmark height={26} className="brand-name" />
        </a>
        <nav className="nav" aria-label={t.nav.primary}>
          {links.map(([href, label]) => (
            <a key={href} href={href}>
              {label}
            </a>
          ))}
        </nav>
        <div className="header-actions">
          <LangSwitch />
          <ThemeToggle label={t.nav.darkMode} />
          <a className="icon-btn" href={REPO} aria-label={t.nav.githubLabel}>
            <GitHub size={19} />
          </a>
        </div>
      </div>
    </header>
  );
}
