import { useState, type CSSProperties } from 'react';

import { ArrowUpRight, Check } from '../components/Icons';
import { Phone } from '../components/Phone';
import { useLang } from '../lang';
import { hasScreen } from '../screens';
import './Precision.css';

/** Fruit yoghurt, per 100 g as served. A 125 g pot gives the app's 121 kcal and 11 g added sugar. */
const PER_100 = { kcal: 97, protein: 3.5, carbs: 15.2, sugar: 13.6, added: 8.8, fat: 2.4 };
const MIN = 50;
const MAX = 300;

const NIH_SOURCE = 'https://sciencedaily.com/releases/2026/07/260726015237.htm';

export function Precision() {
  const { t, lang } = useLang();
  const p = t.precision;
  const [grams, setGrams] = useState(125);
  const locale = lang === 'fr' ? 'fr-FR' : 'en-GB';
  const g = (value: number) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: value < 10 ? 1 : 0, minimumFractionDigits: value < 10 ? 1 : 0 }).format(value);
  const int = (value: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);

  const at = (per100: number) => (per100 * grams) / 100;
  const v = {
    kcal: at(PER_100.kcal),
    protein: at(PER_100.protein),
    carbs: at(PER_100.carbs),
    sugar: at(PER_100.sugar),
    added: at(PER_100.added),
    fat: at(PER_100.fat),
  };
  const atwater = 4 * v.protein + 4 * v.carbs + 9 * v.fat;

  // Circle area follows grams; they sit on a common baseline so the nesting reads at a glance.
  const k = 90 / Math.sqrt((PER_100.carbs * MAX) / 100);
  const circles = [
    { key: 'carbs', r: k * Math.sqrt(v.carbs), color: 'var(--carbs)' },
    { key: 'sugar', r: k * Math.sqrt(v.sugar), color: '#ec5fa0' },
    { key: 'added', r: k * Math.sqrt(v.added), color: 'var(--sugar)' },
  ];

  const rows: [string, string, string?][] = [
    [p.per100.rows.kcal, `${int(v.kcal)} kcal`],
    [p.per100.rows.protein, `${g(v.protein)} g`],
    [p.per100.rows.carbs, `${g(v.carbs)} g`],
    [p.per100.rows.sugar, `${g(v.sugar)} g`, 'sub'],
    [p.per100.rows.added, `${g(v.added)} g`, 'added'],
    [p.per100.rows.fat, `${g(v.fat)} g`],
  ];

  const progress = (grams - MIN) / (MAX - MIN);

  return (
    <section className="section precision" id="precision">
      <div className="wrap">
        <header className="section-head" data-reveal>
          <p className="kicker" style={{ '--dot': 'var(--sugar)' } as CSSProperties}>
            {p.kicker}
          </p>
          <h2>{p.title}</h2>
          <p>
            {p.lead}{' '}
            <a className="precision-source" href={NIH_SOURCE} rel="noopener">
              {p.source}
              <ArrowUpRight size={14} />
            </a>
          </p>
        </header>

        <div className="precision-grid">
          <article className="card per100" data-reveal>
            <div className="per100-head">
              <div>
                <h3>{p.per100.title}</h3>
                <p>{p.per100.body}</p>
              </div>
            </div>

            <div className="per100-body">
              <div className="per100-controls">
                <div className="per100-food">
                  <span aria-hidden="true">🥛</span>
                  <span>{p.per100.food}</span>
                </div>
                <label className="per100-portion" htmlFor="portion">
                  <span>{p.per100.portion}</span>
                  <output htmlFor="portion" className="num">
                    {grams} g
                  </output>
                </label>
                <input
                  id="portion"
                  className="range"
                  type="range"
                  min={MIN}
                  max={MAX}
                  step={5}
                  value={grams}
                  onChange={(event) => setGrams(Number(event.target.value))}
                  style={{ '--p': progress } as CSSProperties}
                />
                <dl className="per100-table">
                  {rows.map(([label, value, kind]) => (
                    <div key={label} data-kind={kind}>
                      <dt>{label}</dt>
                      <dd className="num">{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              <figure className="nested">
                <svg viewBox="0 0 200 184" role="img" aria-label={p.per100.nested}>
                  {circles.map((c) => (
                    <circle
                      key={c.key}
                      cx={100}
                      cy={182 - c.r}
                      r={c.r}
                      fill={c.color}
                      fillOpacity={c.key === 'added' ? 0.95 : 0.28}
                      stroke={c.color}
                      strokeOpacity={0.6}
                      strokeWidth={c.key === 'added' ? 0 : 1.2}
                    />
                  ))}
                </svg>
                <figcaption>{p.per100.nested}</figcaption>
                <p className="atwater">
                  <span className="atwater-label">{p.per100.atwater}</span>
                  <span className="atwater-math num">
                    4 × {g(v.protein)} + 4 × {g(v.carbs)} + 9 × {g(v.fat)} = {int(atwater)} kcal
                  </span>
                  <span className="atwater-ok">
                    <Check size={15} />
                    {p.per100.atwaterOk}
                  </span>
                </p>
              </figure>
            </div>
          </article>

          <article className="card precision-tile" data-reveal style={{ '--i': 1 } as CSSProperties}>
            <h3>{p.question.title}</h3>
            <p>{p.question.body}</p>
            <div className="question" aria-hidden="true">
              <p className="question-ask">{p.question.ask}</p>
              <div className="question-options">
                {p.question.options.map((option, i) => (
                  <span key={i} data-on={i === 1 || undefined}>
                    {option}
                  </span>
                ))}
              </div>
            </div>
          </article>

          <article className="card precision-tile" data-reveal style={{ '--i': 2 } as CSSProperties}>
            <h3>{p.checks.title}</h3>
            <p>{p.checks.body}</p>
            <ul className="checks">
              {p.checks.items.map((item, i) => (
                <li key={i}>
                  <span className="dot" style={{ '--c': ['var(--sugar)', 'var(--fat)', 'var(--accent)'][i] } as CSSProperties} />
                  {item}
                </li>
              ))}
            </ul>
          </article>

          <article className="card precision-targets" data-reveal data-has-phone={hasScreen('plan') || undefined}>
            <div className="precision-targets-text">
              <h3>{p.targets.title}</h3>
              <p>{p.targets.body}</p>
              <ul className="formula">
                {p.targets.chips.map((chip) => (
                  <li key={chip}>{chip}</li>
                ))}
              </ul>
            </div>
            <div className="precision-targets-phone">
              <Phone screen="plan" alt={p.targets.screenAlt} crop width="min(260px, 66vw)" />
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
