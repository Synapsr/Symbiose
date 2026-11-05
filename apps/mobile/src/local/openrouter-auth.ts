import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { LoopbackAuth } from '../../modules/loopback-auth';

/**
 * « Se connecter à OpenRouter »: OpenRouter's OAuth PKCE gives the app a key
 * of the person's own account, billed to their credits. No client secret, no
 * server: the browser comes back to the app's one-shot loopback server.
 * https://openrouter.ai/docs/guides/overview/auth/oauth
 */

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Symbiose</title>
<style>body{font:17px -apple-system,system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;background:#f6f4ef;color:#1d1b16;text-align:center}
@media(prefers-color-scheme:dark){body{background:#151412;color:#f2efe8}}p{opacity:.7}</style></head>
<body><div><h1>C’est bon&nbsp;!</h1><p>Retourne dans Symbiose. · You can go back to Symbiose.</p></div></body></html>`;

const base64url = (base64: string) => base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export type OpenRouterResult = { ok: true; key: string } | { ok: false; reason: 'cancelled' | 'unavailable' | 'failed' };

export async function signInWithOpenRouter(): Promise<OpenRouterResult> {
  if (!LoopbackAuth) return { ok: false, reason: 'unavailable' };
  const verifier = base64url(btoa(String.fromCharCode(...Crypto.getRandomBytes(48))));
  const challenge = base64url(await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 }));
  let port: number;
  try {
    port = await LoopbackAuth.start('/callback', PAGE);
  } catch {
    return { ok: false, reason: 'failed' };
  }
  const params = new URLSearchParams({ callback_url: `http://localhost:${port}/callback`, code_challenge: challenge, code_challenge_method: 'S256' });
  const redirect = LoopbackAuth.waitForRedirect(15 * 60_000);
  const browser = WebBrowser.openAuthSessionAsync(`https://openrouter.ai/auth?${params.toString()}`, 'symbiose://openrouter', { preferEphemeralSession: false });
  const first = await Promise.race([redirect.then((target) => ({ target })), browser.then(() => ({ target: undefined as string | null | undefined }))]);
  let target = first.target;
  if (target === undefined) {
    target = await Promise.race([redirect, new Promise<null>((resolve) => setTimeout(() => resolve(null), 800))]);
    LoopbackAuth.stop();
  } else if (Platform.OS === 'ios') WebBrowser.dismissAuthSession();
  else LoopbackAuth.bringToFront();
  const code = target ? new URLSearchParams(target.split('?')[1] ?? '').get('code') : null;
  if (!code) return { ok: false, reason: 'cancelled' };
  try {
    const res = await fetch('https://openrouter.ai/api/v1/auth/keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
    });
    const body = (await res.json()) as { key?: string };
    return res.ok && body.key ? { ok: true, key: body.key } : { ok: false, reason: 'failed' };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
