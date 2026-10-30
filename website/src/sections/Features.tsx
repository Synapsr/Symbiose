import { useEffect, useRef, useState, type CSSProperties } from 'react';

import { Barcode, EyeOff, Sparkle, Wand } from '../components/Icons';
import { Phone } from '../components/Phone';
import { prefersReducedMotion, useSeen } from '../hooks';
import { useLang } from '../lang';
import { hasScreen } from '../screens';
import './Features.css';

/** Average added sugar (g) by local hour, 6 h → 23 h: the 4 pm reflex stands out. */
const BY_HOUR = [0, 2, 6, 3, 1, 0.5, 3, 4, 2, 5, 14, 7, 2, 1, 3, 4, 1, 0];
const FIRST_HOUR = 6;
const PEAK = BY_HOUR.indexOf(Math.max(...BY_HOUR));

function HourChart({ label }: { label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useSeen(ref);
  const max = Math.max(...BY_HOUR);
  return (
    <figure className="hours" ref={ref}>
      <div className="hours-bars" role="img" aria-label={label}>
        {BY_HOUR.map((value, i) => (
          <span
            key={i}
            className="hours-bar"
            data-peak={i === PEAK || undefined}
            style={{ '--h': seen ? Math.max(value / max, 0.04) : 0.04, '--i': i } as CSSProperties}
          />
        ))}
      </div>
      <div className="hours-axis" aria-hidden="true">
        {BY_HOUR.map((_, i) => {
          const hour = FIRST_HOUR + i;
          return <span key={i}>{hour % 4 === 0 ? `${hour}h` : ''}</span>;
        })}
      </div>
      <figcaption className="hours-caption">{label}</figcaption>
    </figure>
  );
}

function CoachChat() {
  const { t, lang } = useLang();
  const c = t.features.coach;
  const ref = useRef<HTMLDivElement>(null);
  const seen = useSeen(ref, '0px 0px -25% 0px');
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    // Stream the answer word by word once the card is in view, like the app does.
    if (!seen || prefersReducedMotion()) {
      setCount(null);
      return;
    }
    const words = c.answer.split(' ');
    let n = 0;
    setCount(0);
    const id = window.setInterval(() => {
      n += 1;
      setCount(n);
      if (n >= words.length) window.clearInterval(id);
    }, 55);
    return () => window.clearInterval(id);
  }, [seen, c.answer, lang]);

  const words = c.answer.split(' ');
  const streaming = count !== null && count < words.length;
  const text = count === null ? c.answer : words.slice(0, count).join(' ');

  return (
    <div className="chat" ref={ref}>
      <p className="chat-bubble chat-bubble--me">{c.question}</p>
      <div className="chat-bubble chat-bubble--coach">
        <span className="sr-only">{c.answer}</span>
        <span aria-hidden="true">
          {/* The full text reserves the bubble's final height, so streaming never shifts layout. */}
          <span className="chat-ghost">{c.answer}</span>
          <span className="chat-live">
            {text}
            {streaming ? <span className="chat-caret" /> : null}
          </span>
        </span>
      </div>
      <div className="chat-suggestion" data-show={!streaming || undefined} aria-hidden={streaming || undefined}>
        <p className="chat-suggestion-title">
          <Sparkle size={16} />
          {c.suggestion}
        </p>
        <p>{c.suggestionBody}</p>
        <span className="chat-suggestion-btn">{c.apply}</span>
      </div>
    </div>
  );
}

export function Features() {
  const { t } = useLang();
  const f = t.features;
  const cravingPhone = hasScreen('craving');

  return (
    <section className="section features" id="features">
      <div className="wrap">
        <header className="section-head" data-reveal>
          <p className="kicker" style={{ '--dot': 'var(--warning)' } as CSSProperties}>
            {f.kicker}
          </p>
          <h2>{f.title}</h2>
        </header>

        <div className="bento">
          <article className="card tile tile--craving" data-reveal data-has-phone={cravingPhone || undefined}>
            <div className="tile-text">
              <span className="tile-icon tile-icon--accent" aria-hidden="true">
                <Sparkle size={20} />
              </span>
              <h3>{f.craving.title}</h3>
              <p>{f.craving.body}</p>
            </div>
            <div className="tile-visual craving-visual">
              {cravingPhone ? <Phone screen="craving" alt={f.craving.screenAlt} crop width="min(280px, 72vw)" /> : null}
              {cravingPhone ? null : (
                <div className="craving-card">
                  <p className="craving-row">
                    <span>{f.craving.what}</span>
                    <strong>{f.craving.choice}</strong>
                  </p>
                  <div className="craving-block">
                    <p className="craving-label">{f.craving.tipLabel}</p>
                    <p>{f.craving.tip}</p>
                  </div>
                  <div className="craving-block">
                    <p className="craving-label">{f.craving.altLabel}</p>
                    <p>{f.craving.alt}</p>
                  </div>
                  <div className="craving-actions" aria-hidden="true">
                    <span className="craving-btn craving-btn--yes">{f.craving.resisted}</span>
                    <span className="craving-btn">{f.craving.gaveIn}</span>
                  </div>
                </div>
              )}
            </div>
          </article>

          <article className="card tile tile--fix" data-reveal style={{ '--i': 1 } as CSSProperties}>
            <span className="tile-icon" aria-hidden="true">
              <Wand size={20} />
            </span>
            <h3>{f.fix.title}</h3>
            <p>{f.fix.body}</p>
            <p className="fix-field">
              {f.fix.example}
              <span className="fix-caret" aria-hidden="true" />
            </p>
          </article>

          <article className="card tile tile--trends" data-reveal>
            <div className="tile-text">
              <h3>{f.trends.title}</h3>
              <p>{f.trends.body}</p>
            </div>
            <HourChart label={f.trends.chartLabel} />
            <div className="sources">
              <p className="sources-title">{f.trends.sources}</p>
              <ul>
                {f.trends.items.map((item, i) => (
                  <li key={i} style={{ '--w': item.grams / f.trends.items[0]!.grams } as CSSProperties}>
                    <span className="sources-name">
                      {item.name} <span className="sources-count">{item.count}</span>
                    </span>
                    <span className="sources-grams num">{item.grams} g</span>
                    <span className="sources-bar" aria-hidden="true" />
                  </li>
                ))}
              </ul>
            </div>
          </article>

          <article className="card tile tile--coach" data-reveal style={{ '--i': 1 } as CSSProperties}>
            <div className="tile-text">
              <h3>{f.coach.title}</h3>
              <p>{f.coach.body}</p>
            </div>
            <div className="tile-visual coach-visual">
              <CoachChat />
            </div>
            <p className="review-label">{f.coach.reviewLabel}</p>
            <ul className="review">
              {f.coach.review.map((label, i) => (
                <li key={i} style={{ '--c': ['var(--accent)', 'var(--warning)', 'var(--fat)'][i] } as CSSProperties}>
                  <span className="dot" />
                  {label}
                </li>
              ))}
            </ul>
          </article>

          <article className="card tile tile--small" data-reveal>
            <span className="tile-icon" aria-hidden="true">
              <Barcode size={20} />
            </span>
            <h3>{f.barcode.title}</h3>
            <p>{f.barcode.body}</p>
          </article>

          <article className="card tile tile--small" data-reveal style={{ '--i': 1 } as CSSProperties}>
            <span className="tile-icon" aria-hidden="true">
              <EyeOff size={20} />
            </span>
            <h3>{f.calm.title}</h3>
            <p>{f.calm.body}</p>
          </article>
        </div>
      </div>
    </section>
  );
}
