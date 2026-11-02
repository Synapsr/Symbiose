import type { CSSProperties } from 'react';

import { CopyButton } from '../components/CopyButton';
import { ArrowUpRight, Check, Qr, Server, Terminal } from '../components/Icons';
import { DOCKER_RUN, REPO } from '../i18n';
import { useLang } from '../lang';
import './Privacy.css';

export function Privacy() {
  const { t } = useLang();
  const p = t.privacy;
  const stepIcons = [Terminal, Server, Qr];
  return (
    <section className="privacy" id="self-host" aria-labelledby="privacy-title">
      <div className="privacy-panel">
        <div className="wrap privacy-grid">
          <div className="privacy-main">
            <header className="section-head" data-reveal>
              <p className="kicker">{p.kicker}</p>
              <h2 id="privacy-title">{p.title}</h2>
              <p>{p.body}</p>
            </header>

            <div className="terminal" data-reveal style={{ '--i': 1 } as CSSProperties}>
              <div className="terminal-bar">
                <span className="terminal-title">
                  <Terminal size={16} />
                  {p.terminal}
                </span>
                <CopyButton text={DOCKER_RUN} label={p.copy} done={p.copied} />
              </div>
              <pre tabIndex={0} aria-label={p.terminal}>
                <code>
                  <span className="c-cmd">docker run</span> -d --name symbiose \{'\n'}
                  {'  '}-p 3000:3000 \{'\n'}
                  {'  '}-e <span className="c-key">ANTHROPIC_API_KEY</span>=<span className="c-val">sk-ant-...</span> \{'\n'}
                  {'  '}-v symbiose-data:/data \{'\n'}
                  {'  '}
                  <span className="c-img">synapsr/symbiose:latest</span>
                </code>
              </pre>
              <p className="terminal-foot">
                <span>{p.compose}</span>
                <a href={`${REPO}#self-host-the-server`}>
                  {p.readme}
                  <ArrowUpRight size={14} />
                </a>
              </p>
            </div>

            <ol className="privacy-steps">
              {p.steps.map((step, i) => {
                const Icon = stepIcons[i]!;
                return (
                  <li key={i} data-reveal style={{ '--i': i } as CSSProperties}>
                    <span className="privacy-step-num num">{i + 1}</span>
                    <Icon size={20} className="privacy-step-icon" />
                    <h3>{step.title}</h3>
                    <p>{step.body}</p>
                  </li>
                );
              })}
            </ol>
          </div>

          <ul className="privacy-facts">
            {p.facts.map((fact, i) => (
              <li key={i} data-reveal style={{ '--i': i } as CSSProperties}>
                <span className="privacy-check" aria-hidden="true">
                  <Check size={15} />
                </span>
                {fact}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
