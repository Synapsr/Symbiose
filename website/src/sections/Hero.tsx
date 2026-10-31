import { useEffect, useRef, type CSSProperties } from 'react';

import { HeroMark } from '../components/HeroMark';
import { ArrowRight, GitHub } from '../components/Icons';
import { Logo } from '../components/Logo';
import { Phone } from '../components/Phone';
import { prefersReducedMotion } from '../hooks';
import { REPO } from '../i18n';
import { useLang } from '../lang';
import './Hero.css';

const d = (step: number) => ({ '--d': step }) as CSSProperties;

/** On desktop, a soft light follows the pointer around the hero's mark (one rAF per move, CSS variables only). */
function usePointerLight() {
  const orbs = useRef<HTMLDivElement>(null);
  const glow = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const area = orbs.current;
    const light = glow.current;
    if (!area || !light || prefersReducedMotion() || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    const hero = area.closest('section');
    if (!hero) return;
    let frame = 0;
    const move = (event: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const box = light.getBoundingClientRect();
        light.style.setProperty('--mx', `${event.clientX - box.left}px`);
        light.style.setProperty('--my', `${event.clientY - box.top}px`);
        light.dataset.on = '';
      });
    };
    const leave = () => {
      cancelAnimationFrame(frame);
      delete light.dataset.on;
    };
    hero.addEventListener('pointermove', move, { passive: true });
    hero.addEventListener('pointerleave', leave);
    return () => {
      cancelAnimationFrame(frame);
      hero.removeEventListener('pointermove', move);
      hero.removeEventListener('pointerleave', leave);
    };
  }, []);
  return { orbs, glow };
}

export function Hero() {
  const { t } = useLang();
  const h = t.hero;
  const { orbs, glow } = usePointerLight();
  return (
    <section className="hero" id="top">
      <div className="wrap hero-grid">
        <div className="hero-copy">
          <Logo size={56} animate className="hero-logo" />
          <p className="hero-eyebrow h-in" style={d(1)}>
            {h.eyebrow.map((item, i) => (
              <span key={item}>
                {i > 0 ? <span className="hero-eyebrow-sep" aria-hidden="true" /> : null}
                {item}
              </span>
            ))}
          </p>
          <h1 className="hero-title">
            <span className="h-focus" style={d(2)}>
              {h.title1}
            </span>{' '}
            <span className="h-focus accent-italic" style={d(3)}>
              {h.title2}
            </span>
          </h1>
          <p className="hero-lead h-in" style={d(4)}>
            {h.lead}
          </p>
          <div className="hero-ctas h-in" style={d(5)}>
            <a className="btn btn--primary btn--icon-end" href="#self-host">
              {h.ctaPrimary}
              <ArrowRight size={18} />
            </a>
            <a className="btn btn--secondary btn--icon-start" href={REPO}>
              <GitHub size={18} />
              {h.ctaSecondary}
            </a>
          </div>
          <p className="hero-note h-in" style={d(6)}>
            {h.note}
          </p>
        </div>

        <div className="hero-visual">
          <div className="hero-orbs" ref={orbs} aria-hidden="true">
            <span className="hero-glow" ref={glow} />
            <HeroMark />
          </div>
          <div className="hero-phone hero-phone--back">
            <Phone screen="insights-sources" theme="dark" alt={h.altDark} eager width="100%" />
          </div>
          <div className="hero-phone hero-phone--front">
            <Phone screen="today" theme="light" alt={h.altLight} eager width="100%" />
          </div>
          <div className="hero-chip hero-chip--analyzing" aria-hidden="true">
            <Logo size={22} breathe />
            {h.chipAnalyzing}
          </div>
          <div className="hero-chip hero-chip--rule" aria-hidden="true">
            <span className="dot" style={{ '--c': 'var(--sugar)' } as CSSProperties} />
            {h.chipRule}
          </div>
        </div>
      </div>
    </section>
  );
}

export function Facts() {
  const { t } = useLang();
  return (
    <section className="facts" aria-label="Symbiose">
      <ul className="wrap facts-list">
        {t.facts.map((fact, i) => (
          <li key={fact.label} data-reveal style={{ '--i': i } as CSSProperties}>
            <span className="facts-value num">{fact.value}</span>
            <span className="facts-label">{fact.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
