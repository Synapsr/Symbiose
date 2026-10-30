import type { CSSProperties } from 'react';

import { Chevron } from '../components/Icons';
import { useLang } from '../lang';
import './Faq.css';

export function Faq() {
  const { t } = useLang();
  const f = t.faq;
  return (
    <section className="section faq" id="faq">
      <div className="wrap faq-grid">
        <header className="section-head faq-head" data-reveal>
          <p className="kicker" style={{ '--dot': 'var(--text-2)' } as CSSProperties}>
            {f.kicker}
          </p>
          <h2>{f.title}</h2>
        </header>
        <div className="faq-list">
          {f.items.map((item, i) => (
            <details key={i} data-reveal style={{ '--i': Math.min(i, 3) } as CSSProperties}>
              <summary>
                <span>{item.q}</span>
                <Chevron size={20} className="faq-chevron" />
              </summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
