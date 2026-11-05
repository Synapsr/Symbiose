import { HttpError } from '@symbiose/core';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { storage } from '@/lib/storage';

import { LoopbackAuth } from '../../modules/loopback-auth';

/**
 * Sign in with ChatGPT, plan usage for open-source and locally hosted apps:
 * https://developers.openai.com/siwc/token-sharing-open-source
 *
 * - The first sign-in registers this phone (`dynamic_agent_client`, with a
 *   stable `ext_agent_host_id`); OpenAI answers with the client id to keep.
 * - OpenAI only redirects to `http://127.0.0.1:<port>/auth/callback`: a
 *   one-shot server in the app (modules/loopback-auth) receives the code.
 * - Access tokens last an hour, refresh tokens 30 days and rotate: refreshes
 *   go one at a time, and a network failure never erases them.
 * Tokens stay in the Keychain (Keystore), never in logs or URLs.
 */

const ACCOUNTS = 'https://auth.openai.com/api/accounts';
const AUTHORIZE = `${ACCOUNTS}/authorize`;
const TOKEN = `${ACCOUNTS}/oauth/token`;
const DISCOVERY = 'https://auth.openai.com/.well-known/openid-configuration';
const RESOURCE = 'https://api.openai.com/v1';
const SCOPE = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const CALLBACK_PATH = '/auth/callback';
const KEY = 'symbiose.chatgpt';
/** Time to sign in (the person may create an account on the way). */
const SIGN_IN_TIMEOUT = 15 * 60_000;

interface Stored {
  /** This phone, for OpenAI: chosen once, never a person's identifier. */
  hostId: string;
  /** Issued at the first sign-in, reused afterwards. */
  clientId?: string;
  accessToken?: string;
  refreshToken?: string;
  idToken?: string;
  /** Epoch ms. */
  expiresAt?: number;
  email?: string | null;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
}

let cache: Stored | null = null;
let refreshing: Promise<string> | null = null;

async function load(): Promise<Stored> {
  if (cache) return cache;
  const raw = await storage.get(KEY).catch(() => null);
  cache = raw ? (JSON.parse(raw) as Stored) : { hostId: `urn:uuid:${Crypto.randomUUID()}` };
  if (!raw) await save(cache);
  return cache;
}

async function save(next: Stored): Promise<void> {
  cache = next;
  await storage.set(KEY, JSON.stringify(next));
}

const base64url = (base64: string) => base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomString = (bytes: number) => base64url(btoa(String.fromCharCode(...Crypto.getRandomBytes(bytes))));

/** The claims of a JWT, unverified: only the nonce and the email are read. */
function claims(jwt: string | undefined): Record<string, unknown> {
  try {
    const payload = jwt?.split('.')[1];
    if (!payload) return {};
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=');
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), (char) => char.charCodeAt(0)))) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const SUCCESS_PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Symbiose</title><style>body{font:17px -apple-system,system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;background:#f6f4ef;color:#1d1b16;text-align:center}
@media(prefers-color-scheme:dark){body{background:#151412;color:#f2efe8}}p{opacity:.7}</style></head>
<body><div><h1>C’est bon&nbsp;!</h1><p>Retourne dans Symbiose. · You can go back to Symbiose.</p></div></body></html>`;

export type SignInResult = { ok: true; email: string | null } | { ok: false; reason: 'cancelled' | 'unavailable' | 'failed'; message?: string };

/** Opens OpenAI's sign-in, and keeps the tokens when the person comes back. */
export async function signInWithChatGpt(): Promise<SignInResult> {
  if (!LoopbackAuth) return { ok: false, reason: 'unavailable' };
  const stored = await load();
  const verifier = randomString(48);
  const challenge = base64url(await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 }));
  const state = randomString(24);
  const nonce = randomString(24);

  let port: number;
  try {
    port = await LoopbackAuth.start(CALLBACK_PATH, SUCCESS_PAGE);
  } catch (error) {
    return { ok: false, reason: 'failed', message: error instanceof Error ? error.message : String(error) };
  }
  const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`;
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: stored.clientId ?? 'dynamic_agent_client',
    redirect_uri: redirectUri,
    scope: SCOPE,
    resource: RESOURCE,
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ext_agent_host_id: stored.hostId,
  });
  if (!stored.clientId) params.set('agent_name_hint', 'Symbiose');
  if (stored.idToken) params.set('id_token_hint', stored.idToken);

  // The browser comes back to the app's own server; closing it first means "cancel".
  const redirect = LoopbackAuth.waitForRedirect(SIGN_IN_TIMEOUT);
  const browser = WebBrowser.openAuthSessionAsync(`${AUTHORIZE}?${params.toString()}`, 'symbiose://chatgpt', {
    // Shares Safari's sign-in, so someone already signed in to ChatGPT there only confirms.
    preferEphemeralSession: false,
  });
  const first = await Promise.race([redirect.then((target) => ({ target })), browser.then(() => ({ target: undefined as string | null | undefined }))]);
  let target = first.target;
  if (target === undefined) {
    // The browser closed: the redirect may still arrive in the same instant.
    target = await Promise.race([redirect, new Promise<null>((resolve) => setTimeout(() => resolve(null), 800))]);
    LoopbackAuth.stop();
  } else {
    if (Platform.OS === 'ios') WebBrowser.dismissAuthSession();
    else LoopbackAuth.bringToFront();
  }
  if (!target) return { ok: false, reason: 'cancelled' };

  const query = new URLSearchParams(target.split('?')[1] ?? '');
  if (query.get('state') !== state) return { ok: false, reason: 'failed', message: 'state mismatch' };
  const error = query.get('error');
  if (error) return error === 'access_denied' ? { ok: false, reason: 'cancelled' } : { ok: false, reason: 'failed', message: query.get('error_description') ?? error };
  const code = query.get('code');
  if (!code) return { ok: false, reason: 'failed', message: 'no code' };
  const clientId = query.get('client_id') ?? stored.clientId;
  if (!clientId) return { ok: false, reason: 'failed', message: 'no client id' };

  let tokens: TokenResponse;
  try {
    tokens = await postForm<TokenResponse>(TOKEN, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
      resource: RESOURCE,
    });
  } catch (err) {
    return { ok: false, reason: 'failed', message: err instanceof Error ? err.message : String(err) };
  }
  const idClaims = claims(tokens.id_token);
  if (tokens.id_token && idClaims.nonce !== nonce) return { ok: false, reason: 'failed', message: 'nonce mismatch' };
  const email = typeof idClaims.email === 'string' ? idClaims.email : null;
  await save({ ...stored, clientId, ...tokenFields(tokens, stored), email });
  return { ok: true, email };
}

function tokenFields(tokens: TokenResponse, previous: Stored): Pick<Stored, 'accessToken' | 'refreshToken' | 'idToken' | 'expiresAt'> {
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? previous.refreshToken,
    idToken: tokens.id_token ?? previous.idToken,
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
  };
}

class OAuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`${code} (${status})`);
  }
}

async function postForm<T>(url: string, body: Record<string, string>): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(body).toString(),
  });
  const text = await res.text();
  const data = (() => {
    try {
      return text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  })();
  if (!res.ok) {
    const code = typeof data.error === 'string' ? data.error : ((data.error as { code?: string } | undefined)?.code ?? `http_${res.status}`);
    throw new OAuthError(res.status, code);
  }
  return data as T;
}

/** Refresh errors that mean the session is over: sign in again (errors-and-recovery). */
const TERMINAL = new Set(['token_expired', 'refresh_token_expired', 'invalid_grant', 'refresh_token_invalidated', 'refresh_token_reused']);

const reconnect = () => new HttpError(424, 'ai_reconnect', 'Sign in to ChatGPT again');

/** A valid access token, refreshed when it is about to expire (or when asked after a 401). */
export async function chatGptAccessToken(options: { fresh?: boolean } = {}): Promise<string> {
  const stored = await load();
  if (!stored.accessToken || !stored.refreshToken || !stored.clientId) throw reconnect();
  if (!options.fresh && stored.expiresAt && stored.expiresAt - 120_000 > Date.now()) return stored.accessToken;
  // One refresh at a time: the refresh token rotates, two at once would burn it.
  refreshing ??= (async () => {
    try {
      const current = await load();
      const tokens = await postForm<TokenResponse>(TOKEN, {
        grant_type: 'refresh_token',
        client_id: current.clientId!,
        refresh_token: current.refreshToken!,
        resource: RESOURCE,
      });
      const next = { ...current, ...tokenFields(tokens, current) };
      await save(next);
      return next.accessToken!;
    } catch (error) {
      if (error instanceof OAuthError && (TERMINAL.has(error.code) || error.status === 401)) {
        const current = await load();
        await save({ hostId: current.hostId, clientId: current.clientId, email: current.email });
        throw reconnect();
      }
      // A network failure keeps the tokens: the next try may work.
      throw new HttpError(424, 'ai_unreachable', 'Could not reach ChatGPT');
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** Whether this phone holds a ChatGPT session (it may still need a refresh). */
export async function chatGptAccount(): Promise<{ signedIn: boolean; email: string | null }> {
  const stored = await load();
  return { signedIn: Boolean(stored.refreshToken && stored.clientId), email: stored.email ?? null };
}

/**
 * Signs out: revokes the refresh token at OpenAI, then forgets the tokens. The
 * client id and this phone's host id stay, as OpenAI asks, for the next sign-in.
 * Returns false when the revocation couldn't be confirmed (the person can still
 * disconnect Symbiose from ChatGPT's settings).
 */
export async function signOutOfChatGpt(): Promise<boolean> {
  const stored = await load();
  let revoked = !stored.refreshToken;
  if (stored.refreshToken && stored.clientId) {
    try {
      const discovery = (await (await fetch(DISCOVERY)).json()) as { revocation_endpoint?: string };
      if (discovery.revocation_endpoint) {
        const res = await fetch(discovery.revocation_endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: stored.refreshToken, token_type_hint: 'refresh_token', client_id: stored.clientId }).toString(),
        });
        revoked = res.ok;
      }
    } catch {
      revoked = false;
    }
  }
  await save({ hostId: stored.hostId, clientId: stored.clientId, email: stored.email });
  return revoked;
}

/** Where people set what Symbiose may use of their plan. */
export const CHATGPT_USAGE_URL = 'https://chatgpt.com/#settings';
