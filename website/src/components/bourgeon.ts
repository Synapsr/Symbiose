// « Bourgeon »: the mark's geometry and motion, shared by the Logo and the hero's glass mark.
// The same construction as the app (apps/mobile/src/components/ui/bourgeon-path.ts).

export const C1X = 41.5;
export const C1Y = 59.5;
export const R1 = 25;
export const C2X = 69.5;
export const C2Y = 31.5;
export const R2 = 15.5;
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

/** The bud's light sits exactly on the bud of the path, with the same numbers. */
export type Bud = { cx: number; cy: number; r: number };
export function budAt(bud: number, breath: number): Bud {
  return {
    cx: C1X + (C2X - C1X) * bud + U * 0.9 * breath,
    cy: C1Y + (C2Y - C1Y) * bud - U * 0.9 * breath,
    r: R2 * (0.45 + 0.55 * Math.min(bud, 1.08)) + 1.5 * breath,
  };
}

/** The outline for a mount progress (`grow`: the cell, `bud`: the bud) and a breath (0 → 1). */
export function shape(grow: number, bud: number, breath: number): string {
  const b = budAt(bud, breath);
  return bourgeonPath(C1X, C1Y, R1 * (0.62 + 0.38 * grow) - 0.6 * breath, b.cx, b.cy, b.r, RF + 2.8 * breath);
}

/** A damped spring from 0 to 1 (mass 1, natural frequency ω, damping ratio ζ < 1), t in seconds. */
function spring(t: number, omega: number, zeta: number): number {
  if (t <= 0) return 0;
  const wd = omega * Math.sqrt(1 - zeta * zeta);
  return 1 - Math.exp(-zeta * omega * t) * (Math.cos(wd * t) + ((zeta * omega) / wd) * Math.sin(wd * t));
}

export const REST = shape(1, 1, 0);
export const BUD_REST = budAt(1, 0);

/**
 * A birth, sampled for SMIL so it plays before (and without) JavaScript. `swell`: the cell
 * swells in too (the Logo); otherwise it is already there and only the bud is born (the hero).
 */
export function birth({ frames = 30, seconds = 1, swell = true, from = 0 }: { frames?: number; seconds?: number; swell?: boolean; from?: number } = {}) {
  const d: string[] = [];
  const bud: Bud[] = [];
  for (let i = 0; i <= frames; i++) {
    const t = (i / frames) * seconds;
    if (i === frames) {
      d.push(REST);
      bud.push(BUD_REST);
      continue;
    }
    // The cell: no bounce. The bud: barely any overshoot when it is the hero's slower, larger birth.
    const g = swell ? spring(t, 14, 0.7) : 1;
    const b = from + (1 - from) * (swell ? spring(t - 0.16, 10, 0.6) : spring(t - 0.1, 7.5, 0.8));
    d.push(shape(g, b, 0));
    bud.push(budAt(b, 0));
  }
  return { d, bud, seconds };
}

/** Breathe: the bud inhales, the neck thickens, the cell gives a little. */
export const BREATH = [REST, shape(1, 1, 1), REST].join(';');
export const BUD_BREATH = [BUD_REST, budAt(1, 1), BUD_REST];
/** Sine in-out, for both halves of a breath. */
export const SINE = '0.37 0 0.63 1;0.37 0 0.63 1';

export const BUD_KEYS = ['cx', 'cy', 'r'] as const;
export const track = (key: keyof Bud, frames: Bud[]) => frames.map((frame) => frame[key].toFixed(2)).join(';');
