import type { CSSProperties } from 'react';

import { ArrowUpRight, Check, GitHub } from '../components/Icons';
import { REPO } from '../i18n';
import { useLang } from '../lang';
import './OpenSource.css';

const PATHS = ['apps/mobile', 'apps/server', 'Anthropic API', 'packages/shared'];

export function OpenSource() {
  const { t } = useLang();
  const o = t.open;
  return (
    <section className="section open" id="open-source">
      <div className="wrap open-grid">
        <div>
          <header className="section-head" data-reveal>
            <p className="kicker">{o.kicker}</p>
            <h2>{o.title}</h2>
            <p>{o.body}</p>
          </header>
          <div className="open-ctas" data-reveal style={{ '--i': 1 } as CSSProperties}>
            <a className="btn btn--primary btn--icon-start" href={REPO}>
              <GitHub size={18} />
              {o.github}
            </a>
            <a className="btn btn--secondary btn--icon-end" href={`${REPO}/blob/main/CONTRIBUTING.md`}>
              {o.contribute}
              <ArrowUpRight size={16} />
            </a>
          </div>
          <a className="open-link" href={`${REPO}/blob/main/docs/architecture.md`} data-reveal style={{ '--i': 2 } as CSSProperties}>
            {o.architecture}
            <ArrowUpRight size={14} />
          </a>
        </div>

        <ul className="stack card" data-reveal style={{ '--i': 1 } as CSSProperties}>
          {o.stack.map((item, i) => (
            <li key={i}>
              <span className="stack-name">{item.name}</span>
              <span className="stack-role">{item.role}</span>
              <code className="stack-path">{PATHS[i]}</code>
            </li>
          ))}
          <li className="stack-license">
            <span className="stack-license-badge">
              <Check size={14} />
              MIT
            </span>
            <code className="stack-path">LICENSE</code>
          </li>
        </ul>
      </div>
    </section>
  );
}
