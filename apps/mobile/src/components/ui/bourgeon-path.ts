/** The mark at rest, in its 100-unit box: the cell, the bud on the 45° diagonal, the neck between them. */
export const BOURGEON = { c1x: 41.5, c1y: 59.5, r1: 25, c2x: 69.5, c2y: 31.5, r2: 15.5, rf: 5 } as const;

/**
 * The Bourgeon outline: a cell and a bud joined by two concave fillet arcs
 * (radius `rf`) tangent to both, as one closed path made only of arcs. A
 * worklet, so the logo can rebuild it every frame while the bud grows or breathes.
 */
export function bourgeonPath(c1x: number, c1y: number, r1: number, c2x: number, c2y: number, r2: number, rf: number): string {
  'worklet';
  const n = (v: number) => Math.round(v * 100) / 100;
  const circle = (x: number, y: number, r: number) => `M${n(x - r)} ${n(y)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0Z`;
  const dx = c2x - c1x;
  const dy = c2y - c1y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d <= Math.abs(r1 - r2)) return circle(c1x, c1y, Math.max(r1, r2)); // the bud is still inside the cell
  if (d >= r1 + r2 + 2 * rf) return circle(c1x, c1y, r1) + circle(c2x, c2y, r2); // too far apart to touch
  const ux = dx / d;
  const uy = dy / d;
  const R1 = r1 + rf;
  const R2 = r2 + rf;
  const a = (R1 * R1 - R2 * R2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, R1 * R1 - a * a));
  // Fillet centres, one on each side of the cell → bud axis.
  const fpx = c1x + a * ux - h * uy;
  const fpy = c1y + a * uy + h * ux;
  const fmx = c1x + a * ux + h * uy;
  const fmy = c1y + a * uy - h * ux;
  // Tangent points on the cell (a*) and on the bud (b*).
  const apx = c1x + ((fpx - c1x) * r1) / R1;
  const apy = c1y + ((fpy - c1y) * r1) / R1;
  const amx = c1x + ((fmx - c1x) * r1) / R1;
  const amy = c1y + ((fmy - c1y) * r1) / R1;
  const bpx = c2x + ((fpx - c2x) * r2) / R2;
  const bpy = c2y + ((fpy - c2y) * r2) / R2;
  const bmx = c2x + ((fmx - c2x) * r2) / R2;
  const bmy = c2y + ((fmy - c2y) * r2) / R2;
  const TAU = Math.PI * 2;
  const mod = (x: number) => ((x % TAU) + TAU) % TAU;
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
