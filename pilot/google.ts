// Sign in with Google (OAuth 2.0 authorization code with PKCE), asking only for the email and name. start() sends the
// browser to Google; finish() trades the code Google sends back for an ID token, straight from Google's token
// endpoint over TLS, and checks it is meant for this client, fresh, for this very sign-in (state and nonce), and for
// an email Google has verified. Who may come in is the router's call (accounts.admit).
import { createHash, randomBytes } from 'node:crypto';

export type GoogleConfig = { clientId: string; clientSecret: string; redirectUri: string };
export type Identity = { email: string; name: string };
// What Google's token endpoint answers for a code; replaceable so the flow can be tested without Google.
export type Exchange = (input: { code: string; verifier: string; config: GoogleConfig }) => Promise<{ id_token?: string }>;

const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
// A sign-in started and not finished within this is forgotten.
const PENDING_MS = 10 * 60_000;

export class SignInError extends Error {}

const googleExchange: Exchange = async ({ code, verifier, config }) => {
  const response = await fetch(TOKEN, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, code_verifier: verifier, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, grant_type: 'authorization_code' }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new SignInError(`Google refused the sign-in (${response.status}).`);
  return await response.json() as { id_token?: string };
};

export function createGoogle(config: GoogleConfig, options: { exchange?: Exchange; now?: () => number } = {}) {
  const exchange = options.exchange ?? googleExchange;
  const now = options.now ?? Date.now;
  const pending = new Map<string, { verifier: string; nonce: string; at: number }>();

  return {
    // The Google address to send the browser to, remembering what this sign-in must come back with.
    start(): string {
      for (const [state, entry] of pending) if (now() - entry.at > PENDING_MS) pending.delete(state);
      const state = randomBytes(24).toString('base64url'), verifier = randomBytes(48).toString('base64url'), nonce = randomBytes(24).toString('base64url');
      pending.set(state, { verifier, nonce, at: now() });
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      return `${AUTHORIZE}?${new URLSearchParams({
        client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code', scope: 'openid email profile',
        state, nonce, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account',
      })}`;
    },
    // The Google account behind a callback; throws SignInError for anything not exactly this sign-in.
    async finish(code: string | null, state: string | null): Promise<Identity> {
      const entry = state ? pending.get(state) : undefined;
      if (state) pending.delete(state);
      if (!code || !entry || now() - entry.at > PENDING_MS) throw new SignInError('This sign-in expired or was not started here. Try again.');
      const { id_token } = await exchange({ code, verifier: entry.verifier, config });
      const payload = id_token?.split('.')[1];
      if (!payload) throw new SignInError('Google sent no identity back.');
      let claims: Record<string, unknown>;
      try { claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { throw new SignInError('Google sent an identity Echo could not read.'); }
      if (!ISSUERS.has(String(claims.iss)) || claims.aud !== config.clientId) throw new SignInError('That identity was not issued for Echo.');
      if (typeof claims.exp !== 'number' || claims.exp * 1000 < now()) throw new SignInError('That sign-in has expired. Try again.');
      if (claims.nonce !== entry.nonce) throw new SignInError('That sign-in does not match this one. Try again.');
      if (claims.email_verified !== true || typeof claims.email !== 'string') throw new SignInError('Google has not verified this account’s email address.');
      return { email: claims.email.toLowerCase(), name: typeof claims.name === 'string' ? claims.name : claims.email };
    },
  };
}
export type Google = ReturnType<typeof createGoogle>;
