#!/usr/bin/env node
/**
 * Symbiose's feedback sounds, « Verre », rendered from nothing but maths: no
 * samples, no downloads, no dependencies. They stay ours and can be
 * regenerated or changed at will.
 *
 *   node apps/mobile/scripts/sounds/synth.mjs [--preview <dir>]
 *
 * Writes `apps/mobile/assets/sounds/*.m4a` (AAC, through macOS `afconvert`).
 * With `--preview`, also keeps the 24-bit WAV masters, a showreel of the five
 * sounds and notes.md in `<dir>`.
 *
 * The pipeline, in the order of this file:
 *   1. Excitation: a mallet. Its force is a smooth pulse whose width is its
 *      hardness (and so the brightness), plus a breath of contact noise.
 *   2. Modal body: decaying resonators tuned to a crystal bowl's modes. Strike
 *      position sets the level of each mode, higher modes die faster, and
 *      doublets, detune and a pitch that settles after the blow keep it from
 *      sounding sterile.
 *   3. Room: a 16-line feedback delay network. Short, dense and damped, it
 *      sits well under the dry sound and is only slightly decorrelated.
 *   4. Mastering: 3-6 kHz taming, gentle saturation, a 4th-order high-pass,
 *      loudness set to a target (BS.1770), a true-peak ceiling and a natural tail.
 *   5. Recipes: five roles in one key (D major), with onsets that land on the
 *      app's haptic beats (`src/lib/feedback.ts`).
 *
 * The material table still holds the rosewood bar and tuning fork tried
 * alongside it; only the crystal is rendered.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 48000;
const TAU = 2 * Math.PI;
const dB = (x) => 20 * Math.log10(Math.max(x, 1e-12));
const fromDb = (d) => 10 ** (d / 20);
const cents = (c) => 2 ** (c / 1200);

// =============================================================== 0. Basics

/** A seeded random (mulberry32): every render is identical. */
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STEPS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** 'F#6' → Hz, equal temperament, A4 = 440. */
function hz(name) {
  const [, letter, accidental = '', octave] = /^([A-G])(#|b)?(\d)$/.exec(name);
  const midi = 12 * (Number(octave) + 1) + STEPS[letter] + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0);
  return 440 * 2 ** ((midi - 69) / 12);
}

function stereo(seconds) {
  const length = Math.round(seconds * SR);
  return { length, L: new Float64Array(length), R: new Float64Array(length) };
}

function mixInto(dst, src, at = 0, gain = 1) {
  const from = Math.round(at * SR);
  const n = Math.min(src.length, dst.length - from);
  for (let i = 0; i < n; i++) {
    dst.L[from + i] += src.L[i] * gain;
    dst.R[from + i] += src.R[i] * gain;
  }
}

function scale(buf, g) {
  for (let i = 0; i < buf.length; i++) {
    buf.L[i] *= g;
    buf.R[i] *= g;
  }
}

function samplePeak(buf) {
  let p = 0;
  for (let i = 0; i < buf.length; i++) p = Math.max(p, Math.abs(buf.L[i]), Math.abs(buf.R[i]));
  return p;
}

/** Equal-power pan, unity in the centre. */
function panGains(pan) {
  const a = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4;
  return [Math.cos(a) * Math.SQRT2, Math.sin(a) * Math.SQRT2];
}

// Biquads (RBJ cookbook), direct form I, in place.
function design(type, f, { q = Math.SQRT1_2, gain = 0 } = {}) {
  const w = (TAU * f) / SR;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const A = 10 ** (gain / 40);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lowpass') [b0, b1, b2, a0, a1, a2] = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2, 1 + alpha, -2 * cos, 1 - alpha];
  else if (type === 'highpass') [b0, b1, b2, a0, a1, a2] = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alpha, -2 * cos, 1 - alpha];
  else if (type === 'bandpass') [b0, b1, b2, a0, a1, a2] = [alpha, 0, -alpha, 1 + alpha, -2 * cos, 1 - alpha];
  else if (type === 'peak') [b0, b1, b2, a0, a1, a2] = [1 + alpha * A, -2 * cos, 1 - alpha * A, 1 + alpha / A, -2 * cos, 1 - alpha / A];
  else if (type === 'highshelf' || type === 'lowshelf') {
    const s = 2 * Math.sqrt(A) * alpha;
    const k = type === 'highshelf' ? 1 : -1;
    b0 = A * (A + 1 + k * (A - 1) * cos + s);
    b1 = -2 * k * A * (A - 1 + k * (A + 1) * cos);
    b2 = A * (A + 1 + k * (A - 1) * cos - s);
    a0 = A + 1 - k * (A - 1) * cos + s;
    a1 = 2 * k * (A - 1 - k * (A + 1) * cos);
    a2 = A + 1 - k * (A - 1) * cos - s;
  } else throw new Error(type);
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

function run(ch, [b0, b1, b2, a1, a2]) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < ch.length; i++) {
    const x = ch[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    ch[i] = y;
  }
}

function filt(buf, type, f, opts) {
  const c = design(type, f, opts);
  run(buf.L, c);
  run(buf.R, c);
}

/** 4th-order Butterworth high-pass: two biquads. */
function highpass4(buf, f) {
  filt(buf, 'highpass', f, { q: 0.5411961 });
  filt(buf, 'highpass', f, { q: 1.3065630 });
}

// =============================================================== 1. Excitation

/**
 * The mallet's force, t^2 * e^(-t/b). It rises smoothly from zero (no corner,
 * so no click), has one hump and no spectral nulls, and above 1/(2*pi*b) it
 * falls at 18 dB/octave: b is the hardness. About 35 µs is a hard rod on
 * glass, 70-100 µs is felt on wood. Its area is 1, so a mode it strikes rings
 * at the pulse's spectrum at that frequency.
 */
function forcePulse(b) {
  const n = Math.max(6, Math.ceil(16 * b * SR));
  const x = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / SR;
    x[i] = t * t * Math.exp(-t / b);
    sum += x[i];
  }
  for (let i = 0; i < n; i++) x[i] /= sum;
  return x;
}

/** |X(f)|: how strongly the pulse drives a mode at f (1 at DC). */
function pulseGain(x, f) {
  const w = (TAU * f) / SR;
  let re = 0, im = 0;
  for (let i = 0; i < x.length; i++) {
    re += x[i] * Math.cos(w * i);
    im -= x[i] * Math.sin(w * i);
  }
  return Math.hypot(re, im);
}

/**
 * The contact itself: a millisecond or two of noise, Hann-shaped and band-passed
 * where the material speaks (a glassy tick, a felt thock). Peak 1.
 */
function contactNoise({ length, freq, q }, rand) {
  const n = Math.max(8, Math.round(length * SR));
  const out = new Float64Array(n + Math.round(0.006 * SR));
  for (let i = 0; i < n; i++) out[i] = (rand() * 2 - 1) * Math.sin((Math.PI * i) / n) ** 2;
  const c = design('bandpass', freq, { q });
  run(out, c);
  run(out, c);
  let p = 0;
  for (const v of out) p = Math.max(p, Math.abs(v));
  for (let i = 0; i < out.length; i++) out[i] /= p || 1;
  // The filters ring past the burst: ease them out so nothing is cut.
  const tail = Math.round(0.004 * SR);
  for (let i = 0; i < tail; i++) out[out.length - tail + i] *= 0.5 + 0.5 * Math.cos((Math.PI * i) / tail);
  return out;
}

// =============================================================== 2. Modal bodies

/**
 * Euler-Bernoulli beam modes, with x running from 0 to 1 along the bar. They give each mode's level from
 * where it is struck. The rosewood bar's undercut retunes its ratios, but its mode shapes stay close
 * to a plain bar's.
 */
const BEAMS = {
  // Free at both ends (a marimba bar): 1 : 2.756 : 5.404 : 8.933 when uniform.
  free: {
    beta: [4.73004074, 7.85320462, 10.9956078, 14.1371655, 17.2787597],
    sigma: (B) => (Math.cosh(B) - Math.cos(B)) / (Math.sinh(B) - Math.sin(B)),
    phi: (B, s, x) => Math.cosh(B * x) + Math.cos(B * x) - s * (Math.sinh(B * x) + Math.sin(B * x)),
  },
  // Clamped at 0, free at 1 (a tine, a fork's prong): 1 : 6.267 : 17.55.
  clamped: {
    beta: [1.87510407, 4.69409113, 7.85475744, 10.9955407, 14.1371684],
    sigma: (B) => (Math.cosh(B) + Math.cos(B)) / (Math.sinh(B) + Math.sin(B)),
    phi: (B, s, x) => Math.cosh(B * x) - Math.cos(B * x) - s * (Math.sinh(B * x) - Math.sin(B * x)),
  },
};

function beamShape(kind, n, x) {
  const beam = BEAMS[kind];
  const B = beam.beta[Math.min(n, beam.beta.length - 1)];
  return beam.phi(B, beam.sigma(B), x) / 2;
}

/**
 * The materials. Each mode has a `ratio` to the fundamental and a `level`: its onset level next to the
 * fundamental, as heard with the material's own mallet, before the strike position (`beam`, `pos`)
 * weighs it. A mode can also have a `split` (a doublet), its own `tau` (a multiple of the fundamental's
 * decay; otherwise τk = τ1 · (f1/fk)^loss, so higher modes die faster), an `attack` (a swell instead of
 * an instant start) and `lock` (it follows the fundamental exactly, as a coupled resonator does).
 * `beam: false` modes ignore the strike position. `mallet.b` is the hardness and `noise` the contact.
 * `detune` (cents, random per mode) and `settle` (a pitch easing down after the blow) are the small
 * imperfections that make it real.
 */
const MATERIALS = {
  // A small crystal bowl, struck on the rim with a hard rod. Its thin-shell (n,0) modes run
  // n(n²-1)/√(n²+1), so 1 : 2.83 : 5.42 : 8.77 : 12.9. Each mode is a doublet, split by the glass's
  // imperfections. A bright, inharmonic « tink » resolves into a pure ring that shimmers a little,
  // one partner leaning left and the other right.
  crystal: {
    modes: [
      { ratio: 1, level: 1, split: 0.0012 },
      { ratio: 2.828, level: 0.42, split: 0.0016 },
      { ratio: 5.423, level: 0.2, split: 0.0022 },
      { ratio: 8.77, level: 0.085, split: 0.003 },
      { ratio: 12.87, level: 0.035, split: 0.0036 },
    ],
    loss: 0.7,
    detune: 3,
    spread: 0.14,
    settle: { cents: 5, time: 0.008 },
    mallet: { b: 0.000045 },
    noise: { level: 0.12, freq: 7800, q: 1.2, length: 0.001 },
  },
  // A rosewood marimba bar, undercut so its modes run 1 : 4 : 9.2, struck a little off centre
  // (x = 0.42) with a felt mallet. Two torsional modes give the short woody knock. The resonator tube
  // under the bar sings the fundamental with it, swelling in over a few ms and ringing a touch longer:
  // the « bloom ».
  rosewood: {
    modes: [
      { ratio: 1, level: 1 },
      { ratio: 3.98, level: 0.34 },
      { ratio: 9.15, level: 0.076 },
      { ratio: 2.61, level: 0.1, tau: 0.1, beam: false },
      { ratio: 6.07, level: 0.05, tau: 0.05, beam: false },
      { ratio: 1, level: 0.45, tau: 1.2, attack: 0.006, lock: true, beam: false },
    ],
    beam: 'free',
    pos: 0.42,
    loss: 0.85,
    detune: 4,
    spread: 0.08,
    settle: { cents: 4, time: 0.01 },
    mallet: { b: 0.00011 },
    noise: { level: 0.16, freq: 1300, q: 0.7, length: 0.004 },
  },
  // A small tuning fork, tapped near the tip of a prong. Its fundamental is almost a pure sine. The
  // clang mode at 6.27x is a bright, tonal tick, gone within a few ms, and the fork's own
  // nonlinearity adds a faint octave. It is clean, but it is an object.
  fork: {
    modes: [
      { ratio: 1, level: 1 },
      { ratio: 6.267, level: 0.54, tau: 0.12 },
      { ratio: 2, level: 0.05, tau: 0.45, attack: 0.0015, lock: true, beam: false },
    ],
    beam: 'clamped',
    pos: 0.93,
    loss: 1,
    detune: 1.5,
    spread: 0.05,
    settle: { cents: 10, time: 0.005 },
    mallet: { b: 0.00006 },
    noise: { level: 0.1, freq: 3400, q: 1.5, length: 0.0008 },
  },
};

/**
 * One mode: a complex one-pole resonator, z <- r * e^(iω) * z + force, heard as Im z. Struck by the
 * pulse, it starts from zero and rings as a decaying sine. ω eases from slightly sharp to true (the
 * blow's pitch settle), and the phase stays continuous. When `attack` > 0, the instant start becomes
 * a soft swell, e^(-t/τ) - e^(-t/τ'), like a resonator tube filling up.
 */
function resonate(out, pulse, { f, amp, tau, pan = 0, settle = null, attack = 0 }) {
  const [gl, gr] = panGains(pan);
  const r = Math.exp(-1 / (tau * SR));
  let r2 = 0;
  let swell = 1;
  if (attack) {
    const t2 = 1 / (1 / tau + 1 / attack);
    r2 = Math.exp(-1 / (t2 * SR));
    const tp = (Math.log(tau / t2) * tau * t2) / (tau - t2);
    swell = 1 / (Math.exp(-tp / tau) - Math.exp(-tp / t2));
  }
  const w0 = (TAU * f) / SR;
  const s0 = settle ? cents(settle.cents) - 1 : 0;
  const settleEnd = settle ? Math.round(settle.time * SR * 10) : 0;
  const settleStep = settle ? Math.exp(-1 / (settle.time * SR)) : 0;
  let offset = s0;
  let cr = r * Math.cos(w0), ci = r * Math.sin(w0);
  let dr = r2 * Math.cos(w0), di = r2 * Math.sin(w0);
  let zr = 0, zi = 0, yr = 0, yi = 0;
  const floor = (1e-6 / amp) ** 2;
  for (let n = 0; n < out.length; n++) {
    if (n <= settleEnd && settle) {
      const w = n === settleEnd ? w0 : w0 * (1 + offset);
      offset *= settleStep;
      const c = Math.cos(w), s = Math.sin(w);
      cr = r * c;
      ci = r * s;
      dr = r2 * c;
      di = r2 * s;
    }
    const x = n < pulse.length ? pulse[n] : 0;
    const nr = cr * zr - ci * zi + x;
    zi = ci * zr + cr * zi;
    zr = nr;
    let y = zi;
    if (attack) {
      const mr = dr * yr - di * yi + x;
      yi = di * yr + dr * yi;
      yr = mr;
      y = (zi - yi) * swell;
    }
    y *= amp;
    out.L[n] += y * gl;
    out.R[n] += y * gr;
    if ((n & 255) === 0 && n > pulse.length + settleEnd && zr * zr + zi * zi < floor) break;
  }
}

/**
 * One blow on one object. Mode levels are as heard with the material's own mallet. A louder blow is a
 * touch harder (as with a real mallet), and `hard` > 1 softens it: both tilt the spectrum around that
 * reference. The pulse's length also sets how softly each mode starts.
 */
function strike(material, freq, { tau, vel = 1, hard = 1, pan = 0, seconds = 1.6, seed = 1, pos } = {}) {
  const m = MATERIALS[material];
  const rand = random(seed);
  const out = stereo(seconds);
  const nominal = forcePulse(m.mallet.b);
  const pulse = forcePulse(m.mallet.b * hard * (1.12 - 0.24 * vel));
  const x = pos ?? m.pos;
  const shape0 = m.beam ? Math.abs(beamShape(m.beam, 0, x)) : 1;
  let f1 = freq;
  m.modes.forEach((mode, k) => {
    const f = mode.lock ? f1 * mode.ratio : freq * mode.ratio * cents(m.detune * (rand() * 2 - 1) * (k ? 1 : 0.25));
    if (k === 0) f1 = f;
    if (f > 15500) return;
    const shape = m.beam && mode.beam !== false ? Math.abs(beamShape(m.beam, k, x)) / shape0 : 1;
    const amp = (vel * mode.level * shape) / pulseGain(nominal, f);
    if (amp * pulseGain(pulse, f) < 1e-5) return;
    const t = mode.tau ? tau * mode.tau : Math.max(0.0015, tau * (freq / f) ** m.loss);
    const p = pan + (rand() * 2 - 1) * m.spread;
    const common = { tau: t, settle: m.settle, attack: mode.attack ?? 0 };
    if (mode.split) {
      // A doublet: two near-twins beating slowly, one leaning left and the other right.
      resonate(out, pulse, { ...common, f: f * (1 - mode.split / 2), amp: amp * 0.7, pan: p - m.spread });
      resonate(out, pulse, { ...common, f: f * (1 + mode.split / 2), amp: amp * 0.3, tau: t * 0.9, pan: p + m.spread });
    } else resonate(out, pulse, { ...common, f, amp, pan: p });
  });
  if (m.noise) {
    const n = contactNoise({ ...m.noise, freq: m.noise.freq / Math.sqrt(hard) }, rand);
    const [gl, gr] = panGains(pan);
    const level = (m.noise.level * vel) / hard;
    for (let i = 0; i < Math.min(n.length, out.length); i++) {
      out.L[i] += n[i] * level * gl;
      out.R[i] += n[i] * level * gr;
    }
  }
  return out;
}

// =============================================================== 3. Room

/**
 * A small, dense, damped room. It hears a band-limited copy of the dry sound. A few early reflections
 * come first, then four Schroeder diffusers and a 16-line feedback delay network of 4-13 ms lines.
 * Hadamard mixing keeps the network lossless, per-line gains set the `rt60`, and a one-pole low-pass in
 * each loop lets the highs die first. Each line's length drifts by a sample or two: a tonal source would
 * otherwise beat against the network's own resonances (a metallic flutter), and the drift smears them.
 * The output sits `drr` dB under the dry sound (the direct-to-reverberant energy ratio), only a little
 * wider than mono.
 */
function room(buf, { rt60 = 0.25, size = 1, predelay = 0.006, drr = 18, damp = 0.35, low = 300, high = 8000, width = 0.6 } = {}) {
  const n = buf.length;
  const N = 16;
  const input = new Float64Array(n);
  for (let i = 0; i < n; i++) input[i] = 0.5 * (buf.L[i] + buf.R[i]);
  run(input, design('highpass', low));
  run(input, design('lowpass', high));
  const pd = Math.round(predelay * SR);
  // Early reflections: [ms after the pre-delay, gain, side].
  const early = [
    [0, 0.5, -1],
    [1.9, 0.42, 1],
    [3.7, 0.36, -1],
    [5.3, 0.3, 1],
    [7.9, 0.24, -1],
    [10.6, 0.18, 1],
  ].map(([ms, g, side]) => [Math.round((ms / 1000) * SR * size), g, side]);
  const diffusers = [131, 97, 311, 233].map((len) => ({ data: new Float64Array(Math.round(len * size)), i: 0, g: 0.6 }));
  const lens = [211, 241, 269, 293, 317, 347, 373, 401, 431, 457, 487, 509, 541, 571, 599, 631].map((len) => Math.round(len * size));
  const depth = 1.6;
  const lines = lens.map((len) => new Float64Array(len + 8));
  const write = new Int32Array(N);
  const lp = new Float64Array(N);
  const gains = lens.map((len) => 10 ** ((-3 * len) / (SR * rt60)));
  const rates = lens.map((_, k) => (TAU * (0.31 + 0.137 * k)) / SR);
  const phases = lens.map((_, k) => k * 2.399);
  const o = new Float64Array(N);
  const wetL = new Float64Array(n);
  const wetR = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const j = i - pd;
    let x = j >= 0 ? input[j] : 0;
    let eL = 0, eR = 0;
    for (const [d, g, side] of early) {
      const v = j - d >= 0 ? input[j - d] * g : 0;
      if (side < 0) eL += v;
      else eR += v;
    }
    for (const ap of diffusers) {
      const y = ap.data[ap.i];
      const v = x + ap.g * y;
      ap.data[ap.i] = v;
      ap.i = (ap.i + 1) % ap.data.length;
      x = y - ap.g * v;
    }
    let yl = 0, yr = 0;
    for (let k = 0; k < N; k++) {
      // A drifting read point, with linear interpolation.
      const line = lines[k];
      const size_ = line.length;
      const d = lens[k] + depth * Math.sin(rates[k] * i + phases[k]);
      let pos = write[k] - d;
      while (pos < 0) pos += size_;
      const i0 = Math.floor(pos);
      const frac = pos - i0;
      const raw = line[i0 % size_] * (1 - frac) + line[(i0 + 1) % size_] * frac;
      lp[k] = raw * (1 - damp) + lp[k] * damp;
      o[k] = lp[k] * gains[k];
      yl += (k & 1 ? -1 : 1) * o[k];
      yr += (k & 2 ? -1 : 1) * o[k];
    }
    // Fast Walsh-Hadamard transform: a lossless, fully mixing feedback matrix.
    for (let h = 1; h < N; h *= 2) {
      for (let a = 0; a < N; a += 2 * h) {
        for (let b = a; b < a + h; b++) {
          const u = o[b], v = o[b + h];
          o[b] = u + v;
          o[b + h] = u - v;
        }
      }
    }
    for (let k = 0; k < N; k++) {
      lines[k][write[k]] = o[k] / 4 + (k & 4 ? -x : x);
      write[k] = (write[k] + 1) % lines[k].length;
    }
    wetL[i] = yl * 0.25 + eL;
    wetR[i] = yr * 0.25 + eR;
  }
  // Narrow the wet signal: mid stays and side is scaled by `width`.
  let eDry = 0, eWet = 0;
  for (let i = 0; i < n; i++) {
    const mid = 0.5 * (wetL[i] + wetR[i]);
    const side = 0.5 * (wetL[i] - wetR[i]) * width;
    wetL[i] = mid + side;
    wetR[i] = mid - side;
    eDry += buf.L[i] ** 2 + buf.R[i] ** 2;
    eWet += wetL[i] ** 2 + wetR[i] ** 2;
  }
  const g = Math.sqrt((eDry / eWet) * 10 ** (-drr / 10));
  for (let i = 0; i < n; i++) {
    buf.L[i] += wetL[i] * g;
    buf.R[i] += wetR[i] * g;
  }
}

// =============================================================== 4. Mastering

/** BS.1770 K-weighting at 48 kHz, in place. */
function kWeight(ch) {
  run(ch, [1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585]);
  run(ch, [1, -2, 1, -1.99004745483398, 0.99007225036621]);
}

/**
 * BS.1770 loudness. `momentary` is the loudest 400 ms window and `shortTerm` the loudest 3 s window
 * (both slid sample by sample over zero padding). `integrated` is gated (-70 LUFS absolute, -10 LU
 * relative). The sounds are levelled on `momentary`, the closest match for a sound shorter than 3 s.
 */
function loudness(buf) {
  const pad = 3 * SR;
  const n = buf.length + 2 * pad;
  const L = new Float64Array(n);
  const R = new Float64Array(n);
  L.set(buf.L, pad);
  R.set(buf.R, pad);
  kWeight(L);
  kWeight(R);
  const sum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) sum[i + 1] = sum[i] + L[i] * L[i] + R[i] * R[i];
  const loudest = (w) => {
    let max = 0;
    for (let i = w; i <= n; i++) max = Math.max(max, sum[i] - sum[i - w]);
    return -0.691 + 10 * Math.log10(max / w);
  };
  const block = Math.round(0.4 * SR);
  const hop = block / 4;
  const blocks = [];
  for (let i = 0; i + block <= n; i += hop) blocks.push((sum[i + block] - sum[i]) / block);
  const lk = (z) => -0.691 + 10 * Math.log10(z);
  const abs = blocks.filter((z) => lk(z) > -70);
  const mean = (a) => a.reduce((s, z) => s + z, 0) / a.length;
  const rel = abs.length ? abs.filter((z) => lk(z) > lk(mean(abs)) - 10) : [];
  return { momentary: loudest(block), shortTerm: loudest(3 * SR), integrated: rel.length ? lk(mean(rel)) : -Infinity };
}

/** True peak: 4x oversampling with a 64-tap Blackman-windowed sinc per phase (BS.1770 Annex 2 in spirit). */
function truePeak(buf) {
  const K = 32;
  const phases = [1, 2, 3].map((p) => {
    const h = new Float64Array(2 * K);
    for (let k = -K + 1; k <= K; k++) {
      const t = k - p / 4;
      const sinc = Math.sin(Math.PI * t) / (Math.PI * t);
      const u = (t + K) / (2 * K);
      const w = 0.42 - 0.5 * Math.cos(TAU * u) + 0.08 * Math.cos(2 * TAU * u);
      h[k + K - 1] = sinc * w;
    }
    return h;
  });
  let peak = 0;
  for (const ch of [buf.L, buf.R]) {
    for (let i = 0; i < ch.length; i++) {
      peak = Math.max(peak, Math.abs(ch[i]));
      for (const h of phases) {
        let y = 0;
        for (let k = -K + 1; k <= K; k++) {
          const j = i + k;
          if (j >= 0 && j < ch.length) y += ch[j] * h[k + K - 1];
        }
        peak = Math.max(peak, Math.abs(y));
      }
    }
  }
  return peak;
}

/**
 * Gentle warmth: x + e·x² - d·x³, run at a drive measured against the sound's own peak, so every sound
 * is warmed the same whatever its level. It only adds 2nd and 3rd harmonics, so nothing aliases. The
 * high-pass that follows removes the small DC the even term leaves.
 */
function saturate(buf, drive) {
  const p = samplePeak(buf);
  if (!p || !drive) return;
  const d = drive / 3;
  const e = drive * 0.2;
  for (const ch of [buf.L, buf.R]) {
    for (let i = 0; i < ch.length; i++) {
      const x = ch[i] / p;
      ch[i] = (x + e * x * x - d * x * x * x) * p;
    }
  }
}

/**
 * Ends the sound where it has truly died. It cuts 10 ms after the last moment above -60 dB (from the
 * peak) and fades out with a raised cosine that starts once the sound is 40 dB down. It never cuts a
 * ring short unless `maxLength` forces it, and says so when it does.
 */
function trimTail(buf, maxLength, label) {
  const blk = Math.round(0.002 * SR);
  const env = [];
  for (let i = 0; i < buf.length; i += blk) {
    let m = 0;
    for (let j = i; j < Math.min(i + blk, buf.length); j++) m = Math.max(m, Math.abs(buf.L[j]), Math.abs(buf.R[j]));
    env.push(m);
  }
  const peak = Math.max(...env);
  const lastAbove = (db) => {
    for (let b = env.length - 1; b >= 0; b--) if (env[b] > peak * fromDb(db)) return (b + 1) * blk;
    return 0;
  };
  const natural = lastAbove(-60) + Math.round(0.01 * SR);
  const end = Math.min(natural, buf.length, Math.round(maxLength * SR));
  const minFade = Math.round(0.015 * SR);
  const fadeFrom = Math.min(lastAbove(-40), end - minFade);
  if (lastAbove(-40) > end - minFade) console.warn(`  ! ${label}: cut while still above -40 dB (capped at ${maxLength}s)`);
  for (let i = fadeFrom; i < end; i++) {
    const g = 0.5 + 0.5 * Math.cos((Math.PI * (i - fadeFrom)) / (end - fadeFrom));
    buf.L[i] *= g;
    buf.R[i] *= g;
  }
  buf.L = buf.L.slice(0, end);
  buf.R = buf.R.slice(0, end);
  buf.length = end;
  return { audible: lastAbove(-40) / SR };
}

/**
 * The finishing chain for the iPhone's speaker. It tames 3-6 kHz with a broad cut and softens the air
 * above 10 kHz. It adds gentle saturation and a 4th-order high-pass at ~140 Hz (nothing a phone could
 * play), sets the loudness to `lufs`, keeps the true peak under `ceiling` (-1.5 dBTP, leaving room for
 * the AAC encoder's overshoot) and gives the sound a natural tail.
 */
function master(buf, { lufs, maxLength, label, hp = 140, tame = { f: 4300, gain: -3, q: 0.9 }, air = { f: 10000, gain: -3 }, body = null, drive = 0.1, ceiling = -1.5 }) {
  if (body) filt(buf, 'peak', body.f, { gain: body.gain, q: body.q });
  filt(buf, 'peak', tame.f, { gain: tame.gain, q: tame.q });
  filt(buf, 'highshelf', air.f, { gain: air.gain });
  saturate(buf, drive);
  highpass4(buf, hp);
  scale(buf, fromDb(lufs - loudness(buf).momentary));
  const tp = truePeak(buf);
  let limited = 0;
  if (tp > fromDb(ceiling)) {
    limited = dB(tp) - ceiling;
    scale(buf, fromDb(ceiling) / tp);
  }
  const { audible } = trimTail(buf, maxLength, label);
  return { buf, audible, limited };
}

// =============================================================== 5. Recipes

/**
 * The shared grammar, in D major. Every family plays the same notes at the same moments; only the
 * material changes. The onsets land on the haptic beats in feedback.ts: rise at 0 / 120 / 240 ms and
 * bloom at 0 / 90 ms.
 *   pop         D6                               one blow: « c'est noté »
 *   pop-bright  D6, then A6 75 ms later          a rising fifth: « noté, et bien vu »
 *   chime       F#6 A6 D7, 55 ms apart           the triad, landing on the upper tonic, which rings
 *   bloom       A5 grazed, then D6 F#6 A6 rolled at 90 ms   a chord that opens
 *   rise        D6, A6, then D7 + D6 (+ a breath of F#6) at 0, 120 and 240 ms   the crescendo of « J'ai tenu »
 */
const ROLES = ['pop', 'pop-bright', 'chime', 'bloom', 'rise'];

/** Loudness targets (LUFS, loudest 400 ms) and length caps: a gentle hierarchy, the same for every family. */
const TARGET = { pop: -22, 'pop-bright': -21.5, chime: -20.5, bloom: -20.5, rise: -19.5 };
const CAP = { pop: 0.25, 'pop-bright': 0.45, chime: 0.6, bloom: 0.7, rise: 1.2 };

/**
 * The score for each role. `t` scales the decay (τ of the fundamental, in s), `v` the velocities and
 * `h` the mallet's hardness, so each family plays the same score with its own feel.
 */
function score(role, { t, v = 1, h = 1 }) {
  const n = (note, at, tau, vel, extra = {}) => ({ note, at, tau: tau * t, vel: Math.min(1, vel * v), hard: (extra.hard ?? 1) * h, pan: extra.pan ?? 0, seed: extra.seed ?? Math.round(at * 1000) + 3 });
  switch (role) {
    case 'pop':
      return [n('D6', 0, 0.042, 0.9)];
    case 'pop-bright':
      return [n('D6', 0, 0.05, 0.82, { pan: -0.06 }), n('A6', 0.075, 0.064, 0.86, { pan: 0.08 })];
    case 'chime':
      return [n('F#6', 0, 0.055, 0.66, { pan: -0.1 }), n('A6', 0.055, 0.06, 0.76, { pan: 0.04 }), n('D7', 0.11, 0.092, 0.92, { pan: 0.1 }), n('D6', 0.11, 0.085, 0.26, { pan: -0.05, hard: 1.3 })];
    case 'bloom':
      return [
        n('A5', 0, 0.06, 0.4, { pan: -0.12, hard: 1.35 }),
        n('D6', 0.09, 0.112, 0.62, { pan: -0.1, hard: 1.2 }),
        n('F#6', 0.103, 0.105, 0.6, { pan: 0.04, hard: 1.2 }),
        n('A6', 0.117, 0.1, 0.66, { pan: 0.14, hard: 1.15 }),
      ];
    case 'rise':
      return [
        n('D6', 0, 0.075, 0.55, { pan: -0.14 }),
        n('A6', 0.12, 0.085, 0.72, { pan: 0.0 }),
        n('D7', 0.24, 0.18, 0.95, { pan: 0.12 }),
        n('D6', 0.24, 0.17, 0.42, { pan: -0.08, hard: 1.25 }),
        n('F#6', 0.247, 0.15, 0.16, { pan: 0.05, hard: 1.4 }),
      ];
    default:
      throw new Error(role);
  }
}

/** The family: a material, its feel on the shared score, its room and its finishing. */
const FAMILIES = [
  {
    id: 'A',
    dir: 'A-verre',
    name: 'Verre',
    material: 'crystal',
    feel: { t: 1, v: 1, h: 1 },
    room: { rt60: 0.24, size: 1, predelay: 0.006, drr: 17, damp: 0.3, low: 400, high: 9500, width: 0.55 },
    master: { tame: { f: 4400, gain: -3.5, q: 0.9 }, air: { f: 10500, gain: -3 }, drive: 0.07 },
    character: 'Du cristal frappé d’une baguette dure : net, brillant, précis, avec le léger miroitement (les doublets) d’un vrai verre.',
    lines: {
      pop: 'Un petit bol de cristal touché du bout de la baguette : un « tink » en ré, net, éteint aussitôt.',
      'pop-bright': 'Le même tink, puis sa quinte (la) un souffle plus haut : noté, et bien vu.',
      chime: 'Fa♯, la, ré : l’accord monte en trois verres et le ré aigu reste, soutenu à l’octave, avec le miroitement du cristal.',
      bloom: 'Un la grave effleuré, puis l’accord de ré qui s’ouvre en arpège rapide, baguette plus douce.',
      rise: 'Ré, la, puis le ré aigu doublé à l’octave, en crescendo sur les trois vibrations ; il chante un peu plus d’une demi-seconde.',
    },
  },
];

function renderSound(family, role) {
  const events = score(role, family.feel);
  const seconds = CAP[role] + 0.6;
  const buf = stereo(seconds);
  for (const e of events) {
    const s = strike(family.material, hz(e.note), { tau: e.tau, vel: e.vel, hard: e.hard, pan: e.pan, seed: e.seed, seconds: seconds - e.at });
    mixInto(buf, s, e.at);
  }
  room(buf, family.room);
  return master(buf, { ...family.master, lufs: TARGET[role], maxLength: CAP[role], label: `${family.id}/${role}` });
}

// =============================================================== 6. Files

/** 24-bit PCM WAV with TPDF dither at the 24-bit floor. */
function wav24(buf) {
  const data = Buffer.alloc(buf.length * 6);
  const rand = random(1);
  for (let i = 0; i < buf.length; i++) {
    for (const [c, ch] of [buf.L, buf.R].entries()) {
      const v = Math.round(ch[i] * 8388607 + (rand() - rand()));
      data.writeIntLE(Math.max(-8388608, Math.min(8388607, v)), i * 6 + c * 3, 3);
    }
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(SR, 24);
  header.writeUInt32LE(SR * 6, 28);
  header.writeUInt16LE(6, 32);
  header.writeUInt16LE(24, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** AAC-LC in an .m4a. afconvert writes the encoder's priming and padding, so players trim them. */
function aac(wavPath, m4aPath) {
  execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '128000', '-q', '127', '-s', '0', wavPath, m4aPath]);
}

/** Clips in order, `gap` s of silence between them, with a short lead-in and tail. */
function reel(clips, gap, lead = 0.3, tail = 0.5) {
  const total = lead + clips.reduce((s, c) => s + c.length / SR, 0) + gap * (clips.length - 1) + tail;
  const out = stereo(total);
  let at = lead;
  for (const c of clips) {
    mixInto(out, c, at);
    at += c.length / SR + gap;
  }
  return out;
}

function writePair(dir, name, buf) {
  const wavPath = join(dir, `${name}.wav`);
  writeFileSync(wavPath, wav24(buf));
  aac(wavPath, join(dir, `${name}.m4a`));
  return wavPath;
}

function notesFor(family, rows) {
  const table = rows
    .map((r) => `| \`${r.role}\` | ${family.lines[r.role]} | ${r.seconds.toFixed(2)} s (audible ${r.audible.toFixed(2)} s) | ${r.momentary.toFixed(1)} LUFS | ${r.truePeak.toFixed(1)} dBTP |`)
    .join('\n');
  return `# ${family.id} · « ${family.name} »

${family.character}

| Son | Ce qu’on entend | Durée | Sonie (400 ms max) | Crête vraie |
| --- | --- | --- | --- | --- |
${table}

- **Durée**: the length of the file, which ends once the sound is 60 dB under its peak. « Audible »: the moment it falls 40 dB under its peak.
- **Sonie**: BS.1770, the loudest 400 ms window (momentary max), the fair measure for a sound shorter than 3 s.
- \`showreel.m4a\`: the five sounds in this order, 0.8 s apart.
- Notes: D major (D6 = 1175 Hz). Onsets of \`rise\` at 0, 120 and 240 ms, of \`bloom\` at 0 and 90 ms, in time with the haptics.
`;
}

// --------------------------------------------------------------- Run

export { strike, room, master, loudness, truePeak, MATERIALS, hz, stereo, SR, renderSound, FAMILIES, beamShape, forcePulse, pulseGain };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

function main() {
  const assets = resolve(dirname(fileURLToPath(import.meta.url)), '../../assets/sounds');
  const previewAt = process.argv.indexOf('--preview');
  const preview = previewAt > -1 ? resolve(process.argv[previewAt + 1]) : null;
  const work = preview ?? mkdtempSync(join(tmpdir(), 'symbiose-sounds-'));
  mkdirSync(work, { recursive: true });
  mkdirSync(assets, { recursive: true });
  const family = FAMILIES[0];
  const rows = [];
  const clips = [];
  console.log(`${family.name}`);
  for (const role of ROLES) {
    const { buf, audible, limited } = renderSound(family, role);
    clips.push(buf);
    writePair(work, role, buf);
    copyFileSync(join(work, `${role}.m4a`), join(assets, `${role}.m4a`));
    const l = loudness(buf);
    const row = {
      role,
      seconds: buf.length / SR,
      audible,
      momentary: l.momentary,
      truePeak: dB(truePeak(buf)),
      kb: Math.round(statSync(join(assets, `${role}.m4a`)).size / 102.4) / 10,
    };
    rows.push(row);
    console.log(
      `  ${role.padEnd(11)} ${row.seconds.toFixed(3)} s (audible ${row.audible.toFixed(2)})  M ${row.momentary.toFixed(1)} LUFS  TP ${row.truePeak.toFixed(2)} dBTP${limited ? `  (TP-limited ${limited.toFixed(1)} dB)` : ''}  ${row.kb} KB`,
    );
  }
  if (preview) {
    writePair(preview, 'showreel', reel(clips, 0.8));
    rmSync(join(preview, 'showreel.wav'));
    writeFileSync(join(preview, 'notes.md'), notesFor(family, rows));
    console.log(`preview: ${preview}`);
  } else {
    rmSync(work, { recursive: true, force: true });
  }
  console.log(`sounds: ${assets}`);
}
