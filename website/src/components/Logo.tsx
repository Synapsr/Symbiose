import { useId } from 'react';

import './Logo.css';

// « Bourgeon »: the same geometry and motion as the app's Logo (apps/mobile/src/components/ui/logo.tsx).
const C1X = 41.5;
const C1Y = 59.5;
const R1 = 25;
const C2X = 69.5;
const C2Y = 31.5;
const R2 = 15.5;
const RF = 5;
const U = Math.SQRT1_2; // cell → bud, on the 45° diagonal

/** A cell and a bud joined by two concave fillet arcs (radius rf) tangent to both: one path of arcs only. */
function bourgeonPath(c1x: number, c1y: number, r1: number, c2x: number, c2y: number, r2: number, rf: number): string {
  const n = (v: number) => Math.round(v * 100) / 100;
  const circle = (x: number, y: number, r: number) => `M${n(x - r)} ${n(y)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0Z`;
  const dx = c2x - c1x;
  const dy = c2y - c1y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d <= Math.abs(r1 - r2)) return circle(c1x, c1y, Math.max(r1, r2)); // the bud is still inside the cell
  if (d >= r1 + r2 + 2 * rf) return circle(c1x, c1y, r1) + circle(c2x, c2y, r2);
  const ux = dx / d;
  const uy = dy / d;
  const q1 = r1 + rf;
  const q2 = r2 + rf;
  const a = (q1 * q1 - q2 * q2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, q1 * q1 - a * a));
  const fpx = c1x + a * ux - h * uy;
  const fpy = c1y + a * uy + h * ux;
  const fmx = c1x + a * ux + h * uy;
  const fmy = c1y + a * uy - h * ux;
  const apx = c1x + ((fpx - c1x) * r1) / q1;
  const apy = c1y + ((fpy - c1y) * r1) / q1;
  const amx = c1x + ((fmx - c1x) * r1) / q1;
  const amy = c1y + ((fmy - c1y) * r1) / q1;
  const bpx = c2x + ((fpx - c2x) * r2) / q2;
  const bpy = c2y + ((fpy - c2y) * r2) / q2;
  const bmx = c2x + ((fmx - c2x) * r2) / q2;
  const bmy = c2y + ((fmy - c2y) * r2) / q2;
  const mod = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const bigBud = mod(Math.atan2(bpy - c2y, bpx - c2x) - Math.atan2(bmy - c2y, bmx - c2x)) > Math.PI ? 1 : 0;
  const bigCell = mod(Math.atan2(amy - c1y, amx - c1x) - Math.atan2(apy - c1y, apx - c1x)) > Math.PI ? 1 : 0;
  return (
    `M${n(apx)} ${n(apy)}` +
    `A${n(rf)} ${n(rf)} 0 0 1 ${n(bpx)} ${n(bpy)}` +
    `A${n(r2)} ${n(r2)} 0 ${bigBud} 0 ${n(bmx)} ${n(bmy)}` +
    `A${n(rf)} ${n(rf)} 0 0 1 ${n(amx)} ${n(amy)}` +
    `A${n(r1)} ${n(r1)} 0 ${bigCell} 0 ${n(apx)} ${n(apy)}Z`
  );
}

/** The mark for a mount progress (`grow`: the cell, `bud`: the bud) and a breath (0 → 1). */
function shape(grow: number, bud: number, breath: number): string {
  return bourgeonPath(
    C1X,
    C1Y,
    R1 * (0.62 + 0.38 * grow) - 0.6 * breath,
    C1X + (C2X - C1X) * bud + U * 0.9 * breath,
    C1Y + (C2Y - C1Y) * bud - U * 0.9 * breath,
    R2 * (0.45 + 0.55 * Math.min(bud, 1.08)) + 1.5 * breath,
    RF + 2.8 * breath,
  );
}

/** A damped spring from 0 to 1 (mass 1, natural frequency ω, damping ratio ζ < 1), t in seconds. */
function spring(t: number, omega: number, zeta: number): number {
  if (t <= 0) return 0;
  const wd = omega * Math.sqrt(1 - zeta * zeta);
  return 1 - Math.exp(-zeta * omega * t) * (Math.cos(wd * t) + ((zeta * omega) / wd) * Math.sin(wd * t));
}

const REST = shape(1, 1, 0);
/** Mount, sampled for SMIL so it plays before (and without) JavaScript: the cell swells in, the bud pushes out and settles. */
const MOUNT_FRAMES = 30;
const MOUNT_SECONDS = 1;
const MOUNT = Array.from({ length: MOUNT_FRAMES + 1 }, (_, i) => {
  const t = (i / MOUNT_FRAMES) * MOUNT_SECONDS;
  return i === MOUNT_FRAMES ? REST : shape(spring(t, 14, 0.7), spring(t - 0.16, 10, 0.6), 0);
});
/** Breathe (3.2 s): the bud inhales, the neck thickens, the cell gives a little. */
const BREATH = [REST, shape(1, 1, 1), REST].join(';');
const SINE = '0.37 0 0.63 1;0.37 0 0.63 1';

/**
 * The Symbiose mark, « Bourgeon »: a cell and the bud that grows out of it.
 * `animate`: the bud pushes out on load, like the app's welcome. `breathe`: it
 * breathes, as in the app while a meal is analysed. Reduced motion: drawn at
 * rest, and a breathing mark only pulses its opacity.
 */
export function Logo({ size = 28, animate = false, breathe = false, className = '' }: { size?: number; animate?: boolean; breathe?: boolean; className?: string }) {
  const id = `bourgeon${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const fill = `url(#${id})`;
  const moving = animate || breathe;
  return (
    <svg
      className={['logo', breathe && 'logo--breathe', className].filter(Boolean).join(' ')}
      viewBox="12.5 12 76.5 76.5"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false">
      <defs>
        <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="27" y1="80" x2="78" y2="21">
          <stop offset="0" className="logo-s0" />
          <stop offset="0.48" className="logo-s1" />
          <stop offset="0.76" className="logo-s2" />
          <stop offset="1" className="logo-s3" />
        </linearGradient>
      </defs>
      {moving ? (
        <path className="logo-live" d={animate ? MOUNT[0] : REST} fill={fill}>
          {animate ? <animate attributeName="d" values={MOUNT.join(';')} dur={`${MOUNT_SECONDS}s`} begin="0.15s" fill="freeze" /> : null}
          {breathe ? <animate attributeName="d" values={BREATH} dur="3.2s" repeatCount="indefinite" calcMode="spline" keyTimes="0;0.5;1" keySplines={SINE} /> : null}
        </path>
      ) : null}
      <path className={moving ? 'logo-still' : undefined} d={REST} fill={fill} />
    </svg>
  );
}
