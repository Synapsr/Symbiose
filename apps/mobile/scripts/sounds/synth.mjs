#!/usr/bin/env node
/**
 * Symbiose's feedback sounds, synthesised from scratch: no samples, no
 * downloads, so they can be regenerated (and changed) by anyone and stay ours.
 *
 *   node apps/mobile/scripts/sounds/synth.mjs [--preview <dir>]
 *
 * Writes `apps/mobile/assets/sounds/*.m4a` (AAC, through macOS `afconvert`).
 * With `--preview`, also writes the WAVs, a showreel of the whole family and
 * a small page to listen to them in `<dir>`.
 *
 * The family, « Bourgeon »: one key (D major pentatonic, D5 to A7, where phone
 * speakers sing), glassy partials that ring like a glossy cell, a little
 * upward bend for the bud, soft attacks and a short warm room. Every sound
 * is quiet by design, measured with the BS.1770 K-weighting.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 48000;
const TAU = Math.PI * 2;
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../../assets/sounds');

/** D major pentatonic, the family's one key. */
const N = {
  D5: 587.33,
  Fs5: 739.99,
  A5: 880,
  B5: 987.77,
  D6: 1174.66,
  E6: 1318.51,
  Fs6: 1479.98,
  A6: 1760,
  B6: 1975.53,
  D7: 2349.32,
  E7: 2637.02,
  Fs7: 2959.96,
  A7: 3520,
};

// ---------------------------------------------------------------- Building blocks

/** A seeded random: the sparkles land in the same places every time. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Raised-cosine attack (no click), then an exponential decay. */
function envelope(t, attack, decay) {
  if (t < 0) return 0;
  const rise = t < attack ? 0.5 - 0.5 * Math.cos((Math.PI * t) / attack) : 1;
  return rise * Math.exp(-Math.max(0, t - attack) / decay);
}

function stereo(seconds) {
  const length = Math.round(seconds * SR);
  return { length, L: new Float64Array(length), R: new Float64Array(length) };
}

/** Adds a voice (a function of its own time, called sample by sample) at `start` s, panned -1…1 at equal power. */
function add(buf, start, voice, { gain = 1, pan = 0, seconds = Infinity } = {}) {
  const from = Math.round(start * SR);
  const to = Math.min(buf.length, from + Math.round(Math.min(seconds, buf.length / SR) * SR));
  const angle = ((pan + 1) * Math.PI) / 4;
  const l = Math.cos(angle) * gain;
  const r = Math.sin(angle) * gain;
  for (let i = from; i < to; i++) {
    const s = voice((i - from) / SR);
    buf.L[i] += s * l;
    buf.R[i] += s * r;
  }
}

/**
 * A struck glass: a few inharmonic partials (a free bar's 1 : 2.76 : 5.40),
 * the higher ones fading first. `cents` detunes it a hair for width.
 */
function glass(freq, { attack = 0.004, decay = 0.25, cents = 0, partials = [[1, 1, 1], [2.756, 0.2, 0.42], [5.404, 0.05, 0.2]] } = {}) {
  const f = freq * 2 ** (cents / 1200);
  return (t) => {
    let s = 0;
    for (const [ratio, amp, life] of partials) s += amp * Math.sin(TAU * f * ratio * t) * envelope(t, attack, decay * life);
    return s;
  };
}

/** A small FM bell: a bright, glassy strike that settles into a pure tone. */
function bell(freq, { ratio = 3.5, index = 1.1, indexDecay = 0.06, attack = 0.003, decay = 0.3 } = {}) {
  return (t) => envelope(t, attack, decay) * Math.sin(TAU * freq * t + index * Math.exp(-t / indexDecay) * Math.sin(TAU * freq * ratio * t));
}

/** The bud: a round sine whose pitch springs up, like a droplet or a pod opening. */
function bud(from, to, { sweep = 0.016, attack = 0.0025, decay = 0.05 } = {}) {
  let phase = 0;
  return (t) => {
    const f = to + (from - to) * Math.exp(-t / sweep);
    phase += (TAU * f) / SR;
    return envelope(t, attack, decay) * (Math.sin(phase) + 0.1 * Math.sin(2 * phase));
  };
}

/** A warm, woody pluck (kalimba-like) that blooms: it starts a little flat and bends up into tune. */
function bloom(freq, { bend = -40, bendTime = 0.03, attack = 0.006, decay = 0.32 } = {}) {
  let phase = 0;
  return (t) => {
    phase += (TAU * freq * 2 ** ((bend * Math.exp(-t / bendTime)) / 1200)) / SR;
    return (
      envelope(t, attack, decay) * Math.sin(phase) +
      0.1 * envelope(t, attack * 0.6, decay * 0.22) * Math.sin(phase * 3.93) +
      0.025 * envelope(t, 0.002, decay * 0.08) * Math.sin(phase * 9.2) +
      0.16 * envelope(t, attack * 2, decay * 0.8) * Math.sin(phase * 0.5)
    );
  };
}

/** A soft sine bed with a slow rise, for body under a chord. */
function pad(freq, { attack = 0.06, decay = 0.5, vibrato = 0 } = {}) {
  let phase = 0;
  return (t) => {
    phase += (TAU * freq * (1 + vibrato * Math.sin(TAU * 5.2 * t))) / SR;
    return envelope(t, attack, decay) * Math.sin(phase);
  };
}

// ---------------------------------------------------------------- Processing

/** RBJ biquads, run in place on both channels. */
function biquad(buf, type, freq, q = Math.SQRT1_2) {
  const w = (TAU * freq) / SR;
  const alpha = Math.sin(w) / (2 * q);
  const cos = Math.cos(w);
  let b0, b1, b2;
  if (type === 'lowpass') [b0, b1, b2] = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2];
  else [b0, b1, b2] = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
  const a0 = 1 + alpha;
  filter(buf, [b0 / a0, b1 / a0, b2 / a0], [1, (-2 * cos) / a0, (1 - alpha) / a0]);
}

function filter(buf, [b0, b1, b2], [, a1, a2]) {
  for (const ch of [buf.L, buf.R]) {
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
}

/** Freeverb (Jezar's), small and warm: 8 damped combs and 4 allpasses per side, with a pre-delay. */
function room(buf, { size = 0.6, damp = 0.45, wet = 0.18, predelay = 0.012 } = {}) {
  const scale = SR / 44100;
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const allpasses = [556, 441, 341, 225];
  const feedback = size * 0.28 + 0.7;
  const damping = damp * 0.4;
  const side = (spread) => {
    const c = combs.map((n) => ({ data: new Float64Array(Math.round((n + spread) * scale)), i: 0, store: 0 }));
    const a = allpasses.map((n) => ({ data: new Float64Array(Math.round((n + spread) * scale)), i: 0 }));
    return (x) => {
      let out = 0;
      for (const comb of c) {
        const y = comb.data[comb.i];
        comb.store = y * (1 - damping) + comb.store * damping;
        comb.data[comb.i] = x + comb.store * feedback;
        comb.i = (comb.i + 1) % comb.data.length;
        out += y;
      }
      for (const ap of a) {
        const y = ap.data[ap.i];
        ap.data[ap.i] = out + y * 0.5;
        ap.i = (ap.i + 1) % ap.data.length;
        out = y - out;
      }
      return out;
    };
  };
  const left = side(0);
  const right = side(23);
  const delay = Math.round(predelay * SR);
  // The room hears the dry sound only, never its own tail.
  const dry = Float64Array.from(buf.L, (l, i) => l + buf.R[i]);
  for (let i = 0; i < buf.length; i++) {
    const j = i - delay;
    const input = j >= 0 ? dry[j] * 0.015 : 0;
    // Wet only: the dry signal is already there.
    buf.L[i] += left(input) * wet * 3;
    buf.R[i] += right(input) * wet * 3;
  }
}

/** BS.1770 K-weighting (48 kHz coefficients), then the loudest 400 ms window, in LUFS. */
function loudness(buf) {
  const pad = Math.round(0.4 * SR);
  const k = { length: buf.length + 2 * pad, L: new Float64Array(buf.length + 2 * pad), R: new Float64Array(buf.length + 2 * pad) };
  k.L.set(buf.L, pad);
  k.R.set(buf.R, pad);
  filter(k, [1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585]);
  filter(k, [1, -2, 1], [1, -1.99004745483398, 0.99007225036621]);
  const window = Math.round(0.4 * SR);
  const hop = Math.round(0.01 * SR);
  let sum = 0;
  for (let i = 0; i < window; i++) sum += k.L[i] ** 2 + k.R[i] ** 2;
  let max = sum;
  for (let i = window, n = 0; i < k.length; i++) {
    sum += k.L[i] ** 2 + k.R[i] ** 2 - k.L[i - window] ** 2 - k.R[i - window] ** 2;
    if (++n % hop === 0) max = Math.max(max, sum);
  }
  return -0.691 + 10 * Math.log10(max / window);
}

function peak(buf) {
  let p = 0;
  for (let i = 0; i < buf.length; i++) p = Math.max(p, Math.abs(buf.L[i]), Math.abs(buf.R[i]));
  return p;
}

function gain(buf, g) {
  for (let i = 0; i < buf.length; i++) {
    buf.L[i] *= g;
    buf.R[i] *= g;
  }
}

/** The finishing chain: room, clean lows and highs, level to `lufs` (peaks kept under -3 dBFS), soft edges. */
function master(buf, { lufs, reverb }) {
  room(buf, reverb);
  // Phone speakers can't play below ~200 Hz anyway; above 11 kHz is only fizz.
  biquad(buf, 'highpass', 170);
  biquad(buf, 'highpass', 170);
  biquad(buf, 'lowpass', 11000);
  gain(buf, 10 ** ((lufs - loudness(buf)) / 20));
  const ceiling = 10 ** (-3 / 20);
  const p = peak(buf);
  if (p > ceiling) gain(buf, ceiling / p);
  const fadeIn = Math.round(0.0008 * SR);
  const fadeOut = Math.round(0.12 * SR);
  for (let i = 0; i < buf.length; i++) {
    let g = 1;
    if (i < fadeIn) g = i / fadeIn;
    const left = buf.length - 1 - i;
    if (left < fadeOut) g *= 0.5 - 0.5 * Math.cos((Math.PI * left) / fadeOut);
    buf.L[i] *= g;
    buf.R[i] *= g;
  }
  return buf;
}

// ---------------------------------------------------------------- The family

/** « C'est noté »: a meal is saved. A bud pops, a glass answers. Barely there. */
function pop() {
  const buf = stereo(0.42);
  add(buf, 0, bud(392, 587.33), { gain: 0.9 });
  add(buf, 0.012, glass(N.D6, { decay: 0.11 }), { gain: 0.3, pan: 0.15 });
  return master(buf, { lufs: -21, reverb: { size: 0.45, wet: 0.13 } });
}

/** « Noté, et bien vu »: the same pop, and a fifth above it, when the meal suits the plan. */
function popBright() {
  const buf = stereo(0.62);
  add(buf, 0, bud(392, 587.33), { gain: 0.9 });
  add(buf, 0.012, glass(N.D6, { decay: 0.12 }), { gain: 0.3, pan: -0.15 });
  add(buf, 0.085, glass(N.A6, { decay: 0.2, cents: -3 }), { gain: 0.22, pan: 0.25 });
  add(buf, 0.085, glass(N.A6, { decay: 0.2, cents: 3 }), { gain: 0.22, pan: 0.45 });
  return master(buf, { lufs: -20.5, reverb: { size: 0.5, wet: 0.16 } });
}

/** A daily goal reached: three crystal bells climb to the home note and ring there. */
function chime() {
  const buf = stereo(0.8);
  add(buf, 0, bell(N.Fs5, { decay: 0.16 }), { gain: 0.5, pan: -0.25 });
  add(buf, 0.07, bell(N.A5, { decay: 0.18 }), { gain: 0.55, pan: 0 });
  add(buf, 0.14, bell(N.D6, { decay: 0.34, index: 1.3 }), { gain: 0.62, pan: 0.25 });
  add(buf, 0.14, glass(N.D6, { decay: 0.3, cents: 4 }), { gain: 0.18, pan: -0.2 });
  // Body for headphones, sparkle for the speaker.
  add(buf, 0.14, pad(N.D5, { attack: 0.02, decay: 0.28 }), { gain: 0.14 });
  add(buf, 0.16, glass(N.D7, { decay: 0.12 }), { gain: 0.07, pan: 0.5 });
  return master(buf, { lufs: -19, reverb: { size: 0.55, wet: 0.2 } });
}

/** A milestone, or a good day recognised: a warm chord rolls up and blooms into tune. */
function bloomChord() {
  const buf = stereo(0.8);
  const notes = [
    [N.D5, -0.3, 0.55],
    [N.A5, -0.1, 0.5],
    [N.D6, 0.1, 0.45],
    [N.Fs6, 0.3, 0.32],
  ];
  notes.forEach(([freq, pan, g], i) => add(buf, i * 0.045, bloom(freq, { decay: 0.3 - i * 0.02 }), { gain: g, pan }));
  add(buf, 0.135, glass(N.A6, { decay: 0.16 }), { gain: 0.06, pan: 0.4 });
  return master(buf, { lufs: -19.5, reverb: { size: 0.6, wet: 0.2 } });
}

/** « J'ai tenu »: the big one. A swell, a climbing cascade, a ringing chord, a little glitter. */
function rise() {
  const buf = stereo(1.55);
  // The swell under the climb.
  add(buf, 0, pad(N.D5, { attack: 0.3, decay: 0.25, vibrato: 0.002 }), { gain: 0.14 });
  // The climb, left to right, louder at each step.
  const climb = [N.D5, N.Fs5, N.A5, N.D6, N.Fs6];
  climb.forEach((freq, i) => add(buf, i * 0.06, glass(freq, { decay: 0.14 }), { gain: 0.32 + i * 0.09, pan: -0.45 + i * 0.22 }));
  // The chord it lands on, with a warm bed under it.
  const at = 0.32;
  add(buf, at, bell(N.D6, { decay: 0.55, index: 1.2 }), { gain: 0.5, pan: -0.3 });
  add(buf, at, bell(N.Fs6, { decay: 0.5, index: 1 }), { gain: 0.42, pan: 0.3 });
  add(buf, at + 0.012, bell(N.A6, { decay: 0.48, index: 0.9 }), { gain: 0.36, pan: -0.1 });
  add(buf, at + 0.02, glass(N.D7, { decay: 0.4, cents: 3 }), { gain: 0.16, pan: 0.15 });
  add(buf, at - 0.02, pad(N.D5, { attack: 0.05, decay: 0.6 }), { gain: 0.15, pan: -0.2 });
  add(buf, at - 0.02, pad(N.A5, { attack: 0.06, decay: 0.55 }), { gain: 0.12, pan: 0.2 });
  // Glitter: high glass ticks scattered over the ring.
  const random = seeded(7);
  const glitter = [N.D7, N.E7, N.Fs7, N.A7, N.B6];
  for (let i = 0; i < 9; i++) {
    const when = at + 0.08 + i * 0.065 + random() * 0.03;
    add(buf, when, glass(glitter[Math.floor(random() * glitter.length)], { decay: 0.1 + random() * 0.08 }), { gain: 0.05 + random() * 0.035 - i * 0.003, pan: random() * 1.4 - 0.7 });
  }
  return master(buf, { lufs: -17.5, reverb: { size: 0.68, wet: 0.24 } });
}

/** File name, the sound, and the moment it belongs to (for the preview page). */
const FAMILY = [
  ['pop', pop, 'C’est noté', 'Un repas est enregistré, son analyse arrive.'],
  ['pop-bright', popBright, 'Noté, et bien vu', 'L’analyse arrive et le repas colle bien au plan.'],
  ['chime', chime, 'Objectif du jour atteint', 'Protéines, fibres ou eau : la première fois de la journée.'],
  ['bloom', bloomChord, 'Un cap, une belle journée', 'Plan créé, premier repas, une semaine notée, ou « hier, c’était une belle journée ».'],
  ['rise', rise, 'J’ai tenu', 'Une envie surfée : la plus grande récompense.'],
];

// ---------------------------------------------------------------- Files

function wav(buf) {
  const data = Buffer.alloc(buf.length * 4);
  const random = seeded(1);
  for (let i = 0; i < buf.length; i++) {
    for (const [c, ch] of [buf.L, buf.R].entries()) {
      // TPDF dither, a whisper below the 16-bit floor.
      const dither = (random() - random()) / 32768;
      data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round((ch[i] + dither) * 32767))), i * 4 + c * 2);
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
  header.writeUInt32LE(SR * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** AAC in an .m4a: small, and played by iOS, Android and every browser. */
function aac(wavPath, m4aPath) {
  execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '128000', '-q', '127', '-s', '0', wavPath, m4aPath]);
}

function showreel(buffers) {
  const gap = 0.9;
  const total = 0.3 + buffers.reduce((s, b) => s + b.length / SR + gap, 0);
  const reel = stereo(total);
  let at = Math.round(0.3 * SR);
  for (const b of buffers) {
    reel.L.set(b.L, at);
    reel.R.set(b.R, at);
    at += b.length + Math.round(gap * SR);
  }
  return reel;
}

function page(rows) {
  const items = rows
    .map(
      (r) => `<li><div><strong>${r.moment}</strong><span>${r.when}</span><code>${r.name}.m4a · ${r.seconds.toFixed(2)} s · ${r.kb} Ko · ${r.lufs.toFixed(1)} LUFS</code></div><audio controls preload="auto" src="${r.name}.m4a"></audio></li>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sons Bourgeon</title>
<style>
:root{--bg:#F5F4F0;--card:#fff;--text:#111;--muted:#6E6E73;--accent:#1F8A5B;--bud:#B6E35A}
@media (prefers-color-scheme:dark){:root{--bg:#0A0A0B;--card:#161618;--text:#F5F5F3;--muted:#9A9AA0;--accent:#3DD68C}}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.45 -apple-system,system-ui,sans-serif}
main{max-width:640px;margin:0 auto;padding:32px 16px 64px}
h1{font:600 30px/1.1 ui-serif,Georgia,serif;margin:0 0 6px}
p{color:var(--muted);margin:0 0 24px}
ul{list-style:none;margin:0;padding:0;display:grid;gap:12px}
li{background:var(--card);border-radius:22px;padding:16px;display:grid;gap:12px}
li div{display:grid;gap:2px}
span{color:var(--muted)}
code{font:12px ui-monospace,monospace;color:var(--muted);font-variant-numeric:tabular-nums}
audio{width:100%}
.reel{border:1.5px solid var(--accent)}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--bud);margin-right:8px}
</style></head><body><main>
<h1><span class="dot"></span>Sons Bourgeon</h1>
<p>La famille de sons de Symbiose, synthétisée de zéro (aucun échantillon). Calme par défaut, coupée par le mode silencieux.</p>
<ul>
<li class="reel"><div><strong>Tout d’un coup</strong><span>Les cinq sons à la suite, pour écouter sur le téléphone.</span></div><audio controls preload="auto" src="showreel.m4a"></audio></li>
${items}
</ul></main></body></html>
`;
}

// ---------------------------------------------------------------- Run

const previewAt = process.argv.indexOf('--preview');
const preview = previewAt > -1 ? resolve(process.argv[previewAt + 1]) : null;
const work = mkdtempSync(join(tmpdir(), 'symbiose-sounds-'));
mkdirSync(OUT, { recursive: true });
if (preview) mkdirSync(preview, { recursive: true });

const rows = [];
const buffers = [];
for (const [name, make, moment, when] of FAMILY) {
  const buf = make();
  buffers.push(buf);
  const wavPath = join(work, `${name}.wav`);
  const m4aPath = join(OUT, `${name}.m4a`);
  writeFileSync(wavPath, wav(buf));
  aac(wavPath, m4aPath);
  const row = { name, moment, when, seconds: buf.length / SR, lufs: loudness(buf), peak: 20 * Math.log10(peak(buf)), kb: Math.round(statSync(m4aPath).size / 102.4) / 10 };
  rows.push(row);
  if (preview) {
    copyFileSync(wavPath, join(preview, `${name}.wav`));
    copyFileSync(m4aPath, join(preview, `${name}.m4a`));
  }
  console.log(`${name.padEnd(11)} ${row.seconds.toFixed(2)} s  ${row.lufs.toFixed(1)} LUFS (max 400 ms)  peak ${row.peak.toFixed(1)} dBFS  ${row.kb} KB`);
}

if (preview) {
  const reelWav = join(work, 'showreel.wav');
  writeFileSync(reelWav, wav(showreel(buffers)));
  aac(reelWav, join(preview, 'showreel.m4a'));
  writeFileSync(join(preview, 'preview.html'), page(rows));
  console.log(`preview: ${join(preview, 'preview.html')}`);
}
rmSync(work, { recursive: true, force: true });
