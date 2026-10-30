import type { CSSProperties } from 'react';

import { useLang } from '../lang';
import './Roadmap.css';

export function Roadmap() {
  const { t } = useLang();
  const r = t.roadmap;
  return (
    <section className="section roadmap" id="roadmap">
      <div className="wrap">
        <header className="section-head" data-reveal>
          <p className="kicker" style={{ '--dot': 'var(--fat)' } as CSSProperties}>
            {r.kicker}
          </p>
          <h2>{r.title}</h2>
        </header>
        <div className="roadmap-grid">
          {r.groups.map((group, i) => (
            <section key={i} className="roadmap-col" data-status={group.status} data-reveal style={{ '--i': i } as CSSProperties} aria-labelledby={`roadmap-${group.status}`}>
              <h3 id={`roadmap-${group.status}`} className="roadmap-label">
                <span className="roadmap-dot" aria-hidden="true" />
                {group.label}
              </h3>
              <ul>
                {group.items.map((item, j) => (
                  <li key={j}>{item}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}
