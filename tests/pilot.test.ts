import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPilot } from '../pilot/router';

const ORIGIN = 'https://echo.example';
const CLIENT = 'client-123.apps.googleusercontent.com';
const data = mkdtempSync(join(tmpdir(), 'pilot-test-'));
// Stands in for each learner's Echo: answers with the learner it was reached for and what it was sent.
const echo = Bun.serve({ port: 0, fetch: (req) => Response.json({ path: new URL(req.url).pathname, cookie: req.headers.get('cookie') }) });
// Stands in for Google's token endpoint: signs in whoever the test says, for the nonce of that sign-in.
let identity: Record<string, unknown> = {};
const idToken = (claims: Record<string, unknown>) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`;
const pilot = createPilot({
  data, origin: ORIGIN, ownerData: data, firstPort: 7900, owner: 'Gal',
  google: { clientId: CLIENT, clientSecret: 'secret' },
  exchange: async () => ({ id_token: idToken(identity) }),
  backend: async (learner) => `http://127.0.0.1:${echo.port}/as/${learner.id}`,
});
afterAll(() => { pilot.stop(); echo.stop(); rmSync(data, { recursive: true, force: true }); });

const get = (path: string, headers: Record<string, string> = {}) => pilot.publicFetch(new Request(`${ORIGIN}${path}`, { headers }));
// The whole round trip through Google for whoever `claims` names; returns the callback's answer.
async function signIn(claims: Record<string, unknown>, tamper: (params: URLSearchParams) => void = () => {}) {
  const started = await get('/auth/google');
  const google = new URL(started.headers.get('location')!);
  expect(google.searchParams.get('scope')).toBe('openid email profile');
  expect(google.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/auth/callback`);
  identity = { iss: 'https://accounts.google.com', aud: CLIENT, exp: Math.floor(Date.now() / 1000) + 600, email_verified: true, nonce: google.searchParams.get('nonce'), ...claims };
  const back = new URLSearchParams({ code: 'code-1', state: google.searchParams.get('state')! });
  tamper(back);
  return get(`/auth/callback?${back}`);
}
const cookieOf = (response: Response) => response.headers.get('set-cookie')?.match(/echo_session=([^;]*)/)?.[1] ?? '';

test('only emails on the list are let in, each to their own Echo, which never sees the session cookie', async () => {
  pilot.accounts.add({ email: 'Dana@Gmail.com', name: 'Dana' });
  const stranger = await signIn({ email: 'mallory@gmail.com' });
  expect(stranger.headers.get('location')).toBe('/signin?denied=mallory%40gmail.com');
  expect(cookieOf(stranger)).toBe('');
  const dana = await signIn({ email: 'dana@gmail.com', name: 'Dana Cohen' });
  expect(dana.headers.get('location')).toBe('/echo/');
  expect(dana.headers.get('set-cookie')).toContain('HttpOnly; Secure; SameSite=Lax');
  const reached = await (await get('/echo/api/state', { cookie: `other=1; echo_session=${cookieOf(dana)}` })).json();
  expect(reached).toEqual({ path: '/as/dana/echo/api/state', cookie: null });
});

test('without a session a page goes to sign-in and anything else is refused, before reaching any Echo', async () => {
  const page = await get('/echo/', { accept: 'text/html' });
  expect(page.status).toBe(303);
  expect(page.headers.get('location')).toBe('/signin');
  expect((await get('/echo/api/state', { cookie: 'echo_session=made-up' })).status).toBe(401);
});

test('removing a friend signs them out everywhere at once; adding them back keeps their folder and port', async () => {
  const friend = pilot.accounts.add({ email: 'noa@gmail.com', name: 'Noa' });
  const phone = cookieOf(await signIn({ email: 'noa@gmail.com' })), laptop = cookieOf(await signIn({ email: 'noa@gmail.com' }));
  expect((await get('/echo/api/state', { cookie: `echo_session=${laptop}` })).status).toBe(200);
  pilot.accounts.remove(friend.id);
  for (const token of [phone, laptop]) expect((await get('/echo/api/state', { cookie: `echo_session=${token}` })).status).toBe(401);
  expect((await signIn({ email: 'noa@gmail.com' })).headers.get('location')).toBe('/signin?denied=noa%40gmail.com');
  expect(pilot.accounts.add({ email: 'noa@gmail.com', name: 'Noa' })).toEqual(friend);
});

test('a sign-in that is not exactly the one started here is refused', async () => {
  pilot.accounts.add({ email: 'yael@gmail.com', name: 'Yael' });
  const refused = async (response: Response) => { expect(response.headers.get('location')).toStartWith('/signin?failed='); expect(cookieOf(response)).toBe(''); };
  await refused(await signIn({ email: 'yael@gmail.com', aud: 'someone-elses-client' }));
  await refused(await signIn({ email: 'yael@gmail.com', nonce: 'replayed' }));
  await refused(await signIn({ email: 'yael@gmail.com', email_verified: false }));
  await refused(await signIn({ email: 'yael@gmail.com', exp: Math.floor(Date.now() / 1000) - 60 }));
  await refused(await signIn({ email: 'yael@gmail.com' }, (params) => params.set('state', 'forged')));
  // A state is good once: the same callback a second time is refused.
  const started = new URL((await get('/auth/google')).headers.get('location')!);
  identity = { iss: 'accounts.google.com', aud: CLIENT, exp: Math.floor(Date.now() / 1000) + 600, email_verified: true, nonce: started.searchParams.get('nonce'), email: 'yael@gmail.com' };
  const callback = `/auth/callback?code=c&state=${started.searchParams.get('state')}`;
  expect(cookieOf(await get(callback))).not.toBe('');
  await refused(await get(callback));
});

test('signing out needs a POST from Echo itself, and ends that session only', async () => {
  pilot.accounts.add({ email: 'tal@gmail.com', name: 'Tal' });
  const first = cookieOf(await signIn({ email: 'tal@gmail.com' })), second = cookieOf(await signIn({ email: 'tal@gmail.com' }));
  const out = (origin: string, method = 'POST') => pilot.publicFetch(new Request(`${ORIGIN}/auth/signout`, { method, headers: { cookie: `echo_session=${first}`, origin } }));
  expect((await out('https://evil.example')).status).toBe(403);
  expect((await out(ORIGIN, 'GET')).status).toBe(403);
  expect((await get('/echo/api/state', { cookie: `echo_session=${first}` })).status).toBe(200);
  expect((await out(ORIGIN)).headers.get('location')).toBe('/signin');
  expect((await get('/echo/api/state', { cookie: `echo_session=${first}` })).status).toBe(401);
  expect((await get('/echo/api/state', { cookie: `echo_session=${second}` })).status).toBe(200);
});
