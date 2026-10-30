// Inlines the French page into dist/index.html (fast first paint, crawlable
// content), preloads the two fonts used above the fold and resolves absolute
// URLs for social cards when SITE_URL is set (e.g. https://symbiose.example).
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const dist = new URL('../dist/', import.meta.url);
const ssr = new URL('../dist-ssr/', import.meta.url);

const { render } = await import(new URL('entry-server.js', ssr).href);

let html = readFileSync(new URL('index.html', dist), 'utf8');
if (!html.includes('<!--app-html-->')) throw new Error('dist/index.html has no <!--app-html--> placeholder');

const assets = readdirSync(new URL('assets/', dist));
const preload = ['fraunces-latin-opsz-normal', 'fraunces-latin-opsz-italic', 'instrument-sans-latin-wght-normal']
  .map((prefix) => assets.find((file) => file.startsWith(prefix) && file.endsWith('.woff2')))
  .filter(Boolean)
  .map((file) => `<link rel="preload" href="/assets/${file}" as="font" type="font/woff2" crossorigin />`)
  .join('\n    ');

const site = (process.env.SITE_URL ?? '').trim().replace(/\/+$/, '');
const seo = site ? `<link rel="canonical" href="${site}/" />\n    <meta property="og:url" content="${site}/" />` : '';

// One small page: inlining its CSS saves a render-blocking round trip.
const stylesheet = html.match(/<link rel="stylesheet"[^>]*href="\/assets\/([^"]+\.css)"[^>]*>/);
if (stylesheet) {
  const css = readFileSync(new URL(`assets/${stylesheet[1]}`, dist), 'utf8');
  html = html.replace(stylesheet[0], () => `<style>${css}</style>`);
}

// The page is fully readable without JS: let fonts and images go first.
html = html.replace(/<script type="module" crossorigin src=/, '<script type="module" crossorigin fetchpriority="low" src=');

html = html
  .replace('<!--app-html-->', render('fr'))
  .replace('<!--preload-->', preload)
  .replace('<!--seo-->', seo)
  .replaceAll('%OG_IMAGE%', `${site}/og.jpg`);

writeFileSync(new URL('index.html', dist), html);
rmSync(ssr, { recursive: true, force: true });

console.log(`prerendered dist/index.html (${Math.round(html.length / 1024)} kB)${site ? ` for ${site}` : ''}`);
