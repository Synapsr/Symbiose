import { useEffect, useRef, useState, type CSSProperties } from 'react';

import { Barcode, Camera, TextLines } from '../components/Icons';
import { Logo } from '../components/Logo';
import { Phone } from '../components/Phone';
import { useLang } from '../lang';
import type { ScreenName } from '../screens';
import './HowItWorks.css';

const SCREENS: ScreenName[][] = [['onboarding-goals', 'plan', 'welcome'], ['capture-text', 'today'], ['meal']];

export function HowItWorks() {
  const { t } = useLang();
  const how = t.how;
  const [active, setActive] = useState(0);
  const steps = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    // The step crossing the middle band of the viewport drives the sticky phone.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(Number((entry.target as HTMLElement).dataset.step));
        }
      },
      { rootMargin: '-45% 0px -45% 0px' },
    );
    steps.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const x = how.extras;

  const extras = [
    <div className="how-extra" key="goal">
      <p className="how-quote">{x.quote}</p>
      <ul className="how-result">
        {x.result.map((line, i) => (
          <li key={i}>
            <span className="dot" style={{ '--c': i === 0 ? 'var(--sugar)' : 'var(--accent)' } as CSSProperties} />
            {line}
          </li>
        ))}
      </ul>
    </div>,
    <div className="how-extra" key="capture">
      <div className="how-modes" aria-hidden="true">
        <span>
          <Camera size={18} />
        </span>
        <span>
          <TextLines size={18} />
        </span>
        <span>
          <Barcode size={18} />
        </span>
      </div>
      <p className="how-status">
        <Logo size={22} className="logo--breathe" />
        {x.status}
      </p>
    </div>,
    <div className="how-extra how-feedback" key="feedback">
      <p>
        <span className="dot" style={{ '--c': 'var(--text-3)' } as CSSProperties} />
        <strong>{x.feedback}</strong>
      </p>
      <span className="how-feedback-bar" aria-hidden="true">
        <span />
      </span>
      <p className="how-feedback-tip">{x.tip}</p>
    </div>,
  ];

  return (
    <section className="section how" id="how">
      <div className="wrap">
        <header className="section-head" data-reveal>
          <p className="kicker">{how.kicker}</p>
          <h2>{how.title}</h2>
        </header>

        <div className="how-grid">
          <ol className="how-steps">
            {how.steps.map((step, i) => (
              <li
                key={i}
                ref={(el) => {
                  steps.current[i] = el;
                }}
                data-step={i}
                className="how-step"
                data-active={active === i || undefined}
                data-reveal>
                <div className="how-step-text">
                  <span className="how-num num" aria-hidden="true">
                    {i + 1}
                  </span>
                  <h3>{step.title}</h3>
                  <p className="how-body">{step.body}</p>
                  {extras[i]}
                </div>
                <div className="how-step-phone">
                  <Phone screen={SCREENS[i]!} alt={step.alt} width="min(250px, 68vw)" />
                </div>
              </li>
            ))}
          </ol>

          <div className="how-stage">
            <div className="how-stage-inner" data-step={active}>
              <span className="how-stage-orb" aria-hidden="true" />
              {how.steps.map((step, i) => (
                <div key={i} className="how-screen" data-active={active === i || undefined} aria-hidden={active !== i}>
                  <Phone screen={SCREENS[i]!} alt={step.alt} width="var(--stage-w)" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
