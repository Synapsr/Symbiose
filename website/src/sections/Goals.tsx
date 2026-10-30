import { useRef, useState, type CSSProperties } from 'react';

import { useAnimatedNumber, useSeen } from '../hooks';
import type { GoalId } from '../i18n';
import { useLang } from '../lang';
import './Goals.css';

type GoalData = {
  color: string;
  eaten: number;
  limit: number;
  unit: 'g' | 'kcal';
  secondary: { eaten: number; target: number; color: string };
};

/** One illustrative day per goal; the metric shown first is what the app puts first. */
const DATA: Record<GoalId, GoalData> = {
  sugar: { color: 'var(--sugar)', eaten: 18, limit: 25, unit: 'g', secondary: { eaten: 1420, target: 2100, color: 'var(--accent)' } },
  weight: { color: 'var(--accent)', eaten: 1240, limit: 1850, unit: 'kcal', secondary: { eaten: 82, target: 112, color: 'var(--protein)' } },
  muscle: { color: 'var(--protein)', eaten: 96, limit: 140, unit: 'g', secondary: { eaten: 2050, target: 2650, color: 'var(--accent)' } },
  fiber: { color: 'var(--fiber)', eaten: 22, limit: 30, unit: 'g', secondary: { eaten: 1380, target: 2000, color: 'var(--accent)' } },
};

const ORDER: GoalId[] = ['sugar', 'weight', 'muscle', 'fiber'];

const SIZE = 168;
const STROKE = 14;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function Goals() {
  const { t, lang } = useLang();
  const g = t.goals;
  const [goal, setGoal] = useState<GoalId>('sugar');
  const card = useRef<HTMLDivElement>(null);
  const seen = useSeen(card);

  const data = DATA[goal];
  const copy = g.options[goal];
  const fmt = new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-GB', { maximumFractionDigits: 0 });

  const left = useAnimatedNumber(seen ? data.limit - data.eaten : 0);
  const eaten = useAnimatedNumber(data.eaten);
  const limit = useAnimatedNumber(data.limit);
  const secondary = useAnimatedNumber(data.secondary.eaten);
  const secondaryTarget = useAnimatedNumber(data.secondary.target);
  const progress = seen ? data.eaten / data.limit : 0;
  const unit = (value: number, u: string) => (u === 'kcal' ? `${fmt.format(value)} kcal` : `${fmt.format(value)} g`);

  return (
    <section className="section goals" id="goals">
      <div className="wrap goals-grid">
        <div className="goals-copy">
          <header className="section-head" data-reveal>
            <p className="kicker" style={{ '--dot': 'var(--sugar)' } as CSSProperties}>
              {g.kicker}
            </p>
            <h2>{g.title}</h2>
            <p>{g.body}</p>
          </header>

          <div className="goals-picker" role="radiogroup" aria-label={g.pick} data-reveal style={{ '--i': 1 } as CSSProperties}>
            {ORDER.map((id) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={goal === id}
                className="goals-chip"
                onClick={() => setGoal(id)}
                style={{ '--c': DATA[id].color } as CSSProperties}>
                <span className="dot" />
                {g.options[id].label}
              </button>
            ))}
          </div>

          <dl className="goals-plan" data-reveal style={{ '--i': 2 } as CSSProperties}>
            <div>
              <dt>{g.yourWords}</dt>
              <dd className="goals-words" key={`w-${goal}`}>
                {copy.words}
              </dd>
            </div>
            <div>
              <dt>{g.yourPlan}</dt>
              <dd>
                <ul key={`p-${goal}`} className="goals-rules">
                  {copy.plan.map((line, i) => (
                    <li key={i} style={{ '--i': i } as CSSProperties}>
                      {line}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          </dl>
        </div>

        <div className="goals-demo" data-reveal style={{ '--i': 1 } as CSSProperties}>
          <div className="goals-card card" ref={card} style={{ '--c': data.color } as CSSProperties}>
            <span className="goals-glow" aria-hidden="true" />
            <div className="goals-card-top">
              <div className="goals-ring" role="img" aria-label={`${copy.metric} : ${unit(data.eaten, data.unit)} / ${unit(data.limit, data.unit)}`}>
                <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
                  <circle className="goals-ring-track" cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} strokeWidth={STROKE} fill="none" />
                  <circle
                    className="goals-ring-fill"
                    cx={SIZE / 2}
                    cy={SIZE / 2}
                    r={RADIUS}
                    strokeWidth={STROKE}
                    fill="none"
                    strokeLinecap="round"
                    strokeDasharray={CIRCUMFERENCE}
                    strokeDashoffset={CIRCUMFERENCE * (1 - Math.min(progress, 1))}
                  />
                </svg>
                <div className="goals-ring-label" aria-hidden="true">
                  <span className="num goals-ring-value">{fmt.format(left)}</span>
                  <span className="goals-ring-unit">{copy.unitLeft}</span>
                </div>
              </div>
              <div className="goals-stats">
                <p className="goals-metric">
                  <span className="dot" />
                  {copy.metric}
                </p>
                <div>
                  <p className="goals-stat-label">{g.eaten}</p>
                  <p className="goals-stat num">{unit(eaten, data.unit)}</p>
                </div>
                <div>
                  <p className="goals-stat-label">{copy.limit}</p>
                  <p className="goals-stat num">{unit(limit, data.unit)}</p>
                </div>
              </div>
            </div>
            <div className="goals-secondary">
              <p>
                {fmt.format(secondary)} / {fmt.format(secondaryTarget)} {copy.secondary}
              </p>
              <span className="goals-bar" aria-hidden="true">
                <span
                  style={
                    {
                      '--p': seen ? data.secondary.eaten / data.secondary.target : 0,
                      '--bar': data.secondary.color,
                    } as CSSProperties
                  }
                />
              </span>
            </div>
          </div>
          <p className="goals-voice" key={`v-${goal}-${lang}`}>
            {copy.voice}
          </p>
          <p className="goals-caption">{g.caption}</p>
          <p className="sr-only" aria-live="polite">
            {`${copy.metric} : ${unit(data.eaten, data.unit)} / ${unit(data.limit, data.unit)}. ${copy.voice}`}
          </p>
        </div>
      </div>
    </section>
  );
}
