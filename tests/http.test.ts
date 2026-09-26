import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { audioFile, compressed, staticFile } from '../lib/http';

const dir = mkdtempSync(join(tmpdir(), 'echo-http-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const clip = join(dir, 'clip.mp3');
writeFileSync(clip, new Uint8Array(4000).fill(7));
const script = join(dir, 'app.js');
writeFileSync(script, 'console.log("echo");\n'.repeat(200));
const request = (headers: Record<string, string> = {}) => new Request('http://echo.test/x', { headers: { 'accept-encoding': 'gzip, br', ...headers } });

test('a byte range of a recording stays that range through compression', async () => {
  const req = request({ range: 'bytes=0-1' });
  const res = await compressed(req, audioFile(req, Bun.file(clip)));
  expect(res.status).toBe(206);
  expect(res.headers.get('content-range')).toBe('bytes 0-1/4000');
  expect((await res.arrayBuffer()).byteLength).toBe(2);
});

test('a recording the phone already has comes back as 304, and is kept for a day', async () => {
  const first = audioFile(request(), Bun.file(clip));
  expect(first.headers.get('cache-control')).toBe('max-age=86400');
  const again = audioFile(request({ 'if-none-match': first.headers.get('etag')! }), Bun.file(clip));
  expect(again.status).toBe(304);
});

test('the app is gzipped for a browser that accepts it, and revalidates to 304 until it changes', async () => {
  const req = request();
  const res = await compressed(req, staticFile(req, Bun.file(script)));
  expect(res.headers.get('content-encoding')).toBe('gzip');
  expect(new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(await res.arrayBuffer())))).toBe('console.log("echo");\n'.repeat(200));
  const etag = res.headers.get('etag')!;
  expect(staticFile(request({ 'if-none-match': etag }), Bun.file(script)).status).toBe(304);
  writeFileSync(script, 'console.log("changed");\n'.repeat(200));
  expect(staticFile(request({ 'if-none-match': etag }), Bun.file(script)).status).toBe(200);
});

test('JSON goes plain to a browser that does not accept gzip', async () => {
  const res = await compressed(new Request('http://echo.test/x'), Response.json({ words: Array.from({ length: 300 }, (_, i) => i) }));
  expect(res.headers.get('content-encoding')).toBeNull();
  expect((await res.json() as { words: number[] }).words.length).toBe(300);
});
