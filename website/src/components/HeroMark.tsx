import type { ReactNode } from 'react';

import { birth, BREATH, BUD_BREATH, BUD_KEYS, BUD_REST, REST, SINE, track, type Bud } from './bourgeon';
import './HeroMark.css';

// The hero's birth: the cell is already there, the light starts inside it, leaning towards
// the bud, and is born slower than the Logo's (a large mark), with barely any overshoot.
const BORN_AT = '0.9s';
const BIRTH = birth({ frames: 36, seconds: 1.3, swell: false, from: 0.18 });
const SEED = { d: BIRTH.d[0]!, bud: BIRTH.bud[0]! };
const HALO = 2.1;
const scaled = (bud: Bud, scale: number) => ({ ...bud, r: bud.r * scale });
const breath = { dur: '4.8s', begin: 'hm-birth.end', repeatCount: 'indefinite', calcMode: 'spline', keyTimes: '0;0.5;1', keySplines: SINE } as const;
const born = { dur: `${BIRTH.seconds}s`, begin: BORN_AT, fill: 'freeze' } as const;

/** A circle that rides on the bud through the birth and the breath (`scale`: its radius against the bud's). */
function Light({ scale, fill, children }: { scale: number; fill: string; children?: ReactNode }) {
  const at = scaled(SEED.bud, scale);
  return (
    <circle cx={at.cx} cy={at.cy} r={at.r} fill={fill}>
      {BUD_KEYS.map((key) => (
        <animate key={key} attributeName={key} values={track(key, BIRTH.bud.map((b) => scaled(b, scale)))} {...born} />
      ))}
      {BUD_KEYS.map((key) => (
        <animate key={`b${key}`} attributeName={key} values={track(key, BUD_BREATH.map((b) => scaled(b, scale)))} {...breath} />
      ))}
      {children}
    </circle>
  );
}

/**
 * The mark blown up behind the hero's phones, as glass: on load the rim light sweeps around
 * the cell (cyan to emerald), then the bud of light is born and glows once; then a calm idle,
 * the bud breathing and the rim light drifting. Reduced motion: drawn at rest, still.
 */
export function HeroMark() {
  return (
    <svg className="hero-mark" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <defs>
        {/* One animated outline, drawn four times (glass, inner light, then the rim glow and the rim on top). */}
        <path id="hm-shape" d={SEED.d} pathLength={1}>
          <animate id="hm-birth" attributeName="d" values={BIRTH.d.join(';')} {...born} />
          <animate attributeName="d" values={BREATH} {...breath} />
        </path>
        <linearGradient id="hm-glass-fill" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" className="hm-glass-0" />
          <stop offset="1" className="hm-glass-1" />
        </linearGradient>
        <radialGradient id="hm-inner" gradientUnits="userSpaceOnUse" cx="58" cy="44" r="38">
          <stop offset="0" className="hm-inner-0" />
          <stop offset="1" className="hm-inner-1" />
        </radialGradient>
        {/* The rim light, cyan in the cell to emerald at the bud, drifting slowly once born. */}
        <linearGradient id="hm-rim" gradientUnits="userSpaceOnUse" x1="24.86" y1="75.55" x2="74.91" y2="25.49">
          <stop offset="0" stopColor="#3CC8FF" />
          <stop offset="0.55" stopColor="#22D3B0" />
          <stop offset="1" stopColor="#2EE68A" />
          <animateTransform attributeName="gradientTransform" type="rotate" values="0 50 50;360 50 50" dur="36s" begin="hm-birth.end" repeatCount="indefinite" />
        </linearGradient>
        <radialGradient id="hm-bud" cx="0.38" cy="0.34" r="0.72">
          <stop offset="0" className="logo-b0" />
          <stop offset="0.55" className="logo-b1" />
          <stop offset="1" className="logo-b2" />
        </radialGradient>
        <radialGradient id="hm-halo" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" className="hm-halo-0" />
          <stop offset="1" className="hm-halo-1" />
        </radialGradient>
      </defs>

      <g className="hm-live">
        <use href="#hm-shape" className="hm-glass" fill="url(#hm-glass-fill)" />
        <use href="#hm-shape" className="hm-glass" fill="url(#hm-inner)" />
        <g className="hm-lights">
          <Light scale={HALO} fill="url(#hm-halo)">
            {/* One soft pulse as the bud settles, then a quiet glow (added on top of the breath). */}
            <animate attributeName="r" additive="sum" values="0;5;0" keyTimes="0;0.35;1" dur="1.1s" begin="hm-birth.end" calcMode="spline" keySplines="0.2 0 0 1;0.4 0 0.2 1" />
            <animate attributeName="opacity" values="1;0.35" dur="1.1s" begin="hm-birth.end" fill="freeze" />
          </Light>
          <Light scale={1} fill="url(#hm-bud)" />
        </g>
        {/* The rim light on top, around the cell and the bud alike. */}
        <use href="#hm-shape" className="hm-rim-glow" fill="none" stroke="url(#hm-rim)" />
        <use href="#hm-shape" className="hm-rim" fill="none" stroke="url(#hm-rim)" />
      </g>

      <g className="hm-still">
        <path d={REST} fill="url(#hm-glass-fill)" />
        <path d={REST} fill="url(#hm-inner)" />
        <circle cx={BUD_REST.cx} cy={BUD_REST.cy} r={BUD_REST.r} fill="url(#hm-bud)" />
        <path className="hm-rim-glow" d={REST} fill="none" stroke="url(#hm-rim)" />
        <path className="hm-rim" d={REST} fill="none" stroke="url(#hm-rim)" />
      </g>
    </svg>
  );
}
