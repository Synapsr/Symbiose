import QRCode from 'qrcode';

const escape = (value: string) => value.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** Small status page with a QR code the mobile app scans to connect. */
export async function landingPage(opts: { url: string; version: string; aiEnabled: boolean; model: string | null }): Promise<string> {
  const qr = await QRCode.toString(opts.url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  const isLocal = /\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)/.test(opts.url);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Symbiose server</title>
<style>
  :root { --bg: #f6f5f1; --card: #fff; --text: #141414; --muted: #6b6b6b; --accent: #1f8a5b; --line: rgba(0,0,0,.08); }
  @media (prefers-color-scheme: dark) { :root { --bg: #0b0b0c; --card: #161618; --text: #f4f4f2; --muted: #9a9a9a; --line: rgba(255,255,255,.08); } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--text);
         font: 16px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; padding: 16px; }
  main { width: min(420px, 100%); background: var(--card); border: 1px solid var(--line); border-radius: 28px; padding: 32px; text-align: center; }
  h1 { font-size: 28px; letter-spacing: -0.02em; margin: 0 0 4px; }
  p { margin: 0; color: var(--muted); }
  .qr { background: #fff; border-radius: 20px; padding: 16px; margin: 24px auto; width: 240px; }
  .qr svg { display: block; width: 100%; height: auto; }
  code { font: 14px ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; }
  .pill { display: inline-flex; gap: 6px; align-items: center; border: 1px solid var(--line); border-radius: 999px; padding: 4px 12px; font-size: 14px; margin-top: 16px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: ${opts.aiEnabled ? 'var(--accent)' : '#d9822b'}; }
  .warn { margin-top: 16px; font-size: 14px; color: #d9822b; }
</style>
</head>
<body>
<main>
  <h1>Symbiose</h1>
  <p>Your server is running · v${escape(opts.version)}</p>
  <div class="qr">${qr}</div>
  <p>Open the Symbiose app, tap <strong>Scan server</strong> and point it at this code, or enter:</p>
  <p><code>${escape(opts.url)}</code></p>
  <span class="pill"><span class="dot"></span>${opts.aiEnabled ? `AI ready · ${escape(opts.model ?? '')}` : 'AI disabled · set ANTHROPIC_API_KEY'}</span>
  ${isLocal ? '<p class="warn">This address only works on this machine. Open this page through your LAN IP or domain, or set PUBLIC_URL.</p>' : ''}
</main>
</body>
</html>`;
}
