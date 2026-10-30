import { useEffect } from 'react';

import { Header } from './components/Header';
import { useLang } from './lang';
import { Faq } from './sections/Faq';
import { Features } from './sections/Features';
import { Footer } from './sections/Footer';
import { Goals } from './sections/Goals';
import { Facts, Hero } from './sections/Hero';
import { HowItWorks } from './sections/HowItWorks';
import { OpenSource } from './sections/OpenSource';
import { Precision } from './sections/Precision';
import { Privacy } from './sections/Privacy';
import { Roadmap } from './sections/Roadmap';
import { Watch } from './sections/Watch';

/**
 * One observer reveals `[data-reveal]` blocks as they scroll in. Blocks already
 * on screen are marked first, then `.ready` arms the hidden state, so the
 * prerendered page never flashes.
 */
function useScrollReveal(lang: string) {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('lang-swap');
    const pending = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]:not([data-in])'));
    if (!('IntersectionObserver' in window)) {
      pending.forEach((el) => el.setAttribute('data-in', ''));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute('data-in', '');
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    const viewport = window.innerHeight;
    for (const el of pending) {
      const rect = el.getBoundingClientRect();
      if (rect.top < viewport && rect.bottom > 0) el.setAttribute('data-in', '');
      else observer.observe(el);
    }
    root.classList.add('ready');
    return () => observer.disconnect();
  }, [lang]);
}

export function App() {
  const { t, lang } = useLang();
  useScrollReveal(lang);
  return (
    <>
      <a className="skip-link" href="#main">
        {t.nav.skip}
      </a>
      <Header />
      <main id="main">
        <Hero />
        <Facts />
        <HowItWorks />
        <Goals />
        <Features />
        <Precision />
        <Watch />
        <Privacy />
        <OpenSource />
        <Roadmap />
        <Faq />
      </main>
      <Footer />
    </>
  );
}
