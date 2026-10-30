import { useRef, type CSSProperties } from 'react';

import { Camera, Heart, Scale, Sparkle, Steps } from '../components/Icons';
import { Phone } from '../components/Phone';
import { useSeen } from '../hooks';
import { useLang } from '../lang';
import { hasScreen } from '../screens';
import './Watch.css';

/** 30 days of weigh-ins: noisy readings, a calm trend. Illustrative. */
const READINGS = [
  78.4, 78.6, 78.1, 78.3, 78.0, 78.2, 77.9, 78.1, 77.6, 77.9, 77.8, 77.5, 77.7, 77.3, 77.6, 77.2, 77.4, 77.0, 77.3, 76.9, 77.1, 76.8,
  77.0, 76.7, 76.9, 76.5, 76.8, 76.6, 76.4, 76.6,
];

function trend(values: number[], alpha = 0.18): number[] {
  const out: number[] = [];
  values.forEach((value, i) => out.push(i === 0 ? value : out[i - 1]! + alpha * (value - out[i - 1]!)));
  return out;
}

function WeightCard({ label, delta }: { label: string; delta: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useSeen(ref);
  const W = 320;
  const H = 150;
  const min = Math.min(...READINGS) - 0.3;
  const max = Math.max(...READINGS) + 0.3;
  const x = (i: number) => 8 + (i / (READINGS.length - 1)) * (W - 16);
  const y = (v: number) => 10 + ((max - v) / (max - min)) * (H - 20);
  const smooth = trend(READINGS);
  const path = smooth.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  return (
    <div className="card weight-card" ref={ref} data-seen={seen || undefined}>
      <div className="weight-head">
        <p className="weight-label">
          <span className="dot" />
          {label}
        </p>
        <p className="weight-delta num">{delta}</p>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="weight-chart" aria-hidden="true">
        {READINGS.map((v, i) => (
          <circle key={i} cx={x(i)} cy={y(v)} r={2.6} className="weight-dot" />
        ))}
        <path d={path} className="weight-trend" pathLength={1} />
      </svg>
    </div>
  );
}

export function Watch() {
  const { t } = useLang();
  const w = t.watch;
  const icons = [Steps, Scale, Heart];
  const weightPhone = hasScreen('insights-weight');

  return (
    <section className="section watch" id="watch">
      <div className="wrap watch-grid">
        <div className="watch-copy">
          <header className="section-head" data-reveal>
            <p className="kicker" style={{ '--dot': 'var(--protein)' } as CSSProperties}>
              {w.kicker}
            </p>
            <h2>{w.title}</h2>
            <p>{w.body}</p>
          </header>

          <ul className="watch-items">
            {w.items.map((item, i) => {
              const Icon = icons[i]!;
              return (
                <li key={i} data-reveal style={{ '--i': i } as CSSProperties}>
                  <span className="watch-icon" aria-hidden="true">
                    <Icon size={20} />
                  </span>
                  <div>
                    <h3>{item.title}</h3>
                    <p>{item.body}</p>
                  </div>
                </li>
              );
            })}
            <li data-reveal style={{ '--i': 3 } as CSSProperties}>
              <span className="watch-icon" aria-hidden="true">
                <Camera size={20} />
              </span>
              <div>
                <h3>{w.controlsTitle}</h3>
                <p>
                  {w.controlsBody} {w.controlsList}
                </p>
              </div>
            </li>
          </ul>
          <p className="watch-compat" data-reveal>
            {w.compat}
          </p>
        </div>

        <div className="watch-visual" data-reveal style={{ '--i': 1 } as CSSProperties}>
          <span className="watch-orb" aria-hidden="true" />
          {weightPhone ? (
            <Phone screen="insights-weight" alt={w.screenAlt} width="min(280px, 64vw)" />
          ) : (
            <WeightCard label={w.weightLabel} delta={w.weightTrend} />
          )}
          <div className="controls" aria-hidden="true">
            <span className="control">
              <span className="control-btn">
                <Camera size={24} />
              </span>
              <span className="control-label">{w.controls[0]}</span>
            </span>
            <span className="control">
              <span className="control-btn control-btn--accent">
                <Sparkle size={24} />
              </span>
              <span className="control-label">{w.controls[1]}</span>
            </span>
          </div>
        </div>
      </div>

      <div className="wrap">
        <p className="wip" data-reveal>
          <span className="wip-badge">
            <span className="wip-pulse" aria-hidden="true" />
            {w.wipLabel}
          </span>
          <span>{w.wip}</span>
        </p>
      </div>
    </section>
  );
}
