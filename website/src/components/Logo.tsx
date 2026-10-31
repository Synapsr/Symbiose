import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';

import { prefersReducedMotion } from '../hooks';
import { birth, BREATH, BUD_BREATH, BUD_KEYS, BUD_REST, REST, SINE, track } from './bourgeon';
import './Logo.css';

// « Bourgeon » Graphite: the same geometry, rendering and motion as the app's Logo (apps/mobile/src/components/ui/logo.tsx).
const MOUNT = birth();
const MOUNT_D = MOUNT.d.join(';');
const MOUNT_BUD = Object.fromEntries(BUD_KEYS.map((key) => [key, track(key, MOUNT.bud)])) as Record<(typeof BUD_KEYS)[number], string>;
const BREATH_BUD = Object.fromEntries(BUD_KEYS.map((key) => [key, track(key, BUD_BREATH)])) as Record<(typeof BUD_KEYS)[number], string>;
const SEED = { d: MOUNT.d[0]!, bud: MOUNT.bud[0]! };

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * For a mark born when it scrolls in: `rest` on the server and when already on screen at
 * load, `waiting` (drawn as a seed) below the fold, `born` once it enters the viewport.
 */
function useBirth(ref: RefObject<SVGSVGElement | null>, enabled: boolean): 'rest' | 'waiting' | 'born' {
  const [state, setState] = useState<'rest' | 'waiting' | 'born'>('rest');
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el || prefersReducedMotion()) return;
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) return;
    setState('waiting');
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setState('born');
          observer.disconnect();
        }
      },
      { rootMargin: '0px 0px -18% 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, enabled]);
  return state;
}

/**
 * The Symbiose mark, « Bourgeon » Graphite: a cell in ink and the bud of light that grows
 * out of it. `animate`: the light pushes out on load, like the app's welcome; `'inview'`:
 * when it scrolls into view. `breathe`: it breathes, as in the app while a meal is analysed
 * (after its birth). Reduced motion: drawn at rest, a breathing mark only pulses its opacity.
 */
export function Logo({ size = 28, animate = false, breathe = false, className = '' }: { size?: number; animate?: boolean | 'inview'; breathe?: boolean; className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const ink = `logo-ink${id}`;
  const light = `logo-bud${id}`;
  const born = `logo-born${id}`;
  const ref = useRef<SVGSVGElement>(null);
  const state = useBirth(ref, animate === 'inview');
  const animations = useRef<SVGAnimationElement[]>([]);

  // Started before paint, so the full mark never flashes between the seed and the birth.
  useIsoLayoutEffect(() => {
    if (state === 'born') animations.current.filter((el) => el.isConnected).forEach((el) => el.beginElement());
  }, [state]);

  const onLoad = animate === true;
  const moving = onLoad || breathe || state !== 'rest';
  const seed = onLoad || state === 'waiting';
  const breathing = breathe && state !== 'waiting';
  // In view, the breath waits for the birth to end (SMIL syncbase).
  const breathBegin = state === 'born' ? `${born}.end` : '0s';
  const keep = (el: SVGAnimationElement | null) => {
    if (el && !animations.current.includes(el)) animations.current.push(el);
  };
  const birthProps = (begin: string) => ({ dur: `${MOUNT.seconds}s`, begin, fill: 'freeze' as const });
  const breathProps = { dur: '3.2s', begin: breathBegin, repeatCount: 'indefinite', calcMode: 'spline', keyTimes: '0;0.5;1', keySplines: SINE };

  return (
    <svg
      ref={ref}
      className={['logo', breathe && 'logo--breathe', className].filter(Boolean).join(' ')}
      viewBox="12.5 12 76.5 76.5"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false">
      <defs>
        <linearGradient id={ink} gradientUnits="userSpaceOnUse" x1="27" y1="80" x2="78" y2="21">
          <stop offset="0" className="logo-k0" />
          <stop offset="1" className="logo-k1" />
        </linearGradient>
        <radialGradient id={light} cx="0.38" cy="0.34" r="0.72">
          <stop offset="0" className="logo-b0" />
          <stop offset="0.55" className="logo-b1" />
          <stop offset="1" className="logo-b2" />
        </radialGradient>
      </defs>
      {moving ? (
        <g key={state}>
          <path className="logo-live" d={seed ? SEED.d : REST} fill={`url(#${ink})`}>
            {onLoad ? <animate attributeName="d" values={MOUNT_D} {...birthProps('0.15s')} /> : null}
            {state === 'born' ? <animate ref={keep} id={born} attributeName="d" values={MOUNT_D} {...birthProps('indefinite')} /> : null}
            {breathing ? <animate attributeName="d" values={BREATH} {...breathProps} /> : null}
          </path>
          <circle className="logo-live" cx={seed ? SEED.bud.cx : BUD_REST.cx} cy={seed ? SEED.bud.cy : BUD_REST.cy} r={seed ? SEED.bud.r : BUD_REST.r} fill={`url(#${light})`}>
            {onLoad ? BUD_KEYS.map((key) => <animate key={key} attributeName={key} values={MOUNT_BUD[key]} {...birthProps('0.15s')} />) : null}
            {state === 'born' ? BUD_KEYS.map((key) => <animate key={key} ref={keep} attributeName={key} values={MOUNT_BUD[key]} {...birthProps('indefinite')} />) : null}
            {breathing ? BUD_KEYS.map((key) => <animate key={`b${key}`} attributeName={key} values={BREATH_BUD[key]} {...breathProps} />) : null}
          </circle>
        </g>
      ) : null}
      <path className={moving ? 'logo-still' : undefined} d={REST} fill={`url(#${ink})`} />
      <circle className={moving ? 'logo-still' : undefined} cx={BUD_REST.cx} cy={BUD_REST.cy} r={BUD_REST.r} fill={`url(#${light})`} />
    </svg>
  );
}
